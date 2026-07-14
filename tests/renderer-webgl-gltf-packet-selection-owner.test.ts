import { describe, expect, it } from "vitest";
import { gltfMaterialLodSelectionKey } from "../packages/renderer-webgl/src/gltf/packet-selection-owner";
import type {
  LoadedGltfPrimitive,
  LoadedGltfPrimitiveMaterial,
} from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { PreparedGltfState } from "../packages/renderer-webgl/src/gltf/prepared-runtime";

describe("glTF packet selection owner", () => {
  it("forms material LOD identity from asset, occurrence, primitive, selection, and local instance", () => {
    const state = { key: "asset:helmet" } as PreparedGltfState;
    const primitive = { key: "mesh:2:primitive:1" } as LoadedGltfPrimitive;
    const material = { selectionKey: "variant:3" } as LoadedGltfPrimitiveMaterial;

    expect(gltfMaterialLodSelectionKey(
      state,
      "instance:5:8",
      primitive,
      material,
      13,
    )).toBe(
      "asset:helmet:instance:5:8:material:mesh:2:primitive:1:variant:3:instance:13",
    );
  });
});
