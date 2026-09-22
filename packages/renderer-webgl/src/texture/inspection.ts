import { formatFailure } from "../diagnostics/format-failure";
import { decodedTextureKey, type DecodedTextureSource, type TextureSourceRef } from "./source";
import type { TextureInspection, TextureInspector } from "./inspection-policy";

type Inspection = {
  controller: AbortController;
  promise: Promise<void>;
  users: number;
  settled: boolean;
};
const aborted = () => new DOMException("Texture inspection was aborted", "AbortError");

/** Root-local decisions and one bounded classification lane, shared by texture producers. */
export class TextureInspectionOwner implements TextureInspector {
  readonly #policy: TextureInspection;
  readonly #entries = new Map<string, Inspection>();
  #tail: Promise<void> = Promise.resolve();
  #disposed = false;
  #sampler?: import("./inspection-sample").TextureInspectionSampler;

  constructor(policy: TextureInspection) { this.#policy = policy; }

  async accept(asset: TextureSourceRef, decoded: DecodedTextureSource, signal: AbortSignal): Promise<DecodedTextureSource> {
    let retained = decoded;
    try {
      if (decoded.preview !== undefined) throw new Error("Royal texture inspection requires final pixels, not a deferred preview");
      if (decoded.kind === undefined) {
        const { freezeInspectionSource } = await import("./inspection-sample");
        if (signal.aborted || this.#disposed) throw aborted();
        retained = freezeInspectionSource(decoded);
      }
      const count = retained.kind === undefined ? 1 : retained.levels.length;
      if (count === 0) throw new Error("Royal texture inspection requires image pixels");
      for (let mip = 0; mip < count; mip++) {
        const { TextureInspectionSampler } = await import("./inspection-sample");
        if (signal.aborted || this.#disposed) throw aborted();
        this.#sampler ??= new TextureInspectionSampler();
        const images = this.#sampler.samples(retained, mip);
        try {
          for (const image of images) await this.inspectPixels("image:" + decodedTextureKey(asset), async () => image, signal);
        } finally { for (const image of images) { image.width = 1; image.height = 1; } }
      }
      return retained;
    } catch (error) { retained.close?.(); throw error; }
  }

  async sample(source: DecodedTextureSource, mip = 0): Promise<HTMLCanvasElement> {
    const { TextureInspectionSampler } = await import("./inspection-sample");
    if (this.#disposed) throw aborted();
    this.#sampler ??= new TextureInspectionSampler();
    return this.#sampler.sample(source, mip);
  }

  /** Fingerprint every newly prepared representation before consulting cached decisions. */
  async inspectPixels(key: string, sample: () => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void> {
    if (this.#disposed || signal.aborted) throw aborted();
    const image = await sample();
    try {
      const { inspectionSampleKey } = await import("./inspection-sample");
      const pixels = await inspectionSampleKey(image);
      await this.inspect(key + ":" + pixels, async () => image, signal);
    } finally { image.width = 1; image.height = 1; }
  }

  async inspect(key: string, sample: (signal: AbortSignal) => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void> {
    if (this.#disposed || signal.aborted) throw aborted();
    let entry = this.#entries.get(key);
    if (entry?.controller.signal.aborted) { this.#entries.delete(key); entry = undefined; }
    if (entry === undefined) {
      const controller = new AbortController();
      entry = { controller, promise: Promise.resolve(), users: 0, settled: false };
      const created = entry;
      entry.promise = this.#tail.then(async () => {
        if (controller.signal.aborted) throw aborted();
        const image = await sample(controller.signal);
        try {
          if (controller.signal.aborted) throw aborted();
          const allowed = await this.#policy.allow(image, controller.signal);
          if (controller.signal.aborted) throw aborted();
          if (allowed !== true) throw new Error("Royal texture blocked by inspection");
        } finally { image.width = 1; image.height = 1; }
      }).catch((error: unknown) => {
        if (controller.signal.aborted) throw aborted();
        // Cache only a bounded diagnostic, not an arbitrary consumer exception graph.
        throw new Error(formatFailure(error));
      }).finally(() => {
        created.settled = true;
        if (controller.signal.aborted && this.#entries.get(key) === created) this.#entries.delete(key);
        // Retain decisions, never decoded pixels. Evict only completed work.
        for (const [oldKey, old] of this.#entries) {
          if (this.#entries.size <= 1024) break;
          if (old.settled && old.users === 0) this.#entries.delete(oldKey);
        }
      });
      this.#tail = entry.promise.catch(() => undefined);
      this.#entries.set(key, entry);
    } else {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    entry.users++;
    const current = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (--current.users === 0 && !current.settled) current.controller.abort();
    };
    signal.addEventListener("abort", release, { once: true });
    try {
      // Keep the producer's borrowed source alive until shared sampling has finished.
      await current.promise;
      if (signal.aborted || this.#disposed) throw aborted();
    } finally { signal.removeEventListener("abort", release); release(); }
  }

  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#entries.values()) entry.controller.abort();
    this.#entries.clear();
    this.#sampler?.dispose();
  }
}
