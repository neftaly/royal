import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  glbFromDocument,
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";

describe("static glTF preparation core", () => {
  it("lowers one unlit GLB triangle into the canonical surface ABI", () => {
    const bytes = staticTriangleGlb();
    const prepared = prepareStaticGlb(bytes, "asset:v1", "triangle.glb");
    expect(prepared.primitives).toHaveLength(1);
    const primitive = prepared.primitives[0]!;
    expect(primitive.material).toEqual({
      baseColor: [0.2, 0.4, 0.8, 1],
      kind: "unlit",
      requiresTextureCoordinates: false,
    });
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

  it("normalizes core opaque metallic-roughness and the implicit glTF material", () => {
    const standard = staticTriangleDocument();
    delete standard.extensionsRequired;
    delete standard.extensionsUsed;
    standard.materials = [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.1, 0.2, 0.3, 0.4],
        metallicFactor: 0.25,
        roughnessFactor: 0.75,
      },
    }];
    expect(prepareStaticGlb(staticTriangleGlb(standard), "standard").primitives[0]!.material)
      .toEqual({
        baseColor: [0.1, 0.2, 0.3, 1],
        kind: "standard",
        metallicFactor: 0.25,
        requiresTextureCoordinates: false,
        roughnessFactor: 0.75,
      });

    delete standard.materials;
    const meshes = standard.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    delete meshes[0]!.primitives[0]!.material;
    expect(prepareStaticGlb(staticTriangleGlb(standard), "implicit").primitives[0]!.material)
      .toEqual({
        baseColor: [1, 1, 1, 1],
        kind: "standard",
        metallicFactor: 1,
        requiresTextureCoordinates: false,
        roughnessFactor: 1,
      });
  });

  it("borrows validated normal and primary-UV streams into the canonical ABI", () => {
    const document = staticTriangleDocument();
    document.accessors = [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC2" },
    ];
    document.bufferViews = [
      { buffer: 0, byteLength: 36, byteOffset: 0 },
      { buffer: 0, byteLength: 6, byteOffset: 36 },
      { buffer: 0, byteLength: 36, byteOffset: 44 },
      { buffer: 0, byteLength: 24, byteOffset: 80 },
    ];
    document.buffers = [{ byteLength: 104 }];
    document.meshes = [{ primitives: [{
      attributes: { NORMAL: 2, POSITION: 0, TEXCOORD_0: 3 },
      indices: 1,
      material: 0,
    }] }];
    const binary = new Uint8Array(104);
    new Float32Array(binary.buffer, 0, 9).set([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]);
    new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
    new Float32Array(binary.buffer, 44, 9).set([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    new Float32Array(binary.buffer, 80, 6).set([0, 0, 1, 0, 0.5, 1]);
    const bytes = glbFromDocument(document, binary);

    const geometry = prepareStaticGlb(bytes, "attributes:v1").primitives[0]!.geometry;
    expect(geometry.normals).toEqual(new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]));
    expect(geometry.textureCoordinates0).toEqual(new Float32Array([0, 0, 1, 0, 0.5, 1]));
    expect(geometry.normals?.buffer).toBe(bytes.buffer);
    expect(geometry.textureCoordinates0?.buffer).toBe(bytes.buffer);
  });

  it("rejects unsupported vertex semantics and mismatched stream counts", () => {
    const unsupported = staticTriangleDocument();
    const meshes = unsupported.meshes as Array<{ primitives: Array<{ attributes: object }> }>;
    meshes[0]!.primitives[0]!.attributes = { COLOR_0: 0, POSITION: 0 };
    expect(() => prepareStaticGlb(staticTriangleGlb(unsupported), "colored"))
      .toThrow("attributes.COLOR_0: is not in the static profile yet");

    const mismatched = staticTriangleDocument();
    mismatched.accessors = [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 0, componentType: 5126, count: 2, type: "VEC3" },
    ];
    const mismatchedMeshes = mismatched.meshes as Array<{
      primitives: Array<{ attributes: object }>;
    }>;
    mismatchedMeshes[0]!.primitives[0]!.attributes = { NORMAL: 2, POSITION: 0 };
    expect(() => prepareStaticGlb(staticTriangleGlb(mismatched), "mismatched"))
      .toThrow("attributes.NORMAL: count must match POSITION");
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
