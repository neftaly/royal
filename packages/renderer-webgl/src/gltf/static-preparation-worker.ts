import { setWorkerGltfCodecUrls, type GltfCodecUrls } from "./codec-loader";
import { prepareStaticGltfSource } from "./static-asset";
import type { TextureVersion } from "@royal/renderer-core";
import { preparedStaticGltfTransferBuffers } from "./static-transfer";
import type { StaticDracoDecodeTask } from "./draco";
import {
  decodedDracoTaskTransferBuffers,
  executeDracoTasksInWorkers,
  executeDracoTasksSerially,
} from "./static-draco-executor";
import type { StaticGltfResourceRequest } from "./static-buffer-demand";
import type { StaticGeometryTaskPlan } from "./static-geometry-plan";
import { formatFailure } from "../diagnostics/format-failure";

type PreparationRequest = Readonly<{
  codecs: GltfCodecUrls;
  bytes: Uint8Array;
  computeGeometryTaskKeys?: readonly string[];
  contentKey: string;
  kind: "prepare";
  label: string;
  geometryTasks?: StaticGeometryTaskPlan;
  resourceVersion?: TextureVersion;
  sceneIndex?: number;
  sourceUri: string;
}>;

type ResourceResult =
  | Readonly<{ bytes: Uint8Array; id: number; kind: "read-resource-ready" }>
  | Readonly<{ error: string; id: number; kind: "read-resource-error" }>;

type DracoDecodeRequest = Readonly<{
  codecs: GltfCodecUrls;
  kind: "decode-draco-tasks";
  tasks: readonly StaticDracoDecodeTask[];
}>;

type WorkerMessage = DracoDecodeRequest | PreparationRequest | ResourceResult;

type WorkerScope = Readonly<{
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerMessage>) => void,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}>;

const workerScope = globalThis as unknown as WorkerScope;

type ResourceRead = Readonly<{
  reject(error: Error): void;
  resolve(bytes: Uint8Array): void;
}>;

const resourceReads = new Map<number, ResourceRead>();
let nextResourceReadId = 1;
let preparing = false;

const readResource = (
  uri: string,
  request?: StaticGltfResourceRequest,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const id = nextResourceReadId;
    nextResourceReadId += 1;
    resourceReads.set(id, { reject, resolve });
    workerScope.postMessage({
      id,
      kind: "read-resource",
      ...(request === undefined ? {} : { request }),
      uri,
    });
  });

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.kind === "decode-draco-tasks") {
    setWorkerGltfCodecUrls(request.codecs);
    void executeDracoTasksSerially(request.tasks).then((results) => {
      workerScope.postMessage(
        { kind: "decode-draco-ready", results },
        decodedDracoTaskTransferBuffers(results),
      );
    }).catch((error: unknown) => {
      workerScope.postMessage({ error: formatFailure(error), kind: "decode-draco-error" });
    });
    return;
  }
  if (request.kind === "read-resource-ready") {
    const read = resourceReads.get(request.id);
    if (read === undefined) return;
    resourceReads.delete(request.id);
    read.resolve(request.bytes);
    return;
  }
  if (request.kind === "read-resource-error") {
    const read = resourceReads.get(request.id);
    if (read === undefined) return;
    resourceReads.delete(request.id);
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
  setWorkerGltfCodecUrls(request.codecs);
  preparing = true;
  void prepareStaticGltfSource(
    request.bytes,
    request.contentKey,
    request.label,
    request.sourceUri,
    readResource,
    executeDracoTasksInWorkers,
    request.sceneIndex,
    request.resourceVersion,
    request.geometryTasks,
    request.computeGeometryTaskKeys === undefined
      ? undefined
      : new Set(request.computeGeometryTaskKeys),
  ).then((prepared) => {
    workerScope.postMessage(
      { kind: "ready", prepared },
      preparedStaticGltfTransferBuffers(prepared),
    );
  }).catch((error: unknown) => {
    workerScope.postMessage({ error: formatFailure(error), kind: "error" });
  }).finally(() => {
    resourceReads.clear();
    preparing = false;
  });
});
