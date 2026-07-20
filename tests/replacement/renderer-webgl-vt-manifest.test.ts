import { describe, expect, it } from "vitest";
import {
  derivedVirtualTextureMipCount,
  parseVirtualTextureManifest,
  virtualTexturePageUri,
} from "../../packages/renderer-webgl/src/virtual-texture/manifest";

const fixture = () => ({
  borderTexels: 1,
  colorSpace: "srgb",
  contractVersion: 2,
  mipCount: 4,
  pageSize: 512,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.svg" },
  physicalByteBudget: 26_419_856,
  physicalSlots: 24,
  virtualSize: [4096, 4096],
});

describe("VT2 manifest contract", () => {
  it("lowers an authored manifest to compact mip-table layout", () => {
    const manifest = parseVirtualTextureManifest(fixture());
    expect(derivedVirtualTextureMipCount(4096, 4096, 512)).toBe(4);
    expect(manifest.mipLayouts).toEqual([
      { byteOffset: 0, height: 8, width: 8 },
      { byteOffset: 256, height: 4, width: 4 },
      { byteOffset: 320, height: 2, width: 2 },
      { byteOffset: 336, height: 1, width: 1 },
    ]);
    expect(manifest).toMatchObject({
      tableByteLength: 340,
      tableHeight: 8,
      tableWidth: 8,
    });
    expect(virtualTexturePageUri(manifest, { mip: 2, x: 1, y: 0 }))
      .toBe("pages/m2-1-0.svg");
  });

  it("pads odd page grids so every logical mip fits WebGL mip storage", () => {
    const manifest = parseVirtualTextureManifest({
      ...fixture(),
      mipCount: 3,
      virtualSize: [2561, 1537],
    });
    expect(manifest).toMatchObject({ tableHeight: 4, tableWidth: 8 });
    expect(manifest.mipLayouts).toEqual([
      { byteOffset: 0, height: 4, width: 6 },
      { byteOffset: 128, height: 2, width: 3 },
      { byteOffset: 160, height: 1, width: 2 },
    ]);
    expect(manifest.tableByteLength).toBe(168);
  });

  it("lets an exact sparse entry override complete template addressing", () => {
    const manifest = parseVirtualTextureManifest({
      ...fixture(),
      pages: {
        entries: [{ mip: 0, uri: "special.png", x: 1, y: 2 }],
        uriTemplate: "{mip}/{x}/{y}.png",
      },
    });
    expect(virtualTexturePageUri(manifest, { mip: 0, x: 1, y: 2 })).toBe("special.png");
    expect(virtualTexturePageUri(manifest, { mip: 1, x: 0, y: 0 })).toBe("1/0/0.png");
  });

  it("rejects ambiguous, duplicated, out-of-grid, and incompatible author data", () => {
    expect(() => parseVirtualTextureManifest({ ...fixture(), contractVersion: 1 }))
      .toThrow("contractVersion must be 2");
    expect(() => parseVirtualTextureManifest({
      ...fixture(),
      pages: { uriTemplate: "pages/{wat}.png" },
    })).toThrow("unsupported token");
    expect(() => parseVirtualTextureManifest({
      ...fixture(),
      pages: { entries: [
        { mip: 0, uri: "a.png", x: 0, y: 0 },
        { mip: 0, uri: "b.png", x: 0, y: 0 },
      ] },
    })).toThrow("duplicated");
    expect(() => parseVirtualTextureManifest({
      ...fixture(),
      pages: { entries: [{ mip: 3, uri: "bad.png", x: 1, y: 0 }] },
    })).toThrow("outside its mip grid");
    expect(() => parseVirtualTextureManifest({
      ...fixture(),
      borderTexels: 1,
      pageEncoding: "ktx2-etc2",
      pageSize: 511,
    })).toThrow("block-compatible");
    expect(() => parseVirtualTextureManifest({
      ...fixture(),
      pageEncoding: "ktx2-basis",
    })).toThrow("image or ktx2-etc2");
  });
});
