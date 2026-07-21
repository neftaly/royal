import { describe, expect, it } from "vitest";
import { selectedStaticMeshIndices } from "../../packages/renderer-webgl/src/gltf/static-node-selection";

describe("static glTF selected-scene inventory", () => {
  it("includes child and LOD meshes while excluding unselected scenes", () => {
    const document = {
      meshes: [{}, {}, {}, {}],
      nodes: [
        { children: [1], mesh: 0 },
        { extensions: { MSFT_lod: { ids: [2] } }, mesh: 1 },
        { mesh: 2 },
        { mesh: 3 },
      ],
      scene: 0,
      scenes: [{ nodes: [0] }, { nodes: [3] }],
    };
    expect(selectedStaticMeshIndices(document, "selected.gltf")).toEqual([0, 1, 2]);
    expect(selectedStaticMeshIndices(document, "selected.gltf", 1)).toEqual([3]);
    expect(() => selectedStaticMeshIndices(document, "selected.gltf", 2))
      .toThrow("sceneIndex: index 2 is out of range");
  });

  it("fails a selected child/LOD cycle instead of recursing indefinitely", () => {
    expect(() => selectedStaticMeshIndices({
      meshes: [{}],
      nodes: [{ children: [1] }, { extensions: { MSFT_lod: { ids: [0] } }, mesh: 0 }],
      scenes: [{ nodes: [0] }],
    }, "cycle.gltf")).toThrow("child/MSFT_lod cycle");
  });
});
