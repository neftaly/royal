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
