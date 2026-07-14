import { describe, expect, it } from "vitest";
import {
  maximumVirtualTexturePageTableUploadBytes,
  selectColdVirtualTextureAllocation,
  type VirtualTextureAllocationCandidate,
} from "../packages/renderer-webgl/src/virtual-texture-allocation-policy";
import type { VirtualTextureManifestModel } from "../packages/renderer-webgl/src/virtual-texturing";

const candidate = (
  state: string,
  lastDemandFrame: number,
  admissionTicket: number,
  options: { readonly allocated?: boolean; readonly demanded?: boolean } = {},
): VirtualTextureAllocationCandidate<string> => ({
  admissionTicket,
  allocated: options.allocated ?? true,
  demanded: options.demanded ?? false,
  lastDemandFrame,
  state,
});

describe("virtual-texture allocation reclamation policy", () => {
  it("never reclaims demanded or unallocated resources", () => {
    expect(selectColdVirtualTextureAllocation([
      candidate("demanded", Number.NEGATIVE_INFINITY, 0, { demanded: true }),
      candidate("unallocated", Number.NEGATIVE_INFINITY, 1, { allocated: false }),
    ], 100)).toEqual({ graceBlocked: false });
  });

  it("protects recently demanded allocations through the inclusive two-frame grace", () => {
    expect(selectColdVirtualTextureAllocation([candidate("warm", 8, 0)], 10)).toEqual({
      graceBlocked: true,
    });
    expect(selectColdVirtualTextureAllocation([candidate("cold", 7, 0)], 10)).toEqual({
      graceBlocked: false,
      state: "cold",
    });
  });

  it("prefers never-demanded, then oldest-demanded, then earliest-admitted resources", () => {
    const candidates = [
      candidate("new-ticket", 4, 9),
      candidate("old-ticket", 4, 2),
      candidate("never", Number.NEGATIVE_INFINITY, 20),
    ];
    expect(selectColdVirtualTextureAllocation(candidates, 20)).toMatchObject({ state: "never" });

    const withoutNever = candidates.slice(0, 2);
    expect(selectColdVirtualTextureAllocation(withoutNever, 20)).toMatchObject({ state: "old-ticket" });
    expect(selectColdVirtualTextureAllocation(withoutNever.reverse(), 20)).toMatchObject({
      state: "old-ticket",
    });
  });

  it("reports grace pressure even when an older allocation can be reclaimed", () => {
    expect(selectColdVirtualTextureAllocation([
      candidate("warm", 19, 0),
      candidate("cold", 3, 1),
    ], 20)).toEqual({ graceBlocked: true, state: "cold" });
  });
});

describe("virtual-texture page-table upload sizing", () => {
  const manifest = (overrides: Partial<VirtualTextureManifestModel> = {}): VirtualTextureManifestModel => ({
    borderTexels: 0,
    height: 513,
    pageAddressing: "complete",
    pageEncoding: "image",
    pageSize: 256,
    pages: [],
    width: 1025,
    ...overrides,
  });

  it("budgets the complete base table for generated and templated sources", () => {
    expect(maximumVirtualTexturePageTableUploadBytes(manifest())).toBe(5 * 3 * 4);
    expect(maximumVirtualTexturePageTableUploadBytes(manifest({ uriTemplate: "{mip}/{x}/{y}" })))
      .toBe(5 * 3 * 4);
  });

  it("budgets only the largest clamped coverage update for explicit pages", () => {
    expect(maximumVirtualTexturePageTableUploadBytes(manifest({
      pageAddressing: "sparse",
      pages: [
        { mip: 0, uri: "small", x: 0, y: 0 },
        { mip: 1, uri: "largest", x: 1, y: 0 },
        { mip: 2, uri: "edge", x: 1, y: 0 },
      ],
    }))).toBe(2 * 2 * 4);
    expect(maximumVirtualTexturePageTableUploadBytes(manifest({ pageAddressing: "sparse" }))).toBe(0);
  });
});
