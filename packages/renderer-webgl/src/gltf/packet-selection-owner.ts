import {
  appendSelectedFramePacket,
  beginSelectedFramePacketView,
  beginSelectedFramePacketViews,
  createSelectedFramePackets,
  endSelectedFramePacketView,
  framePacketLodRequirementsMatch,
  type SelectedFramePackets,
} from "../frame-packets";
import { copyFrameViewMatrixInto, type FrameViews } from "../frame-views";
import type { FramePlan } from "../frame-plan";
import { GltfInstanceTransformRegistry } from "./instance-transform-registry";
import {
  gltfPrimitiveMaterialForVariant,
  selectedGltfVariantIndex,
} from "./material-preparation-arena";
import type {
  LoadedGltfPrimitive,
  LoadedGltfPrimitiveMaterial,
} from "./prepared-asset";
import {
  PreparedGltfRuntime,
  type AnyGltfNode,
  type PreparedGltfState,
} from "./prepared-runtime";
import {
  identityMat4,
  multiplyMat4Into,
  transformMat4Into,
  type Mat4,
} from "../math/mat4";
import { isBoundsVisible, type MutableBounds3 } from "../math/picking";
import {
  createProjectedBoundsWorkspace,
  projectedBoundsScreenCoverage,
} from "../math/projected-bounds";
import { readPacketBoundsInto } from "../packet-resource-tables";
import { SceneBindingRegistry } from "../scene-binding-registry";

export const gltfMaterialLodSelectionKey = (
  state: PreparedGltfState,
  renderInstanceKey: string,
  primitive: LoadedGltfPrimitive,
  primitiveMaterial: LoadedGltfPrimitiveMaterial,
  instanceIndex: number,
): string =>
  `${state.key}:${renderInstanceKey}:material:${primitive.key}:${primitiveMaterial.selectionKey}:instance:${instanceIndex}`;

/** Owns shared-view glTF LOD observation and per-view packet selection. */
export class GltfPacketSelectionOwner {
  readonly #boundsScratch: MutableBounds3 = { max: [0, 0, 0], min: [0, 0, 0] };
  readonly #instanceTransforms: GltfInstanceTransformRegistry;
  readonly #projectedBounds = createProjectedBoundsWorkspace();
  readonly #rootModel = identityMat4();
  readonly #rootViewProjection = identityMat4();
  readonly #runtime: PreparedGltfRuntime;
  readonly #sceneBindings: SceneBindingRegistry;
  readonly #viewProjection = identityMat4();
  readonly selected: SelectedFramePackets;

  constructor(
    runtime: PreparedGltfRuntime,
    instanceTransforms: GltfInstanceTransformRegistry,
    sceneBindings: SceneBindingRegistry,
  ) {
    this.#runtime = runtime;
    this.#instanceTransforms = instanceTransforms;
    this.#sceneBindings = sceneBindings;
    this.selected = createSelectedFramePackets(runtime.packetTopology.catalog);
  }

  prepareFrame(plan: FramePlan, frameViews: FrameViews): void {
    this.#prepareSharedViewLodSelections(plan, frameViews);
    this.#selectFramePackets(plan, frameViews);
  }

  #prepareSharedViewLodSelections(plan: FramePlan, frameViews: FrameViews): void {
    this.#runtime.sharedViewLods.beginFrame();
    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      copyFrameViewMatrixInto(this.#viewProjection, frameViews.viewProjections, viewIndex);
      this.#visitLodRoots(plan, this.#viewProjection, 1);
    }
    this.#runtime.sharedViewLods.finalizeNodes();
    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      copyFrameViewMatrixInto(this.#viewProjection, frameViews.viewProjections, viewIndex);
      this.#visitLodRoots(plan, this.#viewProjection, 2);
    }
    this.#runtime.sharedViewLods.finalizeMaterials();
  }

  #selectFramePackets(plan: FramePlan, frameViews: FrameViews): void {
    const topology = this.#runtime.packetTopology;
    const packetSelections = this.#runtime.sharedViewLods.packetSelections;
    beginSelectedFramePacketViews(this.selected, topology.catalog, frameViews.count);
    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      beginSelectedFramePacketView(this.selected, topology.catalog, viewIndex);
      copyFrameViewMatrixInto(this.#viewProjection, frameViews.viewProjections, viewIndex);
      for (let occurrenceIndex = 0; occurrenceIndex < topology.occurrenceCount; occurrenceIndex += 1) {
        const requestRow = plan.gltfRequestRows[occurrenceIndex]!;
        const node = plan.nodes[requestRow.nodeIndex] as AnyGltfNode;
        const instanceViews = node.kind === "gltf-instances"
          ? this.#instanceTransforms.views(node.instances)
          : undefined;
        const ordinaryRootModel = node.kind === "gltf"
          ? transformMat4Into(this.#rootModel, this.#sceneBindings.transform(node))
          : undefined;
        const first = topology.occurrenceFirsts[occurrenceIndex]!;
        const end = first + topology.occurrenceCounts[occurrenceIndex]!;
        for (let packetIndex = first; packetIndex < end; packetIndex += 1) {
          if (!framePacketLodRequirementsMatch(
            topology.catalog,
            topology.requirements,
            packetIndex,
            packetSelections.selectedLevels,
            packetSelections.selectionEpochs,
            packetSelections.epoch,
          )) continue;
          const outerIndex = topology.catalog.instanceFirsts[packetIndex]!;
          const rootModel = instanceViews?.rootModels[outerIndex] ?? ordinaryRootModel;
          if (rootModel === undefined) continue;
          multiplyMat4Into(this.#rootViewProjection, this.#viewProjection, rootModel);
          const hasBounds = readPacketBoundsInto(
            topology.resources,
            topology.catalog.boundsIds[packetIndex]!,
            this.#boundsScratch,
          );
          if (!isBoundsVisible(
            hasBounds ? this.#boundsScratch : undefined,
            this.#rootViewProjection,
          )) continue;
          appendSelectedFramePacket(this.selected, topology.catalog, packetIndex);
        }
      }
      endSelectedFramePacketView(this.selected, topology.catalog, viewIndex);
    }
  }

  #visitLodRoots(plan: FramePlan, viewProjection: Mat4, phase: 1 | 2): void {
    let renderInstanceOrdinal = 0;
    for (const planNode of plan.nodes) {
      if (planNode.kind !== "gltf" && planNode.kind !== "gltf-instances") continue;
      const node = planNode;
      const ordinal = renderInstanceOrdinal;
      renderInstanceOrdinal += 1;
      const state = this.#runtime.stateForNode(node);
      if (state.status !== "ready" || (!state.hasNodeLod && !state.hasMaterialLod)) continue;
      if (node.kind === "gltf-instances") {
        const views = this.#instanceTransforms.views(node.instances);
        for (let outerIndex = 0; outerIndex < node.instances.count; outerIndex += 1) {
          multiplyMat4Into(this.#rootViewProjection, viewProjection, views.rootModels[outerIndex]!);
          this.#observeLodRoot(
            state,
            node,
            `instance:${ordinal}:${outerIndex}`,
            this.#rootViewProjection,
            phase,
          );
        }
        continue;
      }
      transformMat4Into(this.#rootModel, this.#sceneBindings.transform(node));
      multiplyMat4Into(this.#rootViewProjection, viewProjection, this.#rootModel);
      this.#observeLodRoot(
        state,
        node,
        `instance:${ordinal}`,
        this.#rootViewProjection,
        phase,
      );
    }
  }

  #observeLodRoot(
    state: PreparedGltfState,
    node: AnyGltfNode,
    renderInstanceKey: string,
    rootViewProjectionModel: Mat4,
    phase: 1 | 2,
  ): void {
    const selectedVariantIndex = phase === 2 && state.hasMaterialVariants
      ? selectedGltfVariantIndex(state.variants, node.materialVariant)
      : undefined;
    for (const primitive of state.primitives) {
      const nodeLod = primitive.nodeLod;
      if (phase === 1) {
        if (nodeLod === undefined) continue;
        const selectionKey = `${state.key}:${renderInstanceKey}:node:${nodeLod.group}`;
        const id = this.#runtime.sharedViewLods.nodeSelectionId(
          state.key,
          selectionKey,
          nodeLod,
          state.primitives,
        );
        this.#runtime.sharedViewLods.touchNode(id);
        if (nodeLod.level !== 0) {
          for (const bounds of primitive.localBounds) {
            if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
            this.#runtime.sharedViewLods.observeNodeFallback(id, nodeLod.level);
          }
          continue;
        }
        for (const bounds of primitive.localBounds) {
          if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
          this.#runtime.sharedViewLods.observeCoverage(
            id,
            projectedBoundsScreenCoverage(bounds, rootViewProjectionModel, this.#projectedBounds),
          );
        }
        continue;
      }
      if (nodeLod !== undefined) {
        const nodeSelectionKey = `${state.key}:${renderInstanceKey}:node:${nodeLod.group}`;
        if (this.#runtime.sharedViewLods.selectedLevel(state.key, nodeSelectionKey) !== nodeLod.level) continue;
      }
      const primitiveMaterial = selectedVariantIndex === undefined
        ? primitive.baseMaterial
        : gltfPrimitiveMaterialForVariant(selectedVariantIndex, primitive);
      const materialLod = primitiveMaterial.materialLod;
      if (materialLod === undefined) continue;
      for (let instanceIndex = 0; instanceIndex < primitive.localBounds.length; instanceIndex += 1) {
        const bounds = primitive.localBounds[instanceIndex];
        if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
        const selectionKey = gltfMaterialLodSelectionKey(
          state,
          renderInstanceKey,
          primitive,
          primitiveMaterial,
          instanceIndex,
        );
        const id = this.#runtime.sharedViewLods.materialSelectionId(state.key, selectionKey, materialLod);
        this.#runtime.sharedViewLods.touchMaterial(id);
        this.#runtime.sharedViewLods.observeCoverage(
          id,
          projectedBoundsScreenCoverage(bounds, rootViewProjectionModel, this.#projectedBounds),
        );
      }
    }
  }
}
