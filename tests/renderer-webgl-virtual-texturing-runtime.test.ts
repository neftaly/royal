import { describe, expect, it } from "vitest";
import {
  firstVirtualTexturePageUri,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  virtualTexturePageUri,
} from "../packages/renderer-webgl/src/virtual-texturing";

describe("WebGL virtual texturing runtime model", () => {
  it("parses explicit page-entry manifests into a normalized resource model", () => {
    const result = parseVirtualTextureManifest({
      colorSpace: "srgb",
      fallbackColor: [0.08, 0.1, 0.12, 1],
      id: "terrain",
      mipCount: 2,
      pageSize: 128,
      pages: {
        entries: {
          "m0/0/0": "pages/mip-0/x0-y0.png",
          "m1/0/0": { height: 64, uri: "pages/mip-1/x0-y0.png", width: 64 },
        },
      },
      physicalSlots: 4,
      virtualSize: [512, 256],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      colorSpace: "srgb",
      fallbackColor: [0.08, 0.1, 0.12, 1],
      height: 256,
      id: "terrain",
      mipCount: 2,
      pageSize: 128,
      physicalSlots: 4,
      width: 512,
    }));
    expect(result.manifest?.pages).toEqual([
      { id: "m0/0/0", mip: 0, uri: "pages/mip-0/x0-y0.png", x: 0, y: 0 },
      { height: 64, id: "m1/0/0", mip: 1, uri: "pages/mip-1/x0-y0.png", width: 64, x: 0, y: 0 },
    ]);
    expect(result.manifest === undefined ? undefined : firstVirtualTexturePageUri(result.manifest))
      .toBe("pages/mip-0/x0-y0.png");
  });

  it("parses nested research manifests and resolves URI templates", () => {
    const result = parseVirtualTextureManifest({
      assetId: "royal.generated-terrain-material.vt-demo",
      demoBudget: { cacheSlots: 12 },
      variants: [{ format: "png-rgba8", uriTemplate: "pages/mip-{mip}/x{x}-y{y}.png" }],
      virtualTexture: {
        colorSpace: "srgb",
        dimensions: [128, 128],
        mipCount: 3,
        usableTileSize: 32,
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      height: 128,
      id: "royal.generated-terrain-material.vt-demo",
      pageSize: 32,
      physicalSlots: 12,
      uriTemplate: "pages/mip-{mip}/x{x}-y{y}.png",
      width: 128,
    }));
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 2, x: 3, y: 1 }))
      .toBe("pages/mip-2/x3-y1.png");
  });

  it("accepts explicit texture width and height fields", () => {
    const result = parseVirtualTextureManifest({
      height: 128,
      pageSize: 64,
      pages: { uriTemplate: "pages/{page}.png" },
      width: 256,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      height: 128,
      pageSize: 64,
      width: 256,
    }));
    expect(result.manifest === undefined ? undefined : firstVirtualTexturePageUri(result.manifest))
      .toBe("pages/m0/0/0.png");
  });

  it("parses generated/debug manifests as unsupported metadata instead of uploadable pages", () => {
    const result = parseVirtualTextureManifest({
      format: "rgba8",
      id: "generated-virtual-texture-surface",
      mipCount: 3,
      pageSize: 128,
      pages: {
        generator: "debug-rgba",
        kind: "generated",
      },
      physicalSlots: 9,
      virtualSize: [512, 512],
    });

    expect(result.manifest).toEqual(expect.objectContaining({
      height: 512,
      id: "generated-virtual-texture-surface",
      pageSize: 128,
      width: 512,
    }));
    expect(result.manifest?.pages).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "vt.pages.generated", severity: "unsupported" }),
      expect.objectContaining({ code: "vt.pages.empty", severity: "unsupported" }),
    ]);
    expect(result.manifest === undefined ? undefined : firstVirtualTexturePageUri(result.manifest)).toBeUndefined();
  });

  it("tracks page to atlas slot mappings and dirty page-table updates incrementally", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };

    expect(table.ensureResident(first)).toEqual(expect.objectContaining({ pageKey: "0/0/0", slot: 0 }));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: "0/0/0", slot: 0 },
    ]);

    table.ensureResident(first);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);

    expect(table.ensureResident(second)).toEqual(expect.objectContaining({ pageKey: "0/1/0", slot: 1 }));
    expect(table.residentSlot(first)).toBe(0);
    expect(table.residentSlot(second)).toBe(1);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: second, pageKey: "0/1/0", slot: 1 },
    ]);
  });

  it("selects the nearest resident parent fallback for missing pages", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 4 });
    const parent = { mip: 1, x: 1, y: 1 };
    table.ensureResident(parent);
    table.takeDirtyPageTableUpdates();

    expect(table.resolveResidentFallback({ mip: 0, x: 3, y: 2 }, { maxMip: 3 })).toEqual(
      expect.objectContaining({ page: parent, pageKey: "1/1/1", slot: 0 }),
    );
    expect(table.resolveResidentFallback({ mip: 0, x: 0, y: 0 }, { maxMip: 1 })).toBeUndefined();
  });

  it("evicts with a bounded clock policy and records invalidated page-table entries", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const third = { mip: 0, x: 2, y: 0 };
    const fourth = { mip: 0, x: 3, y: 0 };

    table.ensureResident(first);
    table.ensureResident(second);
    table.takeDirtyPageTableUpdates();

    expect(table.ensureResident(third)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: first, slot: 0 }),
      page: third,
      slot: 0,
    }));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: "0/0/0" },
      { page: third, pageKey: "0/2/0", slot: 0 },
    ]);

    expect(table.ensureResident(fourth)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: second, slot: 1 }),
      page: fourth,
      slot: 1,
    }));
    expect(table.residentSlot(first)).toBeUndefined();
    expect(table.residentSlot(second)).toBeUndefined();
    expect(table.residentSlot(third)).toBe(0);
    expect(table.residentSlot(fourth)).toBe(1);
  });
});
