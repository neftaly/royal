import type { Transform } from "@royal/renderer-core";
import {
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  type FramePacketRenderClass,
} from "../frame/packets";
import {
  appendPreparedGltfPacketSubmission,
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
import { GLTF_PACKET_ROOT_SOURCE_KIND } from "../gltf-packet-topology";
import {
  packetLocalModelDeterminant,
  readPacketRootSourceInto,
  resolvePacketMaterial,
  type MutablePacketRootSourceRow,
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

const transformOrientationDeterminant = (transform: Transform | undefined): number => {
  const scale = transform?.scale;
  return scale === undefined ? 1 : scale[0] * scale[1] * scale[2];
};

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
  readonly #rootSourceScratch: MutablePacketRootSourceRow = {
    kind: 0,
    outerIndex: 0,
    planOccurrenceIndex: 0,
  };
  readonly #runtime: PreparedGltfRuntime;
  readonly #sceneBindings: SceneBindingRegistry;
  readonly #selection: GltfPacketSelectionOwner;
  readonly #instanceAssetLights = new Map<number, SurfaceLightSet | undefined>();
  readonly #instanceAssetLightScopeIds = new Map<number, number>();
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
    if (packetCursor >= packetEnd) return packetCursor;
    const firstPacketIndex = selected.orderedPacketIndices[packetCursor]!;
    readPacketRootSourceInto(
      topology.resources,
      catalog.rootSourceIds[firstPacketIndex]!,
      this.#rootSourceScratch,
    );
    if (this.#rootSourceScratch.planOccurrenceIndex !== nodeIndex) {
      if (this.#rootSourceScratch.planOccurrenceIndex < nodeIndex) {
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
    const ordinaryAssetLights = ordinaryRootModel === undefined
      ? undefined
      : this.#lightResolver.resolveGltfAsset(state, ordinaryRootModel);
    const ordinaryLightScopeId = ordinaryAssetLights === undefined
      ? 0
      : this.#lightResolver.gltfScopeId(state.instanceKey, renderInstanceOrdinal, 0);
    const instanceAssetLights = instanceViews === undefined ? undefined : this.#instanceAssetLights;
    const instanceAssetLightScopeIds = this.#instanceAssetLightScopeIds;
    instanceAssetLights?.clear();
    instanceAssetLightScopeIds.clear();
    const expectedKind = node.kind === "gltf"
      ? GLTF_PACKET_ROOT_SOURCE_KIND.gltf
      : GLTF_PACKET_ROOT_SOURCE_KIND.gltfInstances;
    let determinantOuterIndex = -1;
    let rootDeterminant = 1;
    let cursor = packetCursor;

    while (cursor < packetEnd) {
      const packetIndex = selected.orderedPacketIndices[cursor]!;
      readPacketRootSourceInto(
        topology.resources,
        catalog.rootSourceIds[packetIndex]!,
        this.#rootSourceScratch,
      );
      const source = this.#rootSourceScratch;
      if (source.planOccurrenceIndex !== nodeIndex) {
        if (source.planOccurrenceIndex < nodeIndex) {
          throw new Error("Royal retained glTF packet selection is not in frame-plan order");
        }
        break;
      }
      if (source.kind !== expectedKind) {
        throw new Error("Royal retained glTF packet root kind diverged from the frame plan");
      }
      const outerIndex = catalog.instanceFirsts[packetIndex]!;
      if (source.outerIndex !== outerIndex || catalog.instanceCounts[packetIndex] !== 1) {
        throw new Error("Royal retained glTF packet instance source is invalid");
      }
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
      const localDeterminant = packetLocalModelDeterminant(
        topology.resources,
        catalog.localModelIds[packetIndex]!,
      );
      const rootModel = instanceViews?.rootModels[outerIndex] ?? ordinaryRootModel;
      const rootTransform = instanceViews?.transforms[outerIndex] ?? ordinaryRootTransform;
      if (rootModel === undefined) {
        throw new Error("Royal retained glTF packet root source has no current transform");
      }
      if (outerIndex !== determinantOuterIndex) {
        rootDeterminant = transformOrientationDeterminant(rootTransform);
        determinantOuterIndex = outerIndex;
      }
      const packetSidedness = catalog.sidedness[packetIndex]!;
      let assetLights = ordinaryAssetLights;
      let lightScopeId = ordinaryLightScopeId;
      if (instanceAssetLights !== undefined) {
        if (instanceAssetLights.has(outerIndex)) {
          assetLights = instanceAssetLights.get(outerIndex);
          lightScopeId = instanceAssetLightScopeIds.get(outerIndex)!;
        } else {
          assetLights = this.#lightResolver.resolveGltfAsset(state, rootModel);
          lightScopeId = assetLights === undefined
            ? 0
            : this.#lightResolver.gltfScopeId(state.instanceKey, renderInstanceOrdinal, outerIndex);
          instanceAssetLights.set(outerIndex, assetLights);
          instanceAssetLightScopeIds.set(outerIndex, lightScopeId);
        }
      }
      const rootSourceId = catalog.rootSourceIds[packetIndex]!;
      let rootBindingId = preparedGltfPacketSubmissionRootBindingId(
        this.#batches.workspace,
        rootSourceId,
      );
      if (rootBindingId === undefined) {
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
        rootBinding.rootLogicalIndex = instanceViews === undefined ? -1 : outerIndex;
        rootBinding.rootTransform = rootTransform;
        if (instanceViews === undefined) delete rootBinding.rootInstanceViews;
        else rootBinding.rootInstanceViews = instanceViews;
        rootBindingId = retainGltfPacketSubmissionRootBinding(
          this.#batches.workspace,
          planRevision,
          catalog,
          rootSourceId,
          outerIndex,
          lightScopeId,
          rootBinding,
        );
      }
      const lightBindingId = assetLights === undefined
        ? NO_FRAME_PACKET_ID
        : retainGltfPacketSubmissionLightBinding(
            this.#batches.workspace,
            planRevision,
            catalog,
            lightScopeId,
            assetLights,
          );
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
        | (rootDeterminant * localDeterminant >= 0 ? FRAME_PACKET_SIDEDNESS.frontFaceCcw : 0);
      appendPreparedGltfPacketSubmission(this.#batches.workspace, submissionRow);
      cursor += 1;
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
