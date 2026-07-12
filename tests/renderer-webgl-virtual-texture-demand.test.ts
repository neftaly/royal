import { describe, expect, it } from "vitest";
import {
  isVirtualTextureDemandPageAvailable,
  planVirtualTextureBootstrapDemand,
  planVirtualTextureCoarseToFineDemand,
  planVirtualTextureDrawDemand,
  projectVirtualTextureScreenFootprint,
  selectVirtualTextureFrameWorkingSet,
  selectVirtualTextureWorkingSet,
  virtualTextureDemandModelCount,
  virtualTextureDemandPageGrid,
  virtualTexturePagesForFootprint,
  virtualTextureTargetMip,
} from "../packages/renderer-webgl/src/virtual-texture-demand";
import { identityMat4, type Mat4 } from "../packages/renderer-webgl/src/math/mat4";
import type { VirtualTextureDrawDemandContext } from "../packages/renderer-webgl/src/virtual-texture-runtime";
import type { VirtualTextureManifestModel } from "../packages/renderer-webgl/src/virtual-texturing";

const manifest = (overrides: Partial<VirtualTextureManifestModel> = {}): VirtualTextureManifestModel => ({
  height: 1_024,
  pageSize: 256,
  pages: [],
  uriTemplate: "pages/m{mip}-{x}-{y}.png",
  width: 1_024,
  ...overrides,
});

const context = (
  positions: Float32Array,
  projection: Mat4 = identityMat4(),
): VirtualTextureDrawDemandContext => ({
  modelSource: { kind: "single", model: identityMat4() },
  positions,
  projection,
  texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
  view: identityMat4(),
  viewportSize: [1_000, 800],
});

describe("virtual texture pure demand planning", () => {
  it("counts single and composed model sources without renderer state", () => {
    expect(virtualTextureDemandModelCount({ kind: "single", model: identityMat4() })).toBe(1);
    expect(virtualTextureDemandModelCount({
      kind: "composed",
      localModels: [identityMat4(), identityMat4()],
      rootModels: [identityMat4()],
    })).toBe(1);
  });

  it("projects visible geometry and preserves flipY demand orientation", () => {
    const projected = projectVirtualTextureScreenFootprint(
      context(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0])),
      true,
    );
    expect(projected.kind).toBe("visible");
    if (projected.kind !== "visible") return;
    expect(projected.footprint).toMatchObject({ minU: 0, maxU: 1, minV: 0, maxV: 1 });
    expect(projected.footprint.screenWidth).toBe(500);
    expect(projected.footprint.screenHeight).toBe(400);
  });

  it("rejects every non-positive clipW sample and safely culls one-sided offscreen bounds", () => {
    const behindProjection = [...identityMat4()] as unknown as number[];
    behindProjection[15] = -1;
    const behind = projectVirtualTextureScreenFootprint(
      context(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0]), behindProjection as unknown as Mat4),
      true,
    );
    expect(behind).toEqual({ kind: "not-visible" });

    const offscreen = projectVirtualTextureScreenFootprint(
      context(new Float32Array([2, -0.5, 0, 3, -0.5, 0, 2, 0.5, 0])),
      true,
    );
    expect(offscreen).toEqual({ kind: "not-visible" });
    expect(planVirtualTextureDrawDemand({
      context: context(new Float32Array([2, -0.5, 0, 3, -0.5, 0, 2, 0.5, 0])),
      flipY: true,
      generated: true,
      manifest: manifest(),
    })).toEqual({ coverageCandidates: [], demandCandidates: [] });
  });

  it("uses bounded conservative demand when geometry crosses the near plane", () => {
    const crossingProjection = [...identityMat4()] as unknown as number[];
    crossingProjection[11] = 1;
    const crossing = context(
      new Float32Array([-0.5, -0.5, -2, 0.5, -0.5, 0, -0.5, 0.5, 0]),
      crossingProjection as unknown as Mat4,
    );
    expect(projectVirtualTextureScreenFootprint(crossing, true)).toEqual({ kind: "indeterminate" });
    const demand = planVirtualTextureDrawDemand({
      context: crossing,
      flipY: true,
      generated: true,
      limit: 3,
      manifest: manifest(),
    });
    expect(demand.coverageCandidates).toEqual([]);
    expect(demand.demandCandidates).toEqual(planVirtualTextureBootstrapDemand({
      generated: true,
      manifest: manifest(),
    }, 3));
  });

  it("computes mip grids, footprint pages, and target mip deterministically", () => {
    const source = manifest({ height: 768, width: 1_280 });
    expect(virtualTextureDemandPageGrid(source, 0)).toEqual({ height: 3, width: 5 });
    expect(virtualTextureDemandPageGrid(source, 2)).toEqual({ height: 1, width: 2 });
    const footprint = {
      maxU: 0.8,
      maxV: 1,
      minU: 0.2,
      minV: 0,
      screenHeight: 100,
      screenWidth: 100,
    };
    expect(virtualTextureTargetMip(source, footprint)).toBeGreaterThanOrEqual(0);
    expect(virtualTexturePagesForFootprint(source, 2, footprint)).toEqual([
      { mip: 2, x: 0, y: 0 },
      { mip: 2, x: 1, y: 0 },
    ]);
  });

  it("checks sparse page availability independently from demand ordering", () => {
    const sparse: VirtualTextureManifestModel = {
      height: 1_024,
      pageSize: 256,
      pages: [{ mip: 1, uri: "parent.png", x: 0, y: 0 }],
      width: 1_024,
    };
    const pageUrisByKey = new Map([["1/0/0", "parent.png"]]);
    expect(isVirtualTextureDemandPageAvailable({ generated: false, manifest: sparse, pageUrisByKey }, {
      mip: 1,
      x: 0,
      y: 0,
    })).toBe(true);
    expect(isVirtualTextureDemandPageAvailable({ generated: false, manifest: sparse, pageUrisByKey }, {
      mip: 0,
      x: 0,
      y: 0,
    })).toBe(false);
  });

  it("bounds context-free bootstrap before traversing a huge logical address space", () => {
    const huge = manifest({ height: 2 ** 40, pageSize: 1, width: 2 ** 40 });
    expect(planVirtualTextureBootstrapDemand({ generated: true, manifest: huge }, 3)).toEqual([
      { mip: 40, x: 0, y: 0 },
      { mip: 39, x: 0, y: 0 },
      { mip: 39, x: 1, y: 0 },
    ]);
    expect(planVirtualTextureDrawDemand({
      flipY: true,
      generated: true,
      limit: 2,
      manifest: huge,
    }).demandCandidates).toHaveLength(2);
  });

  it("plans coarse-to-fine demand and selects the established target-biased working set", () => {
    const source = { generated: true, manifest: manifest() };
    const footprint = {
      maxU: 1,
      maxV: 1,
      minU: 0,
      minV: 0,
      screenHeight: 1_024,
      screenWidth: 1_024,
    };
    const candidates = planVirtualTextureCoarseToFineDemand(source, 0, footprint, undefined, 5);
    expect(candidates).toEqual([
      { mip: 2, x: 0, y: 0 },
      { mip: 1, x: 0, y: 0 },
      { mip: 1, x: 1, y: 0 },
      { mip: 1, x: 0, y: 1 },
      { mip: 1, x: 1, y: 1 },
    ]);
    expect(selectVirtualTextureWorkingSet(candidates, 3, false)).toEqual([candidates[0]]);
    expect(selectVirtualTextureWorkingSet(candidates, 3, true)).toEqual([
      candidates[0],
      candidates[1],
      candidates[2],
    ]);
    expect(selectVirtualTextureWorkingSet([], 3, true)).toEqual([]);
  });

  it("represents two disjoint XR-eye targets with their common parent at capacity three", () => {
    const parent = { mip: 2, x: 0, y: 0 };
    const left = { mip: 0, x: 0, y: 0 };
    const right = { mip: 0, x: 3, y: 0 };
    expect(selectVirtualTextureFrameWorkingSet([
      { candidates: [parent, left], preferTargetMip: true },
      { candidates: [parent, right], preferTargetMip: true },
    ], 3)).toEqual([parent, left, right]);
  });

  it("deduplicates overlapping submissions while round-robining distinct targets", () => {
    const parent = { mip: 2, x: 0, y: 0 };
    const shared = { mip: 0, x: 1, y: 1 };
    const left = { mip: 0, x: 0, y: 1 };
    const right = { mip: 0, x: 2, y: 1 };
    expect(selectVirtualTextureFrameWorkingSet([
      { candidates: [parent, shared, left], preferTargetMip: true },
      { candidates: [parent, shared, right], preferTargetMip: true },
    ], 4)).toEqual([parent, shared, right, left]);
  });

  it("matches the single-submission selector exactly", () => {
    const candidates = [
      { mip: 3, x: 0, y: 0 },
      { mip: 0, x: 0, y: 0 },
      { mip: 0, x: 1, y: 0 },
      { mip: 0, x: 2, y: 0 },
    ];
    for (const capacity of [0, 1, 2, 4]) {
      for (const preferTargetMip of [false, true]) {
        expect(selectVirtualTextureFrameWorkingSet([
          { candidates, preferTargetMip },
        ], capacity)).toEqual(selectVirtualTextureWorkingSet(candidates, capacity, preferTargetMip));
      }
    }
  });

  it("handles zero and one capacity deterministically", () => {
    const parent = { mip: 2, x: 0, y: 0 };
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const submissions = [
      { candidates: [parent, first], preferTargetMip: true },
      { candidates: [parent, second], preferTargetMip: true },
    ];
    expect(selectVirtualTextureFrameWorkingSet(submissions, 0)).toEqual([]);
    expect(selectVirtualTextureFrameWorkingSet(submissions, 1)).toEqual([parent]);
    expect(selectVirtualTextureFrameWorkingSet(submissions, 2)).toEqual([parent, first]);
    expect(selectVirtualTextureFrameWorkingSet(submissions, 2)).toEqual([parent, first]);
  });

  it("rotates constrained frame capacity across views over successive frames", () => {
    const parent = { mip: 2, x: 0, y: 0 };
    const left = { mip: 0, x: 0, y: 0 };
    const right = { mip: 0, x: 3, y: 0 };
    const submissions = [
      { candidates: [parent, left], preferTargetMip: true },
      { candidates: [parent, right], preferTargetMip: true },
    ];

    const selectedByFrame = Array.from({ length: 4 }, (_value, frame) =>
      selectVirtualTextureFrameWorkingSet(submissions, 2, frame % submissions.length));
    expect(selectedByFrame).toEqual([
      [parent, left],
      [parent, right],
      [parent, left],
      [parent, right],
    ]);
  });

  it("preserves original submission identity when constrained rotation crosses culled views", () => {
    const parent = { mip: 2, x: 0, y: 0 };
    const left = { mip: 0, x: 0, y: 0 };
    const right = { mip: 0, x: 3, y: 0 };
    const submissions = [
      { candidates: [parent, left], preferTargetMip: true },
      { candidates: [], preferTargetMip: true },
      { candidates: [parent, right], preferTargetMip: true },
      { candidates: [], preferTargetMip: true },
    ];

    const selectedByFrame = Array.from({ length: submissions.length }, (_value, frame) =>
      selectVirtualTextureFrameWorkingSet(submissions, 2, frame));
    expect(selectedByFrame).toEqual([
      [parent, left],
      [parent, right],
      [parent, right],
      [parent, left],
    ]);
  });
});
