import { prepareStaticGltfSource, type PreparedStaticGltf } from "./static-asset";

type PreparationRequest = Readonly<{
  bytes: Uint8Array;
  contentKey: string;
  label: string;
  sourceUri: string;
}>;

type WorkerScope = Readonly<{
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PreparationRequest>) => void,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}>;

const workerScope = globalThis as unknown as WorkerScope;

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

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
  void prepareStaticGltfSource(
    request.bytes,
    request.contentKey,
    request.label,
    request.sourceUri,
    async (uri) => {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`glTF resource ${JSON.stringify(uri)} failed with HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  ).then((prepared) => {
    workerScope.postMessage(
      { kind: "ready", prepared },
      transferBuffers(prepared),
    );
  }).catch((error: unknown) => {
    workerScope.postMessage({ error: formatFailure(error), kind: "error" });
  });
});
