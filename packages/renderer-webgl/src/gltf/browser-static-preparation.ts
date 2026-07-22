import type { PreparedStaticGltf } from "./static-asset";
import type { TextureVersion } from "@royal/renderer-core";
import type { StaticGltfResourceRequest } from "./static-buffer-demand";
import type { StaticGltfResourceReader } from "./static-source";

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

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

const defaultWorker = (): Worker => new Worker(
  new URL("./static-preparation-worker.ts", import.meta.url),
  { name: "royal-gltf-preparation", type: "module" },
);

/** Uses an isolated worker when its startup cost is smaller than likely preparation work. */
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
  etc2Available = true,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
): Promise<PreparedStaticGltf> => {
  if (signal.aborted) throw abortFailure();
  if (createWorker === undefined || !shouldPrepareStaticGltfInWorker(bytes)) {
    const preparation = await import("./static-asset");
    if (signal.aborted) throw abortFailure();
    return preparation.prepareStaticGltfSource(
      bytes,
      contentKey,
      label,
      sourceUri,
      readResource,
      undefined,
      etc2Available,
      sceneIndex,
      resourceVersion,
    );
  }
  return new Promise<PreparedStaticGltf>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("messageerror", onMessageError);
      worker.terminate();
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => finish(() => reject(abortFailure()));
    const onError = (event: ErrorEvent): void => finish(() => reject(new Error(
      event.message || "Royal glTF preparation worker failed",
    )));
    const onMessageError = (): void => finish(() => reject(new Error(
      "Royal glTF preparation worker returned an unreadable result",
    )));
    const onMessage = (event: MessageEvent<PreparationResultMessage>): void => {
      const message = event.data;
      if (message.kind === "read-resource") {
        const reading = message.request === undefined
          ? readResource(message.uri)
          : readResource(message.uri, message.request);
        void reading.then((bytes) => {
          if (settled) return;
          try {
            worker.postMessage(
              { bytes, id: message.id, kind: "read-resource-ready" },
              [bytes.buffer],
            );
          } catch (error) {
            finish(() => reject(error));
          }
        }).catch((error: unknown) => {
          if (settled) return;
          try {
            worker.postMessage({
              error: formatFailure(error),
              id: message.id,
              kind: "read-resource-error",
            });
          } catch (postError) {
            finish(() => reject(postError));
          }
        });
      } else if (message.kind === "error") {
        finish(() => reject(new Error(message.error)));
      } else {
        finish(() => resolve(message.prepared));
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("messageerror", onMessageError);
    try {
      worker.postMessage(
        {
          bytes,
          contentKey,
          etc2Available,
          kind: "prepare",
          label,
          resourceVersion,
          sceneIndex,
          sourceUri,
        },
        [bytes.buffer],
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
};
