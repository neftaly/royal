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
  groupPreparedGltfPacketSubmissionSegment,
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
import {
  packetLocalModelSemanticId,
  packetResourceTablesPlanRevision,
  readPacketLocalModelInto,
} from "../packet-resource-tables";
import {
  vertexInputGeometry,
  type VertexInputArena,
  type VertexInputGeometry,
  type VertexInputInstanceAllocation,
} from "../vertex-input/arena";
import {
  createSurfaceLightSetWorkspace,
  writeCombinedSurfaceLightSet,
  type SurfaceLightSet,
  type SurfaceLightSetWorkspace,
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
  readonly rootLogicalIndex: number;
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
  readonly lights: SurfaceLightSetWorkspace;
  readonly localModelSignature: number[];
  readonly localModels: Mat4[];
  material: SurfaceMaterial;
  readonly rootModels: Mat4[];
  readonly rootInstanceViews: Array<GltfInstanceTransformView | undefined>;
  readonly rootLogicalIndices: number[];
  readonly rootTransforms: Array<Transform | undefined>;
  sidedness: GltfFrameDrawSidedness;
}

export interface GltfFrameBatchCounters extends GltfInstanceBufferUploadCounters {
  batchPlansBuilt: number;
}

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
  readonly #localModels: Array<MutableMat4 | undefined> = [];
  readonly #vertexInputs: VertexInputArena;
  #liveBatchIds = new Uint32Array(1);
  #liveBatchCount = 0;
  #localModelResourceRevision = -1;

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
    const localModelResourceRevision = packetResourceTablesPlanRevision(
      this.#prepared.packetTopology.resources,
    );
    if (this.#localModelResourceRevision !== localModelResourceRevision) {
      this.#localModels.length = 0;
      this.#localModelResourceRevision = localModelResourceRevision;
    }
    groupPreparedGltfPacketSubmissionSegment(
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
    this.#localModels.length = 0;
    this.#localModelResourceRevision = -1;
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
          lights: createSurfaceLightSetWorkspace(),
          localModelSignature: [],
          localModels: [],
          material: material.material,
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
      batch.localModelSignature.length = memberCount;
      batch.localModels.length = memberCount;
      batch.rootModels.length = memberCount;
      batch.rootInstanceViews.length = memberCount;
      batch.rootLogicalIndices.length = memberCount;
      batch.rootTransforms.length = memberCount;
      batch.cpuGeometry = geometry.source;
      batch.geometry = geometry;
      batch.geometryId = geometryId;
      writeCombinedSurfaceLightSet(batch.lights, sceneLights, assetLights);
      batch.material = material.material;
      const sidedness = batch.sidedness as {
        -readonly [Key in keyof GltfFrameDrawSidedness]: GltfFrameDrawSidedness[Key];
      };
      sidedness.doubleSided =
        (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0;
      sidedness.frontFaceCcw =
        (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0;
      for (let memberOffset = 0; memberOffset < memberCount; memberOffset += 1) {
        this.#writeSubmission(
          batch,
          memberOffset,
          groups.memberIndices[memberFirst + memberOffset]!,
        );
      }
    }
  }

  #writeSubmission(batch: GltfFrameDrawBatch, memberIndex: number, index: number): void {
    const root = this.workspace.rootBindings[this.workspace.rootBindingIds[index]!]!;
    const localModelId = this.workspace.localModelIds[index]!;
    const localModelSemanticId = packetLocalModelSemanticId(
      this.#prepared.packetTopology.resources,
      localModelId,
    );
    let localModel = this.#localModels[localModelId];
    if (localModel === undefined) {
      localModel = identityMat4();
      readPacketLocalModelInto(
        this.#prepared.packetTopology.resources,
        localModelId,
        localModel,
      );
      this.#localModels[localModelId] = localModel;
    }
    batch.localModelSignature[memberIndex] = localModelSemanticId;
    batch.localModels[memberIndex] = localModel;
    batch.rootModels[memberIndex] = root.rootModel;
    batch.rootInstanceViews[memberIndex] = root.rootInstanceViews;
    batch.rootLogicalIndices[memberIndex] = root.rootLogicalIndex;
    batch.rootTransforms[memberIndex] = root.rootTransform;
  }
}
