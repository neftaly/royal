import type { Geometry, Material, MeshNode } from "@royal/renderer-core";
import {
  directGeometryDeclaration,
  directGeometryDeclarationKey,
  normalizeGeometryDeclaration,
  type CpuGeometry,
} from "./geometry-recipes";
import type { LoadedGltfPrimitive } from "./gltf/prepared-asset";
import { identityMat4 } from "./math/mat4";
import { worldBounds, type Bounds3 } from "./math/picking";

export type RetainedGeometryRecipe = {
  readonly id: number;
  readonly recipe: CpuGeometry;
};

/** Owns semantic CPU geometry identity, bounds, and glTF packet reverse lookup. */
export class GeometryRecipeRegistry {
  readonly #localBounds = new WeakMap<Float32Array, Bounds3 | undefined>();
  readonly #pickingRecipes = new WeakMap<Geometry, CpuGeometry>();
  readonly #retained = new Map<string, RetainedGeometryRecipe>();
  readonly #gltfKeys = new WeakMap<LoadedGltfPrimitive, string>();
  readonly #packetPrimitives = new Map<number, LoadedGltfPrimitive>();

  retainRecipe(key: string, id: number, recipe: CpuGeometry): void {
    this.#retained.set(key, { id, recipe });
  }

  releaseRecipe(key: string, id: number): void {
    if (this.#retained.get(key)?.id === id) this.#retained.delete(key);
  }

  retainedDirectRecipe(
    geometry: MeshNode["geometry"],
    material: Material,
  ): RetainedGeometryRecipe {
    const declaration = directGeometryDeclaration(
      geometry,
      material.kind === "wireframe" ? "wireframe" : "surface",
    );
    const key = directGeometryDeclarationKey(declaration);
    const retained = this.#retained.get(key);
    if (retained === undefined) {
      throw new Error(`Royal direct geometry ${key} was not semantically retained`);
    }
    return retained;
  }

  /** Normalizes a node-local picking override through the ordinary direct-geometry recipe path. */
  pickingRecipe(geometry: Geometry): CpuGeometry {
    const cached = this.#pickingRecipes.get(geometry);
    if (cached !== undefined) return cached;
    const recipe = normalizeGeometryDeclaration(directGeometryDeclaration(geometry, "surface"));
    this.#pickingRecipes.set(geometry, recipe);
    return recipe;
  }

  associateGltfPrimitiveKey(primitive: LoadedGltfPrimitive, key: string): void {
    this.#gltfKeys.set(primitive, key);
  }

  retainedGltfRecipe(primitive: LoadedGltfPrimitive): RetainedGeometryRecipe | undefined {
    const key = this.#gltfKeys.get(primitive);
    return key === undefined ? undefined : this.#retained.get(key);
  }

  bindPacketPrimitive(id: number, primitive: LoadedGltfPrimitive): void {
    this.#packetPrimitives.set(id, primitive);
  }

  packetPrimitive(id: number): LoadedGltfPrimitive | undefined {
    return this.#packetPrimitives.get(id);
  }

  forgetPacketPrimitive(id: number): void {
    this.#packetPrimitives.delete(id);
  }

  clearPacketPrimitives(): void {
    this.#packetPrimitives.clear();
  }

  clearRetainedRecipes(): void {
    this.#retained.clear();
  }

  localBounds(geometry: CpuGeometry): Bounds3 | undefined {
    if (this.#localBounds.has(geometry.positions)) return this.#localBounds.get(geometry.positions);
    const bounds = worldBounds(geometry.positions, identityMat4());
    this.#localBounds.set(geometry.positions, bounds);
    return bounds;
  }
}
