import type { Transform } from "@royal/renderer-core";
import { captureFirstFailure, type CapturedFailure } from "../captured-failure";
import {
  beginGltfInstanceBufferArenaFrame,
  bindGltfInstanceBuffer,
  clearGltfInstanceBufferArena,
  createGltfInstanceBufferArena,
  releaseUnusedGltfInstanceBuffers,
  type GltfInstanceBufferUploadCounters,
} from "../gltf-instance-buffer-arena";
import {
  assertGltfPacketBatchSegmentGroupsCurrent,
  beginGltfPacketBatchRegistryFrame,
  clearGltfPacketBatchRegistry,
  clearGltfPacketBatchSegmentGroups,
  createGltfPacketBatchRegistry,
  createGltfPacketBatchSegmentGroups,
  groupGltfPacketSubmissionSegment,
  type GltfPacketBatchRegistry,
  type GltfPacketBatchSegmentGroups,
} from "../gltf-packet-batch-registry";
import {
  clearGltfPacketSubmissionWorkspace,
  createGltfPacketSubmissionWorkspace,
  type GltfPacketSubmissionWorkspace,
} from "../gltf-packet-submission-workspace";
import { FRAME_PACKET_SIDEDNESS, NO_FRAME_PACKET_ID } from "../frame/packets";
import type { CpuGeometry } from "../geometry-recipes";
import { identityMat4, type Mat4, type MutableMat4 } from "../math/mat4";
import { readPacketLocalModelInto } from "../packet-resource-tables";
import {
  vertexInputGeometry,
  type VertexInputArena,
  type VertexInputGeometry,
  type VertexInputInstanceAllocation,
} from "../vertex-input/arena";
import {
  combineSurfaceLightSets,
  type SurfaceLightSet,
} from "../webgl/lights";
import type { SurfaceMaterial } from "../webgl/materials";
import type { GltfInstanceTransformView } from "./instance-transform-registry";
import type { PreparedGltfRuntime } from "./prepared-runtime";

export interface GltfFrameMaterialBinding {
  readonly material: SurfaceMaterial;
}

export interface GltfFrameRootBinding {
  readonly rootModel: Mat4;
  readonly rootInstanceViews?: GltfInstanceTransformView;
  readonly rootPositionSignatureVersion?: number;
  readonly rootRotationSignatureVersion?: number;
  readonly rootScaleSignatureVersion?: number;
  readonly rootSignatureInstanceIndex: number;
  readonly rootSignatureRenderInstanceOrdinal: number;
  readonly rootTransform: Transform | undefined;
}

export interface GltfFrameDrawSidedness {
  readonly doubleSided: boolean;
  readonly frontFaceCcw: boolean;
}

export interface GltfFrameDrawBatch {
  cpuGeometry: CpuGeometry;
  geometry: VertexInputGeometry;
  geometryId: number;
  readonly key: number;
  lights: SurfaceLightSet;
  readonly localModelSignature: number[];
  readonly localModels: Mat4[];
  readonly localModelSlots: MutableMat4[];
  material: SurfaceMaterial;
  readonly rootPositionSignature: number[];
  readonly rootRotationSignature: number[];
  readonly rootScaleSignature: number[];
  readonly rootModels: Mat4[];
  readonly rootInstanceViews: Array<GltfInstanceTransformView | undefined>;
  readonly rootLogicalIndices: number[];
  readonly rootTransforms: Array<Transform | undefined>;
  sidedness: GltfFrameDrawSidedness;
}

export interface GltfFrameBatchCounters extends GltfInstanceBufferUploadCounters {
  batchPlansBuilt: number;
}

const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const appendTransformVectorSignatureValues = (
  signature: number[],
  transform: Transform | undefined,
  field: keyof Transform,
): void => {
  const resolved = transform ?? IDENTITY_TRANSFORM;
  signature.push(resolved[field][0], resolved[field][1], resolved[field][2]);
};

const appendRootSignatures = (
  positionSignature: number[],
  rotationSignature: number[],
  scaleSignature: number[],
  root: GltfFrameRootBinding,
): void => {
  if (root.rootPositionSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(positionSignature, root.rootTransform, "position");
  } else {
    positionSignature.push(
      root.rootPositionSignatureVersion,
      root.rootSignatureRenderInstanceOrdinal,
      root.rootSignatureInstanceIndex,
    );
  }
  if (root.rootRotationSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(rotationSignature, root.rootTransform, "rotation");
  } else {
    rotationSignature.push(
      root.rootRotationSignatureVersion,
      root.rootSignatureRenderInstanceOrdinal,
      root.rootSignatureInstanceIndex,
    );
  }
  if (root.rootScaleSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(scaleSignature, root.rootTransform, "scale");
  } else {
    scaleSignature.push(
      root.rootScaleSignatureVersion,
      root.rootSignatureRenderInstanceOrdinal,
      root.rootSignatureInstanceIndex,
    );
  }
};

export class GltfFrameBatchArena {
  readonly workspace: GltfPacketSubmissionWorkspace<
    GltfFrameMaterialBinding,
    GltfFrameRootBinding,
    SurfaceLightSet
  > = createGltfPacketSubmissionWorkspace();

  readonly #batches: Array<GltfFrameDrawBatch | undefined> = [];
  readonly #instanceBuffers;
  readonly #prepared: PreparedGltfRuntime;
  readonly #registry: GltfPacketBatchRegistry = createGltfPacketBatchRegistry();
  readonly #groups: GltfPacketBatchSegmentGroups = createGltfPacketBatchSegmentGroups();
  readonly #vertexInputs: VertexInputArena;
  #liveBatchIds = new Uint32Array(1);
  #liveBatchCount = 0;

  constructor(
    prepared: PreparedGltfRuntime,
    vertexInputs: VertexInputArena,
  ) {
    this.#prepared = prepared;
    this.#vertexInputs = vertexInputs;
    this.#instanceBuffers = createGltfInstanceBufferArena(vertexInputs);
  }

  beginFrame(): void {
    beginGltfPacketBatchRegistryFrame(this.#registry);
    beginGltfInstanceBufferArenaFrame(this.#instanceBuffers);
  }

  prepareSegment(
    planRevision: number,
    sceneLights: SurfaceLightSet | undefined,
    gl: WebGL2RenderingContext,
    contextGeneration: number,
    counters: GltfFrameBatchCounters,
  ): GltfPacketBatchSegmentGroups {
    const catalog = this.#prepared.packetTopology.catalog;
    groupGltfPacketSubmissionSegment(
      this.#registry,
      this.#groups,
      this.workspace,
      planRevision,
      catalog,
    );
    assertGltfPacketBatchSegmentGroupsCurrent(
      this.#registry,
      this.#groups,
      this.workspace,
      planRevision,
      catalog,
    );
    this.#prepareBatches(sceneLights, gl, contextGeneration, counters);
    return this.#groups;
  }

  batch(batchId: number): GltfFrameDrawBatch {
    const batch = this.#batches[batchId];
    if (batch === undefined) throw new Error(`Royal glTF frame batch ${batchId} is not prepared`);
    return batch;
  }

  bindInstanceBuffer(
    gl: WebGL2RenderingContext,
    contextGeneration: number,
    batch: GltfFrameDrawBatch,
    counters: GltfFrameBatchCounters,
  ): VertexInputInstanceAllocation {
    return bindGltfInstanceBuffer(
      this.#instanceBuffers,
      gl,
      contextGeneration,
      batch.key,
      batch.localModels,
      batch.localModelSignature,
      batch.rootTransforms,
      batch.rootInstanceViews,
      batch.rootLogicalIndices,
      batch.rootPositionSignature,
      batch.rootRotationSignature,
      batch.rootScaleSignature,
      counters,
    );
  }

  releaseUnused(gl: WebGL2RenderingContext, contextGeneration: number): void {
    for (let index = 0; index < this.#liveBatchCount; index += 1) {
      const batchId = this.#liveBatchIds[index]!;
      if (this.#registry.batchTouchedEpochs[batchId] === this.#registry.frameEpoch) continue;
      this.#batches[batchId] = undefined;
    }
    releaseUnusedGltfInstanceBuffers(this.#instanceBuffers, gl, contextGeneration);
    if (this.#liveBatchIds.length < this.#registry.touchedBatchCount) {
      let capacity = this.#liveBatchIds.length;
      while (capacity < this.#registry.touchedBatchCount) capacity *= 2;
      this.#liveBatchIds = new Uint32Array(capacity);
    }
    this.#liveBatchIds.set(this.#registry.touchedBatchIds.subarray(0, this.#registry.touchedBatchCount));
    this.#liveBatchCount = this.#registry.touchedBatchCount;
  }

  dropContext(): void {
    this.#batches.length = 0;
    this.#liveBatchCount = 0;
    clearGltfPacketBatchSegmentGroups(this.#groups);
  }

  dispose(): void {
    this.#batches.length = 0;
    this.#liveBatchCount = 0;
    let failure: CapturedFailure | undefined;
    const clear = (action: () => void): void => {
      failure = captureFirstFailure(failure, action);
    };
    clear(() => clearGltfInstanceBufferArena(this.#instanceBuffers));
    clear(() => clearGltfPacketBatchSegmentGroups(this.#groups));
    clear(() => clearGltfPacketBatchRegistry(this.#registry));
    clear(() => clearGltfPacketSubmissionWorkspace(this.workspace));
    if (failure !== undefined) throw failure.value;
  }

  #prepareBatches(
    sceneLights: SurfaceLightSet | undefined,
    gl: WebGL2RenderingContext,
    contextGeneration: number,
    counters: GltfFrameBatchCounters,
  ): void {
    const workspace = this.workspace;
    const groups = this.#groups;
    for (let activeIndex = 0; activeIndex < groups.activeBatchCount; activeIndex += 1) {
      const batchId = groups.activeBatchIds[activeIndex]!;
      const memberFirst = groups.batchMemberFirsts[batchId]!;
      const memberCount = groups.batchCounts[batchId]!;
      const firstIndex = groups.memberIndices[memberFirst]!;
      const geometryId = workspace.geometryIds[firstIndex]!;
      const geometry = vertexInputGeometry(this.#vertexInputs, gl, contextGeneration, geometryId);
      const material = workspace.materialBindings[workspace.materialBindingIds[firstIndex]!]!;
      const assetLights = workspace.lightBindingIds[firstIndex] === NO_FRAME_PACKET_ID
        ? undefined
        : workspace.lightBindings[workspace.lightBindingIds[firstIndex]!]!;
      let batch = this.#batches[batchId];
      if (batch === undefined) {
        batch = {
          cpuGeometry: geometry.source,
          geometry,
          geometryId,
          key: batchId,
          lights: combineSurfaceLightSets(sceneLights, assetLights),
          localModelSignature: [],
          localModels: [],
          localModelSlots: [],
          material: material.material,
          rootPositionSignature: [],
          rootRotationSignature: [],
          rootScaleSignature: [],
          rootModels: [],
          rootInstanceViews: [],
          rootLogicalIndices: [],
          rootTransforms: [],
          sidedness: {
            doubleSided: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0,
            frontFaceCcw: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0,
          },
        };
        if (this.#liveBatchIds.length <= this.#liveBatchCount) {
          const ids = new Uint32Array(this.#liveBatchIds.length * 2);
          ids.set(this.#liveBatchIds);
          this.#liveBatchIds = ids;
        }
        this.#batches[batchId] = batch;
        this.#liveBatchIds[this.#liveBatchCount] = batchId;
        this.#liveBatchCount += 1;
        counters.batchPlansBuilt += 1;
      }
      batch.localModelSignature.length = 0;
      batch.localModels.length = 0;
      batch.rootPositionSignature.length = 0;
      batch.rootRotationSignature.length = 0;
      batch.rootScaleSignature.length = 0;
      batch.rootModels.length = 0;
      batch.rootInstanceViews.length = 0;
      batch.rootLogicalIndices.length = 0;
      batch.rootTransforms.length = 0;
      batch.cpuGeometry = geometry.source;
      batch.geometry = geometry;
      batch.geometryId = geometryId;
      batch.lights = combineSurfaceLightSets(sceneLights, assetLights);
      batch.material = material.material;
      batch.sidedness = {
        doubleSided: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0,
        frontFaceCcw: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0,
      };
      for (let memberOffset = 0; memberOffset < memberCount; memberOffset += 1) {
        this.#appendSubmission(batch, groups.memberIndices[memberFirst + memberOffset]!);
      }
    }
  }

  #appendSubmission(batch: GltfFrameDrawBatch, index: number): void {
    const root = this.workspace.rootBindings[this.workspace.rootBindingIds[index]!]!;
    const localModelIndex = batch.localModels.length;
    let localModel = batch.localModelSlots[localModelIndex];
    if (localModel === undefined) {
      localModel = identityMat4();
      batch.localModelSlots.push(localModel);
    }
    readPacketLocalModelInto(
      this.#prepared.packetTopology.resources,
      this.workspace.localModelIds[index]!,
      localModel,
    );
    for (let component = 0; component < 16; component += 1) {
      batch.localModelSignature.push(localModel[component]!);
    }
    appendRootSignatures(
      batch.rootPositionSignature,
      batch.rootRotationSignature,
      batch.rootScaleSignature,
      root,
    );
    batch.localModels.push(localModel);
    batch.rootModels.push(root.rootModel);
    batch.rootInstanceViews.push(root.rootInstanceViews);
    batch.rootLogicalIndices.push(root.rootSignatureInstanceIndex);
    batch.rootTransforms.push(root.rootTransform);
  }
}
