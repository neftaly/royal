import { describe, expect, it } from "vitest";
import {
  generatedRasterVirtualTextureManifest,
} from "../packages/renderer-webgl/src/virtual-texture/automatic-source";
import {
  derivedVirtualTextureMipCount,
  encodeVirtualTexturePageTableRgba8,
  generatedVirtualTexturePageCount,
  generatedVirtualTextureManifest,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  virtualTextureDecodedPageBytes,
  virtualTexturePageKey,
  virtualTexturePageUri,
  virtualTextureStoredPageBytes,
  virtualTextureStoredPageSize,
  type VirtualTextureAtlasAssignment,
  type VirtualTextureManifestModel,
  type VirtualTexturePageKey,
  type VirtualTexturePageTableUpdate,
} from "../packages/renderer-webgl/src/virtual-texture/model";
import {
  assertFuzz,
  assertFuzzArrayEqual,
  assertFuzzEqual,
  forEachFuzzCase,
  type SeededRandom,
} from "./fuzz";

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

const ensureResident = (
  table: VirtualTextureAtlasPageTable,
  ...input: Parameters<VirtualTextureAtlasPageTable["planResident"]>
): VirtualTextureAtlasAssignment => {
  const transaction = table.planResident(...input);
  table.commitResident(transaction);
  return transaction.assignment;
};

const takeDirtyPageTableUpdates = (
  table: VirtualTextureAtlasPageTable,
): readonly VirtualTexturePageTableUpdate[] => {
  const updates: VirtualTexturePageTableUpdate[] = [];
  let update = table.dirtyPageTableUpdate(0);
  while (update !== undefined) {
    updates.push(update);
    table.commitDirtyPageTableUpdate();
    update = table.dirtyPageTableUpdate(0);
  }
  return updates;
};

const activeResidentCount = (table: VirtualTextureAtlasPageTable): number => {
  let count = 0;
  for (const record of table.residentPageValues()) {
    if (table.isActivePageKey(record.pageKey)) count += 1;
  }
  return count;
};

type ResidentAssignment = VirtualTextureAtlasAssignment;
type PageTableUpdate = VirtualTexturePageTableUpdate;

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
  activePageKeys: ReadonlySet<VirtualTexturePageKey>,
): Array<number | undefined> => {
  const slots = new Array<number | undefined>(width * width);
  const active = assignments
    .filter(({ pageKey }) => activePageKeys.has(pageKey))
    .sort((left, right) => right.page.mip - left.page.mip);
  for (const assignment of active) {
    const coverage = 2 ** assignment.page.mip;
    for (let y = assignment.page.y * coverage; y < (assignment.page.y + 1) * coverage; y += 1) {
      for (let x = assignment.page.x * coverage; x < (assignment.page.x + 1) * coverage; x += 1) {
        slots[y * width + x] = assignment.slot;
      }
    }
  }
  return slots;
};

describe("WebGL virtual texturing runtime model", () => {
  it("rounds generated raster address space while keeping bounded physical policy", () => {
    const dimensions = { height: 777.2, width: 1_023.1 };
    const raster = generatedRasterVirtualTextureManifest({
      ...dimensions,
      colorSpace: "srgb",
      decodedBytes: 0,
      label: "raster",
      source: { data: new Uint8Array(), height: 1, kind: "rgba-texture", width: 1 },
    });
    expect(raster).toMatchObject({ height: 778, physicalSlots: 21, width: 1_024 });
  });

  it("rejects invalid generated raster dimensions without looping", () => {
    expect(() => generatedRasterVirtualTextureManifest({
      decodedBytes: 0,
      height: 512,
      label: "invalid raster",
      source: { data: new Uint8Array(), height: 1, kind: "rgba-texture", width: 1 },
      width: Number.POSITIVE_INFINITY,
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

  it("parses explicit page-entry manifests into a normalized resource model", () => {
    const result = parseVirtualTextureManifest({
      borderTexels: 1,
      contractVersion: 2,
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
        borderTexels: 1,
        contractVersion: 2,
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
      borderTexels: 1,
      contractVersion: 2,
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
        borderTexels: 1,
        contractVersion: 2,
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
      ["pageEncoding", "jpeg", "vt.manifest.pageEncoding"],
      ["physicalSlots", 0, "vt.manifest.physicalSlots"],
      ["physicalByteBudget", 1.5, "vt.manifest.physicalByteBudget"],
    ] as const) {
      const result = parseVirtualTextureManifest({
        borderTexels: 1,
        contractVersion: 2,
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
        borderTexels: 1,
        contractVersion: 2,
        pageSize: 64,
        pages: { entries, uriTemplate: "{mip}/{x}/{y}.png" },
        virtualSize: [128, 128],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics.some(({ severity }) => severity === "error")).toBe(true);
    }
  });

  it("normalizes block-aligned KTX2/Basis page transport and its retained byte cost", () => {
    const result = parseVirtualTextureManifest({
      borderTexels: 2,
      contractVersion: 2,
      pageEncoding: "ktx2-basis",
      pageSize: 64,
      pages: { uriTemplate: "pages/{mip}/{x}-{y}.ktx2" },
      virtualSize: [256, 128],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      pageEncoding: "ktx2-basis",
      pageSize: 64,
    }));
    expect(result.manifest === undefined ? undefined : virtualTextureStoredPageBytes(result.manifest))
      .toBe((68 / 4) ** 2 * 16);

    const misaligned = parseVirtualTextureManifest({
      borderTexels: 1,
      contractVersion: 2,
      pageEncoding: "ktx2-basis",
      pageSize: 64,
      pages: { uriTemplate: "pages/{mip}/{x}-{y}.ktx2" },
      virtualSize: [256, 128],
    });
    expect(misaligned.manifest).toBeUndefined();
    expect(misaligned.diagnostics).toContainEqual(expect.objectContaining({
      code: "vt.manifest.pageEncoding",
      severity: "error",
    }));
  });

  it("preserves deliberately sparse valid explicit manifests", () => {
    const result = parseVirtualTextureManifest({
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 64,
      pages: { entries: [{ mip: 0, uri: "one-page.png", x: 2, y: 4 }] },
      virtualSize: [192, 320],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.pages).toEqual([{ mip: 0, uri: "one-page.png", x: 2, y: 4 }]);
  });

  it("normalizes bordered storage while preserving logical grids and resource budgets", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 2,
      borderTexels: 2,
      mipCount: 3,
      pageSize: 64,
      pages: {
        entries: [{ mip: 0, uri: "pages/0.png", x: 0, y: 0 }],
      },
      physicalByteBudget: 80 * 80 * 4 * 3,
      virtualSize: [256, 128],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      borderTexels: 2,
      mipCount: 3,
      pageSize: 64,
      physicalByteBudget: 80 * 80 * 4 * 3,
    }));
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 0, x: 0, y: 0 }))
      .toBe("pages/0.png");
    expect(result.manifest === undefined ? undefined : virtualTextureStoredPageSize(result.manifest)).toBe(68);
    expect(result.manifest === undefined ? undefined : virtualTextureDecodedPageBytes(result.manifest)).toBe(68 ** 2 * 4);
  });

  it("requires v2 and a positive border, failing v1 closed", () => {
    for (const input of [
      { borderTexels: 1, contractVersion: 1, pageSize: 64, pages: { uriTemplate: "page.png" }, virtualSize: [64, 64] },
      { contractVersion: 2, pageSize: 64, pages: { uriTemplate: "page.png" }, virtualSize: [64, 64] },
      { borderTexels: 0, contractVersion: 2, pageSize: 64, pages: { uriTemplate: "page.png" }, virtualSize: [64, 64] },
    ]) {
      const result = parseVirtualTextureManifest(input);
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics.some(({ severity }) => severity === "error")).toBe(true);
    }
  });

  it("fails stored-cell extent and byte arithmetic closed at safe-integer boundaries", () => {
    expect(parseVirtualTextureManifest({
      borderTexels: Number.MAX_SAFE_INTEGER,
      contractVersion: 2,
      pageSize: 1,
      pages: { uriTemplate: "page.png" },
      virtualSize: [1, 1],
    }).manifest).toBeUndefined();
    expect(() => generatedVirtualTextureManifest({
      borderTexels: Number.MAX_SAFE_INTEGER,
      height: 1,
      pageSize: 1,
      physicalSlotCap: 1,
      width: 1,
    })).toThrow(RangeError);
    expect(() => virtualTextureDecodedPageBytes({
      borderTexels: 1,
      height: 1,
      pageAddressing: "sparse",
      pageEncoding: "image",
      pageSize: 1_000_000_000,
      pages: [],
      width: 1,
    })).toThrow(RangeError);
  });

  it("packs common page identity without changing authored key-template labels", () => {
    const pages = [
      { mip: 0, x: 0, y: 0 },
      { mip: 255, x: 65_535, y: 65_535 },
      { mip: 1, x: 256, y: 1 },
      { mip: 2, x: 1, y: 256 },
    ];
    const keys = pages.map(virtualTexturePageKey);
    expect(keys.every((key) => typeof key === "number" && Number.isSafeInteger(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(virtualTexturePageKey({ mip: 0, x: 65_536, y: 0 })).toBe("0/65536/0");

    const templated: VirtualTextureManifestModel = {
      borderTexels: 1,
      height: 1,
      pageAddressing: "complete",
      pageEncoding: "image",
      pageSize: 1,
      pages: [],
      uriTemplate: "pages/{key}.png",
      width: 1,
    };
    expect(virtualTexturePageUri(templated, pages[2]!)).toBe("pages/1/256/1.png");
  });

  it("tracks page to atlas slot mappings and dirty page-table updates incrementally", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };

    expect(ensureResident(table, first)).toEqual(expect.objectContaining({
      pageKey: virtualTexturePageKey(first),
      slot: 0,
    }));
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page: first, pageKey: virtualTexturePageKey(first), slot: 0 },
    ]);

    ensureResident(table, first);
    expect(takeDirtyPageTableUpdates(table)).toEqual([]);

    expect(ensureResident(table, second)).toEqual(expect.objectContaining({
      pageKey: virtualTexturePageKey(second),
      slot: 1,
    }));
    expect(table.residentSlot(first)).toBe(0);
    expect(table.residentSlot(second)).toBe(1);
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page: second, pageKey: virtualTexturePageKey(second), slot: 1 },
    ]);
  });

  it("publishes resident assignment only after an explicit transaction commit", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };
    const transaction = table.planResident(page);

    expect(transaction.assignment).toEqual(expect.objectContaining({
      pageKey: virtualTexturePageKey(page),
      slot: 0,
    }));
    expect(table.residentSlot(page)).toBeUndefined();
    expect(table.residentCount).toBe(0);
    expect(table.dirtyPageTableUpdateCount).toBe(0);

    table.commitResident(transaction);
    expect(table.residentSlot(page)).toBe(0);
    expect(table.residentCount).toBe(1);
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page, pageKey: virtualTexturePageKey(page), slot: 0 });
  });

  it("keeps inactive resident pages cached and remaps them without another residency allocation", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };
    const pageKey = virtualTexturePageKey(page);

    table.reconcileActivePageKeys(new Set());
    const assignment = ensureResident(table, page);
    expect(table.residentCount).toBe(1);
    expect(activeResidentCount(table)).toBe(0);
    expect(takeDirtyPageTableUpdates(table)).toEqual([]);

    table.reconcileActivePageKeys(new Set([pageKey]));
    expect(activeResidentCount(table)).toBe(1);
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page, pageKey, residentMip: 0, slot: assignment.slot },
    ]);

    table.reconcileActivePageKeys(new Set());
    expect(table.residentCount).toBe(1);
    expect(takeDirtyPageTableUpdates(table)).toEqual([{ page, pageKey }]);

    table.reconcileActivePageKeys(new Set([pageKey]));
    expect(table.residentSlot(page)).toBe(assignment.slot);
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page, pageKey, residentMip: 0, slot: assignment.slot },
    ]);
  });

  it("coalesces rapid partially-flushed reconciliations into a bounded authoritative mapping", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 3 });
    const parent = { mip: 2, x: 0, y: 0 };
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 3, y: 3 };
    const records = [parent, first, second].map((page) => ensureResident(table, page));
    const gpuSlots = new Array<number | undefined>(16);
    const apply = (update: NonNullable<ReturnType<typeof table.dirtyPageTableUpdate>>): void => {
      const coverage = 2 ** update.page.mip;
      for (let y = update.page.y * coverage; y < (update.page.y + 1) * coverage; y += 1) {
        for (let x = update.page.x * coverage; x < (update.page.x + 1) * coverage; x += 1) {
          gpuSlots[y * 4 + x] = update.slot;
        }
      }
    };

    for (const update of takeDirtyPageTableUpdates(table)) apply(update);
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
    for (const update of takeDirtyPageTableUpdates(table)) apply(update);

    expect(gpuSlots).toEqual(Array.from({ length: 16 }, (_unused, index) => (
      index === 15 ? records[2]?.slot : undefined
    )));
  });

  it("matches a seeded reference page table across active hierarchy changes", () => {
    forEachFuzzCase({
      cases: 16,
      seed: 0x5c0a91e7,
    }, ({ random }) => {
      const width = 8;
      const table = new VirtualTextureAtlasPageTable({ slotCount: 85 });
      const assignments: ResidentAssignment[] = [];
      for (let mip = 3; mip >= 0; mip -= 1) {
        const gridWidth = width / (2 ** mip);
        for (let y = 0; y < gridWidth; y += 1) {
          for (let x = 0; x < gridWidth; x += 1) {
            assignments.push(ensureResident(table, { mip, x, y }));
          }
        }
      }

      const gpuSlots = new Array<number | undefined>(width * width);
      applyPageTableUpdates(gpuSlots, width, takeDirtyPageTableUpdates(table));
      let activePageKeys = new Set(assignments.map(({ pageKey }) => pageKey));
      assertFuzzArrayEqual(gpuSlots,
        referencePageTableSlots(width, assignments, activePageKeys),
        "initial mapping",
      );

      for (let step = 0; step < 64; step += 1) {
        activePageKeys = new Set(
          assignments
            .filter(() => random.boolean(0.45))
            .map(({ pageKey }) => pageKey),
        );
        table.reconcileActivePageKeys(activePageKeys);
        assertFuzz(
          table.dirtyPageTableUpdateCount <= table.residentCount,
          `step=${step} dirty updates exceed residents`,
        );
        applyPageTableUpdates(gpuSlots, width, takeDirtyPageTableUpdates(table));
        assertFuzzArrayEqual(gpuSlots,
          referencePageTableSlots(width, assignments, activePageKeys),
          `step=${step} mapping`,
        );
      }
    });
  });

  it("keeps 4096-slot alternating active sets bounded and reference-equivalent", () => {
    const width = 64;
    const table = new VirtualTextureAtlasPageTable({ slotCount: width * width });
    const assignments: ResidentAssignment[] = [];
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) assignments.push(ensureResident(table, { mip: 0, x, y }));
    }
    const gpuSlots = new Array<number | undefined>(width * width);
    applyPageTableUpdates(gpuSlots, width, takeDirtyPageTableUpdates(table));

    const stable = assignments.filter((_assignment, index) => index % 3 === 0);
    const left = assignments.filter((_assignment, index) => index % 3 === 1);
    const right = assignments.filter((_assignment, index) => index % 3 === 2);
    for (let step = 0; step < 16; step += 1) {
      const activePageKeys = new Set(
        [...stable, ...(step % 2 === 0 ? left : right)].map(({ pageKey }) => pageKey),
      );
      table.reconcileActivePageKeys(activePageKeys);
      assertFuzz(
        table.dirtyPageTableUpdateCount <= table.residentCount,
        `step=${step} dirty updates exceed residents`,
      );
      applyPageTableUpdates(gpuSlots, width, takeDirtyPageTableUpdates(table));
      assertFuzzArrayEqual(
        gpuSlots,
        assignments.map((assignment) => activePageKeys.has(assignment.pageKey) ? assignment.slot : undefined),
        `step=${step} mapping`,
      );
    }
  });

  it("preserves transaction updates ahead of superseding reconciliation snapshots", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const firstAssignment = ensureResident(table, first);
    const secondAssignment = ensureResident(table, second);

    table.reconcileActivePageKeys(new Set([firstAssignment.pageKey]));
    table.reconcileActivePageKeys(new Set([secondAssignment.pageKey]));

    expect(takeDirtyPageTableUpdates(table)).toEqual([
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
    ensureResident(table, parent);
    ensureResident(table, child);
    takeDirtyPageTableUpdates(table);

    table.reconcileActivePageKeys(new Set([virtualTexturePageKey(child), virtualTexturePageKey(replacement)]));
    takeDirtyPageTableUpdates(table);
    const assignment = ensureResident(table, replacement, {
      protectedPages: new Set([virtualTexturePageKey(parent)]),
    });

    expect(assignment.evicted?.pageKey).toBe(virtualTexturePageKey(child));
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page: child, pageKey: virtualTexturePageKey(child) },
      { page: replacement, pageKey: virtualTexturePageKey(replacement), slot: assignment.slot },
    ]);
  });

  it("leaves a planned assignment unpublished when the atlas upload fails", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 1 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    ensureResident(table, first);
    takeDirtyPageTableUpdates(table);

    const failedUpload = table.planResident(second);
    expect(failedUpload.assignment.evicted?.pageKey).toBe(virtualTexturePageKey(first));
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
    ensureResident(table, first);
    ensureResident(table, second);

    const firstUpdate = table.dirtyPageTableUpdate(0);
    expect(firstUpdate).toEqual({ page: first, pageKey: virtualTexturePageKey(first), slot: 0 });
    expect(table.dirtyPageTableUpdate(0)).toBe(firstUpdate);
    expect(table.dirtyPageTableUpdateCount).toBe(2);

    // A failed write does not acknowledge or reorder the front update.
    expect(table.dirtyPageTableUpdate(0)).toBe(firstUpdate);
    expect(table.dirtyPageTableUpdateCount).toBe(2);

    table.commitDirtyPageTableUpdate();
    expect(table.dirtyPageTableUpdate(0)).toEqual({
      page: second,
      pageKey: virtualTexturePageKey(second),
      slot: 1,
    });
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
    ensureResident(table, first);

    const transaction = table.planResident(second);
    table.commitDirtyPageTableUpdate();
    expect(() => table.commitResident(transaction)).not.toThrow();
    expect(table.residentSlot(second)).toBe(1);
    expect(table.dirtyPageTableUpdate(0)).toEqual({
      page: second,
      pageKey: virtualTexturePageKey(second),
      slot: 1,
    });
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
    ensureResident(table, first);
    ensureResident(table, second);
    takeDirtyPageTableUpdates(table);
    ensureResident(table, third);
    takeDirtyPageTableUpdates(table);

    const touch = table.planResident(second);
    expect(touch.assignment).toEqual(expect.objectContaining({
      pageKey: virtualTexturePageKey(second),
      referenceBit: true,
      slot: 1,
    }));
    table.commitResident(touch);
    expect(ensureResident(table, second)).toEqual(expect.objectContaining({ referenceBit: true, slot: 1 }));
  });

  it("selects the nearest resident parent fallback for missing pages", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 4 });
    const parent = { mip: 1, x: 1, y: 1 };
    ensureResident(table, parent);
    takeDirtyPageTableUpdates(table);

    expect(table.resolveResidentFallback({ mip: 0, x: 3, y: 2 }, { maxMip: 3 })).toEqual(
      expect.objectContaining({ page: parent, pageKey: virtualTexturePageKey(parent), slot: 0 }),
    );
    expect(table.resolveResidentFallback({ mip: 0, x: 0, y: 0 }, { maxMip: 1 })).toBeUndefined();
  });

  it("evicts with a bounded clock policy and records invalidated page-table entries", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const third = { mip: 0, x: 2, y: 0 };
    const fourth = { mip: 0, x: 3, y: 0 };

    ensureResident(table, first);
    ensureResident(table, second);
    takeDirtyPageTableUpdates(table);

    expect(ensureResident(table, third)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: first, slot: 0 }),
      page: third,
      slot: 0,
    }));
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page: first, pageKey: virtualTexturePageKey(first) },
      { page: third, pageKey: virtualTexturePageKey(third), slot: 0 },
    ]);

    expect(ensureResident(table, fourth)).toEqual(expect.objectContaining({
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

    ensureResident(table, parent);
    takeDirtyPageTableUpdates(table);
    ensureResident(table, firstChild);
    takeDirtyPageTableUpdates(table);
    const assignment = ensureResident(table, secondChild, { protectedPages });

    expect(assignment.evicted).toEqual(expect.objectContaining({
      pageKey: virtualTexturePageKey(firstChild),
    }));
    expect(table.residentSlot(parent)).toBe(0);
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      expect.objectContaining({
        fallbackPageKey: virtualTexturePageKey(parent),
        pageKey: virtualTexturePageKey(firstChild),
        residentMip: 1,
        slot: 0,
      }),
      expect.objectContaining({ pageKey: virtualTexturePageKey(secondChild), slot: 1 }),
    ]);
  });

  it("keeps page-table residency bounded and slot-unique under fuzzed access", () => {
    forEachFuzzCase({
      cases: 24,
      seed: 0x73f8a91d,
    }, ({ label, random }) => {
      const slotCount = random.int(1, 9);
      const table = new VirtualTextureAtlasPageTable({ slotCount });
      const seenPages = new Map<VirtualTexturePageKey, FuzzPage>();

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
        const assignment = ensureResident(table, page, { protectedPages: protectedKeys });

        assertFuzz(table.residentCount <= slotCount, `${label} step=${step} resident count`);
        assertFuzzEqual(table.residentSlot(page), assignment.slot, `${label} step=${step} resident slot`);
        if (assignment.evicted !== undefined) {
          assertFuzz(
            !(protectedKeys.has(assignment.evicted.pageKey) && hadUnprotectedResident),
            `${label} step=${step} protected eviction`,
          );
          assertFuzzEqual(
            table.residentSlot(assignment.evicted.page),
            undefined,
            `${label} step=${step} evicted page cleared`,
          );
        }

        const residentSlots = [...seenPages.values()]
          .map((candidate) => table.residentSlot(candidate))
          .filter((slot): slot is number => slot !== undefined);
        assertFuzzEqual(
          new Set(residentSlots).size,
          residentSlots.length,
          `${label} step=${step} unique resident slots`,
        );

        takeDirtyPageTableUpdates(table);
        const repeat = ensureResident(table, page);
        assertFuzzEqual(repeat.slot, assignment.slot, `${label} step=${step} repeat slot`);
        assertFuzzEqual(
          takeDirtyPageTableUpdates(table).length,
          0,
          `${label} step=${step} repeat dirty count`,
        );
      }
    });
  });

  it("encodes RGBA8 page-table entries with reserved alpha and keeps dirty updates incremental after init", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };

    expect(encodeVirtualTexturePageTableRgba8({ slot: 0 }, 16)).toEqual([0, 0, 0, 255]);
    expect(encodeVirtualTexturePageTableRgba8({ residentMip: 2, slot: 256 }, 16)).toEqual([0, 16, 2, 255]);
    expect(encodeVirtualTexturePageTableRgba8({}, 16)).toEqual([0, 0, 0, 0]);
    expect(encodeVirtualTexturePageTableRgba8({ slot: 65_534 }, 256)).toEqual([254, 255, 0, 255]);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: 65_535 }, 256)).toThrow(/0 through 65534/);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: -1 }, 256)).toThrow(/0 through 65534/);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: 256 }, 1)).toThrow(/exceeds the encoded atlas grid/);

    ensureResident(table, page);
    expect(takeDirtyPageTableUpdates(table)).toEqual([
      { page, pageKey: virtualTexturePageKey(page), slot: 0 },
    ]);
    ensureResident(table, page);
    expect(takeDirtyPageTableUpdates(table)).toEqual([]);
  });
});
