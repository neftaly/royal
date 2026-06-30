import { describe, expect, it } from "vitest";

import {
  VirtualTextureRuntime,
  virtualTexturePageId,
  virtualTextureParentPage,
} from "../src/virtual-texture-testing";

describe("VirtualTextureRuntime", () => {
  it("creates stable page ids and parent addresses", () => {
    expect(virtualTexturePageId({ mip: 2, x: 3, y: 5 })).toBe("m2/3/5");
    expect(virtualTextureParentPage({ mip: 0, x: 7, y: 4 }, 4)).toEqual({ mip: 1, x: 3, y: 2 });
    expect(virtualTextureParentPage({ mip: 3, x: 0, y: 0 }, 4)).toBeNull();
  });

  it("computes slot layout and padded RGBA8 byte budget", () => {
    const runtime = new VirtualTextureRuntime({
      borderTexels: 4,
      pageSize: 128,
      physicalSlots: 10,
      virtualSize: [512, 256],
    });

    expect(runtime.mipCount).toBe(3);
    expect(runtime.slotColumns).toBe(4);
    expect(runtime.slotRows).toBe(3);
    expect(runtime.slotAddress(9)).toEqual({ slot: 9, x: 1, y: 2 });
    expect(runtime.debugSnapshot().config).toMatchObject({
      bytesPerPage: 136 * 136 * 4,
      paddedPageSize: 136,
    });
  });

  it("writes resident page-table entries using RGBA8 slot and version encoding", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    const first = runtime.makeResident({ mip: 0, x: 1, y: 2 }, 7);
    const second = runtime.makeResident({ mip: 0, x: 2, y: 2 }, 8);
    const dirty = runtime.drainDirtyEntries(9);

    expect(first.page).toMatchObject({ id: "m0/1/2", slot: 0, slotX: 0, slotY: 0 });
    expect(second.page).toMatchObject({ id: "m0/2/2", slot: 1, slotX: 1, slotY: 0 });
    expect(first.entry.encodedRgba8).toEqual([0, 0, 0, 3]);
    expect(second.entry.encodedRgba8).toEqual([1, 0, 0, 5]);
    expect(dirty.map((entry) => entry.op)).toEqual(["upload", "upload"]);
    expect(dirty.map((entry) => entry.batchIndex)).toEqual([0, 1]);
    expect(runtime.debugSnapshot().dirtyEntriesPending).toBe(0);
  });

  it("resolves exact pages, resident parent fallbacks, and missing pages", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 1, x: 1, y: 1 }, 1);
    runtime.drainDirtyEntries();

    const exact = runtime.resolve({ mip: 1, x: 1, y: 1 }, 2);
    const fallback = runtime.resolve({ mip: 0, x: 2, y: 3 }, 3);
    const missing = runtime.resolve({ mip: 0, x: 0, y: 0 }, 4);
    const dirty = runtime.drainDirtyEntries(5);

    expect(exact.kind).toBe("exact");
    expect(fallback.kind).toBe("fallback");
    expect(fallback.mipDelta).toBe(1);
    expect(fallback.entry).toMatchObject({
      flags: ["resident", "fallback"],
      residentPageId: "m1/1/1",
    });
    expect(fallback.entry.encodedRgba8).toEqual([0, 0, 1, 5]);
    expect(missing).toMatchObject({ kind: "missing", page: null });
    expect(missing.entry.encodedRgba8).toEqual([0, 0, 0, 0]);
    expect(dirty.map((entry) => entry.op)).toEqual(["resolve", "missing"]);
  });

  it("evicts least-recent child pages before equally old parent pages", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 2,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 0, x: 0, y: 0 }, 0);
    runtime.makeResident({ mip: 1, x: 0, y: 0 }, 0);
    runtime.drainDirtyEntries();

    const insert = runtime.makeResident({ mip: 0, x: 1, y: 0 }, 1);

    expect(insert.evicted?.id).toBe("m0/0/0");
    expect(runtime.resolve({ mip: 0, x: 0, y: 1 }, 2)).toMatchObject({
      kind: "fallback",
      page: { id: "m1/0/0" },
    });
  });

  it("downgrades descendant page-table entries when a resident parent is evicted", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 2,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 2, x: 0, y: 0 }, 0);
    runtime.resolve({ mip: 0, x: 3, y: 3 }, 1);
    runtime.makeResident({ mip: 0, x: 0, y: 0 }, 2);
    runtime.drainDirtyEntries();

    const inserted = runtime.makeResident({ mip: 0, x: 1, y: 0 }, 3);
    const dirty = runtime.drainDirtyEntries(4);
    const snapshot = runtime.debugSnapshot();

    expect(inserted.evicted?.id).toBe("m2/0/0");
    expect(dirty.map((entry) => [entry.op, entry.tableCoord])).toContainEqual([
      "evict",
      { mip: 0, x: 3, y: 3 },
    ]);
    expect(snapshot.staleResidentReferences).toBe(0);
    expect(snapshot.pageTableEntries.map((entry) => entry.residentPageId)).not.toContain("m2/0/0");
  });

  it("looks up resident pages and slot ownership to reject stale atlas uploads after slot reuse", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 1,
      virtualSize: [256, 128],
    });

    const queued = runtime.makeResident({ mip: 0, x: 0, y: 0 }, 1);
    const queuedUpload = {
      page: { mip: queued.page.mip, x: queued.page.x, y: queued.page.y },
      pageId: queued.page.id,
      slot: queued.page.slot,
      uploadSerial: queued.page.uploadSerial,
    };

    const replacement = runtime.makeResident({ mip: 0, x: 1, y: 0 }, 2);

    expect(replacement.evicted?.id).toBe(queuedUpload.pageId);
    expect(runtime.lookupResidentPage(queuedUpload.pageId)).toBeNull();
    expect(runtime.lookupResidentPage(queuedUpload.page)).toBeNull();
    expect(runtime.lookupPageTableEntry(queuedUpload.page)).toBeNull();
    expect(runtime.lookupResidentPage(replacement.page.id)).toEqual(replacement.page);
    expect(runtime.lookupPageTableEntry({ mip: 0, x: 1, y: 0 })).toMatchObject({
      residentPageId: replacement.page.id,
      uploadSerial: replacement.page.uploadSerial,
    });
    expect(runtime.lookupSlot(queuedUpload.slot)).toMatchObject({
      pageId: replacement.page.id,
      status: "resident",
      uploadSerial: replacement.page.uploadSerial,
    });
    expect(runtime.lookupSlot(queuedUpload.slot).uploadSerial).not.toBe(queuedUpload.uploadSerial);
  });

  it("looks up page-table entries and slot ownership to reject stale fallback uploads", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 2,
      virtualSize: [512, 512],
    });

    const parent = runtime.makeResident({ mip: 1, x: 0, y: 0 }, 1);
    const fallback = runtime.resolve({ mip: 0, x: 1, y: 1 }, 2);
    const queuedEntry = runtime.lookupPageTableEntry({ mip: 0, x: 1, y: 1 });

    expect(fallback.kind).toBe("fallback");
    expect(queuedEntry).toMatchObject({
      residentPageId: parent.page.id,
      uploadSerial: parent.page.uploadSerial,
    });

    runtime.makeResident({ mip: 0, x: 0, y: 0 }, 3);
    const replacement = runtime.makeResident({ mip: 0, x: 2, y: 0 }, 4);

    expect(replacement.evicted?.id).toBe(parent.page.id);
    expect(runtime.lookupResidentPage(parent.page.id)).toBeNull();
    expect(runtime.lookupPageTableEntry({ mip: 0, x: 1, y: 1 })).toBeNull();
    expect(runtime.lookupSlot(parent.page.slot)).toMatchObject({
      pageId: replacement.page.id,
      status: "resident",
      uploadSerial: replacement.page.uploadSerial,
    });
    expect(runtime.lookupSlot(parent.page.slot).uploadSerial).not.toBe(queuedEntry?.uploadSerial);
  });

  it("bounds eviction downgrades to page-table entries that reference the evicted resident page", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 64,
      physicalSlots: 3,
      virtualSize: [4096, 4096],
    });
    const rootMip = runtime.mipCount - 1;

    runtime.makeResident({ mip: rootMip, x: 0, y: 0 }, 10_000);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        runtime.resolve({ mip: 0, x, y }, 10_000 + y * 64 + x);
      }
    }
    runtime.makeResident({ mip: 0, x: 0, y: 0 }, 1);
    runtime.makeResident({ mip: 0, x: 1, y: 0 }, 2);
    runtime.drainDirtyEntries();

    const originalValues = Object.getOwnPropertyDescriptor(Map.prototype, "values")
      ?.value as typeof Map.prototype.values;
    let iteratedMapValues = 0;
    let inserted: ReturnType<VirtualTextureRuntime["makeResident"]> | null = null;
    Map.prototype.values = function patchedValues(this: Map<unknown, unknown>) {
      const iterator = originalValues.call(this);
      return {
        [Symbol.iterator]() {
          return this;
        },
        next() {
          const result = iterator.next();
          if (!result.done) iteratedMapValues += 1;
          return result;
        },
      };
    } as typeof Map.prototype.values;
    try {
      inserted = runtime.makeResident({ mip: 0, x: 2, y: 0 }, 3);
    } finally {
      Map.prototype.values = originalValues;
    }

    const dirty = runtime.drainDirtyEntries(4);

    expect(inserted?.evicted?.id).toBe("m0/0/0");
    expect(iteratedMapValues).toBe(3);
    expect(dirty.map((entry) => [entry.op, entry.tableCoord])).toEqual([
      ["upload", { mip: 0, x: 2, y: 0 }],
      ["resolve", { mip: 0, x: 0, y: 0 }],
    ]);
    expect(runtime.lookupPageTableEntry({ mip: 0, x: 0, y: 0 })).toMatchObject({
      flags: ["resident", "fallback"],
      residentPageId: `m${rootMip}/0/0`,
    });
    expect(runtime.pageTableCounts()).toMatchObject({
      mapped: 4097,
      staleResidentReferences: 0,
    });
  });

  it("reports cheap runtime stats without sorted page-table entry copies", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 1, x: 1, y: 1 }, 1);
    runtime.resolve({ mip: 0, x: 2, y: 3 }, 2);
    runtime.resolve({ mip: 0, x: 0, y: 0 }, 3);

    const originalSort = Array.prototype.sort;
    let stats: ReturnType<VirtualTextureRuntime["stats"]> | null = null;
    let counts: ReturnType<VirtualTextureRuntime["pageTableCounts"]> | null = null;
    let pageTableEntry: ReturnType<VirtualTextureRuntime["lookupPageTableEntry"]> | null = null;
    let residentPage: ReturnType<VirtualTextureRuntime["lookupResidentPage"]> | null = null;
    let residentPageIds: readonly string[] | null = null;
    let slot: ReturnType<VirtualTextureRuntime["lookupSlot"]> | null = null;
    Array.prototype.sort = (() => {
      throw new Error("cheap VT stats should not sort page-table entries");
    }) as typeof Array.prototype.sort;
    try {
      stats = runtime.stats();
      counts = runtime.pageTableCounts();
      pageTableEntry = runtime.lookupPageTableEntry({ mip: 0, x: 2, y: 3 });
      residentPage = runtime.lookupResidentPage("m1/1/1");
      residentPageIds = runtime.residentPageIds();
      expect(runtime.hasResidentPages()).toBe(true);
      slot = runtime.lookupSlot(0);
    } finally {
      Array.prototype.sort = originalSort;
    }

    expect(stats).toMatchObject({
      cache: {
        byMip: { mip1: 1 },
        capacity: 4,
        freeSlots: 3,
        residentPages: 1,
        slotColumns: 2,
        slotRows: 2,
      },
      dirtyEntriesPending: 3,
      pageTable: {
        entries: 2,
        exact: 1,
        fallback: 1,
        mapped: 2,
        resident: 2,
        staleResidentReferences: 0,
        totalVirtualPages: 21,
        unmapped: 19,
      },
      version: 3,
    });
    expect(counts).toEqual(stats?.pageTable);
    expect(pageTableEntry).toMatchObject({ residentPageId: "m1/1/1" });
    expect(residentPage).toMatchObject({ id: "m1/1/1" });
    expect(residentPageIds).toEqual(["m1/1/1"]);
    expect(slot).toMatchObject({ pageId: "m1/1/1" });
  });
});
