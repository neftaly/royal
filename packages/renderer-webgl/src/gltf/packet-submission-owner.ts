import {
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
} from "../frame/packets";
import {
  appendPreparedGltfPacketSubmissionRootBinding,
  beginPreparedGltfPacketSubmissionRun,
  endPreparedGltfPacketSubmissionRun,
  preparedGltfPacketSubmissionLightBindingId,
  preparedGltfPacketSubmissionMaterialBindingId,
  preparedGltfPacketSubmissionRootBindingId,
  resetGltfPacketSubmissionWorkspaceForFrame,
  resetGltfPacketSubmissionWorkspaceForSegment,
  resetGltfPacketSubmissionWorkspaceForView,
  retainGltfPacketSubmissionLightBinding,
  retainGltfPacketSubmissionMaterialBinding,
  writePreparedGltfPacketSubmissionRunBinding,
} from "../gltf-packet-submission-workspace";
import {
  resolvePacketMaterial,
} from "../packet-resource-tables";
import type { WebGlGltfInstancingSnapshot } from "../root-types";
import { SceneBindingRegistry } from "../scene-binding-registry";
import {
  VertexInputGpuUploadCapacityError,
  vertexInputGeometry,
  type VertexInputArena,
} from "../vertex-input/arena";
import {
  hasGltfAssetLights,
  SurfaceLightResolver,
} from "../surface-light-resolver";
import type { SurfaceLightSet } from "../webgl/lights";
import type { SurfaceMaterial } from "../webgl/materials";
import {
  GltfFrameBatchArena,
  type GltfFrameDrawBatch,
  type GltfFrameMaterialBinding,
  type GltfFrameRootBinding,
} from "./frame-batch-arena";
import { GltfInstanceTransformRegistry } from "./instance-transform-registry";
import { GltfMaterialPreparationArena } from "./material-preparation-arena";
import { PreparedGltfRuntime, type AnyGltfNode } from "./prepared-runtime";
import { GltfPacketSelectionOwner } from "./packet-selection-owner";

type GltfInstancingCounters = {
  -readonly [Key in keyof WebGlGltfInstancingSnapshot]: WebGlGltfInstancingSnapshot[Key];
};

type MutableGltfFrameRootBinding = {
  -readonly [Key in keyof GltfFrameRootBinding]: GltfFrameRootBinding[Key];
};

export interface GltfPacketViewSelection {
  readonly packetCursor: number;
  readonly packetEnd: number;
}

export interface GltfPacketSubmissionOwnerOptions {
  readonly instanceTransforms: GltfInstanceTransformRegistry;
  readonly lightResolver: SurfaceLightResolver;
  readonly materials: GltfMaterialPreparationArena;
  readonly runtime: PreparedGltfRuntime;
  readonly sceneBindings: SceneBindingRegistry;
  readonly selection: GltfPacketSelectionOwner;
  readonly vertexInputs: VertexInputArena;
}

const createCounters = (): GltfInstancingCounters => ({
  batchPlansBuilt: 0,
  batchInstancesTotal: 0,
  drawCalls: 0,
  instancesDrawn: 0,
  modelUploadBytes: 0,
  modelUploadCalls: 0,
});

/** Owns selected glTF packet translation, binding identity, and frame batching. */
export class GltfPacketSubmissionOwner {
  readonly #batches: GltfFrameBatchArena;
  readonly #counters = createCounters();
  #geometryContextGeneration = -1;
  readonly #geometryIdentityIds: Array<number | undefined> = [];
  #geometryPlanRevision = -1;
  #geometryUploadDeferred = false;
  readonly #instanceTransforms: GltfInstanceTransformRegistry;
  readonly #lightResolver: SurfaceLightResolver;
  readonly #materials: GltfMaterialPreparationArena;
  readonly #materialBindings = new WeakMap<SurfaceMaterial, GltfFrameMaterialBinding>();
  #materialDemandEpoch = 0;
  #materialDemandEpochs = new Uint32Array(1);
  readonly #rootBindings: Array<MutableGltfFrameRootBinding | undefined> = [];
  readonly #runtime: PreparedGltfRuntime;
  readonly #sceneBindings: SceneBindingRegistry;
  readonly #selection: GltfPacketSelectionOwner;
  readonly #viewSelection: { packetCursor: number; packetEnd: number } = {
    packetCursor: 0,
    packetEnd: 0,
  };
  readonly #vertexInputs: VertexInputArena;
  #renderInstanceOrdinal = 0;

  constructor(options: GltfPacketSubmissionOwnerOptions) {
    this.#batches = new GltfFrameBatchArena(options.runtime, options.vertexInputs);
    this.#instanceTransforms = options.instanceTransforms;
    this.#lightResolver = options.lightResolver;
    this.#materials = options.materials;
    this.#runtime = options.runtime;
    this.#sceneBindings = options.sceneBindings;
    this.#selection = options.selection;
    this.#vertexInputs = options.vertexInputs;
  }

  get counters(): GltfInstancingCounters {
    return this.#counters;
  }

  get frameBatches(): GltfFrameBatchArena {
    return this.#batches;
  }

  get geometryUploadDeferred(): boolean {
    return this.#geometryUploadDeferred;
  }

  get segment(): number {
    return this.#batches.workspace.segment;
  }

  get submissionCount(): number {
    return this.#batches.workspace.count;
  }

  beginFrame(planRevision: number): void {
    if (this.#geometryPlanRevision !== planRevision) {
      this.#geometryIdentityIds.fill(undefined);
      this.#geometryPlanRevision = planRevision;
    }
    resetGltfPacketSubmissionWorkspaceForFrame(
      this.#batches.workspace,
      planRevision,
      this.#runtime.packetTopology.catalog,
    );
    this.#batches.beginFrame();
    this.#geometryUploadDeferred = false;
    this.#materialDemandEpoch += 1;
    if (this.#materialDemandEpoch > 0xffff_ffff) {
      this.#materialDemandEpochs.fill(0);
      this.#materialDemandEpoch = 1;
    }
  }

  /** Demands every selected material for one plan node before fallible geometry upload. */
  demandNodeMaterials(
    node: AnyGltfNode,
    nodeIndex: number,
    packetCursor: number,
    packetEnd: number,
  ): void {
    const selected = this.#selection.selected;
    const selectedPlanNodeIndices = this.#selection.selectedPlanNodeIndices;
    if (packetCursor >= packetEnd || selectedPlanNodeIndices[packetCursor] !== nodeIndex) return;
    const topology = this.#runtime.packetTopology;
    const state = this.#runtime.stateForNode(node);
    for (let cursor = packetCursor; cursor < packetEnd; cursor += 1) {
      if (selectedPlanNodeIndices[cursor] !== nodeIndex) break;
      const packetIndex = selected.orderedPacketIndices[cursor]!;
      const materialId = topology.catalog.materialIds[packetIndex]!;
      if (materialId >= this.#materialDemandEpochs.length) {
        let capacity = this.#materialDemandEpochs.length;
        while (capacity <= materialId) capacity *= 2;
        const epochs = new Uint32Array(capacity);
        epochs.set(this.#materialDemandEpochs);
        this.#materialDemandEpochs = epochs;
      }
      if (this.#materialDemandEpochs[materialId] === this.#materialDemandEpoch) continue;
      this.#materialDemandEpochs[materialId] = this.#materialDemandEpoch;
      this.#runtime.images.demandMaterial(
        state.key,
        resolvePacketMaterial(topology.resources, materialId),
      );
    }
    this.#runtime.images.publishDemandProgress(state.key);
  }

  beginView(planRevision: number, viewIndex: number): GltfPacketViewSelection {
    resetGltfPacketSubmissionWorkspaceForView(
      this.#batches.workspace,
      planRevision,
      this.#runtime.packetTopology.catalog,
      viewIndex,
    );
    this.#renderInstanceOrdinal = 0;
    this.#geometryUploadDeferred = false;
    const packetCursor = this.#selection.selected.viewFirsts[viewIndex]!;
    this.#viewSelection.packetCursor = packetCursor;
    this.#viewSelection.packetEnd = packetCursor + this.#selection.selected.viewCounts[viewIndex]!;
    return this.#viewSelection;
  }

  resetSegment(planRevision: number, segment: number): void {
    resetGltfPacketSubmissionWorkspaceForSegment(
      this.#batches.workspace,
      planRevision,
      this.#runtime.packetTopology.catalog,
      segment,
    );
  }

  appendNode(
    node: AnyGltfNode,
    nodeIndex: number,
    packetCursor: number,
    packetEnd: number,
    planRevision: number,
    gl: WebGL2RenderingContext,
    contextGeneration: number,
  ): number {
    if (this.#geometryContextGeneration !== contextGeneration) {
      this.#geometryIdentityIds.fill(undefined);
      this.#geometryContextGeneration = contextGeneration;
    }
    const renderInstanceOrdinal = this.#renderInstanceOrdinal;
    this.#renderInstanceOrdinal += 1;
    const topology = this.#runtime.packetTopology;
    const catalog = topology.catalog;
    const selected = this.#selection.selected;
    const selectedOuterIndices = this.#selection.selectedOuterIndices;
    const selectedPlanNodeIndices = this.#selection.selectedPlanNodeIndices;
    if (packetCursor >= packetEnd) return packetCursor;
    const firstPlanNodeIndex = selectedPlanNodeIndices[packetCursor]!;
    if (firstPlanNodeIndex !== nodeIndex) {
      if (firstPlanNodeIndex < nodeIndex) {
        throw new Error("Royal retained glTF packet selection is not in frame-plan order");
      }
      return packetCursor;
    }
    const state = this.#runtime.stateForNode(node);
    const hasAssetLights = hasGltfAssetLights(state);
    const instanceViews = node.kind === "gltf-instances"
      ? this.#instanceTransforms.views(node.instances)
      : undefined;
    const ordinaryRootTransform = node.kind === "gltf"
      ? this.#sceneBindings.transform(node)
      : undefined;
    const ordinaryRootModel = node.kind === "gltf"
      ? this.#sceneBindings.modelMatrix(node)
      : undefined;
    const ordinaryScale = ordinaryRootTransform?.scale;
    const ordinaryOrientationPreserving = ordinaryScale === undefined
      || ordinaryScale[0] * ordinaryScale[1] * ordinaryScale[2] >= 0;
    const ordinaryAssetLights = ordinaryRootModel === undefined || !hasAssetLights
      ? undefined
      : this.#lightResolver.resolveGltfAsset(state, ordinaryRootModel);
    const ordinaryLightScopeId = ordinaryAssetLights === undefined
      ? 0
      : this.#lightResolver.gltfScopeId(state.instanceKey, renderInstanceOrdinal, 0);
    let cursor = packetCursor;

    while (cursor < packetEnd) {
      const packetIndex = selected.orderedPacketIndices[cursor]!;
      const selectedPlanNodeIndex = selectedPlanNodeIndices[cursor]!;
      if (selectedPlanNodeIndex !== nodeIndex) {
        if (selectedPlanNodeIndex < nodeIndex) {
          throw new Error("Royal retained glTF packet selection is not in frame-plan order");
        }
        break;
      }
      const instanceFirst = catalog.instanceFirsts[packetIndex]!;
      const instanceEnd = instanceFirst + catalog.instanceCounts[packetIndex]!;
      const geometryId = catalog.geometryIds[packetIndex]!;
      const materialId = catalog.materialIds[packetIndex]!;
      let materialBindingId = preparedGltfPacketSubmissionMaterialBindingId(
        this.#batches.workspace,
        materialId,
      );
      if (materialBindingId === undefined) {
        const loadedMaterial = resolvePacketMaterial(topology.resources, materialId);
        let prepared = this.#materials.settled(loadedMaterial);
        if (prepared === undefined) {
          const basePending = this.#runtime.images.demandMaterial(state.key, loadedMaterial);
          prepared = this.#materials.prepare(
            loadedMaterial,
            this.#runtime.images.readyKeys(state.key),
            basePending,
            this.#runtime.images.publication(state.key, loadedMaterial),
          );
        }
        let materialBinding = this.#materialBindings.get(prepared.material);
        if (materialBinding === undefined) {
          materialBinding = { material: prepared.material };
          this.#materialBindings.set(prepared.material, materialBinding);
        }
        materialBindingId = retainGltfPacketSubmissionMaterialBinding(
          this.#batches.workspace,
          planRevision,
          catalog,
          materialId,
          prepared.materialBatchClassId,
          materialBinding,
        );
      }
      let geometryIdentityId = this.#geometryIdentityIds[geometryId];
      if (geometryIdentityId === undefined) {
        try {
          geometryIdentityId = vertexInputGeometry(
            this.#vertexInputs,
            gl,
            contextGeneration,
            geometryId,
          ).staticIdentityId;
        } catch (error) {
          if (!(error instanceof VertexInputGpuUploadCapacityError)) throw error;
          this.#geometryUploadDeferred = true;
          return cursor;
        }
        this.#geometryIdentityIds[geometryId] = geometryIdentityId;
      }
      const packetSidedness = catalog.sidedness[packetIndex]!;
      const firstRootSourceId = catalog.rootSourceIds[packetIndex]!;
      const runCursor = cursor;
      while (cursor < packetEnd
        && selected.orderedPacketIndices[cursor] === packetIndex
        && selectedPlanNodeIndices[cursor] === nodeIndex) {
        cursor += 1;
      }
      const runCount = cursor - runCursor;
      const runFirst = beginPreparedGltfPacketSubmissionRun(
        this.#batches.workspace,
        catalog,
        packetIndex,
        geometryIdentityId,
        materialBindingId,
        runCount,
      );
      let runOffset = 0;
      while (runOffset < runCount) {
        const selectedOuterIndex = selectedOuterIndices[runCursor + runOffset]!;
        if (selectedOuterIndex < instanceFirst || selectedOuterIndex >= instanceEnd) {
          throw new Error("Royal retained glTF packet selection has an invalid root instance");
        }
        const orientationPreserving = instanceViews === undefined
          ? ordinaryOrientationPreserving
          : instanceViews.orientationPreserving[selectedOuterIndex] !== 0;
        const rootSourceId = firstRootSourceId + selectedOuterIndex - instanceFirst;
        let rootBindingId = preparedGltfPacketSubmissionRootBindingId(
          this.#batches.workspace,
          rootSourceId,
        );
        let lightBindingId = NO_FRAME_PACKET_ID;
        let lightScopeId: number;
        if (rootBindingId === undefined) {
          const rootModel = instanceViews?.rootModels[selectedOuterIndex] ?? ordinaryRootModel;
          if (rootModel === undefined) {
            throw new Error("Royal retained glTF packet root source has no current transform");
          }
          const assetLights = !hasAssetLights
            ? undefined
            : instanceViews === undefined
            ? ordinaryAssetLights
            : this.#lightResolver.resolveGltfAsset(state, rootModel);
          lightScopeId = assetLights === undefined
            ? 0
            : instanceViews === undefined
              ? ordinaryLightScopeId
              : this.#lightResolver.gltfScopeId(state.instanceKey, renderInstanceOrdinal, selectedOuterIndex);
          lightBindingId = assetLights === undefined
            ? NO_FRAME_PACKET_ID
            : retainGltfPacketSubmissionLightBinding(
                this.#batches.workspace,
                planRevision,
                catalog,
                lightScopeId,
                assetLights,
              );
          let rootBinding = this.#rootBindings[rootSourceId];
          if (rootBinding === undefined) {
            rootBinding = { rootModel };
            this.#rootBindings[rootSourceId] = rootBinding;
          }
          rootBinding.rootModel = rootModel;
          rootBindingId = appendPreparedGltfPacketSubmissionRootBinding(
            this.#batches.workspace,
            rootSourceId,
            selectedOuterIndex,
            lightScopeId,
            rootBinding,
          );
        } else {
          lightScopeId = this.#batches.workspace.rootBindingLightScopeIds[rootBindingId]!;
          if (lightScopeId !== 0) {
            const retainedLightBindingId = preparedGltfPacketSubmissionLightBindingId(
              this.#batches.workspace,
              lightScopeId,
            );
            if (retainedLightBindingId === undefined) {
              throw new Error("Royal retained glTF root binding has no asset-local light binding");
            }
            lightBindingId = retainedLightBindingId;
          }
        }
        const sidedness = (packetSidedness & FRAME_PACKET_SIDEDNESS.doubleSided)
          | (((packetSidedness & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0)
            === orientationPreserving
            ? FRAME_PACKET_SIDEDNESS.frontFaceCcw
            : 0);
        writePreparedGltfPacketSubmissionRunBinding(
          this.#batches.workspace,
          runFirst + runOffset,
          lightBindingId,
          lightScopeId,
          rootBindingId,
          sidedness,
        );
        runOffset += 1;
      }
      endPreparedGltfPacketSubmissionRun(this.#batches.workspace, runFirst, runCount);
    }
    return cursor;
  }

  prepareSegment(
    planRevision: number,
    sceneLights: SurfaceLightSet | undefined,
    gl: WebGL2RenderingContext,
    contextGeneration: number,
  ): ReturnType<GltfFrameBatchArena["prepareSegment"]> {
    const groups = this.#batches.prepareSegment(
      planRevision,
      sceneLights,
      gl,
      contextGeneration,
      this.#counters,
    );
    for (let index = 0; index < groups.activeBatchCount; index += 1) {
      this.#counters.batchInstancesTotal += this.#batches.batch(
        groups.activeBatchIds[index]!,
      ).localModels.length;
    }
    return groups;
  }

  batch(batchId: number): GltfFrameDrawBatch {
    return this.#batches.batch(batchId);
  }

  releaseUnused(gl: WebGL2RenderingContext, contextGeneration: number): void {
    this.#batches.releaseUnused(gl, contextGeneration);
  }

  dropContext(): void {
    this.#batches.dropContext();
  }

  dispose(): void {
    this.#batches.dispose();
  }

  snapshot(): WebGlGltfInstancingSnapshot {
    return { ...this.#counters };
  }
}
