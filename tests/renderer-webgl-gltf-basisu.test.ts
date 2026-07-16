import { describe, expect, it } from "vitest";
import {
  decodedGltfBasisuEtc2,
  decodedGltfBasisuRgba,
} from "../packages/renderer-webgl/src/gltf/codecs/basisu";

const level = (width: number, height: number, fill: number) => ({
  compressed: false,
  data: new Uint8Array(width * height * 4).fill(fill),
  height,
  textureFormat: "rgba8unorm",
  width,
});

describe("glTF BasisU RGBA normalization", () => {
  it("owns a complete ETC2 chain with linear and sRGB upload formats", () => {
    const compressedLevel = (width: number, height: number, fill: number) => ({
      compressed: true,
      data: new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16).fill(fill),
      format: 0x9278,
      height,
      textureFormat: "etc2-rgba8unorm",
      width,
    });
    const base = compressedLevel(4, 4, 1);
    const decoded = decodedGltfBasisuEtc2([[
      base,
      compressedLevel(2, 2, 2),
      compressedLevel(1, 1, 3),
    ]], "compressed.ktx2");

    expect(decoded).toMatchObject({
      format: 0x9278,
      height: 4,
      kind: "compressed-texture",
      srgbFormat: 0x9279,
      width: 4,
    });
    expect(decoded.levels.map((entry) => entry.data[0])).toEqual([1, 2, 3]);
    expect(decoded.data).not.toBe(base.data);
  });

  it("owns a valid incomplete ETC2 mip prefix without expanding it to RGBA", () => {
    const compressedLevel = (width: number, height: number, fill: number) => ({
      compressed: true,
      data: new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16).fill(fill),
      format: 0x9278,
      height,
      textureFormat: "etc2-rgba8unorm",
      width,
    });
    const decoded = decodedGltfBasisuEtc2([[
      compressedLevel(8, 8, 1),
      compressedLevel(4, 4, 2),
    ]], "partial.ktx2");

    expect(decoded.kind).toBe("compressed-texture");
    expect(decoded.levels.map(({ height, width }) => ({ height, width }))).toEqual([
      { height: 8, width: 8 },
      { height: 4, width: 4 },
    ]);
  });

  it("copies and preserves a complete authored mip chain", () => {
    const base = level(4, 2, 1);
    const mip1 = level(2, 1, 2);
    const mip2 = level(1, 1, 3);
    const decoded = decodedGltfBasisuRgba([[base, mip1, mip2]], "chain.ktx2");

    expect(decoded).toMatchObject({ height: 2, kind: "rgba-texture", width: 4 });
    expect(decoded.levels?.map(({ data, height, width }) => ({
      first: data[0],
      height,
      width,
    }))).toEqual([
      { first: 1, height: 2, width: 4 },
      { first: 2, height: 1, width: 2 },
      { first: 3, height: 1, width: 1 },
    ]);
    expect(decoded.data).not.toBe(base.data);
  });

  it("rejects malformed mip dimensions and byte payloads", () => {
    expect(() => decodedGltfBasisuRgba([[level(4, 4, 1), level(3, 2, 2)]], "bad-size.ktx2"))
      .toThrow("invalid mip 1 size");
    expect(() => decodedGltfBasisuRgba([[
      { ...level(2, 2, 1), data: new Uint8Array(3) },
    ]], "bad-bytes.ktx2")).toThrow("invalid RGBA8 payload");
  });
});
