import { describe, expect, it } from "vitest";
import { planStaticGltfBufferRequests } from "../../packages/renderer-webgl/src/gltf/static-buffer-demand";

const twoSceneDocument = (): Record<string, unknown> => ({
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
  ],
  asset: { version: "2.0" },
  buffers: [{ byteLength: 1_000, uri: "scene.bin" }],
  bufferViews: [
    { buffer: 0, byteLength: 100, byteOffset: 0 },
    { buffer: 0, byteLength: 50, byteOffset: 100 },
    { buffer: 0, byteLength: 100, byteOffset: 800 },
  ],
  meshes: [
    { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    { primitives: [{ attributes: { POSITION: 2 } }] },
  ],
  nodes: [{ mesh: 0 }, { mesh: 1 }],
  scenes: [{ nodes: [0] }, { nodes: [1] }],
});

describe("static glTF selected-buffer demand", () => {
  it("coalesces only byte ranges reachable from the selected scene", () => {
    const document = twoSceneDocument();
    expect(planStaticGltfBufferRequests(document, "two scenes", 0)).toEqual([{
      byteLength: 1_000,
      ranges: [{ byteLength: 150, byteOffset: 0 }],
    }]);
    expect(planStaticGltfBufferRequests(document, "two scenes", 1)).toEqual([{
      byteLength: 1_000,
      ranges: [{ byteLength: 100, byteOffset: 800 }],
    }]);
  });

  it("includes selected instancing, sparse accessor, Draco, and embedded-image bytes", () => {
    const document = twoSceneDocument() as {
      accessors: Array<Record<string, unknown>>;
      bufferViews: Array<Record<string, unknown>>;
      images?: unknown[];
      meshes: Array<{ primitives: Array<Record<string, unknown>> }>;
      nodes: Array<Record<string, unknown>>;
    };
    document.bufferViews.push(
      { buffer: 0, byteLength: 10, byteOffset: 300 },
      { buffer: 0, byteLength: 10, byteOffset: 310 },
      { buffer: 0, byteLength: 20, byteOffset: 500 },
      { buffer: 0, byteLength: 30, byteOffset: 600 },
    );
    document.accessors.push({
      componentType: 5126,
      count: 3,
      sparse: {
        count: 1,
        indices: { bufferView: 3, componentType: 5121 },
        values: { bufferView: 4 },
      },
      type: "VEC3",
    });
    document.nodes[0]!.extensions = {
      EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 3 } },
    };
    document.meshes[0]!.primitives[0]!.extensions = {
      KHR_draco_mesh_compression: { attributes: { POSITION: 0 }, bufferView: 5 },
    };
    document.images = [{ bufferView: 6, mimeType: "image/png" }];

    expect(planStaticGltfBufferRequests(document, "demanded features", 0)).toEqual([{
      byteLength: 1_000,
      ranges: [
        { byteLength: 150, byteOffset: 0 },
        { byteLength: 20, byteOffset: 300 },
        { byteLength: 20, byteOffset: 500 },
        { byteLength: 30, byteOffset: 600 },
      ],
    }]);
  });

  it("chooses one full read when selected ranges cover most of a buffer", () => {
    const document = twoSceneDocument() as {
      bufferViews: Array<Record<string, unknown>>;
    };
    document.bufferViews[0] = { buffer: 0, byteLength: 850, byteOffset: 0 };
    expect(planStaticGltfBufferRequests(document, "dense scene", 0)).toEqual([undefined]);
  });

  it("rejects a selected range outside its declared source buffer", () => {
    const document = twoSceneDocument() as {
      bufferViews: Array<Record<string, unknown>>;
    };
    document.bufferViews[0] = { buffer: 0, byteLength: 101, byteOffset: 950 };
    expect(() => planStaticGltfBufferRequests(document, "invalid scene", 0))
      .toThrow("invalid scene bufferViews[0]: exceeds its source buffer");
  });
});
