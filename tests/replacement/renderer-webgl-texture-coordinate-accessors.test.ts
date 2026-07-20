import { describe, expect, it } from "vitest";
import {
  readTextureCoordinates,
  type AccessorContext,
} from "../../packages/renderer-webgl/src/gltf/accessor-reader";

const source = (
  values: Uint8Array,
  accessor: Record<string, unknown>,
  byteStride?: number,
): AccessorContext => ({
  accessors: [{ bufferView: 0, count: 2, type: "VEC2", ...accessor }],
  binary: values,
  bufferByteLength: values.byteLength,
  bufferViews: [{ buffer: 0, byteLength: values.byteLength, ...(byteStride === undefined ? {} : { byteStride }) }],
  label: "uv.glb",
});

describe("core glTF texture-coordinate accessors", () => {
  it("normalizes unsigned byte and unsigned short UVs", () => {
    expect(readTextureCoordinates(source(
      new Uint8Array([0, 255, 0, 0, 128, 64, 0, 0]),
      { componentType: 5121, normalized: true },
      4,
    ), 0, "TEXCOORD_0")).toEqual(new Float32Array([0, 1, 128 / 255, 64 / 255]));

    const shorts = new Uint16Array([0, 65_535, 32_768, 16_384]);
    expect(readTextureCoordinates(source(
      new Uint8Array(shorts.buffer),
      { componentType: 5123, normalized: true },
    ), 0, "TEXCOORD_1")).toEqual(new Float32Array([
      0, 1, 32_768 / 65_535, 16_384 / 65_535,
    ]));
  });

  it("rejects integer UVs without their required normalized declaration", () => {
    expect(() => readTextureCoordinates(source(
      new Uint8Array(4),
      { componentType: 5121 },
    ), 0, "TEXCOORD_0")).toThrow(
      "TEXCOORD_0 must use FLOAT or normalized UNSIGNED_BYTE/UNSIGNED_SHORT",
    );
  });
});
