import { loadWorkerRuntime } from "../workers/runtime";
import { setWorkerGltfCodecUrls, type GltfCodecUrls } from "./codec-loader";
import { prepareStaticGltfSource } from "./static-asset";
import type { TextureVersion } from "@royal/renderer-core";
import { preparedStaticGltfTransferBuffers } from "./static-transfer";
import { StaticDracoWorkerOwner } from "./static-draco-executor";
import type { StaticGltfResourceRequest } from "./static-buffer-demand";
import type { StaticGeometryTaskPlan } from "./static-geometry-plan";

type PreparationRequest = Readonly<{
  codecs: GltfCodecUrls;
  bytes: Uint8Array;
  computeGeometryTaskKeys?: readonly string[];
  contentKey: string;
  label: string;
  geometryTasks?: StaticGeometryTaskPlan;
  resourceVersion?: TextureVersion;
  sceneIndex?: number;
  sourceUri: string;
}>;

const { worker, Transfer } = await loadWorkerRuntime();
const draco = new StaticDracoWorkerOwner();

worker({
  prepare: async (request: PreparationRequest, port: MessagePort) => {
    setWorkerGltfCodecUrls(request.codecs);
    let nextId = 0;
    const reads = new Map<number, { resolve(bytes: Uint8Array): void; reject(error: Error): void }>();
    port.onmessage = (event: MessageEvent<{ id: number; bytes: Uint8Array; error?: string }>) => {
      const { id, bytes, error } = event.data;
      const read = reads.get(id);
      reads.delete(id);
      if (error === undefined) read?.resolve(bytes);
      else read?.reject(new Error(error));
    };
    port.onmessageerror = () => {
      for (const read of reads.values()) read.reject(new Error("Unreadable glTF resource response"));
      reads.clear();
    };
    const readResource = (uri: string, demand?: StaticGltfResourceRequest): Promise<Uint8Array> => new Promise((resolve, reject) => {
      const id = ++nextId;
      reads.set(id, { resolve, reject });
      port.postMessage({ id, uri, request: demand });
    });
    try {
      const prepared = await prepareStaticGltfSource(
        request.bytes, request.contentKey, request.label, request.sourceUri, readResource,
        tasks => draco.execute(tasks), request.sceneIndex, request.resourceVersion, request.geometryTasks,
        request.computeGeometryTaskKeys === undefined ? undefined : new Set(request.computeGeometryTaskKeys),
      );
      return new Transfer(prepared, preparedStaticGltfTransferBuffers(prepared));
    } finally { port.close(); reads.clear(); }
  },
}, { onTerminate: () => draco.dispose() });
