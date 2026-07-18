import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";

const staticTriangleDocument = (): Record<string, unknown> => ({
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
  ],
  asset: { version: "2.0" },
  bufferViews: [
    { buffer: 0, byteLength: 36, byteOffset: 0 },
    { buffer: 0, byteLength: 6, byteOffset: 36 },
  ],
  buffers: [{ byteLength: 42 }],
  extensionsRequired: ["KHR_materials_unlit"],
  extensionsUsed: ["KHR_materials_unlit"],
  materials: [{
    extensions: { KHR_materials_unlit: {} },
    pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] },
  }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  nodes: [
    { children: [1], translation: [1, 0, 0] },
    { mesh: 0, translation: [0, 2, 0] },
  ],
  scene: 0,
  scenes: [{ nodes: [0] }],
});

const glb = (document: Record<string, unknown>, lastIndex = 2): Uint8Array => {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, lastIndex]);
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binary.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.length, true);
  view.setUint32(binaryHeader + 4, 0x00_4e_49_42, true);
  bytes.set(binary, binaryHeader + 8);
  return bytes;
};

describe("static glTF preparation core", () => {
  it("lowers one unlit GLB triangle into the canonical surface ABI", () => {
    const bytes = glb(staticTriangleDocument());
    const prepared = prepareStaticGlb(bytes, "asset:v1", "triangle.glb");
    expect(prepared.primitives).toHaveLength(1);
    const primitive = prepared.primitives[0]!;
    expect(primitive.color).toEqual([0.2, 0.4, 0.8, 1]);
    expect(primitive.geometry.key).toBe("asset:v1:mesh:0:primitive:0");
    expect(primitive.geometry.positions).toEqual(new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]));
    expect(primitive.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
    expect(primitive.geometry.positions.buffer).toBe(bytes.buffer);
    expect(primitive.geometry.bounds).toEqual({ max: [1, 1, 0], min: [-1, -1, 0] });
    expect(primitive.localModel.slice(12, 15)).toEqual([1, 2, 0]);
  });

  it("rejects unknown required extensions and out-of-range triangle indices", () => {
    const extensionDocument = staticTriangleDocument();
    extensionDocument.extensionsRequired = ["KHR_future_geometry"];
    expect(() => prepareStaticGlb(glb(extensionDocument), "future", "future.glb"))
      .toThrow("extensionsRequired[0]: is unsupported");
    expect(() => prepareStaticGlb(glb(staticTriangleDocument(), 3), "bad-index", "bad.glb"))
      .toThrow("vertex index is out of range");
  });

  it("rejects texture, transparency, deformation, and hierarchy ambiguity explicitly", () => {
    const textured = staticTriangleDocument();
    const materials = textured.materials as Array<Record<string, unknown>>;
    materials[0]!.pbrMetallicRoughness = { baseColorTexture: { index: 0 } };
    expect(() => prepareStaticGlb(glb(textured), "textured", "textured.glb"))
      .toThrow("baseColorTexture: is not in the static profile yet");

    const animated = staticTriangleDocument();
    animated.animations = [{}];
    expect(() => prepareStaticGlb(glb(animated), "animated", "animated.glb"))
      .toThrow("animations: are not supported yet");

    const shared = staticTriangleDocument();
    shared.scenes = [{ nodes: [0, 1] }];
    expect(() => prepareStaticGlb(glb(shared), "shared", "shared.glb"))
      .toThrow("is cyclic or has multiple parents");
  });
});
