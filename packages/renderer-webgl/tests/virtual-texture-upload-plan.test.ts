import { describe, expect, it } from "vitest";

import { VirtualTextureRuntime } from "../src/virtual-texture-runtime";
import { planVirtualTextureUploads } from "../src/virtual-texture-upload-plan";

describe("planVirtualTextureUploads", () => {
  it("plans page-table texel uploads in drained dirty-entry order", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 1, x: 1, y: 1 }, 1);
    runtime.drainDirtyEntries();
    runtime.resolve({ mip: 0, x: 2, y: 3 }, 2);
    runtime.resolve({ mip: 0, x: 0, y: 0 }, 3);

    const plan = planVirtualTextureUploads(runtime.drainDirtyEntries(4), { pageSize: 128 });

    expect(plan.pageTableUploads).toEqual([
      expect.objectContaining({
        batchIndex: 0,
        dirtySequence: 0,
        drainedFrame: 4,
        kind: "page-table-texel",
        level: 0,
        op: "resolve",
        residentPageId: "m1/1/1",
        rgba8: [0, 0, 1, 5],
        tableCoord: { mip: 0, x: 2, y: 3 },
        xOffset: 2,
        yOffset: 3,
      }),
      expect.objectContaining({
        batchIndex: 1,
        dirtySequence: 1,
        drainedFrame: 4,
        kind: "page-table-texel",
        level: 0,
        op: "missing",
        reason: "no-resident-parent",
        residentPageId: null,
        rgba8: [0, 0, 0, 0],
        tableCoord: { mip: 0, x: 0, y: 0 },
        xOffset: 0,
        yOffset: 0,
      }),
    ]);
    expect(plan.physicalAtlasUploads).toEqual([]);
    expect(plan.uploadCount).toBe(2);
  });

  it("plans physical atlas uploads for resident page uploads", () => {
    const runtime = new VirtualTextureRuntime({
      borderTexels: 4,
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 0, x: 1, y: 2 }, 7);
    runtime.makeResident({ mip: 0, x: 2, y: 2 }, 8);

    const plan = planVirtualTextureUploads(runtime.drainDirtyEntries(9), {
      borderTexels: 4,
      bytesPerTexel: 4,
      pageSize: 128,
    });

    expect(plan.pageTableUploads.map((upload) => upload.rgba8)).toEqual([
      [0, 0, 0, 3],
      [1, 0, 0, 5],
    ]);
    expect(plan.physicalAtlasUploads).toEqual([
      expect.objectContaining({
        batchIndex: 0,
        byteLength: 136 * 136 * 4,
        dirtySequence: 0,
        height: 136,
        kind: "physical-atlas-page",
        paddedPageSize: 136,
        residentPageId: "m0/1/2",
        slot: { slot: 0, x: 0, y: 0 },
        sourcePage: { mip: 0, x: 1, y: 2 },
        uploadSerial: 0,
        width: 136,
        xOffset: 0,
        yOffset: 0,
      }),
      expect.objectContaining({
        batchIndex: 1,
        byteLength: 136 * 136 * 4,
        dirtySequence: 1,
        height: 136,
        kind: "physical-atlas-page",
        paddedPageSize: 136,
        residentPageId: "m0/2/2",
        slot: { slot: 1, x: 1, y: 0 },
        sourcePage: { mip: 0, x: 2, y: 2 },
        uploadSerial: 1,
        width: 136,
        xOffset: 136,
        yOffset: 0,
      }),
    ]);
    expect(plan.uploadCount).toBe(4);
  });

  it("omits physical atlas uploads for fallback, missing, and evict rewrites", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 2,
      virtualSize: [512, 512],
    });

    runtime.makeResident({ mip: 2, x: 0, y: 0 }, 0);
    runtime.resolve({ mip: 0, x: 3, y: 3 }, 1);
    runtime.makeResident({ mip: 0, x: 0, y: 0 }, 2);
    runtime.drainDirtyEntries();
    runtime.makeResident({ mip: 0, x: 1, y: 0 }, 3);

    const plan = planVirtualTextureUploads(runtime.drainDirtyEntries(4), { pageSize: 128 });

    expect(plan.pageTableUploads.map((upload) => upload.op)).toEqual(["upload", "evict", "evict"]);
    expect(plan.physicalAtlasUploads.map((upload) => upload.residentPageId)).toEqual(["m0/1/0"]);
  });

  it("validates upload geometry options before planning", () => {
    expect(() => planVirtualTextureUploads([], { pageSize: 0 })).toThrow(
      "Virtual texture upload plan pageSize must be a positive integer",
    );
    expect(() => planVirtualTextureUploads([], { borderTexels: -1, pageSize: 128 })).toThrow(
      "Virtual texture upload plan borderTexels must be a non-negative integer",
    );
    expect(() => planVirtualTextureUploads([], { bytesPerTexel: 0, pageSize: 128 })).toThrow(
      "Virtual texture upload plan bytesPerTexel must be a positive integer",
    );
  });
});
