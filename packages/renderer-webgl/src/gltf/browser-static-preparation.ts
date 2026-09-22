import { workerScriptUrl } from "../workers/runtime";
import { pool, type Pool } from "workerpool";
import workerUrl from "./static-preparation-worker.ts?worker&url";
import { gltfCodecUrls } from "./codec-loader";
import type { PreparedStaticGltf } from "./static-asset";
import type { TextureVersion } from "@royal/renderer-core";
import { formatFailure } from "../diagnostics/format-failure";
import type { StaticGltfResourceRequest } from "./static-buffer-demand";
import type { StaticGltfResourceReader } from "./static-source";
import type { StaticGeometryTaskPlan } from "./static-geometry-plan";

export { readGltfResourceRangesWithFetch } from "./browser-range-read";

const WORKER_GLTF_BYTE_THRESHOLD = 256 * 1024;
// Keep workers/codecs warm across short pauses between asset bursts.
const DEFAULT_IDLE_WORKER_TIMEOUT_MS = 5_000;

const isGlb = (bytes: Uint8Array): boolean => bytes.byteLength >= 4
  && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46_54_6c_67;

/** Keeps tiny self-contained GLBs synchronous while external and substantial assets leave the UI thread. */
export const shouldPrepareStaticGltfInWorker = (bytes: Uint8Array): boolean =>
  !isGlb(bytes) || bytes.byteLength >= WORKER_GLTF_BYTE_THRESHOLD;

const abortFailure = (): DOMException => new DOMException(
  "Royal glTF preparation was aborted",
  "AbortError",
);

export type BrowserStaticGltfPreparationOwnerOptions = Readonly<{
  cancelDelay?(handle: unknown): void;
  idleWorkerTimeoutMs?: number;
  requestDelay?(callback: () => void, delayMs: number): unknown;
  workerLimit?: number;
}>;

/** The root scheduler admits work; workerpool owns worker reuse and task routing. */
export class BrowserStaticGltfPreparationOwner {
  readonly #options: BrowserStaticGltfPreparationOwnerOptions;
  readonly #available: boolean;
  #pool: Pool | undefined;
  #idleHandle: unknown;
  #disposed = false;
  readonly #active = new Set<() => void>();

  constructor(options: BrowserStaticGltfPreparationOwnerOptions = {}) {
    if (!Number.isSafeInteger(options.workerLimit ?? 8) || (options.workerLimit ?? 8) < 1) {
      throw new RangeError("Royal glTF preparation worker limit must be a positive integer");
    }
    if (!Number.isFinite(options.idleWorkerTimeoutMs ?? DEFAULT_IDLE_WORKER_TIMEOUT_MS) || (options.idleWorkerTimeoutMs ?? DEFAULT_IDLE_WORKER_TIMEOUT_MS) < 0) {
      throw new RangeError("Royal glTF preparation worker idle timeout must be non-negative");
    }
    this.#options = options;
    this.#available = typeof Worker === "function";
  }

  #cancelIdle(): void {
    if (this.#idleHandle === undefined) return;
    (this.#options.cancelDelay ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.#idleHandle);
    this.#idleHandle = undefined;
  }

  #retire(): void {
    this.#cancelIdle();
    const current = this.#pool;
    this.#pool = undefined;
    if (current !== undefined) void current.terminate(true).catch(() => undefined);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const abort of this.#active) abort();
    this.#retire();
  }

  async prepare(
    bytes: Uint8Array,
    contentKey: string,
    label: string,
    sourceUri: string,
    signal: AbortSignal,
    readResource: StaticGltfResourceReader,
    sceneIndex?: number,
    resourceVersion?: TextureVersion,
    geometryTasks?: StaticGeometryTaskPlan,
    computeGeometryTaskKeys?: ReadonlySet<string>,
  ): Promise<PreparedStaticGltf> {
    if (this.#disposed || signal.aborted) throw abortFailure();
    if (!this.#available || !shouldPrepareStaticGltfInWorker(bytes)) {
      const preparation = await import("./static-asset");
      if (this.#disposed || signal.aborted) throw abortFailure();
      return preparation.prepareStaticGltfSource(
        bytes,
        contentKey,
        label,
        sourceUri,
        readResource,
        undefined,
        sceneIndex,
        resourceVersion,
        geometryTasks,
        computeGeometryTaskKeys,
      );
    }
    this.#cancelIdle();
    const workerLimit = this.#options.workerLimit ?? 8;
    const workers = this.#pool ??= pool(workerScriptUrl(workerUrl), {
      maxWorkers: workerLimit, workerType: "web", workerOpts: { type: "module", name: "royal-gltf-preparation" },
    });
    // A private port lets the worker use the root's resource reader while its
    // pool task is running. Task execution/results stay on workerpool's RPC.
    const channel = new MessageChannel();
    let settled = false;
    let cancelTask: (() => void) | undefined;
    return new Promise<PreparedStaticGltf>((resolve, reject) => {
      const finish = (error?: unknown, prepared?: PreparedStaticGltf): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        this.#active.delete(onAbort);
        channel.port1.close();
        channel.port2.close();
        if (!this.#disposed && this.#active.size === 0) {
          this.#idleHandle = (this.#options.requestDelay ?? setTimeout)(() => this.#retire(), this.#options.idleWorkerTimeoutMs ?? DEFAULT_IDLE_WORKER_TIMEOUT_MS);
        }
        if (error !== undefined) reject(error);
        else resolve(prepared!);
      };
      const onAbort = (): void => {
        finish(abortFailure());
        cancelTask?.();
      };
      this.#active.add(onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      channel.port1.onmessage = (event: MessageEvent<{ id: number; uri: string; request?: StaticGltfResourceRequest }>) => {
        const { id, uri, request } = event.data;
        void Promise.resolve().then(() => request === undefined ? readResource(uri) : readResource(uri, request)).then(resourceBytes => {
          if (!settled) channel.port1.postMessage({ id, bytes: resourceBytes }, [resourceBytes.buffer]);
        }).catch((error: unknown) => {
          if (settled) return;
          try { channel.port1.postMessage({ id, error: formatFailure(error) }); }
          catch (failure) { finish(failure); cancelTask?.(); }
        });
      };
      channel.port1.onmessageerror = () => { finish(new Error("Unreadable glTF resource request")); cancelTask?.(); };
      try {
        const task = workers.exec("prepare", [{
          bytes, contentKey, codecs: gltfCodecUrls(), label, resourceVersion, sceneIndex, sourceUri, geometryTasks,
          computeGeometryTaskKeys: computeGeometryTaskKeys === undefined ? undefined : [...computeGeometryTaskKeys],
        }, channel.port2], { transfer: [bytes.buffer, channel.port2] });
        cancelTask = () => task.cancel();
        void task.then(prepared => finish(undefined, prepared), error => finish(error));
        if (signal.aborted || this.#disposed) onAbort();
      } catch (error) { finish(error); }
    });
  }
}
