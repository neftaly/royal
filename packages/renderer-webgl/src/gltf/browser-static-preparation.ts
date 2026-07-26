import type { PreparedStaticGltf } from "./static-asset";
import type { TextureVersion } from "@royal/renderer-core";
import { formatFailure } from "../diagnostics/format-failure";
import type { StaticGltfResourceRequest } from "./static-buffer-demand";
import type { StaticGltfResourceReader } from "./static-source";
import type { StaticGeometryTaskPlan } from "./static-geometry-plan";

export { readGltfResourceRangesWithFetch } from "./browser-range-read";

type PreparationResultMessage =
  | Readonly<{ error: string; kind: "error" }>
  | Readonly<{
    id: number;
    kind: "read-resource";
    request?: StaticGltfResourceRequest;
    uri: string;
  }>
  | Readonly<{ kind: "ready"; prepared: PreparedStaticGltf }>;

const WORKER_GLTF_BYTE_THRESHOLD = 256 * 1024;

const isGlb = (bytes: Uint8Array): boolean => bytes.byteLength >= 4
  && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46_54_6c_67;

/** Keeps tiny self-contained GLBs synchronous while external and substantial assets leave the UI thread. */
export const shouldPrepareStaticGltfInWorker = (bytes: Uint8Array): boolean =>
  !isGlb(bytes) || bytes.byteLength >= WORKER_GLTF_BYTE_THRESHOLD;

const abortFailure = (): DOMException => new DOMException(
  "Royal glTF preparation was aborted",
  "AbortError",
);

const defaultWorker = (): Worker => new Worker(
  new URL("./static-preparation-worker.ts", import.meta.url),
  { name: "royal-gltf-preparation", type: "module" },
);

const DEFAULT_IDLE_WORKER_TIMEOUT_MS = 1_000;

export type BrowserStaticGltfPreparationOwnerOptions = Readonly<{
  cancelDelay?(handle: unknown): void;
  createWorker?(): Worker;
  idleWorkerTimeoutMs?: number;
  requestDelay?(callback: () => void, delayMs: number): unknown;
  workerLimit?: number;
}>;

type PreparationWorkerSlot = {
  abortActive: (() => void) | undefined;
  idleHandle: unknown;
  readonly worker: Worker;
};

/**
 * Root-owned amortized worker shell.
 *
 * The root's existing preparation scheduler remains the admission authority;
 * this owner only reuses up to that scheduler's worker-capable concurrency.
 */
export class BrowserStaticGltfPreparationOwner {
  readonly #cancelDelay: (handle: unknown) => void;
  readonly #createWorker: (() => Worker) | undefined;
  #disposed = false;
  readonly #idleWorkerTimeoutMs: number;
  readonly #requestDelay: (callback: () => void, delayMs: number) => unknown;
  readonly #slots = new Set<PreparationWorkerSlot>();
  readonly #workerLimit: number;

  constructor(options: BrowserStaticGltfPreparationOwnerOptions = {}) {
    const workerLimit = options.workerLimit ?? 8;
    const idleWorkerTimeoutMs = options.idleWorkerTimeoutMs
      ?? DEFAULT_IDLE_WORKER_TIMEOUT_MS;
    if (!Number.isSafeInteger(workerLimit) || workerLimit < 1) {
      throw new RangeError("Royal glTF preparation worker limit must be a positive integer");
    }
    if (!Number.isFinite(idleWorkerTimeoutMs) || idleWorkerTimeoutMs < 0) {
      throw new RangeError("Royal glTF preparation worker idle timeout must be non-negative");
    }
    this.#cancelDelay = options.cancelDelay
      ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#createWorker = options.createWorker
      ?? (typeof Worker === "function" ? defaultWorker : undefined);
    this.#idleWorkerTimeoutMs = idleWorkerTimeoutMs;
    this.#requestDelay = options.requestDelay
      ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#workerLimit = workerLimit;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const slot of Array.from(this.#slots)) {
      if (slot.abortActive === undefined) this.#retire(slot);
      else slot.abortActive();
    }
  }

  /** Uses a worker when its startup cost is smaller than likely preparation work. */
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
    if (this.#createWorker === undefined || !shouldPrepareStaticGltfInWorker(bytes)) {
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
    const slot = this.#acquireWorker();
    return new Promise<PreparedStaticGltf>((resolve, reject) => {
      let settled = false;
      const { worker } = slot;
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("messageerror", onMessageError);
        slot.abortActive = undefined;
      };
      const finish = (reusable: boolean, action: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (reusable && !this.#disposed) this.#release(slot);
        else this.#retire(slot);
        action();
      };
      const onAbort = (): void => finish(false, () => reject(abortFailure()));
      const onError = (event: ErrorEvent): void => finish(false, () => reject(new Error(
        event.message || "Royal glTF preparation worker failed",
      )));
      const onMessageError = (): void => finish(false, () => reject(new Error(
        "Royal glTF preparation worker returned an unreadable result",
      )));
      const postResourceFailure = (id: number, error: unknown): void => {
        if (settled) return;
        try {
          worker.postMessage({
            error: formatFailure(error),
            id,
            kind: "read-resource-error",
          });
        } catch (postError) {
          finish(false, () => reject(postError));
        }
      };
      const onMessage = (event: MessageEvent<PreparationResultMessage>): void => {
        const message = event.data;
        if (message.kind === "read-resource") {
          let reading: Promise<Uint8Array>;
          try {
            reading = message.request === undefined
              ? readResource(message.uri)
              : readResource(message.uri, message.request);
          } catch (error) {
            postResourceFailure(message.id, error);
            return;
          }
          void reading.then((resourceBytes) => {
            if (settled) return;
            try {
              worker.postMessage(
                { bytes: resourceBytes, id: message.id, kind: "read-resource-ready" },
                [resourceBytes.buffer],
              );
            } catch (error) {
              finish(false, () => reject(error));
            }
          }).catch((error: unknown) => {
            postResourceFailure(message.id, error);
          });
        } else if (message.kind === "error") {
          finish(true, () => reject(new Error(message.error)));
        } else {
          finish(true, () => resolve(message.prepared));
        }
      };
      slot.abortActive = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener("error", onError);
      worker.addEventListener("message", onMessage);
      worker.addEventListener("messageerror", onMessageError);
      try {
        worker.postMessage(
          {
            bytes,
            contentKey,
            kind: "prepare",
            label,
            resourceVersion,
            sceneIndex,
            sourceUri,
            geometryTasks,
            computeGeometryTaskKeys: computeGeometryTaskKeys === undefined
              ? undefined
              : [...computeGeometryTaskKeys],
          },
          [bytes.buffer],
        );
      } catch (error) {
        finish(false, () => reject(error));
      }
    });
  }

  #acquireWorker(): PreparationWorkerSlot {
    for (const slot of this.#slots) {
      if (slot.abortActive !== undefined) continue;
      this.#cancelIdleRetirement(slot);
      return slot;
    }
    if (this.#slots.size >= this.#workerLimit) {
      throw new Error("Royal glTF preparation exceeded its scheduled worker concurrency");
    }
    const createWorker = this.#createWorker;
    if (createWorker === undefined) {
      throw new Error("Royal glTF preparation worker is unavailable");
    }
    const slot: PreparationWorkerSlot = {
      abortActive: undefined,
      idleHandle: undefined,
      worker: createWorker(),
    };
    this.#slots.add(slot);
    return slot;
  }

  #cancelIdleRetirement(slot: PreparationWorkerSlot): void {
    if (slot.idleHandle === undefined) return;
    this.#cancelDelay(slot.idleHandle);
    slot.idleHandle = undefined;
  }

  #release(slot: PreparationWorkerSlot): void {
    this.#cancelIdleRetirement(slot);
    slot.idleHandle = this.#requestDelay(() => {
      slot.idleHandle = undefined;
      if (slot.abortActive === undefined) this.#retire(slot);
    }, this.#idleWorkerTimeoutMs);
  }

  #retire(slot: PreparationWorkerSlot): void {
    if (!this.#slots.delete(slot)) return;
    this.#cancelIdleRetirement(slot);
    slot.worker.terminate();
  }
}

/** One-shot compatibility wrapper over the shared worker lifecycle implementation. */
export const prepareStaticGltfInBrowser = async (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  signal: AbortSignal,
  readResource: StaticGltfResourceReader,
  createWorker: (() => Worker) | undefined = typeof Worker === "function"
    ? defaultWorker
    : undefined,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
  geometryTasks?: StaticGeometryTaskPlan,
  computeGeometryTaskKeys?: ReadonlySet<string>,
): Promise<PreparedStaticGltf> => {
  const owner = new BrowserStaticGltfPreparationOwner({
    ...(createWorker === undefined ? {} : { createWorker }),
    workerLimit: 1,
  });
  try {
    return await owner.prepare(
      bytes,
      contentKey,
      label,
      sourceUri,
      signal,
      readResource,
      sceneIndex,
      resourceVersion,
      geometryTasks,
      computeGeometryTaskKeys,
    );
  } finally {
    owner.dispose();
  }
};
