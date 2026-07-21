import { describe, expect, it } from "vitest";
import { parseVirtualTextureManifest, virtualTexturePageKey } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import {
  selectVirtualTexturePoolSlot,
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
  it("resolves one retained lookup per logical page", () => {
    class CountedResidents extends Map<number | string, number> {
      gets = 0;

      override get(key: number | string): number | undefined {
        this.gets += 1;
        return super.get(key);
      }
    }
    const residents = new CountedResidents([
      [virtualTexturePageKey({ mip: 2, x: 0, y: 0 }), 0],
    ]);
    writeVirtualTexturePageTable(
      manifest,
      residents,
      2,
      new Uint8Array(virtualTexturePageTableByteLength(manifest)),
    );
    expect(residents.gets).toBe(
      manifest.mipLayouts.reduce((pages, layout) => pages + layout.width * layout.height, 0),
    );
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

  it("keeps equal local page ids distinct across shared-atlas resources", () => {
    const page = { mip: 2, x: 0, y: 0 };
    const pageKey = virtualTexturePageKey(page);
    const slots = [
      { pageKey, resourceKey: "first" },
      { pageKey: virtualTexturePageKey({ mip: 1, x: 0, y: 0 }), resourceKey: "second" },
    ];
    const protectedPages = {
      has: (resourceKey: string): boolean => resourceKey === "first",
    };

    expect(selectVirtualTexturePoolSlot(
      "second",
      pageKey,
      slots,
      new Uint32Array([1, 2]),
      protectedPages,
    )).toBe(1);
    expect(slots[1]).toEqual({
      pageKey: virtualTexturePageKey({ mip: 1, x: 0, y: 0 }),
      resourceKey: "second",
    });
    expect(selectVirtualTexturePoolSlot(
      "third",
      pageKey,
      slots,
      new Uint32Array([1, 2]),
      { has: () => true },
    )).toBe(-1);
    expect(selectVirtualTexturePoolSlot(
      "third",
      pageKey,
      [...slots, undefined],
      new Uint32Array([1, 2, 0]),
      { has: () => true },
    )).toBe(2);
  });
});
