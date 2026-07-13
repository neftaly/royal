import { describe, expect, it } from "vitest";
import {
  generatedRasterVirtualTextureManifest,
  orientVirtualTextureDemandVRange,
} from "../packages/renderer-webgl/src/virtual-texture-runtime";
import { generatedSvgVirtualTextureManifest } from "../packages/renderer-webgl/src/svg-texture";
import {
  derivedVirtualTextureMipCount,
  encodeVirtualTexturePageTableRgba8,
  generatedVirtualTexturePageCount,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  virtualTexturePageKey,
  virtualTexturePageUri,
} from "../packages/renderer-webgl/src/virtual-texturing";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

type FuzzPage = {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
};

const fuzzPage = (random: SeededRandom): FuzzPage => ({
  mip: random.int(0, 4),
  x: random.int(0, 8),
  y: random.int(0, 8),
});

type ResidentAssignment = ReturnType<VirtualTextureAtlasPageTable["ensureResident"]>;
type PageTableUpdate = ReturnType<VirtualTextureAtlasPageTable["takeDirtyPageTableUpdates"]>[number];

const applyPageTableUpdates = (
  target: Array<number | undefined>,
  width: number,
  updates: readonly PageTableUpdate[],
): void => {
  for (const update of updates) {
    const coverage = 2 ** update.page.mip;
    for (let y = update.page.y * coverage; y < (update.page.y + 1) * coverage; y += 1) {
      for (let x = update.page.x * coverage; x < (update.page.x + 1) * coverage; x += 1) {
        target[y * width + x] = update.slot;
      }
    }
  }
};

const referencePageTableSlots = (
  width: number,
  assignments: readonly ResidentAssignment[],
  activePageKeys: ReadonlySet<string>,
): Array<number | undefined> => Array.from({ length: width * width }, (_unused, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  let selected: ResidentAssignment | undefined;
  for (const assignment of assignments) {
    if (!activePageKeys.has(assignment.pageKey)) continue;
    const coverage = 2 ** assignment.page.mip;
    if (
      x < assignment.page.x * coverage
      || x >= (assignment.page.x + 1) * coverage
      || y < assignment.page.y * coverage
      || y >= (assignment.page.y + 1) * coverage
    ) continue;
    if (selected === undefined || assignment.page.mip < selected.page.mip) selected = assignment;
  }
  return selected?.slot;
});

describe("WebGL virtual texturing runtime model", () => {
  it("keeps generated raster and SVG manifest policy identical", () => {
    const dimensions = { height: 777.2, width: 1_023.1 };
    const raster = generatedRasterVirtualTextureManifest({
      ...dimensions,
      colorSpace: "srgb",
      label: "raster",
      source: { data: new Uint8Array(), height: 1, kind: "rgba-texture", width: 1 },
    });
    const svg = generatedSvgVirtualTextureManifest({
      ...dimensions,
      label: "vector",
      text: "<svg/>",
    });

    expect(svg).toEqual(raster);
  });

  it("rejects invalid generated raster and SVG manifest dimensions without looping", () => {
    expect(() => generatedRasterVirtualTextureManifest({
      height: 512,
      label: "invalid raster",
      source: { data: new Uint8Array(), height: 1, kind: "rgba-texture", width: 1 },
      width: Number.POSITIVE_INFINITY,
    })).toThrow(RangeError);
    expect(() => generatedSvgVirtualTextureManifest({
      height: Number.NaN,
      label: "invalid vector",
      text: "<svg/>",
      width: 512,
    })).toThrow(RangeError);
    expect(() => generatedVirtualTexturePageCount(Number.MAX_SAFE_INTEGER, 2, 1))
      .toThrow("page count exceeds safe integer capacity");
  });

  it("derives complete ceil-halved mip chains for NPOT page grids", () => {
    for (const [pagesWide, pagesHigh, mipCount] of [
      [3, 1, 3],
      [5, 1, 4],
      [6, 1, 4],
      [3, 5, 4],
      [6, 3, 4],
    ] as const) {
      expect(derivedVirtualTextureMipCount(pagesWide * 64, pagesHigh * 64, 64)).toBe(mipCount);
    }
  });

  it("orients partial V demand ranges before page selection", () => {
    const oriented = orientVirtualTextureDemandVRange(0.7, 0.9, true);
    expect(oriented[0]).toBeCloseTo(0.1);
    expect(oriented[1]).toBeCloseTo(0.3);
    expect(orientVirtualTextureDemandVRange(0.7, 0.9, false)).toEqual([0.7, 0.9]);
  });

  it("parses explicit page-entry manifests into a normalized resource model", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 1,
      colorSpace: "srgb",
      id: "terrain",
      mipCount: 2,
      pageSize: 128,
      pages: {
        entries: [
          { mip: 0, uri: "pages/mip-0/x0-y0.png", x: 0, y: 0 },
          { mip: 1, uri: "pages/mip-1/x0-y0.png", x: 0, y: 0 },
        ],
      },
      physicalSlots: 4,
      virtualSize: [512, 256],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      colorSpace: "srgb",
      height: 256,
      mipCount: 2,
      pageSize: 128,
      physicalSlots: 4,
      width: 512,
    }));
    expect(result.manifest?.pages).toEqual([
      { mip: 0, uri: "pages/mip-0/x0-y0.png", x: 0, y: 0 },
      { mip: 1, uri: "pages/mip-1/x0-y0.png", x: 0, y: 0 },
    ]);
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 0, x: 0, y: 0 }))
      .toBe("pages/mip-0/x0-y0.png");
  });

  it("rejects explicit mip counts outside the dimension-derived chain", () => {
    for (const mipCount of [0, 4, 1.5]) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        mipCount,
        pageSize: 128,
        pages: { entries: [{ mip: 0, uri: "page.png", x: 0, y: 0 }] },
        virtualSize: [512, 256],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "vt.manifest.mipCount",
        severity: "error",
      }));
    }
  });

  it("accepts the final mip of NPOT grids and bounds explicit pages at every mip", () => {
    const valid = parseVirtualTextureManifest({
      contractVersion: 1,
      pageSize: 64,
      pages: { entries: [{ mip: 3, uri: "root.png", x: 0, y: 0 }] },
      virtualSize: [192, 320],
    });
    expect(valid.manifest).toBeDefined();

    for (const entry of [
      { mip: 0, uri: "bad-x.png", x: 3, y: 0 },
      { mip: 1, uri: "bad-y.png", x: 0, y: 3 },
      { mip: 4, uri: "bad-mip.png", x: 0, y: 0 },
    ]) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        pageSize: 64,
        pages: { entries: [entry] },
        virtualSize: [192, 320],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "vt.pages.bounds",
        severity: "error",
      }));
    }
  });

  it("rejects malformed recognized optional fields and explicit page entries", () => {
    for (const [field, value, code] of [
      ["colorSpace", "display-p3", "vt.manifest.colorSpace"],
      ["physicalSlots", 0, "vt.manifest.physicalSlots"],
      ["physicalByteBudget", 1.5, "vt.manifest.physicalByteBudget"],
    ] as const) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        [field]: value,
        pageSize: 64,
        pages: { uriTemplate: "{mip}/{x}/{y}.png" },
        virtualSize: [128, 128],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error" }));
    }

    for (const entries of [
      [{ mip: 0, uri: "valid.png", x: 0, y: 0 }, { mip: 0, uri: "duplicate.png", x: 0, y: 0 }],
      [{ mip: 0, uri: "", x: 0, y: 0 }],
      { mip: 0, uri: "not-an-array.png", x: 0, y: 0 },
    ]) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        pageSize: 64,
        pages: { entries, uriTemplate: "{mip}/{x}/{y}.png" },
        virtualSize: [128, 128],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics.some(({ severity }) => severity === "error")).toBe(true);
    }
  });

  it("preserves deliberately sparse valid explicit manifests", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 1,
      pageSize: 64,
      pages: { entries: [{ mip: 0, uri: "one-page.png", x: 2, y: 4 }] },
      virtualSize: [192, 320],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.pages).toEqual([{ mip: 0, uri: "one-page.png", x: 2, y: 4 }]);
  });

  it("rejects nonzero borders while preserving resource budgets", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 1,
      borderTexels: 2,
      mipCount: 3,
      pageSize: 64,
      pages: {
        entries: [{ mip: 0, uri: "pages/0.png", x: 0, y: 0 }],
      },
      physicalByteBudget: 80 * 80 * 4 * 3,
      virtualSize: [256, 128],
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "vt.manifest.borderTexels",
      severity: "unsupported",
    }));
    expect(result.manifest).toEqual(expect.objectContaining({
      mipCount: 3,
      pageSize: 64,
      physicalByteBudget: 80 * 80 * 4 * 3,
    }));
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 0, x: 0, y: 0 }))
      .toBe("pages/0.png");
  });

  it("requires the supported versioned contract", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 2,
    });
    expect(result.manifest).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "vt.manifest.contractVersion",
      severity: "error",
    }));
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

  it("publishes resident assignment only after an explicit transaction commit", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };
    const transaction = table.planResident(page);

    expect(transaction.assignment).toEqual(expect.objectContaining({ pageKey: "0/0/0", slot: 0 }));
    expect(table.residentSlot(page)).toBeUndefined();
    expect(table.residentCount).toBe(0);
    expect(table.dirtyPageTableUpdateCount).toBe(0);

    table.commitResident(transaction);
    expect(table.residentSlot(page)).toBe(0);
    expect(table.residentCount).toBe(1);
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page, pageKey: "0/0/0", slot: 0 });
  });

  it("keeps inactive resident pages cached and remaps them without another residency allocation", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };
    const pageKey = virtualTexturePageKey(page);

    table.reconcileActivePageKeys(new Set());
    const assignment = table.ensureResident(page);
    expect(table.residentCount).toBe(1);
    expect(table.activeResidentCount).toBe(0);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);

    table.reconcileActivePageKeys(new Set([pageKey]));
    expect(table.activeResidentCount).toBe(1);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page, pageKey, residentMip: 0, slot: assignment.slot },
    ]);

    table.reconcileActivePageKeys(new Set());
    expect(table.residentCount).toBe(1);
    expect(table.takeDirtyPageTableUpdates()).toEqual([{ page, pageKey }]);

    table.reconcileActivePageKeys(new Set([pageKey]));
    expect(table.residentSlot(page)).toBe(assignment.slot);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page, pageKey, residentMip: 0, slot: assignment.slot },
    ]);
  });

  it("coalesces rapid partially-flushed reconciliations into a bounded authoritative mapping", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 3 });
    const parent = { mip: 2, x: 0, y: 0 };
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 3, y: 3 };
    const records = [parent, first, second].map((page) => table.ensureResident(page));
    const gpuSlots = new Array<number | undefined>(16);
    const apply = (update: NonNullable<ReturnType<typeof table.dirtyPageTableUpdate>>): void => {
      const coverage = 2 ** update.page.mip;
      for (let y = update.page.y * coverage; y < (update.page.y + 1) * coverage; y += 1) {
        for (let x = update.page.x * coverage; x < (update.page.x + 1) * coverage; x += 1) {
          gpuSlots[y * 4 + x] = update.slot;
        }
      }
    };

    for (const update of table.takeDirtyPageTableUpdates()) apply(update);
    table.reconcileActivePageKeys(new Set([records[1]?.pageKey ?? ""]));
    const partiallyFlushed = table.dirtyPageTableUpdate(0);
    expect(partiallyFlushed).toBeDefined();
    if (partiallyFlushed !== undefined) apply(partiallyFlushed);
    table.commitDirtyPageTableUpdate();

    // Resize/camera jitter may publish many working sets before the governor
    // admits another table write. The queue remains bounded by physical cache,
    // and its final snapshot does not depend on the consumed prefix above.
    for (let index = 0; index < 1_000; index += 1) {
      const target = index % 2 === 0 ? records[1]?.pageKey : records[2]?.pageKey;
      table.reconcileActivePageKeys(new Set(target === undefined ? [] : [target]));
      expect(table.dirtyPageTableUpdateCount).toBeLessThanOrEqual(table.residentCount);
    }
    table.reconcileActivePageKeys(new Set([records[2]?.pageKey ?? ""]));
    for (const update of table.takeDirtyPageTableUpdates()) apply(update);

    expect(gpuSlots).toEqual(Array.from({ length: 16 }, (_unused, index) => (
      index === 15 ? records[2]?.slot : undefined
    )));
  });

  it("matches a seeded reference page table across active hierarchy changes", () => {
    forEachFuzzCase({
      cases: 16,
      seed: 0x5c0a91e7,
    }, ({ label, random }) => {
      const width = 8;
      const table = new VirtualTextureAtlasPageTable({ slotCount: 85 });
      const assignments: ResidentAssignment[] = [];
      for (let mip = 3; mip >= 0; mip -= 1) {
        const gridWidth = width / (2 ** mip);
        for (let y = 0; y < gridWidth; y += 1) {
          for (let x = 0; x < gridWidth; x += 1) {
            assignments.push(table.ensureResident({ mip, x, y }));
          }
        }
      }

      const gpuSlots = new Array<number | undefined>(width * width);
      applyPageTableUpdates(gpuSlots, width, table.takeDirtyPageTableUpdates());
      let activePageKeys = new Set(assignments.map(({ pageKey }) => pageKey));
      expect(gpuSlots, `${label} initial mapping`).toEqual(
        referencePageTableSlots(width, assignments, activePageKeys),
      );

      for (let step = 0; step < 64; step += 1) {
        activePageKeys = new Set(
          assignments
            .filter(() => random.boolean(0.45))
            .map(({ pageKey }) => pageKey),
        );
        table.reconcileActivePageKeys(activePageKeys);
        expect(table.dirtyPageTableUpdateCount, `${label} step=${step} bounded updates`)
          .toBeLessThanOrEqual(table.residentCount);
        applyPageTableUpdates(gpuSlots, width, table.takeDirtyPageTableUpdates());
        expect(gpuSlots, `${label} step=${step} mapping`).toEqual(
          referencePageTableSlots(width, assignments, activePageKeys),
        );
      }
    });
  });

  it("keeps 4096-slot alternating active sets bounded and reference-equivalent", () => {
    const width = 64;
    const table = new VirtualTextureAtlasPageTable({ slotCount: width * width });
    const assignments: ResidentAssignment[] = [];
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) assignments.push(table.ensureResident({ mip: 0, x, y }));
    }
    const gpuSlots = new Array<number | undefined>(width * width);
    applyPageTableUpdates(gpuSlots, width, table.takeDirtyPageTableUpdates());

    const stable = assignments.filter((_assignment, index) => index % 3 === 0);
    const left = assignments.filter((_assignment, index) => index % 3 === 1);
    const right = assignments.filter((_assignment, index) => index % 3 === 2);
    for (let step = 0; step < 16; step += 1) {
      const activePageKeys = new Set(
        [...stable, ...(step % 2 === 0 ? left : right)].map(({ pageKey }) => pageKey),
      );
      table.reconcileActivePageKeys(activePageKeys);
      expect(table.dirtyPageTableUpdateCount).toBeLessThanOrEqual(table.residentCount);
      applyPageTableUpdates(gpuSlots, width, table.takeDirtyPageTableUpdates());
      expect(gpuSlots).toEqual(assignments.map((assignment) => (
        activePageKeys.has(assignment.pageKey) ? assignment.slot : undefined
      )));
    }
  });

  it("preserves transaction updates ahead of superseding reconciliation snapshots", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const firstAssignment = table.ensureResident(first);
    const secondAssignment = table.ensureResident(second);

    table.reconcileActivePageKeys(new Set([firstAssignment.pageKey]));
    table.reconcileActivePageKeys(new Set([secondAssignment.pageKey]));

    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: firstAssignment.pageKey, slot: firstAssignment.slot },
      { page: second, pageKey: secondAssignment.pageKey, slot: secondAssignment.slot },
      { page: first, pageKey: firstAssignment.pageKey },
      {
        page: second,
        pageKey: secondAssignment.pageKey,
        residentMip: second.mip,
        slot: secondAssignment.slot,
      },
    ]);
  });

  it("uses only active resident ancestors as eviction fallbacks", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const parent = { mip: 1, x: 0, y: 0 };
    const child = { mip: 0, x: 0, y: 0 };
    const replacement = { mip: 0, x: 1, y: 0 };
    table.ensureResident(parent);
    table.ensureResident(child);
    table.takeDirtyPageTableUpdates();

    table.reconcileActivePageKeys(new Set([virtualTexturePageKey(child), virtualTexturePageKey(replacement)]));
    table.takeDirtyPageTableUpdates();
    const assignment = table.ensureResident(replacement, {
      protectedPages: new Set([virtualTexturePageKey(parent)]),
    });

    expect(assignment.evicted?.pageKey).toBe(virtualTexturePageKey(child));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: child, pageKey: virtualTexturePageKey(child) },
      { page: replacement, pageKey: virtualTexturePageKey(replacement), slot: assignment.slot },
    ]);
  });

  it("leaves a planned assignment unpublished when the atlas upload fails", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 1 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    table.ensureResident(first);
    table.takeDirtyPageTableUpdates();

    const failedUpload = table.planResident(second);
    expect(failedUpload.assignment.evicted?.pageKey).toBe("0/0/0");
    expect(() => {
      throw new Error("atlas upload failure");
    }).toThrow(/atlas upload failure/);

    expect(table.residentSlot(first)).toBe(0);
    expect(table.residentSlot(second)).toBeUndefined();
    expect(table.dirtyPageTableUpdateCount).toBe(0);

    const retry = table.planResident(second);
    expect(retry.assignment).toEqual(failedUpload.assignment);
    table.commitResident(retry);
    expect(table.residentSlot(first)).toBeUndefined();
    expect(table.residentSlot(second)).toBe(0);
  });

  it("peeks dirty updates allocation-free and acknowledges only successful page-table writes", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    table.ensureResident(first);
    table.ensureResident(second);

    const firstUpdate = table.dirtyPageTableUpdate(0);
    expect(firstUpdate).toEqual({ page: first, pageKey: "0/0/0", slot: 0 });
    expect(table.dirtyPageTableUpdate(0)).toBe(firstUpdate);
    expect(table.dirtyPageTableUpdateCount).toBe(2);

    // A failed write does not acknowledge or reorder the front update.
    expect(table.dirtyPageTableUpdate(0)).toBe(firstUpdate);
    expect(table.dirtyPageTableUpdateCount).toBe(2);

    table.commitDirtyPageTableUpdate();
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page: second, pageKey: "0/1/0", slot: 1 });
    expect(table.dirtyPageTableUpdateCount).toBe(1);
    table.commitDirtyPageTableUpdate();
    expect(table.dirtyPageTableUpdateCount).toBe(0);
    expect(table.dirtyPageTableUpdate(0)).toBeUndefined();
    expect(() => table.commitDirtyPageTableUpdate()).toThrow(/no dirty update/);
  });

  it("keeps a planned resident transaction valid while acknowledging an older dirty update", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    table.ensureResident(first);

    const transaction = table.planResident(second);
    table.commitDirtyPageTableUpdate();
    expect(() => table.commitResident(transaction)).not.toThrow();
    expect(table.residentSlot(second)).toBe(1);
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page: second, pageKey: "0/1/0", slot: 1 });
  });

  it("rejects foreign, stale, and already committed resident transactions", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const foreign = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = table.planResident({ mip: 0, x: 0, y: 0 });
    const stale = table.planResident({ mip: 0, x: 1, y: 0 });
    expect(() => foreign.commitResident(first)).toThrow(/another page table/);
    table.commitResident(first);
    expect(() => table.commitResident(first)).toThrow(/already committed/);
    expect(() => table.commitResident(stale)).toThrow(/stale/);
  });

  it("returns a touched existing assignment after the second-chance clock cleared its reference bit", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const third = { mip: 0, x: 2, y: 0 };
    table.ensureResident(first);
    table.ensureResident(second);
    table.takeDirtyPageTableUpdates();
    table.ensureResident(third);
    table.takeDirtyPageTableUpdates();

    const touch = table.planResident(second);
    expect(touch.assignment).toEqual(expect.objectContaining({
      pageKey: "0/1/0",
      referenceBit: true,
      slot: 1,
    }));
    table.commitResident(touch);
    expect(table.ensureResident(second)).toEqual(expect.objectContaining({ referenceBit: true, slot: 1 }));
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

  it("protects resident parents during child uploads and downgrades evicted children to parent fallback entries", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const parent = { mip: 1, x: 0, y: 0 };
    const firstChild = { mip: 0, x: 0, y: 0 };
    const secondChild = { mip: 0, x: 1, y: 0 };
    const protectedPages = new Set([virtualTexturePageKey(parent)]);

    table.ensureResident(parent);
    table.takeDirtyPageTableUpdates();
    table.ensureResident(firstChild);
    table.takeDirtyPageTableUpdates();
    const assignment = table.ensureResident(secondChild, { protectedPages });

    expect(assignment.evicted).toEqual(expect.objectContaining({ pageKey: "0/0/0" }));
    expect(table.residentSlot(parent)).toBe(0);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      expect.objectContaining({
        fallbackPageKey: "1/0/0",
        pageKey: "0/0/0",
        residentMip: 1,
        slot: 0,
      }),
      expect.objectContaining({ pageKey: "0/1/0", slot: 1 }),
    ]);
  });

  it("keeps page-table residency bounded and slot-unique under fuzzed access", () => {
    forEachFuzzCase({
      cases: 24,
      seed: 0x73f8a91d,
    }, ({ label, random }) => {
      const slotCount = random.int(1, 9);
      const table = new VirtualTextureAtlasPageTable({ slotCount });
      const seenPages = new Map<string, FuzzPage>();

      for (let step = 0; step < 48; step += 1) {
        const page = fuzzPage(random);
        const pageKey = virtualTexturePageKey(page);
        seenPages.set(pageKey, page);

        const residentBefore = [...seenPages.entries()]
          .filter(([, candidate]) => table.residentSlot(candidate) !== undefined);
        const protectedKeys = new Set(
          residentBefore
            .filter(() => random.boolean(0.35))
            .map(([key]) => key),
        );
        const hadUnprotectedResident = residentBefore.some(([key]) => !protectedKeys.has(key));
        const assignment = table.ensureResident(page, { protectedPages: protectedKeys });

        expect(table.residentCount, `${label} step=${step} resident count`).toBeLessThanOrEqual(slotCount);
        expect(table.residentSlot(page), `${label} step=${step} resident slot`).toBe(assignment.slot);
        if (assignment.evicted !== undefined) {
          expect(
            protectedKeys.has(assignment.evicted.pageKey) && hadUnprotectedResident,
            `${label} step=${step} protected eviction`,
          ).toBe(false);
          expect(
            table.residentSlot(assignment.evicted.page),
            `${label} step=${step} evicted page cleared`,
          ).toBeUndefined();
        }

        const residentSlots = [...seenPages.values()]
          .map((candidate) => table.residentSlot(candidate))
          .filter((slot): slot is number => slot !== undefined);
        expect(
          new Set(residentSlots).size,
          `${label} step=${step} unique resident slots`,
        ).toBe(residentSlots.length);

        table.takeDirtyPageTableUpdates();
        const repeat = table.ensureResident(page);
        expect(repeat.slot, `${label} step=${step} repeat slot`).toBe(assignment.slot);
        expect(table.takeDirtyPageTableUpdates(), `${label} step=${step} repeat dirty`).toEqual([]);
      }
    });
  });

  it("encodes RGBA8 page-table entries with reserved alpha and keeps dirty updates incremental after init", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };

    expect(encodeVirtualTexturePageTableRgba8({ slot: 0 })).toEqual([1, 0, 0, 255]);
    expect(encodeVirtualTexturePageTableRgba8({ residentMip: 2, slot: 256 })).toEqual([1, 1, 2, 255]);
    expect(encodeVirtualTexturePageTableRgba8({})).toEqual([0, 0, 0, 0]);
    expect(encodeVirtualTexturePageTableRgba8({ slot: 65_534 })).toEqual([255, 255, 0, 255]);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: 65_535 })).toThrow(/0 through 65534/);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: -1 })).toThrow(/0 through 65534/);

    table.ensureResident(page);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page, pageKey: "0/0/0", slot: 0 },
    ]);
    table.ensureResident(page);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);
  });
});
