import { describe, expect, it } from "vitest";
import { parseVirtualTextureManifest, virtualTexturePageKey } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import {
  planVirtualTextureAdmission,
  virtualTexturePageTableByteLength,
  writeVirtualTexturePageTable,
} from "../../packages/renderer-webgl/src/virtual-texture/residency";

const manifest = parseVirtualTextureManifest({
  borderTexels: 1,
  contractVersion: 2,
  mipCount: 3,
  pageSize: 256,
  pages: { uriTemplate: "{mip}/{x}/{y}.png" },
  virtualSize: [1024, 1024],
});

describe("VT2 residency core", () => {
  it("chooses free then oldest unprotected slots without changing live mappings", () => {
    const keys = [virtualTexturePageKey({ mip: 2, x: 0, y: 0 }), undefined];
    expect(planVirtualTextureAdmission(
      { mip: 1, x: 0, y: 0 },
      keys,
      new Uint32Array([4, 0]),
      new Set(),
    )).toMatchObject({ slot: 1 });
    expect(keys[1]).toBeUndefined();

    const full = ["protected", "old", "new"];
    expect(planVirtualTextureAdmission(
      { mip: 0, x: 0, y: 0 },
      full,
      new Uint32Array([1, 2, 20]),
      new Set(["protected"]),
    )).toMatchObject({ evictedKey: "old", slot: 1 });
    expect(planVirtualTextureAdmission(
      { mip: 0, x: 0, y: 0 },
      full,
      new Uint32Array([1, 2, 20]),
      new Set(full),
    )).toBeUndefined();
  });

  it("maps missing fine pages to the closest committed ancestor", () => {
    const root = { mip: 2, x: 0, y: 0 };
    const fine = { mip: 0, x: 1, y: 1 };
    const residents = new Map([
      [virtualTexturePageKey(root), 0],
      [virtualTexturePageKey(fine), 3],
    ]);
    const bytes = new Uint8Array(virtualTexturePageTableByteLength(manifest));
    writeVirtualTexturePageTable(manifest, residents, 2, bytes);
    const mip0 = manifest.mipLayouts[0]!;
    const exactOffset = mip0.byteOffset + (manifest.tableWidth + 1) * 4;
    const fallbackOffset = mip0.byteOffset + (manifest.tableWidth * 3 + 3) * 4;
    expect(Array.from(bytes.slice(exactOffset, exactOffset + 4))).toEqual([1, 1, 0, 255]);
    expect(Array.from(bytes.slice(fallbackOffset, fallbackOffset + 4))).toEqual([0, 0, 2, 255]);
  });
});
