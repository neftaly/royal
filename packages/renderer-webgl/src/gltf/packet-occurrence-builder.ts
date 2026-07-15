import type { FramePlan } from "../frame-plan";
import { GeometryRecipeRegistry } from "../geometry-recipe-registry";
import {
  type GltfPacketOccurrence,
  type GltfPacketPreparedPrimitive,
} from "../gltf-packet-topology";
import {
  gltfPrimitiveMaterialForVariant,
  selectedGltfVariantIndex,
} from "./material-preparation-arena";
import { gltfMaterialLodSelectionKey } from "./packet-selection-owner";
import {
  PreparedGltfRuntime,
  type AnyGltfNode,
  type PreparedGltfState,
} from "./prepared-runtime";

/** Lowers retained glTF state into backend-neutral packet topology occurrences. */
export class GltfPacketOccurrenceBuilder {
  readonly #geometryRecipes: GeometryRecipeRegistry;
  readonly #runtime: PreparedGltfRuntime;

  constructor(geometryRecipes: GeometryRecipeRegistry, runtime: PreparedGltfRuntime) {
    this.#geometryRecipes = geometryRecipes;
    this.#runtime = runtime;
  }

  occurrence(plan: FramePlan, topologyOccurrenceIndex: number): GltfPacketOccurrence {
    const row = plan.gltfRequestRows[topologyOccurrenceIndex]!;
    const node = plan.nodes[row.nodeIndex] as AnyGltfNode;
    const state = this.#runtime.get(row.requestKey);
    const primitives = state?.status === "ready"
      ? this.#preparedPrimitives(node, state, topologyOccurrenceIndex)
      : undefined;
    return {
      kind: node.kind,
      occurrenceIndex: topologyOccurrenceIndex,
      orderingSegment: plan.orderSegments[row.nodeIndex]!,
      outerCount: node.kind === "gltf-instances" ? node.instances.count : 1,
      planOccurrenceIndex: row.nodeIndex,
      ...(primitives === undefined ? {} : { primitives }),
    };
  }

  rebuild(plan: FramePlan): void {
    this.#geometryRecipes.clearPacketPrimitives();
    this.#runtime.rebuildPacketTopology(
      plan.revision,
      plan.gltfRequestRows.map((row) => row.requestKey),
      plan.gltfRequestRows.map((_, index) => this.occurrence(plan, index)),
    );
  }

  resetPlan(): void {
    this.#runtime.sharedViewLods.resetPlan();
  }

  #preparedPrimitives(
    node: AnyGltfNode,
    state: PreparedGltfState,
    renderInstanceOrdinal: number,
  ): readonly GltfPacketPreparedPrimitive[] {
    const outerCount = node.kind === "gltf-instances" ? node.instances.count : 1;
    const selectedVariantIndex = state.hasMaterialVariants
      ? selectedGltfVariantIndex(state.variants, node.materialVariant)
      : undefined;
    return state.primitives.map((primitive) => {
      const retainedGeometry = this.#geometryRecipes.retainedGltfRecipe(primitive);
      if (retainedGeometry === undefined) {
        throw new Error(`Royal glTF primitive geometry ${primitive.key} was not retained for packets`);
      }
      this.#geometryRecipes.bindPacketPrimitive(retainedGeometry.id, primitive);
      const primitiveMaterial = selectedVariantIndex === undefined
        ? primitive.baseMaterial
        : gltfPrimitiveMaterialForVariant(selectedVariantIndex, primitive);
      const materialLod = primitiveMaterial.materialLod;
      const materialAlternatives = materialLod === undefined
        ? [{ material: primitiveMaterial.material }]
        : materialLod.levels.map((material, level) => ({ level, material }));
      const renderInstanceKey = (outerIndex: number): string => node.kind === "gltf-instances"
        ? `instance:${renderInstanceOrdinal}:${outerIndex}`
        : `instance:${renderInstanceOrdinal}`;
      const materialLodSelectionIds = materialLod === undefined
        ? undefined
        : Array.from({ length: outerCount * primitive.localModels.length }, (_, index) => {
            const outerIndex = Math.floor(index / primitive.localModels.length);
            const localIndex = index % primitive.localModels.length;
            return this.#runtime.sharedViewLods.materialSelectionId(
              state.key,
              gltfMaterialLodSelectionKey(
                state,
                renderInstanceKey(outerIndex),
                primitive,
                primitiveMaterial,
                localIndex,
              ),
              materialLod,
            );
          });
      const nodeLod = primitive.nodeLod === undefined
        ? undefined
        : {
            level: primitive.nodeLod.level,
            selectionIds: Array.from({ length: outerCount }, (_, outerIndex) =>
              this.#runtime.sharedViewLods.nodeSelectionId(
                state.key,
                `${state.key}:${renderInstanceKey(outerIndex)}:node:${primitive.nodeLod!.group}`,
                primitive.nodeLod!,
                state.primitives,
              )),
          };
      return {
        geometryId: retainedGeometry.id,
        localBounds: primitive.localBounds,
        localModelDeterminants: primitive.localModelDeterminants,
        localModels: primitive.localModels,
        materialAlternatives,
        ...(materialLodSelectionIds === undefined ? {} : { materialLodSelectionIds }),
        ...(nodeLod === undefined ? {} : { nodeLod }),
      };
    });
  }
}
