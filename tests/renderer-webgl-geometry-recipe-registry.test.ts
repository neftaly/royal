import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  standardMaterial,
} from "@royal/renderer-core";
import {
  directGeometryKey,
  type CpuGeometry,
} from "../packages/renderer-webgl/src/geometry-recipes";
import { GeometryRecipeRegistry } from "../packages/renderer-webgl/src/geometry-recipe-registry";
import type { LoadedGltfPrimitive } from "../packages/renderer-webgl/src/gltf/prepared-asset";

const recipe = (): CpuGeometry => ({
  bucketKey: "test-geometry",
  mode: "triangles",
  positions: new Float32Array([
    -2, -1, 0,
    2, -1, 0,
    0, 3, 0,
  ]),
});

describe("GeometryRecipeRegistry", () => {
  it("owns retained direct-geometry identity without accepting stale releases", () => {
    const registry = new GeometryRecipeRegistry();
    const geometry = boxGeometry(2);
    const material = standardMaterial({ color: [1, 1, 1, 1] });
    const key = directGeometryKey(geometry, "surface");
    const cpu = recipe();

    expect(() => registry.retainedDirectRecipe(geometry, material))
      .toThrow(/was not semantically retained/);
    registry.retainRecipe(key, 7, cpu);
    expect(registry.retainedDirectRecipe(geometry, material)).toEqual({ id: 7, recipe: cpu });

    registry.releaseRecipe(key, 8);
    expect(registry.retainedDirectRecipe(geometry, material).id).toBe(7);
    registry.releaseRecipe(key, 7);
    expect(() => registry.retainedDirectRecipe(geometry, material))
      .toThrow(/was not semantically retained/);
  });

  it("caches local bounds by borrowed position-array identity", () => {
    const registry = new GeometryRecipeRegistry();
    const cpu = recipe();

    const first = registry.localBounds(cpu);
    expect(first).toEqual({ max: [2, 3, 0], min: [-2, -1, 0] });
    expect(registry.localBounds({ ...cpu, bucketKey: "same-positions" })).toBe(first);
  });

  it("keeps glTF semantic keys and transient packet reverse lookup in one authority", () => {
    const registry = new GeometryRecipeRegistry();
    const primitive = { key: "primitive:0" } as LoadedGltfPrimitive;
    const cpu = recipe();

    registry.associateGltfPrimitiveKey(primitive, "gltf:geometry:0");
    expect(registry.retainedGltfRecipe(primitive)).toBeUndefined();
    registry.retainRecipe("gltf:geometry:0", 11, cpu);
    expect(registry.retainedGltfRecipe(primitive)).toEqual({ id: 11, recipe: cpu });

    registry.bindPacketPrimitive(11, primitive);
    expect(registry.packetPrimitive(11)).toBe(primitive);
    registry.clearPacketPrimitives();
    expect(registry.packetPrimitive(11)).toBeUndefined();
    expect(registry.retainedGltfRecipe(primitive)?.recipe).toBe(cpu);

    registry.clearRetainedRecipes();
    expect(registry.retainedGltfRecipe(primitive)).toBeUndefined();
  });
});
