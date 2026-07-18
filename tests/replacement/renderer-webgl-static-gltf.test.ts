import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";

describe("static glTF preparation core", () => {
  it("lowers one unlit GLB triangle into the canonical surface ABI", () => {
    const bytes = staticTriangleGlb();
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
    expect(() => prepareStaticGlb(staticTriangleGlb(extensionDocument), "future", "future.glb"))
      .toThrow("extensionsRequired[0]: is unsupported");
    expect(() => prepareStaticGlb(staticTriangleGlb(undefined, 3), "bad-index", "bad.glb"))
      .toThrow("vertex index is out of range");
  });

  it("rejects texture, transparency, deformation, and hierarchy ambiguity explicitly", () => {
    const textured = staticTriangleDocument();
    const materials = textured.materials as Array<Record<string, unknown>>;
    materials[0]!.pbrMetallicRoughness = { baseColorTexture: { index: 0 } };
    expect(() => prepareStaticGlb(staticTriangleGlb(textured), "textured", "textured.glb"))
      .toThrow("baseColorTexture: is not in the static profile yet");

    const animated = staticTriangleDocument();
    animated.animations = [{}];
    expect(() => prepareStaticGlb(staticTriangleGlb(animated), "animated", "animated.glb"))
      .toThrow("animations: are not supported yet");

    const shared = staticTriangleDocument();
    shared.scenes = [{ nodes: [0, 1] }];
    expect(() => prepareStaticGlb(staticTriangleGlb(shared), "shared", "shared.glb"))
      .toThrow("is cyclic or has multiple parents");
  });
});
