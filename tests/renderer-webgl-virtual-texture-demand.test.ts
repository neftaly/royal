import { describe, expect, it } from "vitest";
import {
  createVirtualTextureDemandPlanningWorkspace,
  isVirtualTextureDemandPageAvailable,
  planVirtualTextureBootstrapDemand,
  planVirtualTextureCoarseToFineDemand,
  planVirtualTextureDrawDemand,
  projectVirtualTextureScreenFootprint,
  selectVirtualTextureFrameWorkingSet,
  selectVirtualTextureWorkingSet,
  stabilizeVirtualTextureDesiredPagesInto,
  virtualTextureDemandModelCount,
  virtualTextureDemandPageGrid,
  virtualTexturePagesForFootprint,
  virtualTextureTargetMip,
  virtualTextureDemandPlanningWorkspaceSnapshot,
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
  options: {
    readonly indices?: Uint8Array | Uint16Array | Uint32Array;
    readonly texCoords?: Float32Array;
  } = {},
): VirtualTextureDrawDemandContext => ({
  ...(options.indices === undefined ? {} : { indices: options.indices }),
  modelSource: { kind: "single", model: identityMat4() },
  positions,
  projection,
  texCoords: options.texCoords ?? new Float32Array([0, 0, 1, 0, 0, 1]),
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

  it("clips a near-plane intersection and derives demand from the visible UV polygon", () => {
    const crossingProjection = [...identityMat4()] as unknown as number[];
    crossingProjection[11] = 1;
    const crossing = context(
      new Float32Array([-0.5, -0.5, -2, 0.5, -0.5, 0, -0.5, 0.5, 0]),
      crossingProjection as unknown as Mat4,
      { texCoords: new Float32Array([1, 1, 0, 0, 0, 0.25]) },
    );
    const projected = projectVirtualTextureScreenFootprint(crossing, true);
    expect(projected.kind).toBe("visible");
    if (projected.kind !== "visible") return;
    expect(projected.footprint.maxU).toBeCloseTo(0.25);
    expect(projected.footprint.maxV).toBeCloseTo(1);
    expect(projected.footprint.minV).toBeCloseTo(0.5625);
    const demand = planVirtualTextureDrawDemand({
      context: crossing,
      flipY: true,
      generated: true,
      limit: 32,
      manifest: manifest(),
    });
    expect(demand.coverageCandidates).not.toEqual([]);
    expect(demand.demandCandidates).not.toEqual(planVirtualTextureBootstrapDemand({
      generated: true,
      manifest: manifest(),
    }, 32));
  });

  it("clips indexed off-center triangles so invisible UVs do not demand opposite pages", () => {
    const clipped = context(
      new Float32Array([
        -3, -0.5, 0,
        0.5, -0.5, 0,
        0.5, 0.5, 0,
        -3, 0.5, 0,
      ]),
      identityMat4(),
      {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
    );
    const projected = projectVirtualTextureScreenFootprint(clipped, false);
    expect(projected.kind).toBe("visible");
    if (projected.kind !== "visible") return;
    expect(projected.footprint.minU).toBeCloseTo(4 / 7);
    expect(projected.footprint.maxU).toBe(1);
    expect(new Set(virtualTexturePagesForFootprint(manifest(), 0, projected.footprint).map((page) => page.x)))
      .toEqual(new Set([2, 3]));
  });

  it("spends limited face-on capacity on coherent, spatially spread refinement", () => {
    const faceOn = context(
      new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      identityMat4(),
      {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
    );
    const source = manifest({ mipCount: 3, uriTemplate: "m{mip}-{x}-{y}.png" });
    const first = planVirtualTextureDrawDemand({ context: faceOn, flipY: false, generated: true, limit: 5, manifest: source });
    const second = planVirtualTextureDrawDemand({ context: faceOn, flipY: false, generated: true, limit: 5, manifest: source });
    expect(first).toEqual(second);
    expect(first.coverageCandidates).toEqual([{ mip: 2, x: 0, y: 0 }]);
    expect(first.demandCandidates[0]).toEqual({ mip: 2, x: 0, y: 0 });
    expect(new Set(first.demandCandidates.slice(1).map((page) => `${page.x}/${page.y}`)))
      .toEqual(new Set(["0/0", "1/0", "0/1", "1/1"]));
  });

  it("refines the near side of an oblique plane more deeply than its far side", () => {
    const perspective = [...identityMat4()] as unknown as number[];
    perspective[10] = 0;
    perspective[11] = 1;
    perspective[15] = 0;
    const oblique = context(
      new Float32Array([
        -0.5, -0.5, 1,
        2, -2, 4,
        2, 2, 4,
        -0.5, 0.5, 1,
      ]),
      perspective as unknown as Mat4,
      {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
    );
    const demand = planVirtualTextureDrawDemand({
      context: oblique,
      flipY: false,
      generated: true,
      limit: 16,
      manifest: manifest({ mipCount: 4, pageSize: 128, uriTemplate: "m{mip}-{x}-{y}.png" }),
    });
    const nearMip = Math.min(...demand.demandCandidates.filter((page) => page.x === 0).map((page) => page.mip));
    const farMip = Math.min(...demand.demandCandidates.filter((page) => (
      page.x === virtualTextureDemandPageGrid(manifest({ mipCount: 4, pageSize: 128 }), page.mip).width - 1
    )).map((page) => page.mip));
    expect(nearMip).toBeLessThan(farMip);
  });

  it("keeps many-triangle hierarchy output bounded and stable across workspace reuse", () => {
    const triangleCount = 256;
    const positions = new Float32Array(triangleCount * 9);
    const texCoords = new Float32Array(triangleCount * 6);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      positions.set([-1, -1, 0, 1, -1, 0, -1, 1, 0], triangle * 9);
      texCoords.set([0, 0, 1, 0, 0, 1], triangle * 6);
    }
    const manyTriangles = context(positions, identityMat4(), { texCoords });
    const input = {
      context: manyTriangles,
      flipY: false,
      generated: true,
      limit: 8,
      manifest: manifest({ mipCount: 3, uriTemplate: "m{mip}-{x}-{y}.png" }),
    } as const;
    const first = planVirtualTextureDrawDemand(input);
    const second = planVirtualTextureDrawDemand(input);
    expect(first.demandCandidates).toHaveLength(8);
    expect(second).toEqual(first);
  });

  it("keeps root-owned planning workspaces isolated with fixed retained memory", () => {
    const first = createVirtualTextureDemandPlanningWorkspace();
    const second = createVirtualTextureDemandPlanningWorkspace();
    const firstComponents = first.visiblePolygonComponents;
    const firstOffsets = first.visiblePolygonOffsets;
    const allocatedBytes = virtualTextureDemandPlanningWorkspaceSnapshot(first).allocatedBytes;
    const triangleCount = 2_000;
    const positions = new Float32Array(triangleCount * 9);
    const texCoords = new Float32Array(triangleCount * 6);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      positions.set([-1, -1, 0, 1, -1, 0, -1, 1, 0], triangle * 9);
      texCoords.set([0, 0, 1, 0, 0, 1], triangle * 6);
    }
    const input = {
      context: context(positions, identityMat4(), { texCoords }),
      flipY: false,
      generated: true,
      limit: 8,
      manifest: manifest({ mipCount: 3, uriTemplate: "m{mip}-{x}-{y}.png" }),
      workspace: first,
    } as const;
    const overflowDemand = planVirtualTextureDrawDemand(input);
    const overflow = virtualTextureDemandPlanningWorkspaceSnapshot(first);
    expect(overflow.overflowed).toBe(true);
    expect(overflow.allocatedBytes).toBe(allocatedBytes);
    expect(overflow.retainedBytes).toBeLessThanOrEqual(32_768 * Float64Array.BYTES_PER_ELEMENT);
    expect(overflowDemand.preferredCandidates).toBeUndefined();
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(second)).toMatchObject({
      overflowed: false,
      retainedBytes: 0,
      retainedPolygons: 0,
    });

    const small = planVirtualTextureDrawDemand({
      ...input,
      context: context(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0])),
    });
    expect(small.preferredCandidates).toBeDefined();
    expect(first.visiblePolygonComponents).toBe(firstComponents);
    expect(first.visiblePolygonOffsets).toBe(firstOffsets);
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(first)).toMatchObject({
      allocatedBytes,
      overflowed: false,
      retainedPolygons: 1,
    });
  });

  it("caps only destructive resident replacements and converges without a wake spin", () => {
    const previous = [0, 1, 2, 3].map((x) => ({ mip: 0, x, y: 0 }));
    const next = [4, 5, 6, 7].map((x) => ({ mip: 0, x, y: 0 }));
    const stabilize = (
      prior: readonly { readonly mip: number; readonly x: number; readonly y: number }[],
      resident: ReadonlySet<string>,
      residentCount: number,
    ) => {
      const pages: Array<{ mip: number; x: number; y: number }> = [];
      const keys = new Set<string>();
      const result = stabilizeVirtualTextureDesiredPagesInto(
        next,
        prior,
        new Set(prior.map((page) => `${page.mip}/${page.x}/${page.y}`)),
        residentCount,
        (page) => resident.has(`${page.mip}/${page.x}/${page.y}`),
        4,
        pages,
        keys,
      );
      return { pages, result };
    };
    const fullResidents = new Set(previous.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const full = stabilize(previous, fullResidents, 4);
    expect(full.result).toEqual({ admissions: 2, deferred: true, retentions: 2 });
    expect(full.pages.slice(0, 2)).toEqual(next.slice(0, 2));

    const underfilled = stabilize(previous, new Set(["0/0/0"]), 1);
    expect(underfilled.pages).toEqual(next);
    expect(underfilled.result).toEqual({ admissions: 4, deferred: false, retentions: 0 });
    const evicted = stabilize(previous, new Set(), 0);
    expect(evicted.pages).toEqual(next);
    expect(evicted.result.deferred).toBe(false);

    let prior = previous;
    let step = full;
    for (let frame = 0; frame < 4 && step.result.deferred; frame += 1) {
      prior = step.pages;
      step = stabilize(prior, new Set(prior.map((page) => `${page.mip}/${page.x}/${page.y}`)), 4);
      expect(step.result.admissions).toBeLessThanOrEqual(2);
    }
    expect(step.pages).toEqual(next);
    expect(step.result.deferred).toBe(false);
    const quiescent = stabilize(step.pages, new Set(next.map((page) => `${page.mip}/${page.x}/${page.y}`)), 4);
    expect(quiescent.result).toEqual({ admissions: 0, deferred: false, retentions: 0 });
  });

  it("does not let one root's planning pass overwrite another root's retained polygons", () => {
    const left = createVirtualTextureDemandPlanningWorkspace();
    const right = createVirtualTextureDemandPlanningWorkspace();
    const leftContext = context(new Float32Array([-1, -1, 0, 0, -1, 0, -1, 1, 0]));
    const rightContext = context(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0]));
    const source = manifest({ mipCount: 3, uriTemplate: "m{mip}-{x}-{y}.png" });
    const leftDemand = planVirtualTextureDrawDemand({ context: leftContext, flipY: false, generated: true, manifest: source, workspace: left });
    const leftSnapshot = virtualTextureDemandPlanningWorkspaceSnapshot(left);
    planVirtualTextureDrawDemand({ context: rightContext, flipY: false, generated: true, manifest: source, workspace: right });
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(left)).toEqual(leftSnapshot);
    expect(planVirtualTextureDrawDemand({ context: leftContext, flipY: false, generated: true, manifest: source, workspace: left }))
      .toEqual(leftDemand);
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
