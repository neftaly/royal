import { describe, expect, it } from "vitest";
import {
  decodeKtx2Etc2Alpha,
  parseKtx2Etc2,
} from "../../packages/renderer-webgl/src/texture/ktx2-etc2";
import { parseKtx2Etc2Page } from "../../packages/renderer-webgl/src/virtual-texture/ktx2-etc2";
import { createKtx2Etc2Fixture as ktx2 } from "./support/ktx2-etc2-fixture";

describe("shared offline KTX2/ETC2 storage", () => {
  it("retains direct sRGB ETC2 mip views without copying or transcoding", () => {
    const bytes = ktx2(152, 8, 4, 4);
    const parsed = parseKtx2Etc2(bytes);
    expect(parsed).toMatchObject({ colorSpace: "srgb", height: 4, width: 8 });
    expect(parsed.levels.map(({ height, width }) => ({ height, width }))).toEqual([
      { height: 4, width: 8 },
      { height: 2, width: 4 },
      { height: 1, width: 2 },
      { height: 1, width: 1 },
    ]);
    for (const level of parsed.levels) expect(level.blocks.buffer).toBe(bytes.buffer);
  });

  it("extracts EAC alpha in image row order while leaving RGB compressed", () => {
    const bytes = ktx2(151);
    const blockOffset = Number(new DataView(bytes.buffer).getBigUint64(80, true));
    bytes[blockOffset] = 100;
    bytes[blockOffset + 1] = (2 << 4) | 13;
    let selectors = 0n;
    for (let pixel = 0; pixel < 16; pixel += 1) {
      selectors = (selectors << 3n) | BigInt(pixel & 7);
    }
    for (let byte = 0; byte < 6; byte += 1) {
      bytes[blockOffset + 2 + byte] = Number((selectors >> BigInt((5 - byte) * 8)) & 255n);
    }
    expect(decodeKtx2Etc2Alpha(parseKtx2Etc2(bytes))).toEqual(new Uint8Array([
      98, 100, 98, 100,
      96, 102, 96, 102,
      94, 104, 94, 104,
      80, 118, 80, 118,
    ]));
    expect(() => decodeKtx2Etc2Alpha(parseKtx2Etc2(bytes), 1)).toThrow("out of range");
  });

  it("extracts the exact authored alpha dimensions at every KTX2 mip", () => {
    const texture = parseKtx2Etc2(ktx2(152, 8, 4, 4));
    expect(texture.levels.map((_level, index) =>
      decodeKtx2Etc2Alpha(texture, index).length)).toEqual([32, 8, 2, 1]);
  });

  it("keeps the VT page contract single-level", () => {
    const bytes = ktx2(152);
    const parsed = parseKtx2Etc2Page(bytes);
    expect(parsed).toMatchObject({ colorSpace: "srgb", height: 4, width: 4 });
    expect(parsed.blocks.buffer).toBe(bytes.buffer);
    expect(() => parseKtx2Etc2Page(ktx2(152, 8, 4, 4))).toThrow("exactly one level");
  });

  it("rejects Basis supercompression instead of silently adding a WASM path", () => {
    expect(() => parseKtx2Etc2(ktx2(0))).toThrow("runtime transcoder");
  });

  it("rejects overlapping or wrongly sized mip storage", () => {
    const bytes = ktx2(151, 8, 8, 2);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(104, view.getBigUint64(80, true), true);
    expect(() => parseKtx2Etc2(bytes)).toThrow("overlap");
  });

  it("accepts only Royal's upper-left, identity-swizzle, straight-alpha semantics", () => {
    expect(() => parseKtx2Etc2(ktx2(152, 4, 4, 1, [
      ["KTXorientation", "rd"],
      ["KTXswizzle", "rgba"],
    ]))).not.toThrow();
    expect(() => parseKtx2Etc2(ktx2(152, 4, 4, 1, [
      ["KTXorientation", "ru"],
    ]))).toThrow("orientation must be rd");
    expect(() => parseKtx2Etc2(ktx2(152, 4, 4, 1, [
      ["KTXswizzle", "bgra"],
    ]))).toThrow("swizzle must be rgba");

    const premultiplied = ktx2(152);
    const dfdOffset = new DataView(premultiplied.buffer).getUint32(48, true);
    premultiplied[dfdOffset + 15] = 1;
    expect(() => parseKtx2Etc2(premultiplied)).toThrow("straight-alpha");
  });
});
