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
      { height: 8, tableY: 0, width: 8 },
      { height: 4, tableY: 8, width: 4 },
      { height: 2, tableY: 12, width: 2 },
      { height: 1, tableY: 14, width: 1 },
    ]);
    expect(manifest).toMatchObject({ tableHeight: 15, tableWidth: 8 });
    expect(virtualTexturePageUri(manifest, { mip: 2, x: 1, y: 0 }))
      .toBe("pages/m2-1-0.svg");
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
