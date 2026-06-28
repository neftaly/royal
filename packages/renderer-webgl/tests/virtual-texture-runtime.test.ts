import { describe, expect, it } from "vitest";

import {
  VirtualTextureRuntime,
  virtualTexturePageId,
  virtualTextureParentPage,
} from "../src/virtual-texture-runtime";

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
});
