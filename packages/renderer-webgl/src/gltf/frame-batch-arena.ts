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
  contextGeneration: number;
  cpuGeometry: CpuGeometry;
  geometry: VertexInputGeometry;
  geometryId: number;
  readonly key: number;
  readonly lights: SurfaceLightSetWorkspace;
  localModelSignatureDirty: boolean;
  readonly localModelSignature: number[];
  readonly localModels: Mat4[];
  material: SurfaceMaterial;
  readonly rootModels: Mat4[];
  readonly rootInstanceViews: Array<GltfInstanceTransformView | undefined>;
  rootLayoutDirty: boolean;
  readonly rootLogicalIndices: number[];
  readonly rootTransforms: Array<Transform | undefined>;
  sceneLightPlanRevision: number;
  sceneLights: SurfaceLightSet | undefined;
  sidedness: GltfFrameDrawSidedness;
}

export interface GltfFrameBatchCounters extends GltfInstanceBufferUploadCounters {
  batchPlansBuilt: number;
}

// Camera-edge visibility should not churn retained batch work. Sixty rendered
// frames is bounded even for continuously animated roots and costs no wall-time
// retention in an idle demand-driven root.
const GLTF_BATCH_RETENTION_FRAMES = 60;

export const gltfFrameBatchIsRetained = (
  frameEpoch: number,
  touchedEpoch: number,
  retentionFrames = GLTF_BATCH_RETENTION_FRAMES,
): boolean => touchedEpoch !== 0 && ((frameEpoch - touchedEpoch) >>> 0) <= retentionFrames;

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
    this.#prepareBatches(planRevision, sceneLights, gl, contextGeneration, counters);
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
    const allocation = bindGltfInstanceBuffer(
      this.#instanceBuffers,
      gl,
      contextGeneration,
      batch.key,
      batch.localModels,
      batch.localModelSignature,
      batch.localModelSignatureDirty,
      batch.rootLayoutDirty,
      batch.rootTransforms,
      batch.rootInstanceViews,
      batch.rootLogicalIndices,
      counters,
    );
    batch.localModelSignatureDirty = false;
    batch.rootLayoutDirty = false;
    return allocation;
  }

  releaseUnused(gl: WebGL2RenderingContext, contextGeneration: number): void {
    for (let batchId = 0; batchId < this.#batches.length; batchId += 1) {
      if (this.#batches[batchId] === undefined) continue;
      if (gltfFrameBatchIsRetained(
        this.#registry.frameEpoch,
        this.#registry.batchTouchedEpochs[batchId]!,
      )) continue;
      this.#batches[batchId] = undefined;
    }
    releaseUnusedGltfInstanceBuffers(this.#instanceBuffers, gl, contextGeneration);
  }

  dropContext(): void {
    this.#batches.length = 0;
    clearGltfPacketBatchSegmentGroups(this.#groups);
  }

  dispose(): void {
    this.#batches.length = 0;
    this.#localModels.length = 0;
    this.#localModelResourceRevision = -1;
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
    planRevision: number,
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
      const material = workspace.materialBindings[workspace.materialBindingIds[firstIndex]!]!;
      const assetLights = workspace.lightBindingIds[firstIndex] === NO_FRAME_PACKET_ID
        ? undefined
        : workspace.lightBindings[workspace.lightBindingIds[firstIndex]!]!;
      let batch = this.#batches[batchId];
      if (batch === undefined) {
        const geometry = vertexInputGeometry(this.#vertexInputs, gl, contextGeneration, geometryId);
        batch = {
          contextGeneration,
          cpuGeometry: geometry.source,
          geometry,
          geometryId,
          key: batchId,
          lights: createSurfaceLightSetWorkspace(),
          localModelSignatureDirty: true,
          localModelSignature: [],
          localModels: [],
          material: material.material,
          rootModels: [],
          rootInstanceViews: [],
          rootLayoutDirty: true,
          rootLogicalIndices: [],
          rootTransforms: [],
          sceneLightPlanRevision: 0,
          sceneLights: undefined,
          sidedness: {
            doubleSided: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0,
            frontFaceCcw: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0,
          },
        };
        this.#batches[batchId] = batch;
        counters.batchPlansBuilt += 1;
      } else if (
        batch.contextGeneration !== contextGeneration
        || batch.geometryId !== geometryId
      ) {
        const geometry = vertexInputGeometry(this.#vertexInputs, gl, contextGeneration, geometryId);
        batch.contextGeneration = contextGeneration;
        batch.cpuGeometry = geometry.source;
        batch.geometry = geometry;
        batch.geometryId = geometryId;
      }
      batch.localModelSignatureDirty ||= batch.localModelSignature.length !== memberCount;
      batch.rootLayoutDirty ||= batch.rootInstanceViews.length !== memberCount
        || batch.rootLogicalIndices.length !== memberCount;
      batch.localModelSignature.length = memberCount;
      batch.localModels.length = memberCount;
      batch.rootModels.length = memberCount;
      batch.rootInstanceViews.length = memberCount;
      batch.rootLogicalIndices.length = memberCount;
      batch.rootTransforms.length = memberCount;
      if (
        assetLights !== undefined
        || batch.sceneLightPlanRevision !== planRevision
        || batch.sceneLights !== sceneLights
      ) {
        writeCombinedSurfaceLightSet(batch.lights, sceneLights, assetLights);
        // Asset-local lights are transformed into a stable mutable workspace,
        // so identity alone cannot prove their values unchanged. Scene-only
        // composition is immutable for a plan revision and can be retained.
        batch.sceneLightPlanRevision = assetLights === undefined ? planRevision : 0;
        batch.sceneLights = sceneLights;
      }
      batch.material = material.material;
      const sidedness = batch.sidedness as {
        -readonly [Key in keyof GltfFrameDrawSidedness]: GltfFrameDrawSidedness[Key];
      };
      sidedness.doubleSided =
        (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0;
      sidedness.frontFaceCcw =
        (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0;
      let previousLocalModelId = NO_FRAME_PACKET_ID;
      let localModelSemanticId = 0;
      let localModel: MutableMat4 | undefined;
      for (let memberOffset = 0; memberOffset < memberCount; memberOffset += 1) {
        const index = groups.memberIndices[memberFirst + memberOffset]!;
        const localModelId = workspace.localModelIds[index]!;
        if (localModelId !== previousLocalModelId) {
          previousLocalModelId = localModelId;
          localModelSemanticId = packetLocalModelSemanticId(
            this.#prepared.packetTopology.resources,
            localModelId,
          );
          localModel = this.#localModels[localModelId];
          if (localModel === undefined) {
            localModel = identityMat4();
            readPacketLocalModelInto(
              this.#prepared.packetTopology.resources,
              localModelId,
              localModel,
            );
            this.#localModels[localModelId] = localModel;
          }
        }
        const root = workspace.rootBindings[workspace.rootBindingIds[index]!]!;
        if (batch.localModelSignature[memberOffset] !== localModelSemanticId) {
          batch.localModelSignatureDirty = true;
          batch.localModelSignature[memberOffset] = localModelSemanticId;
          batch.localModels[memberOffset] = localModel!;
        }
        if (batch.rootModels[memberOffset] !== root.rootModel) {
          batch.rootModels[memberOffset] = root.rootModel;
        }
        if (batch.rootInstanceViews[memberOffset] !== root.rootInstanceViews) {
          batch.rootLayoutDirty = true;
          batch.rootInstanceViews[memberOffset] = root.rootInstanceViews;
        }
        if (batch.rootLogicalIndices[memberOffset] !== root.rootLogicalIndex) {
          batch.rootLayoutDirty = true;
          batch.rootLogicalIndices[memberOffset] = root.rootLogicalIndex;
        }
        if (batch.rootTransforms[memberOffset] !== root.rootTransform) {
          batch.rootTransforms[memberOffset] = root.rootTransform;
        }
      }
    }
  }
}
