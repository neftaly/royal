import { describe, expect, it } from "vitest";
import {
  readFloatVectors,
  readPositions,
  readTextureCoordinates,
  type AccessorContext,
} from "../../packages/renderer-webgl/src/gltf/accessor-reader";

const context = (
  binary: Uint8Array,
  accessors: unknown[],
  bufferViews: unknown[],
  meshQuantization = true,
): AccessorContext => ({
  accessors,
  binary,
  bufferByteLength: binary.byteLength,
  bufferViews,
  label: "quantized fixture",
  meshQuantization,
});

describe("KHR_mesh_quantization accessor lowering", () => {
  it("normalizes signed position, normal, tangent, and UV representations once", () => {
    const binary = new Uint8Array(32);
    new Int8Array(binary.buffer, 0, 8).set([-127, 0, 127, 0, 127, -127, 0, 0]);
    new Int8Array(binary.buffer, 8, 8).set([0, 0, 127, 0, 0, 127, 0, 0]);
    new Int16Array(binary.buffer, 16, 4).set([0, 0, 0, 32_767]);
    new Int16Array(binary.buffer, 24, 4).set([-2, 3, 4, -5]);
    const accessors = [
      { bufferView: 0, componentType: 5120, count: 2, normalized: true, type: "VEC3" },
      { bufferView: 1, componentType: 5120, count: 2, normalized: true, type: "VEC3" },
      { bufferView: 2, componentType: 5122, count: 1, normalized: true, type: "VEC4" },
      { bufferView: 3, componentType: 5122, count: 2, type: "VEC2" },
    ];
    const bufferViews = [
      { buffer: 0, byteLength: 8, byteStride: 4 },
      { buffer: 0, byteLength: 8, byteOffset: 8, byteStride: 4 },
      { buffer: 0, byteLength: 8, byteOffset: 16, byteStride: 8 },
      { buffer: 0, byteLength: 8, byteOffset: 24, byteStride: 4 },
    ];
    const source = context(binary, accessors, bufferViews);

    expect(readPositions(source, 0).positions).toEqual(new Float32Array([
      -1, 0, 1,
      1, -1, 0,
    ]));
    expect(readFloatVectors(source, 1, "VEC3", 3, "NORMAL"))
      .toEqual(new Float32Array([0, 0, 1, 0, 1, 0]));
    expect(readFloatVectors(source, 2, "VEC4", 4, "TANGENT"))
      .toEqual(new Float32Array([0, 0, 0, 1]));
    expect(readTextureCoordinates(source, 3, "TEXCOORD_0"))
      .toEqual(new Float32Array([-2, 3, 4, -5]));
  });

  it("does not silently accept expanded component types without the required declaration", () => {
    const binary = new Uint8Array(4);
    const source = context(
      binary,
      [{ bufferView: 0, componentType: 5120, count: 1, normalized: true, type: "VEC3" }],
      [{ buffer: 0, byteLength: 4, byteStride: 4 }],
      false,
    );
    expect(() => readPositions(source, 0))
      .toThrow("accessors[0].componentType: must be FLOAT");
  });
});
