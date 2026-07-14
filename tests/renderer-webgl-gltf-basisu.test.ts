import { describe, expect, it } from "vitest";
import { decodedGltfBasisuRgba } from "../packages/renderer-webgl/src/gltf/codecs/basisu";

const level = (width: number, height: number, fill: number) => ({
  compressed: false,
  data: new Uint8Array(width * height * 4).fill(fill),
  height,
  textureFormat: "rgba8unorm",
  width,
});

describe("glTF BasisU RGBA normalization", () => {
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
