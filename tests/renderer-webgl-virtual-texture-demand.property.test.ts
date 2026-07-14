import { describe, expect, it } from "vitest";
import {
  createVirtualTextureDemandPlanningWorkspace,
  isVirtualTextureDemandPageAvailable,
  planVirtualTextureBootstrapDemand,
  planVirtualTextureCoarseToFineDemand,
  planVirtualTextureDrawDemand,
  prepareVirtualTextureCoverageProvider,
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
import { perspectiveCamera } from "@royal/renderer-core";
import {
  identityMat4,
  projectionMat4,
  viewMat4,
  type Mat4,
} from "../packages/renderer-webgl/src/math/mat4";
import type { VirtualTextureDrawDemandContext } from "../packages/renderer-webgl/src/virtual-texture-runtime";
import type { VirtualTextureManifestModel } from "../packages/renderer-webgl/src/virtual-texturing";
import { forEachFuzzCase } from "./fuzz";

const manifest = (overrides: Partial<VirtualTextureManifestModel> = {}): VirtualTextureManifestModel => ({
  height: 1_024,
  pageAddressing: "complete",
  pageSize: 256,
  pages: [],
  uriTemplate: "pages/m{mip}-{x}-{y}.png",
  width: 1_024,
  ...overrides,
  borderTexels: overrides.borderTexels ?? 1,
});

const context = (
  positions: Float32Array,
  projection: Mat4 = identityMat4(),
  options: {
    readonly indices?: Uint8Array | Uint16Array | Uint32Array;
    readonly texCoords?: Float32Array;
  } = {},
): VirtualTextureDrawDemandContext => ({
  modelSource: { kind: "single", model: identityMat4() },
  projection,
  provider: prepareVirtualTextureCoverageProvider({
    ...(options.indices === undefined ? {} : { indices: options.indices }),
    positions,
    texCoords: options.texCoords ?? new Float32Array([0, 0, 1, 0, 0, 1]),
  }),
  view: identityMat4(),
  viewportSize: [1_000, 800],
});

describe("virtual texture pure demand planning", () => {
  it("counts single and composed model sources without renderer state", () => {
    expect(virtualTextureDemandModelCount({ kind: "single", model: identityMat4() })).toBe(1);
    expect(() => virtualTextureDemandModelCount({
      kind: "composed",
      localModels: [identityMat4(), identityMat4()],
      rootModels: [identityMat4()],
    })).toThrow("matching lengths");
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

  it("rejects non-finite UV input without retaining a malformed finest region", () => {
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const workspace = createVirtualTextureDemandPlanningWorkspace();
      const invalid = context(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0]),
        identityMat4(),
        { texCoords: new Float32Array([nonFinite, 0, 1, 0, 0, 1]) },
      );
      expect(projectVirtualTextureScreenFootprint(invalid, false, workspace, manifest())).toEqual({
        kind: "indeterminate",
      });
      expect(virtualTextureDemandPlanningWorkspaceSnapshot(workspace).finestRegionCount).toBe(0);
      expect(planVirtualTextureDrawDemand({
        context: invalid,
        flipY: false,
        limit: 4,
        manifest: manifest(),
      })).toEqual({
        coverageCandidates: [],
        demandCandidates: planVirtualTextureBootstrapDemand({
          manifest: manifest(),
        }, 4),
      });
    }
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
      limit: 32,
      manifest: manifest(),
    });
    expect(demand.coverageCandidates).not.toEqual([]);
    expect(demand.demandCandidates).not.toEqual(planVirtualTextureBootstrapDemand({
      manifest: manifest(),
    }, 32));
  });

  it("refines a large textured plane monotonically as the viewer approaches the near plane", () => {
    const projection = projectionMat4(perspectiveCamera({
      far: 100,
      fovY: Math.PI / 3,
      near: 0.1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }), 1_000, 800);
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const demandAtDistance = (distance: number) => planVirtualTextureDrawDemand({
      context: context(
        new Float32Array([
          -10, -10, -distance,
          10, -10, -distance,
          10, 10, -distance,
          -10, 10, -distance,
        ]),
        projection,
        {
          indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
          texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        },
      ),
      flipY: false,
      limit: 32,
      manifest: source,
    });
    const mipAtDistance = (distance: number): number => Math.min(
      ...demandAtDistance(distance).demandCandidates.map((page) => page.mip),
    );

    const distantMip = mipAtDistance(10);
    const nearMip = mipAtDistance(1);
    const headsetCloseMip = mipAtDistance(0.101);
    expect(nearMip).toBeLessThanOrEqual(distantMip);
    expect(headsetCloseMip).toBeLessThanOrEqual(nearMip);
    expect(headsetCloseMip).toBe(0);
    expect(demandAtDistance(0.101).coverageCandidates).not.toEqual([]);
  });

  it("keeps near-field refinement on a grazing ground plane with a visible horizon", () => {
    const camera = perspectiveCamera({
      far: 1_000,
      fovY: Math.PI / 2,
      near: 0.01,
      position: [0, 0.2, 0],
      rotation: [-0.2, 0, 0],
    });
    const ground = context(
      new Float32Array([
        -100, 0, -100,
        100, 0, -100,
        100, 0, 100,
        -100, 0, 100,
      ]),
      projectionMat4(camera, 1_800, 1_800),
      {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
    );
    const demand = planVirtualTextureDrawDemand({
      context: { ...ground, view: viewMat4(camera), viewportSize: [1_800, 1_800] },
      flipY: false,
      limit: 32,
      manifest: manifest({
        height: 16_384,
        mipCount: 7,
        pageSize: 256,
        uriTemplate: "m{mip}-{x}-{y}.png",
        width: 16_384,
      }),
    });

    expect(demand.coverageCandidates).not.toEqual([]);
    expect(demand.demandCandidates).not.toEqual([]);
    expect(Math.min(...demand.demandCandidates.map((page) => page.mip))).toBe(0);
  });

  it("keeps demand bounded while a large plane crosses the perspective near and eye planes", () => {
    const projection = projectionMat4(perspectiveCamera({
      far: 100,
      fovY: Math.PI / 2,
      near: 0.1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }), 1_600, 1_600);
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const demandAtNearEdge = (nearEdgeZ: number) => planVirtualTextureDrawDemand({
      context: context(
        new Float32Array([
          -4, -4, nearEdgeZ,
          4, -4, nearEdgeZ,
          4, 4, -2,
          -4, 4, -2,
        ]),
        projection,
        {
          indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
          texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        },
      ),
      flipY: false,
      limit: 16,
      manifest: source,
    });

    for (const nearEdgeZ of [-0.2, -0.1, -0.05, 0, 0.2]) {
      const first = demandAtNearEdge(nearEdgeZ);
      const repeated = demandAtNearEdge(nearEdgeZ);
      expect(repeated, `stable at near edge z=${nearEdgeZ}`).toEqual(first);
      expect(first.coverageCandidates?.length ?? 0).toBeLessThanOrEqual(16);
      expect(first.demandCandidates.length).toBeGreaterThan(0);
      expect(first.demandCandidates.length).toBeLessThanOrEqual(16);
      expect(first.demandCandidates.every((page) => (
        Number.isInteger(page.mip) && Number.isInteger(page.x) && Number.isInteger(page.y)
      ))).toBe(true);
    }
  });

  it("bounds a huge repeated ground address range without losing close demand", () => {
    const camera = perspectiveCamera({
      far: 10_000,
      fovY: Math.PI / 2,
      near: 0.01,
      position: [0, 0.15, 0],
      rotation: [-0.25, 0, 0],
    });
    const repeatedGround: VirtualTextureDrawDemandContext = {
      ...context(
        new Float32Array([
          -5_000, 0, -5_000,
          5_000, 0, -5_000,
          5_000, 0, 5_000,
          -5_000, 0, 5_000,
        ]),
        projectionMat4(camera, 2_048, 2_048),
        {
          indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
          texCoords: new Float32Array([0, 0, 10_000, 0, 10_000, 10_000, 0, 10_000]),
        },
      ),
      view: viewMat4(camera),
      viewportSize: [2_048, 2_048],
      wrapS: "repeat",
      wrapT: "repeat",
    };
    const input = {
      context: repeatedGround,
      flipY: false,
      limit: 16,
      manifest: manifest({
        height: 16_384,
        mipCount: 7,
        pageSize: 256,
        uriTemplate: "m{mip}-{x}-{y}.png",
        width: 16_384,
      }),
    } as const;

    const first = planVirtualTextureDrawDemand(input);
    expect(planVirtualTextureDrawDemand(input)).toEqual(first);
    expect(first.retentionOverflowed).toBe(true);
    expect(first.coverageCandidates?.length ?? 0).toBeLessThanOrEqual(16);
    expect(first.demandCandidates.length).toBeGreaterThan(0);
    expect(first.demandCandidates.length).toBeLessThanOrEqual(16);
  });

  it("reuses fixed planning memory through rapid viewport and near-field churn", () => {
    const workspace = createVirtualTextureDemandPlanningWorkspace();
    const allocatedBytes = virtualTextureDemandPlanningWorkspaceSnapshot(workspace).allocatedBytes;
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const baseContext = context(
      new Float32Array([-4, -4, -0.11, 4, -4, -0.11, 4, 4, -4, -4, 4, -4]),
      projectionMat4(perspectiveCamera({
        far: 100,
        fovY: Math.PI / 2,
        near: 0.1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }), 1_800, 1_800),
      {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
    );
    const sizes = [[1_800, 1_800], [320, 2_400], [4_096, 256], [1, 1], [0, 0]] as const;
    const outputs = sizes.map((viewportSize) => planVirtualTextureDrawDemand({
      context: { ...baseContext, viewportSize },
      flipY: false,
      limit: 8,
      manifest: source,
      workspace,
    }));

    expect(outputs.slice(0, -1).every((demand) => (
      demand.demandCandidates.length > 0 && demand.demandCandidates.length <= 8
    ))).toBe(true);
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(workspace)).toMatchObject({
      allocatedBytes,
      overflowed: false,
      retainedBytes: 0,
      retainedPolygons: 0,
    });
    expect(planVirtualTextureDrawDemand({
      context: { ...baseContext, viewportSize: sizes[0] },
      flipY: false,
      limit: 8,
      manifest: source,
      workspace,
    })).toEqual(outputs[0]);
  });

  it("maps close repeated and mirrored UV tiles into the shader-visible demand address space", () => {
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const tiledContext = (
      tile: number,
      wrap: "mirrored-repeat" | "repeat",
    ): VirtualTextureDrawDemandContext => ({
      ...context(
        new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0]),
        identityMat4(),
        {
          texCoords: new Float32Array([
            tile + 0.4, tile + 0.4,
            tile + 0.41, tile + 0.4,
            tile + 0.4, tile + 0.41,
          ]),
        },
      ),
      wrapS: wrap,
      wrapT: wrap,
    });
    const demand = (tile: number, wrap: "mirrored-repeat" | "repeat") => planVirtualTextureDrawDemand({
      context: tiledContext(tile, wrap),
      flipY: false,
      limit: 32,
      manifest: source,
    });

    const repeated = demand(50, "repeat");
    const mirrored = demand(49, "mirrored-repeat");
    expect(Math.min(...repeated.demandCandidates.map((page) => page.mip))).toBe(0);
    expect(Math.min(...mirrored.demandCandidates.map((page) => page.mip))).toBe(0);
    expect(repeated.demandCandidates.some((page) => page.mip === 0 && page.x === 25 && page.y === 25)).toBe(true);
    expect(mirrored.demandCandidates.some((page) => page.mip === 0 && page.x === 38 && page.y === 38)).toBe(true);
  });

  it("keeps sampler discontinuity demand conservative and bounded", () => {
    const crossing = {
      ...context(
        new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0]),
        identityMat4(),
        { texCoords: new Float32Array([0.995, 0.4, 1.005, 0.4, 0.995, 0.41]) },
      ),
      wrapS: "repeat" as const,
    };
    const demand = planVirtualTextureDrawDemand({
      context: crossing,
      flipY: false,
      limit: 8,
      manifest: manifest({
        height: 16_384,
        mipCount: 7,
        pageSize: 256,
        uriTemplate: "m{mip}-{x}-{y}.png",
        width: 16_384,
      }),
    });

    expect(demand.retentionOverflowed).toBe(true);
    expect(demand.coverageCandidates?.length).toBeLessThanOrEqual(8);
    expect(demand.demandCandidates).not.toEqual([]);
    expect(demand.demandCandidates.length).toBeLessThanOrEqual(8);
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
    const first = planVirtualTextureDrawDemand({ context: faceOn, flipY: false, limit: 5, manifest: source });
    const second = planVirtualTextureDrawDemand({ context: faceOn, flipY: false, limit: 5, manifest: source });
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
      limit: 8,
      manifest: manifest({ mipCount: 3, uriTemplate: "m{mip}-{x}-{y}.png" }),
      workspace: first,
    } as const;
    const overflowDemand = planVirtualTextureDrawDemand(input);
    const overflow = virtualTextureDemandPlanningWorkspaceSnapshot(first);
    expect(overflow.overflowed).toBe(true);
    expect(overflow.allocatedBytes).toBe(allocatedBytes);
    expect(overflow.retainedBytes).toBeLessThanOrEqual(32_768 * Float64Array.BYTES_PER_ELEMENT);
    expect(overflowDemand.retentionOverflowed).toBe(true);
    expect(overflowDemand.preferredCandidates).toHaveLength(8);
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

  it("keeps bounded near-side refinement when an oblique terrain exceeds retained polygons", () => {
    const farTriangleCount = 2_000;
    const positions = new Float32Array((farTriangleCount + 1) * 9);
    const texCoords = new Float32Array((farTriangleCount + 1) * 6);
    for (let triangle = 0; triangle < farTriangleCount; triangle += 1) {
      positions.set([0, -2, 4, 2, -2, 4, 0, 2, 4], triangle * 9);
      texCoords.set([0.1, 0, 1, 0, 0.1, 1], triangle * 6);
    }
    positions.set([-0.5, -0.5, 1, 0, -0.5, 1, -0.5, 0.5, 1], farTriangleCount * 9);
    texCoords.set([0, 0, 0.1, 0, 0, 0.1], farTriangleCount * 6);
    const perspective = [...identityMat4()] as unknown as number[];
    perspective[10] = 0;
    perspective[11] = 1;
    perspective[15] = 0;
    const workspace = createVirtualTextureDemandPlanningWorkspace();
    const terrainContext = context(positions, perspective as unknown as Mat4, { texCoords });
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const input = {
      context: terrainContext,
      flipY: false,
      limit: 8,
      manifest: source,
      workspace,
    } as const;

    const first = planVirtualTextureDrawDemand(input);
    const firstSnapshot = virtualTextureDemandPlanningWorkspaceSnapshot(workspace);
    const second = planVirtualTextureDrawDemand(input);
    expect(second).toEqual(first);
    expect(first.retentionOverflowed).toBe(true);
    expect(firstSnapshot.overflowed).toBe(true);
    expect(first.demandCandidates.length).toBeLessThanOrEqual(8);
    expect(first.coverageCandidates?.length).toBeLessThanOrEqual(8);
    expect(first.preferredCandidates?.length).toBeLessThanOrEqual(8);
    expect(firstSnapshot.finestObservedMip).toBeDefined();
    const globalFallbackMip = Math.min(...first.demandCandidates.map((page) => page.mip));
    const nearMip = Math.min(...(first.preferredCandidates ?? []).map((page) => page.mip));
    expect(nearMip).toBe(firstSnapshot.finestObservedMip);
    expect(nearMip).toBeLessThan(globalFallbackMip);
    const selected = selectVirtualTextureFrameWorkingSet([{
      candidates: first.demandCandidates,
      preferTargetMip: true,
      preferredCandidates: first.preferredCandidates!,
    }], 4);
    expect(selected[0]).toEqual(first.demandCandidates[0]);
    expect(Math.min(...selected.slice(1).map((page) => page.mip))).toBe(nearMip);

    const resized = planVirtualTextureDrawDemand({
      ...input,
      context: { ...terrainContext, viewportSize: [500, 400] },
    });
    const resizedMip = Math.min(...(resized.preferredCandidates ?? []).map((page) => page.mip));
    expect(resized.retentionOverflowed).toBe(true);
    expect(resizedMip).toBeGreaterThanOrEqual(nearMip);
    planVirtualTextureDrawDemand({
      ...input,
      context: { ...terrainContext, viewportSize: [0, 0] },
    });
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(workspace)).toMatchObject({
      overflowed: false,
      retainedBytes: 0,
      retainedPolygons: 0,
    });
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(workspace).finestObservedMip).toBeUndefined();
    expect(planVirtualTextureDrawDemand(input)).toEqual(first);
  });

  it("bounds overflow fallback work for a huge sparse explicit address space", () => {
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
      limit: 4,
      manifest: {
        borderTexels: 1,
        height: 1_073_741_824,
        mipCount: 31,
        pageAddressing: "sparse",
        pageSize: 1,
        pages: [{ mip: 30, uri: "only-page.png", x: 0, y: 0 }],
        width: 1_073_741_824,
      },
    } as const;
    const first = planVirtualTextureDrawDemand(input);
    expect(first.retentionOverflowed).toBe(true);
    expect(first.coverageCandidates?.length).toBeLessThanOrEqual(4);
    expect(first.demandCandidates.length).toBeLessThanOrEqual(4);
    expect(first.preferredCandidates?.length ?? 0).toBeLessThanOrEqual(4);
    expect(planVirtualTextureDrawDemand(input)).toEqual(first);
  });

  it("bounds non-overflow demand for a 2^30 sparse address space by authored entries", () => {
    const huge = {
      borderTexels: 1,
      height: 2 ** 30,
      mipCount: 31,
      pageAddressing: "sparse",
      pageSize: 1,
      pages: [],
      width: 2 ** 30,
    } satisfies VirtualTextureManifestModel;
    const faceOn = context(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0]));
    const projected = projectVirtualTextureScreenFootprint(faceOn, false);
    expect(projected.kind).toBe("visible");
    if (projected.kind !== "visible") return;
    const targetMip = virtualTextureTargetMip(huge, projected.footprint);
    const targetGrid = virtualTextureDemandPageGrid(huge, targetMip);
    const sparse: VirtualTextureManifestModel = {
      ...huge,
      pages: [
        { mip: 30, uri: "root.png", x: 0, y: 0 },
        { mip: targetMip, uri: "first.png", x: 0, y: 0 },
        {
          mip: targetMip,
          uri: "last.png",
          x: targetGrid.width - 1,
          y: targetGrid.height - 1,
        },
      ],
    };

    const demand = planVirtualTextureDrawDemand({
      context: faceOn,
      flipY: false,
      limit: 4,
      manifest: sparse,
    });

    expect(demand.retentionOverflowed).toBeUndefined();
    expect(demand.coverageCandidates).toEqual(sparse.pages.slice(1));
    expect(demand.demandCandidates).toEqual(sparse.pages);
  });

  it("bounds a truncated huge template hierarchy without a terminal 1x1 mip", () => {
    const truncated: VirtualTextureManifestModel = {
      borderTexels: 1,
      height: 2 ** 30,
      mipCount: 2,
      pageAddressing: "complete",
      pageSize: 1,
      pages: [],
      uriTemplate: "pages/{mip}/{x}/{y}.png",
      width: 2 ** 30,
    };
    const input = {
      context: context(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0])),
      flipY: false,
      limit: 4,
      manifest: truncated,
    } as const;

    const first = planVirtualTextureDrawDemand(input);
    expect(first.retentionOverflowed).toBeUndefined();
    expect(first.coverageCandidates).toHaveLength(4);
    expect(first.demandCandidates).toHaveLength(4);
    expect(first.coverageCandidates?.every((page) => page.mip === 1)).toBe(true);
    expect(planVirtualTextureDrawDemand(input)).toEqual(first);
  });

  it("keeps disjoint finest regions localized independent of reversed index and model ordering", () => {
    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, -1, 1, 0,
      -1, -1, 0, 1, -1, 0, -1, 1, 0,
    ]);
    const texCoords = new Float32Array([
      0, 0, 0.25, 0, 0, 0.25,
      0.75, 0.75, 1, 0.75, 0.75, 1,
    ]);
    const triangleOrder = (first: readonly number[], second: readonly number[]): Uint16Array =>
      new Uint16Array(Array.from({ length: 1_000 }, () => [...first, ...second]).flat());
    const large = identityMat4();
    const small = identityMat4();
    small[0] = 0.25;
    small[5] = 0.25;
    const rootModel = identityMat4();
    const demandContext = (
      indices: Uint16Array,
      localModels: readonly Mat4[],
    ): VirtualTextureDrawDemandContext => ({
      modelSource: {
        kind: "composed",
        localModels,
        rootModels: localModels.map(() => rootModel),
      },
      projection: identityMat4(),
      provider: prepareVirtualTextureCoverageProvider({ indices, positions, texCoords }),
      view: identityMat4(),
      viewportSize: [1_000, 800],
    });
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const forwardWorkspace = createVirtualTextureDemandPlanningWorkspace();
    const reverseWorkspace = createVirtualTextureDemandPlanningWorkspace();
    const forward = planVirtualTextureDrawDemand({
      context: demandContext(triangleOrder([0, 1, 2], [3, 4, 5]), [small, large]),
      flipY: false,
      limit: 8,
      manifest: source,
      workspace: forwardWorkspace,
    });
    const reverse = planVirtualTextureDrawDemand({
      context: demandContext(triangleOrder([3, 4, 5], [0, 1, 2]), [large, small]),
      flipY: false,
      limit: 8,
      manifest: source,
      workspace: reverseWorkspace,
    });

    expect(forward.retentionOverflowed).toBe(true);
    expect(reverse).toEqual(forward);
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(reverseWorkspace).finestObservedMip).toBe(
      virtualTextureDemandPlanningWorkspaceSnapshot(forwardWorkspace).finestObservedMip,
    );
    expect(forwardWorkspace.finestRegionCount).toBe(2);
    const preferred = forward.preferredCandidates ?? [];
    const normalizedCenters = preferred.map((page) => {
      const grid = virtualTextureDemandPageGrid(source, page.mip);
      return {
        u: (page.x + 0.5) / grid.width,
        v: (page.y + 0.5) / grid.height,
      };
    });
    expect(normalizedCenters.some(({ u, v }) => u <= 0.25 && v <= 0.25)).toBe(true);
    expect(normalizedCenters.some(({ u, v }) => u >= 0.75 && v >= 0.75)).toBe(true);
    expect(normalizedCenters.every(({ u, v }) => (
      (u <= 0.25 && v <= 0.25) || (u >= 0.75 && v >= 0.75)
    ))).toBe(true);
  });

  it("keeps the four largest equal-mip regions in a deterministic bounded frontier", () => {
    const sizes = [0.95, 0.85, 0.75, 0.65, 0.55];
    const positions = new Float32Array(sizes.flatMap((size) => [
      -size, -size, 0,
      size, -size, 0,
      -size, size, 0,
    ]));
    const texCoords = new Float32Array(sizes.flatMap((_size, index) => {
      const min = index * 0.2;
      const max = min + 0.1;
      return [min, min, max, min, min, max];
    }));
    const triangleGroups = sizes.map((_size, index) => [index * 3, index * 3 + 1, index * 3 + 2]);
    const indices = (groups: readonly (readonly number[])[]): Uint16Array =>
      new Uint16Array(Array.from({ length: 400 }, () => groups.flat()).flat());
    const source = manifest({
      height: 16_384,
      mipCount: 7,
      pageSize: 256,
      uriTemplate: "m{mip}-{x}-{y}.png",
      width: 16_384,
    });
    const demand = (groups: readonly (readonly number[])[]) => planVirtualTextureDrawDemand({
      context: context(positions, identityMat4(), { indices: indices(groups), texCoords }),
      flipY: false,
      limit: 8,
      manifest: source,
    });

    const forward = demand(triangleGroups);
    const reverse = demand([...triangleGroups].reverse());
    expect(forward.retentionOverflowed).toBe(true);
    expect(reverse).toEqual(forward);
    const preferredCenters = (forward.preferredCandidates ?? []).map((page) => {
      const grid = virtualTextureDemandPageGrid(source, page.mip);
      return (page.x + 0.5) / grid.width;
    });
    for (const retainedCenter of [0.05, 0.25, 0.45, 0.65]) {
      expect(preferredCenters.some((center) => Math.abs(center - retainedCenter) <= 0.06)).toBe(true);
    }
    expect(preferredCenters.every((center) => center < 0.8)).toBe(true);
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
    expect(underfilled.result).toEqual({ admissions: 4, deferred: true, retentions: 0 });
    const evicted = stabilize(previous, new Set(), 0);
    expect(evicted.pages).toEqual(next);
    expect(evicted.result.deferred).toBe(true);

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

  it("publishes an exact small or empty working set instead of filling it from old residency", () => {
    const previous = [0, 1, 2, 3].map((x) => ({ mip: 0, x, y: 0 }));
    const previousKeys = new Set(previous.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const stabilize = (working: readonly { readonly mip: number; readonly x: number; readonly y: number }[]) => {
      const pages: Array<{ mip: number; x: number; y: number }> = [];
      const keys = new Set<string>();
      const result = stabilizeVirtualTextureDesiredPagesInto(
        working,
        previous,
        previousKeys,
        previous.length,
        (page) => previousKeys.has(`${page.mip}/${page.x}/${page.y}`),
        previous.length,
        pages,
        keys,
      );
      return { pages, result };
    };

    expect(stabilize([previous[2]!])).toEqual({
      pages: [previous[2]],
      result: { admissions: 0, deferred: false, retentions: 0 },
    });
    expect(stabilize([])).toEqual({
      pages: [],
      result: { admissions: 0, deferred: false, retentions: 0 },
    });
  });

  it("keeps transition overlap only while a two-page replacement is deferred", () => {
    const previous = [0, 1, 2, 3].map((x) => ({ mip: 0, x, y: 0 }));
    const next = [4, 5, 6, 7].map((x) => ({ mip: 0, x, y: 0 }));
    const residentKeys = new Set(previous.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const firstPages: Array<{ mip: number; x: number; y: number }> = [];
    const firstKeys = new Set<string>();
    const first = stabilizeVirtualTextureDesiredPagesInto(
      next,
      previous,
      residentKeys,
      4,
      (page) => residentKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      firstPages,
      firstKeys,
    );
    expect(first).toEqual({ admissions: 2, deferred: true, retentions: 2 });
    expect(firstPages).toEqual([next[0], next[1], previous[0], previous[1]]);

    const secondPages: Array<{ mip: number; x: number; y: number }> = [];
    const secondKeys = new Set<string>();
    const second = stabilizeVirtualTextureDesiredPagesInto(
      next,
      firstPages,
      firstKeys,
      4,
      (page) => residentKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      secondPages,
      secondKeys,
    );
    expect(second).toEqual({ admissions: 0, deferred: true, retentions: 2 });
    expect(secondPages).toEqual(firstPages);

    const loadedKeys = new Set([...residentKeys, ...next.slice(0, 2).map((page) => `${page.mip}/${page.x}/${page.y}`)]);
    const thirdPages: Array<{ mip: number; x: number; y: number }> = [];
    const thirdKeys = new Set<string>();
    const third = stabilizeVirtualTextureDesiredPagesInto(
      next,
      secondPages,
      secondKeys,
      4,
      (page) => loadedKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      thirdPages,
      thirdKeys,
    );
    expect(third).toEqual({ admissions: 2, deferred: true, retentions: 0 });
    expect(thirdPages).toEqual(next);

    const allLoadedKeys = new Set(next.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const settledPages: Array<{ mip: number; x: number; y: number }> = [];
    const settledKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      next,
      thirdPages,
      thirdKeys,
      4,
      (page) => allLoadedKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      settledPages,
      settledKeys,
    )).toEqual({ admissions: 0, deferred: false, retentions: 0 });
    expect(settledPages).toEqual(next);
  });

  it("skips a terminal admission and continues bounded replacement convergence", () => {
    const failed = { mip: 0, x: 4, y: 0 };
    const healthy = [5, 6, 7, 8].map((x) => ({ mip: 0, x, y: 0 }));
    const old = [0, 1, 2].map((x) => ({ mip: 0, x, y: 0 }));
    const previous = [failed, ...old];
    const previousKeys = new Set(previous.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const oldResidentKeys = new Set(old.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const transitionPages: Array<{ mip: number; x: number; y: number }> = [];
    const transitionKeys = new Set<string>();

    expect(stabilizeVirtualTextureDesiredPagesInto(
      [failed, ...healthy],
      previous,
      previousKeys,
      4,
      (page) => oldResidentKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      transitionPages,
      transitionKeys,
      (page) => page !== failed,
    )).toEqual({ admissions: 2, deferred: true, retentions: 2 });
    expect(transitionPages).toEqual([healthy[0], healthy[1], old[0], old[1]]);

    const firstHealthyResidents = new Set([
      ...oldResidentKeys,
      ...healthy.slice(0, 2).map((page) => `${page.mip}/${page.x}/${page.y}`),
    ]);
    const finalTransitionPages: Array<{ mip: number; x: number; y: number }> = [];
    const finalTransitionKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      [failed, ...healthy],
      transitionPages,
      transitionKeys,
      4,
      (page) => firstHealthyResidents.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      finalTransitionPages,
      finalTransitionKeys,
      (page) => page !== failed,
    )).toEqual({ admissions: 2, deferred: true, retentions: 0 });
    expect(finalTransitionPages).toEqual(healthy);

    const healthyResidentKeys = new Set(healthy.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const settledPages: Array<{ mip: number; x: number; y: number }> = [];
    const settledKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      [failed, ...healthy],
      finalTransitionPages,
      finalTransitionKeys,
      4,
      (page) => healthyResidentKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      settledPages,
      settledKeys,
      (page) => page !== failed,
    )).toEqual({ admissions: 0, deferred: false, retentions: 0 });
    expect(settledPages).toEqual(healthy);
  });

  it("retains sparse disjoint coverage until a smaller target set is resident", () => {
    const previous = [
      { mip: 3, x: 0, y: 0 },
      { mip: 2, x: 7, y: 1 },
    ];
    const next = [
      { mip: 1, x: 1, y: 6 },
      { mip: 0, x: 11, y: 3 },
    ];
    const previousKeys = new Set(previous.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const transitionPages: Array<{ mip: number; x: number; y: number }> = [];
    const transitionKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      next,
      previous,
      previousKeys,
      4,
      (page) => previousKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      transitionPages,
      transitionKeys,
    )).toEqual({ admissions: 2, deferred: true, retentions: 2 });
    expect(transitionPages).toEqual([...next, ...previous]);

    const repeatedPages: Array<{ mip: number; x: number; y: number }> = [];
    const repeatedKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      next,
      transitionPages,
      transitionKeys,
      4,
      (page) => previousKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      repeatedPages,
      repeatedKeys,
    )).toEqual({ admissions: 0, deferred: true, retentions: 2 });
    expect(repeatedPages).toEqual(transitionPages);

    const nextKeys = new Set(next.map((page) => `${page.mip}/${page.x}/${page.y}`));
    const settledPages: Array<{ mip: number; x: number; y: number }> = [];
    const settledKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      next,
      repeatedPages,
      repeatedKeys,
      4,
      (page) => nextKeys.has(`${page.mip}/${page.x}/${page.y}`),
      4,
      settledPages,
      settledKeys,
    )).toEqual({ admissions: 0, deferred: false, retentions: 0 });
    expect(settledPages).toEqual(next);
  });

  it("does not let one root's planning pass overwrite another root's retained polygons", () => {
    const left = createVirtualTextureDemandPlanningWorkspace();
    const right = createVirtualTextureDemandPlanningWorkspace();
    const leftContext = context(new Float32Array([-1, -1, 0, 0, -1, 0, -1, 1, 0]));
    const rightContext = context(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0]));
    const source = manifest({ mipCount: 3, uriTemplate: "m{mip}-{x}-{y}.png" });
    const leftDemand = planVirtualTextureDrawDemand({ context: leftContext, flipY: false, manifest: source, workspace: left });
    const leftSnapshot = virtualTextureDemandPlanningWorkspaceSnapshot(left);
    planVirtualTextureDrawDemand({ context: rightContext, flipY: false, manifest: source, workspace: right });
    expect(virtualTextureDemandPlanningWorkspaceSnapshot(left)).toEqual(leftSnapshot);
    expect(planVirtualTextureDrawDemand({ context: leftContext, flipY: false, manifest: source, workspace: left }))
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
    ]);
  });

  it("addresses truncated NPOT pages by logical texels instead of equal grid fractions", () => {
    const source = manifest({ height: 1_200, width: 2_200 });
    const footprint = {
      maxU: 0.9,
      maxV: 0.3,
      minU: 0.82,
      minV: 0.2,
      screenHeight: 100,
      screenWidth: 100,
    };

    // At mip 1, x=3 covers logical texels [1536, 2048), or
    // U=[0.698..., 0.930...). Treating the five-page grid as equal fifths
    // incorrectly selects the truncated x=4 edge page for this footprint.
    expect(virtualTexturePagesForFootprint(source, 1, footprint)).toEqual([
      { mip: 1, x: 3, y: 0 },
    ]);
  });

  it("refines the texel-addressed NPOT branch that the shader samples", () => {
    const source = manifest({ height: 1_200, width: 2_200 });
    const faceOnNpotSlice = context(
      new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      identityMat4(),
      {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        texCoords: new Float32Array([0.82, 0.2, 0.9, 0.2, 0.9, 0.3, 0.82, 0.3]),
      },
    );
    const demand = planVirtualTextureDrawDemand({
      context: faceOnNpotSlice,
      flipY: false,
      limit: 64,
      manifest: source,
    });

    expect(demand.demandCandidates).toContainEqual({ mip: 1, x: 3, y: 0 });
    expect(demand.demandCandidates).toContainEqual({ mip: 0, x: 7, y: 0 });
    expect(demand.demandCandidates).not.toContainEqual({ mip: 1, x: 4, y: 0 });
    expect(demand.demandCandidates).not.toContainEqual({ mip: 0, x: 8, y: 0 });
  });

  it("checks sparse page availability independently from demand ordering", () => {
    const sparse: VirtualTextureManifestModel = {
      borderTexels: 1,
      height: 1_024,
      pageAddressing: "sparse",
      pageSize: 256,
      pages: [{ mip: 1, uri: "parent.png", x: 0, y: 0 }],
      width: 1_024,
    };
    const pageUrisByKey = new Map([["1/0/0", "parent.png"]]);
    expect(isVirtualTextureDemandPageAvailable({ manifest: sparse, pageUrisByKey }, {
      mip: 1,
      x: 0,
      y: 0,
    })).toBe(true);
    expect(isVirtualTextureDemandPageAvailable({ manifest: sparse, pageUrisByKey }, {
      mip: 0,
      x: 0,
      y: 0,
    })).toBe(false);
  });

  it("bounds context-free bootstrap before traversing a huge logical address space", () => {
    const huge = manifest({ height: 2 ** 40, pageSize: 1, width: 2 ** 40 });
    expect(planVirtualTextureBootstrapDemand({ manifest: huge }, 3)).toEqual([
      { mip: 40, x: 0, y: 0 },
      { mip: 39, x: 0, y: 0 },
      { mip: 39, x: 1, y: 0 },
    ]);
    expect(planVirtualTextureDrawDemand({
      flipY: true,
      limit: 2,
      manifest: huge,
    }).demandCandidates).toHaveLength(2);
  });

  it("plans coarse-to-fine demand and selects the established target-biased working set", () => {
    const source = { manifest: manifest() };
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

  it("keeps frame selection bounded, deterministic, deduplicated, and fair under fuzz", () => {
    forEachFuzzCase({ cases: 128, seed: 0x5654_fa17 }, ({ label, random }) => {
      const pagePool = Array.from({ length: random.int(1, 24) }, (_value, index) => ({
        mip: random.int(0, 8),
        x: index,
        y: random.int(0, 16),
      }));
      const submissions = Array.from({ length: random.int(1, 9) }, () => ({
        candidates: pagePool.filter(() => random.boolean(0.45)).slice(0, 15)
          .sort((left, right) => right.mip - left.mip || left.x - right.x),
        preferTargetMip: random.boolean(),
      }));
      const capacity = random.int(0, 24);
      const start = random.int(0, submissions.length);
      const selected = selectVirtualTextureFrameWorkingSet(submissions, capacity, start);
      const selectedKeys = selected.map((page) => `${page.mip}/${page.x}/${page.y}`);
      const availableKeys = new Set(submissions.flatMap((submission) =>
        submission.candidates.map((page) => `${page.mip}/${page.x}/${page.y}`)));
      expect(selectVirtualTextureFrameWorkingSet(submissions, capacity, start), label).toEqual(selected);
      expect(selected.length, label).toBeLessThanOrEqual(capacity);
      expect(new Set(selectedKeys).size, label).toBe(selected.length);
      expect(selectedKeys.every((key) => availableKeys.has(key)), label).toBe(true);

      const single = random.pick(submissions);
      expect(selectVirtualTextureFrameWorkingSet([single], capacity, start), label)
        .toEqual(selectVirtualTextureWorkingSet(single.candidates, capacity, single.preferTargetMip));

      const parent = { mip: 8, x: 0, y: 0 };
      const activeViews = Array.from({ length: random.int(1, 9) }, (_value, index) => ({
        active: index === 0 || random.boolean(0.65),
        page: { mip: 0, x: index, y: 0 },
      }));
      const rotating = activeViews.map(({ active, page }) => ({
        candidates: active ? [parent, page] : [],
        preferTargetMip: true,
      }));
      const rotatedTargets = new Set(rotating.flatMap((_submission, frame) =>
        selectVirtualTextureFrameWorkingSet(rotating, 2, frame).slice(1)
          .map((page) => `${page.mip}/${page.x}/${page.y}`)));
      expect(rotatedTargets, label).toEqual(new Set(activeViews
        .filter(({ active }) => active)
        .map(({ page }) => `${page.mip}/${page.x}/${page.y}`)));
    });
  });
});
