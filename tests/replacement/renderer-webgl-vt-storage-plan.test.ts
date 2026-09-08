import { describe, expect, it } from "vitest";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import {
  planVirtualTextureAtlasStorage,
  virtualTextureResidentPageCapacity,
} from "../../packages/renderer-webgl/src/virtual-texture/storage-plan";

const manifest = (overrides: Record<string, unknown> = {}) => parseVirtualTextureManifest({
  borderTexels: 1,
  contractVersion: 2,
  pageSize: 128,
  pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
  virtualSize: [512, 512],
  ...overrides,
});

describe("VT storage planning core", () => {
  it("uses already-accounted migration headroom without reserving page tables twice", () => {
    const source = manifest();
    const bytes = 8 * 130 * 130 * 4;
    const plan = planVirtualTextureAtlasStorage(source, 4096, bytes, 8, bytes, "migration");
    expect(plan.slotCount).toBe(8);
    expect(plan.allocationBytes).toBe(bytes);
    expect(planVirtualTextureAtlasStorage(source, 4096, bytes, 8, bytes).slotCount).toBeLessThan(8);
  });

  it("starts at demand and permits growth above 32 MiB inside the root allowance", () => {
    const source = manifest({ borderTexels: 2 });
    const available = 256 * 1024 * 1024;
    expect(planVirtualTextureAtlasStorage(source, 16384, available, 1, available * 0.75).slotCount).toBe(1);
    const grown = planVirtualTextureAtlasStorage(source, 16384, available, 1024, available * 0.75);
    expect(grown.slotCount).toBe(1024);
    expect(grown.allocationBytes).toBeGreaterThan(32 * 1024 * 1024);
    expect(grown.allocationBytes).toBeLessThanOrEqual(available * 0.75);
  });
  it("sizes shared capacity from bytes while preserving authored limits", () => {
    const source = manifest({ borderTexels: 2 });
    const plan = planVirtualTextureAtlasStorage(source, 4096, 256 * 1024 * 1024);
    expect(plan.slotCount).toBe(480);
    expect(plan.allocationBytes).toBe(480 * 132 * 132 * 4);
    expect(plan.allocationBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(virtualTextureResidentPageCapacity(source, 4096, plan)).toBe(480);
    expect(virtualTextureResidentPageCapacity(manifest({ physicalSlots: 8 }), 4096, plan)).toBe(8);
  });

  it("caps atlas dimensions on small GPUs", () => {
    const plan = planVirtualTextureAtlasStorage(manifest(), 512, 256 * 1024 * 1024);
    expect(plan.slotCount).toBe(9);
    expect(plan.atlasColumns * plan.storedPageSize).toBeLessThanOrEqual(512);
    expect(plan.atlasRows * plan.storedPageSize).toBeLessThanOrEqual(512);
  });

  it("does not round a 24-page atlas target into 25 pages of storage", () => {
    const source = manifest();
    const bytesPerPage = 130 * 130 * 4;
    const plan = planVirtualTextureAtlasStorage(
      source,
      4096,
      source.tableByteLength + bytesPerPage * 32,
    );

    expect(plan).toMatchObject({
      allocationBytes: bytesPerPage * 24,
      atlasColumns: 4,
      atlasRows: 6,
      slotCount: 24,
      storedPageSize: 130,
    });
  });

  it("uses the largest rectangular pool that does not exceed an odd page budget", () => {
    const source = manifest();
    const bytesPerPage = 130 * 130 * 4;
    const plan = planVirtualTextureAtlasStorage(
      source,
      4096,
      source.tableByteLength + bytesPerPage * 31,
    );

    expect(plan.slotCount).toBe(23);
    expect(plan.atlasColumns * plan.atlasRows).toBe(plan.slotCount);
    expect(plan.allocationBytes).toBeLessThanOrEqual(bytesPerPage * 23);
  });

  it("rejects storage and WebGL limits that cannot represent one page", () => {
    const source = manifest();
    const bytesPerPage = 130 * 130 * 4;

    expect(() => planVirtualTextureAtlasStorage(
      source,
      129,
      source.tableByteLength + bytesPerPage,
    )).toThrow("stored page exceeds");
    expect(() => planVirtualTextureAtlasStorage(
      source,
      4096,
      source.tableByteLength + bytesPerPage - 1,
    )).toThrow("cannot hold one physical page");
  });

  it("bounds each logical resource by authored slots, bytes, atlas, and page-table size", () => {
    const source = manifest({
      physicalByteBudget: 130 * 130 * 4 * 5,
      physicalSlots: 8,
    });
    const atlas = planVirtualTextureAtlasStorage(source, 4096, 32 * 1024 * 1024);

    expect(virtualTextureResidentPageCapacity(source, 4096, atlas)).toBe(5);
    expect(() => virtualTextureResidentPageCapacity(source, 2, atlas))
      .toThrow("page table exceeds");
  });
});
