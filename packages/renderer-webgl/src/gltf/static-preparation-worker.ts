import { prepareStaticGltfSource, type PreparedStaticGltf } from "./static-asset";

type PreparationRequest = Readonly<{
  bytes: Uint8Array;
  contentKey: string;
  kind: "prepare";
  label: string;
  sourceUri: string;
}>;

type ResourceResult =
  | Readonly<{ bytes: Uint8Array; kind: "read-resource-ready" }>
  | Readonly<{ error: string; kind: "read-resource-error" }>;

type WorkerMessage = PreparationRequest | ResourceResult;

type WorkerScope = Readonly<{
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerMessage>) => void,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}>;

const workerScope = globalThis as unknown as WorkerScope;

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

type ResourceRead = Readonly<{
  reject(error: Error): void;
  resolve(bytes: Uint8Array): void;
}>;

let resourceRead: ResourceRead | undefined;
let preparing = false;

const readResource = (uri: string): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    if (resourceRead !== undefined) {
      reject(new Error("Royal glTF preparation supports one external buffer read"));
      return;
    }
    resourceRead = { reject, resolve };
    workerScope.postMessage({ kind: "read-resource", uri });
  });

const transferBuffers = (prepared: PreparedStaticGltf): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
      return;
    }
    if (value instanceof ArrayBuffer) {
      buffers.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(prepared);
  return [...buffers];
};

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.kind === "read-resource-ready") {
    const read = resourceRead;
    if (read === undefined) return;
    resourceRead = undefined;
    read.resolve(request.bytes);
    return;
  }
  if (request.kind === "read-resource-error") {
    const read = resourceRead;
    if (read === undefined) return;
    resourceRead = undefined;
    read.reject(new Error(request.error));
    return;
  }
  if (preparing) {
    workerScope.postMessage({
      error: "Royal glTF preparation worker is already active",
      kind: "error",
    });
    return;
  }
  preparing = true;
  void prepareStaticGltfSource(
    request.bytes,
    request.contentKey,
    request.label,
    request.sourceUri,
    readResource,
  ).then((prepared) => {
    workerScope.postMessage(
      { kind: "ready", prepared },
      transferBuffers(prepared),
    );
  }).catch((error: unknown) => {
    workerScope.postMessage({ error: formatFailure(error), kind: "error" });
  });
});
