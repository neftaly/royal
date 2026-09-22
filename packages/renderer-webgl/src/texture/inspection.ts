import { formatFailure } from "../diagnostics/format-failure";
import type { DecodedTextureSource, TextureSourceRef } from "./source";
import type { TextureInspection, TextureInspector } from "./inspection-policy";

type Inspection = {
  controller: AbortController;
  promise: Promise<void>;
  users: number;
  settled: boolean;
};
const aborted = () => new DOMException("Texture inspection was aborted", "AbortError");

type QueuedInspection = {
  start: () => void;
  cancel: () => void;
  previous?: QueuedInspection | undefined;
  next?: QueuedInspection | undefined;
};

/** Root-local bounded sampling/classification and pixel decisions shared by texture producers. */
export class TextureInspectionOwner implements TextureInspector {
  readonly #policy: TextureInspection;
  readonly #entries = new Map<string, Inspection>();
  readonly #completed = new Map<string, Promise<void>>();
  #head: QueuedInspection | undefined;
  #tail: QueuedInspection | undefined;
  readonly #concurrency: number;
  #active = 0;
  #disposed = false;
  #sampler?: import("./inspection-sample").TextureInspectionSampler;

  constructor(policy: TextureInspection) {
    this.#policy = policy;
    this.#concurrency = policy.concurrency ?? 1;
    if (!Number.isInteger(this.#concurrency) || this.#concurrency < 1 || this.#concurrency > 4) {
      throw new RangeError("Royal textureInspection concurrency must be an integer from 1 to 4");
    }
  }

  #schedule<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.#disposed || signal.aborted) return Promise.reject(aborted());
    return new Promise<T>((resolve, reject) => {
      const remove = () => {
        if (job.previous === undefined) this.#head = job.next;
        else job.previous.next = job.next;
        if (job.next === undefined) this.#tail = job.previous;
        else job.next.previous = job.previous;
        job.previous = job.next = undefined;
        signal.removeEventListener("abort", job.cancel);
      };
      const job: QueuedInspection = {
        cancel: () => { remove(); reject(aborted()); },
        start: () => {
          remove();
          this.#active++;
          // Active jobs retain their lane and borrowed pixels until their callback settles.
          void (async () => {
            try {
              const value = await run();
              if (this.#disposed || signal.aborted) throw aborted();
              resolve(value);
            } catch (error) { reject(error); }
            finally { this.#active--; this.#drain(); }
          })();
        },
      };
      job.previous = this.#tail;
      if (this.#tail === undefined) this.#head = job;
      else this.#tail.next = job;
      this.#tail = job;
      signal.addEventListener("abort", job.cancel, { once: true });
      this.#drain();
    });
  }

  #drain(): void {
    while (!this.#disposed && this.#active < this.#concurrency && this.#head !== undefined) {
      this.#head.start();
    }
  }

  async accept(_asset: TextureSourceRef, decoded: DecodedTextureSource, signal: AbortSignal): Promise<DecodedTextureSource> {
    let retained = decoded;
    try {
      return await this.#schedule(async () => {
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
          const images = await this.#sampler.samplesAsync(retained, mip, signal);
          try {
            for (const image of images) await this.#inspectPixels(async () => image, signal);
          } finally { for (const image of images) { image.width = 1; image.height = 1; } }
        }
        return retained;
      }, signal);
    } catch (error) { retained.close?.(); throw error; }
  }

  async sample(source: DecodedTextureSource, mip = 0): Promise<HTMLCanvasElement> {
    const { TextureInspectionSampler } = await import("./inspection-sample");
    if (this.#disposed) throw aborted();
    this.#sampler ??= new TextureInspectionSampler();
    return this.#sampler.sample(source, mip);
  }

  /** Fingerprint every newly prepared representation before consulting cached decisions. */
  async inspectPixels(_key: string, sample: () => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void> {
    return this.#schedule(() => this.#inspectPixels(sample, signal), signal);
  }

  async #inspectPixels(sample: () => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void> {
    if (this.#disposed || signal.aborted) throw aborted();
    const image = await sample();
    try {
      if (this.#disposed || signal.aborted) throw aborted();
      const { inspectionSampleKey } = await import("./inspection-sample");
      if (this.#disposed || signal.aborted) throw aborted();
      const pixels = await inspectionSampleKey(image);
      // Policy identity is implicit in this owner. Aliases with equal pixels share inference.
      await this.#decision("pixels:" + pixels, abort => this.#classify(async () => image, abort), signal);
    } finally { image.width = 1; image.height = 1; }
  }

  async #classify(sample: (signal: AbortSignal) => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.#disposed) throw aborted();
    const image = await sample(signal);
    try {
      if (signal.aborted || this.#disposed) throw aborted();
      const allowed = await this.#policy.allow(image, signal);
      if (signal.aborted || this.#disposed) throw aborted();
      if (allowed !== true) throw new Error("Royal texture blocked by inspection");
    } finally { image.width = 1; image.height = 1; }
  }

  async inspect(key: string, sample: (signal: AbortSignal) => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void> {
    return this.#decision("source:" + key, abort => this.#schedule(() => this.#classify(sample, abort), abort), signal);
  }

  #retain(key: string, entry: Inspection): void {
    if (!entry.settled || entry.users !== 0 || this.#entries.get(key) !== entry) return;
    this.#entries.delete(key);
    if (this.#disposed || entry.controller.signal.aborted) return;
    this.#completed.set(key, entry.promise);
    if (this.#completed.size > 1024) this.#completed.delete(this.#completed.keys().next().value!);
  }

  async #decision(key: string, run: (signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<void> {
    if (this.#disposed || signal.aborted) throw aborted();
    const cached = this.#completed.get(key);
    if (cached !== undefined) {
      this.#completed.delete(key);
      this.#completed.set(key, cached);
      await cached;
      if (this.#disposed || signal.aborted) throw aborted();
      return;
    }
    let entry = this.#entries.get(key);
    if (entry?.controller.signal.aborted) { this.#entries.delete(key); entry = undefined; }
    if (entry === undefined) {
      const controller = new AbortController();
      entry = { controller, promise: Promise.resolve(), users: 0, settled: false };
      const created = entry;
      entry.promise = Promise.resolve().then(() => {
        if (controller.signal.aborted || this.#disposed) throw aborted();
        return run(controller.signal);
      }).catch((error: unknown) => {
        if (controller.signal.aborted) throw aborted();
        throw new Error(formatFailure(error));
      }).finally(() => {
        created.settled = true;
        this.#retain(key, created);
      });
      this.#entries.set(key, entry);
    }
    entry.users++;
    const current = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (--current.users === 0 && !current.settled) current.controller.abort();
      this.#retain(key, current);
    };
    signal.addEventListener("abort", release, { once: true });
    try {
      // A canceled producer must keep shared borrowed pixels alive until settlement.
      await current.promise;
      if (signal.aborted || this.#disposed) throw aborted();
    } finally { signal.removeEventListener("abort", release); release(); }
  }

  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#entries.values()) entry.controller.abort();
    this.#entries.clear();
    this.#completed.clear();
    while (this.#head !== undefined) this.#head.cancel();
    this.#sampler?.dispose();
  }
}
