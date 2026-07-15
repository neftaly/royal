import { readRenderObjectHandleTransform } from "@royal/renderer-core/render-object";
import {
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  type FramePacketRenderClass,
} from "../frame/packets";
import { GeometryRecipeRegistry } from "../geometry-recipe-registry";
import {
  appendGltfPacketSubmission,
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
  transformMat4Into,
  type Mat4,
  type MutableMat4,
  identityMat4,
} from "../math/mat4";
import {
  readPacketLocalModelInto,
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
  readonly geometryRecipes: GeometryRecipeRegistry;
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

const orientationDeterminant = (matrix: Mat4): number =>
  matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
  - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
  + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);

/** Owns selected glTF packet translation, binding identity, and frame batching. */
export class GltfPacketSubmissionOwner {
  readonly #batches: GltfFrameBatchArena;
  readonly #counters = createCounters();
  readonly #geometryRecipes: GeometryRecipeRegistry;
  readonly #instanceTransforms: GltfInstanceTransformRegistry;
  readonly #lightResolver: SurfaceLightResolver;
  readonly #localModelScratch: MutableMat4 = identityMat4();
  readonly #materials: GltfMaterialPreparationArena;
  readonly #materialBindings = new WeakMap<SurfaceMaterial, GltfFrameMaterialBinding>();
  readonly #ordinaryRootModels = new WeakMap<AnyGltfNode, MutableMat4>();
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
    this.#geometryRecipes = options.geometryRecipes;
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
    const instanceViews = node.kind === "gltf-instances"
      ? this.#instanceTransforms.views(node.instances)
      : undefined;
    const rootHandle = node.kind === "gltf" ? this.#sceneBindings.handle(node) : undefined;
    const ordinaryRootTransform = node.kind === "gltf"
      ? rootHandle === undefined ? node.transform : readRenderObjectHandleTransform(rootHandle)
      : undefined;
    let ordinaryRootModel: MutableMat4 | undefined;
    if (node.kind === "gltf") {
      ordinaryRootModel = this.#ordinaryRootModels.get(node);
      if (ordinaryRootModel === undefined) {
        ordinaryRootModel = identityMat4();
        this.#ordinaryRootModels.set(node, ordinaryRootModel);
      }
      transformMat4Into(ordinaryRootModel, ordinaryRootTransform);
    }
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
      const expectedKind = node.kind === "gltf"
        ? GLTF_PACKET_ROOT_SOURCE_KIND.gltf
        : GLTF_PACKET_ROOT_SOURCE_KIND.gltfInstances;
      if (source.kind !== expectedKind) {
        throw new Error("Royal retained glTF packet root kind diverged from the frame plan");
      }
      const outerIndex = catalog.instanceFirsts[packetIndex]!;
      if (source.outerIndex !== outerIndex || catalog.instanceCounts[packetIndex] !== 1) {
        throw new Error("Royal retained glTF packet instance source is invalid");
      }
      const geometryId = catalog.geometryIds[packetIndex]!;
      const primitive = this.#geometryRecipes.packetPrimitive(geometryId);
      if (primitive === undefined) {
        throw new Error(`Royal retained glTF packet geometry ${geometryId} has no prepared primitive`);
      }
      const loadedMaterial = resolvePacketMaterial(
        topology.resources,
        catalog.materialIds[packetIndex]!,
      );
      this.#runtime.images.demandMaterial(state.key, loadedMaterial);
      const baseColorImageUri = loadedMaterial.baseColorTexture?.imageUri;
      const prepared = this.#materials.prepare(
        primitive,
        loadedMaterial,
        resourceArenaContentKeys(this.#resourceArena, state.key),
        baseColorImageUri !== undefined
          && this.#runtime.images.imageReady(state.key, baseColorImageUri),
      );
      const geometry = vertexInputGeometry(
        this.#vertexInputs,
        gl,
        contextGeneration,
        geometryId,
      );
      const localDeterminant = readPacketLocalModelInto(
        topology.resources,
        catalog.localModelIds[packetIndex]!,
        this.#localModelScratch,
      );
      const rootModel = instanceViews?.rootModels[outerIndex] ?? ordinaryRootModel;
      const rootTransform = instanceViews?.transforms[outerIndex] ?? ordinaryRootTransform;
      if (rootModel === undefined) {
        throw new Error("Royal retained glTF packet root source has no current transform");
      }
      const rootDeterminant = orientationDeterminant(rootModel);
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
      let materialBinding = this.#materialBindings.get(prepared.material);
      if (materialBinding === undefined) {
        materialBinding = { material: prepared.material };
        this.#materialBindings.set(prepared.material, materialBinding);
      }
      const materialBindingId = retainGltfPacketSubmissionMaterialBinding(
        this.#batches.workspace,
        planRevision,
        catalog,
        catalog.materialIds[packetIndex]!,
        prepared.materialBatchClassId,
        materialBinding,
      );
      const rootSourceId = catalog.rootSourceIds[packetIndex]!;
      let rootBinding = this.#rootBindings[rootSourceId];
      if (rootBinding === undefined) {
        rootBinding = {
          rootModel,
          rootSignatureInstanceIndex: -1,
          rootSignatureRenderInstanceOrdinal: 0,
          rootTransform,
        };
        this.#rootBindings[rootSourceId] = rootBinding;
      }
      rootBinding.rootModel = rootModel;
      rootBinding.rootSignatureInstanceIndex = instanceViews === undefined ? -1 : outerIndex;
      rootBinding.rootSignatureRenderInstanceOrdinal = renderInstanceOrdinal;
      rootBinding.rootTransform = rootTransform;
      if (instanceViews === undefined) delete rootBinding.rootInstanceViews;
      else rootBinding.rootInstanceViews = instanceViews;
      if (instanceViews !== undefined) {
        rootBinding.rootPositionSignatureVersion = instanceViews.sourceKey;
        rootBinding.rootRotationSignatureVersion = instanceViews.sourceKey;
        rootBinding.rootScaleSignatureVersion = instanceViews.sourceKey;
      } else if (rootHandle === undefined) {
        delete rootBinding.rootPositionSignatureVersion;
        delete rootBinding.rootRotationSignatureVersion;
        delete rootBinding.rootScaleSignatureVersion;
      } else {
        rootBinding.rootPositionSignatureVersion = rootHandle.positionVersion;
        rootBinding.rootRotationSignatureVersion = rootHandle.rotationVersion;
        rootBinding.rootScaleSignatureVersion = rootHandle.scaleVersion;
      }
      const rootBindingId = retainGltfPacketSubmissionRootBinding(
        this.#batches.workspace,
        planRevision,
        catalog,
        rootSourceId,
        outerIndex,
        lightScopeId,
        rootBinding,
      );
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
      submissionRow.geometryIdentityId = geometry.staticIdentityId;
      submissionRow.lightBindingId = lightBindingId;
      submissionRow.lightScopeId = lightScopeId;
      submissionRow.localModelId = catalog.localModelIds[packetIndex]!;
      submissionRow.materialBindingId = materialBindingId;
      submissionRow.packetIndex = packetIndex;
      submissionRow.renderClass = catalog.renderClasses[packetIndex]! as FramePacketRenderClass;
      submissionRow.rootBindingId = rootBindingId;
      submissionRow.sidedness = (packetSidedness & FRAME_PACKET_SIDEDNESS.doubleSided)
        | (rootDeterminant * localDeterminant >= 0 ? FRAME_PACKET_SIDEDNESS.frontFaceCcw : 0);
      appendGltfPacketSubmission(
        this.#batches.workspace,
        planRevision,
        catalog,
        submissionRow,
      );
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
