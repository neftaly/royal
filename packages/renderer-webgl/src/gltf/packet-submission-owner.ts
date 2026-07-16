import {
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  type FramePacketRenderClass,
} from "../frame/packets";
import {
  appendPreparedGltfPacketSubmission,
  preparedGltfPacketSubmissionLightBindingId,
  preparedGltfPacketSubmissionMaterialBindingId,
  preparedGltfPacketSubmissionRootBindingId,
  resetGltfPacketSubmissionWorkspaceForFrame,
  resetGltfPacketSubmissionWorkspaceForSegment,
  resetGltfPacketSubmissionWorkspaceForView,
  retainGltfPacketSubmissionLightBinding,
  retainGltfPacketSubmissionMaterialBinding,
  retainGltfPacketSubmissionRootBinding,
  type GltfPacketSubmissionRow,
} from "../gltf-packet-submission-workspace";
import {
  resolvePacketMaterial,
} from "../packet-resource-tables";
import { resourceArenaContentKeys, type ResourceArena } from "../resource-arena";
import type { WebGlGltfInstancingSnapshot } from "../root-types";
import { SceneBindingRegistry } from "../scene-binding-registry";
import {
  vertexInputGeometry,
  type VertexInputArena,
} from "../vertex-input/arena";
import { SurfaceLightResolver } from "../surface-light-resolver";
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
  readonly resourceArena: ResourceArena;
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
  localModelUploadBytes: 0,
  localModelUploadCalls: 0,
  rootPoseUploadBytes: 0,
  rootPoseUploadCalls: 0,
  rootScaleUploadBytes: 0,
  rootScaleUploadCalls: 0,
});

/** Owns selected glTF packet translation, binding identity, and frame batching. */
export class GltfPacketSubmissionOwner {
  readonly #batches: GltfFrameBatchArena;
  readonly #counters = createCounters();
  readonly #frameGeometryIdentityIds: Array<number | undefined> = [];
  readonly #instanceTransforms: GltfInstanceTransformRegistry;
  readonly #lightResolver: SurfaceLightResolver;
  readonly #materials: GltfMaterialPreparationArena;
  readonly #materialBindings = new WeakMap<SurfaceMaterial, GltfFrameMaterialBinding>();
  readonly #resourceArena: ResourceArena;
  readonly #rootBindings: Array<MutableGltfFrameRootBinding | undefined> = [];
  readonly #runtime: PreparedGltfRuntime;
  readonly #sceneBindings: SceneBindingRegistry;
  readonly #selection: GltfPacketSelectionOwner;
  readonly #submissionRow: GltfPacketSubmissionRow = {
    geometryId: 0,
    geometryIdentityId: 0,
    lightBindingId: NO_FRAME_PACKET_ID,
    lightScopeId: 0,
    localModelId: 0,
    materialBindingId: 0,
    packetIndex: 0,
    renderClass: FRAME_PACKET_RENDER_CLASS.opaque,
    rootBindingId: 0,
    sidedness: 0,
  };
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
    this.#resourceArena = options.resourceArena;
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

  get segment(): number {
    return this.#batches.workspace.segment;
  }

  get submissionCount(): number {
    return this.#batches.workspace.count;
  }

  beginFrame(planRevision: number): void {
    this.#frameGeometryIdentityIds.length = 0;
    resetGltfPacketSubmissionWorkspaceForFrame(
      this.#batches.workspace,
      planRevision,
      this.#runtime.packetTopology.catalog,
    );
    this.#batches.beginFrame();
  }

  beginView(planRevision: number, viewIndex: number): GltfPacketViewSelection {
    resetGltfPacketSubmissionWorkspaceForView(
      this.#batches.workspace,
      planRevision,
      this.#runtime.packetTopology.catalog,
      viewIndex,
    );
    this.#renderInstanceOrdinal = 0;
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
    const contentKeys = resourceArenaContentKeys(this.#resourceArena, state.key);
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
    const ordinaryAssetLights = ordinaryRootModel === undefined
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
        this.#runtime.images.demandMaterial(state.key, loadedMaterial);
        const prepared = this.#materials.prepare(
          loadedMaterial,
          contentKeys,
          this.#runtime.images.readyKeys(state.key),
          this.#runtime.images.materialBasePending(state.key, loadedMaterial),
          this.#runtime.images.publication(state.key),
        );
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
      let geometryIdentityId = this.#frameGeometryIdentityIds[geometryId];
      if (geometryIdentityId === undefined) {
        geometryIdentityId = vertexInputGeometry(
          this.#vertexInputs,
          gl,
          contextGeneration,
          geometryId,
        ).staticIdentityId;
        this.#frameGeometryIdentityIds[geometryId] = geometryIdentityId;
      }
      const packetSidedness = catalog.sidedness[packetIndex]!;
      const firstRootSourceId = catalog.rootSourceIds[packetIndex]!;
      while (cursor < packetEnd
        && selected.orderedPacketIndices[cursor] === packetIndex
        && selectedPlanNodeIndices[cursor] === nodeIndex) {
        const selectedOuterIndex = selectedOuterIndices[cursor]!;
        if (selectedOuterIndex < instanceFirst || selectedOuterIndex >= instanceEnd) {
          throw new Error("Royal retained glTF packet selection has an invalid root instance");
        }
        const rootModel = instanceViews?.rootModels[selectedOuterIndex] ?? ordinaryRootModel;
        const rootTransform = instanceViews?.transforms[selectedOuterIndex] ?? ordinaryRootTransform;
        if (rootModel === undefined) {
          throw new Error("Royal retained glTF packet root source has no current transform");
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
          const assetLights = instanceViews === undefined
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
            rootBinding = {
              rootModel,
              rootLogicalIndex: -1,
              rootTransform,
            };
            this.#rootBindings[rootSourceId] = rootBinding;
          }
          rootBinding.rootModel = rootModel;
          rootBinding.rootLogicalIndex = instanceViews === undefined ? -1 : selectedOuterIndex;
          rootBinding.rootTransform = rootTransform;
          if (instanceViews === undefined) delete rootBinding.rootInstanceViews;
          else rootBinding.rootInstanceViews = instanceViews;
          rootBindingId = retainGltfPacketSubmissionRootBinding(
            this.#batches.workspace,
            planRevision,
            catalog,
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
        const submissionRow = this.#submissionRow as {
          -readonly [Key in keyof GltfPacketSubmissionRow]: GltfPacketSubmissionRow[Key];
        };
        submissionRow.geometryId = geometryId;
        submissionRow.geometryIdentityId = geometryIdentityId;
        submissionRow.lightBindingId = lightBindingId;
        submissionRow.lightScopeId = lightScopeId;
        submissionRow.localModelId = catalog.localModelIds[packetIndex]!;
        submissionRow.materialBindingId = materialBindingId;
        submissionRow.packetIndex = packetIndex;
        submissionRow.renderClass = catalog.renderClasses[packetIndex]! as FramePacketRenderClass;
        submissionRow.rootBindingId = rootBindingId;
        submissionRow.sidedness = (packetSidedness & FRAME_PACKET_SIDEDNESS.doubleSided)
          | (((packetSidedness & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0)
            === orientationPreserving
            ? FRAME_PACKET_SIDEDNESS.frontFaceCcw
            : 0);
        appendPreparedGltfPacketSubmission(this.#batches.workspace, submissionRow);
        cursor += 1;
      }
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
