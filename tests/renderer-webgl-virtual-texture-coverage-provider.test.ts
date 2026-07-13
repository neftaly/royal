import { describe, expect, it } from "vitest";
import {
  cachedVirtualTextureCoverageProvider,
  clearVirtualTextureCoverageProviderCache,
  createVirtualTextureCoverageProviderCache,
  releaseVirtualTextureCoverageProviders,
} from "../packages/renderer-webgl/src/virtual-texture-coverage-cache";
import {
  createVirtualTextureDemandPlanningWorkspace,
  planVirtualTextureDrawDemand,
  prepareVirtualTextureCoverageProvider,
  projectVirtualTextureScreenFootprint,
} from "../packages/renderer-webgl/src/virtual-texture-demand";
import { identityMat4, translationMat4, type Mat4 } from "../packages/renderer-webgl/src/math/mat4";
import type { CpuGeometry } from "../packages/renderer-webgl/src/geometry-recipes";
import type { VirtualTextureDrawDemandContext } from "../packages/renderer-webgl/src/virtual-texture-runtime";
import type { VirtualTextureManifestModel } from "../packages/renderer-webgl/src/virtual-texturing";

const positions = (): Float32Array => new Float32Array([
  -1, -1, 0,
  1, -1, 0,
  1, 1, 0,
  -1, 1, 0,
]);

const texCoords = (): Float32Array => new Float32Array([
  0, 0,
  1, 0,
  1, 1,
  0, 1,
]);

const indices = (): Uint16Array => new Uint16Array([0, 1, 2, 0, 2, 3]);

const provider = (overrides: {
  indices?: Uint16Array;
  positions?: Float32Array;
  texCoords?: Float32Array;
} = {}) => prepareVirtualTextureCoverageProvider({
  indices: overrides.indices ?? indices(),
  positions: overrides.positions ?? positions(),
  texCoords: overrides.texCoords ?? texCoords(),
});

const context = (
  prepared = provider(),
  modelSource: VirtualTextureDrawDemandContext["modelSource"] = {
    kind: "single",
    model: identityMat4(),
  },
  projection: Mat4 = identityMat4(),
): VirtualTextureDrawDemandContext => ({
  modelSource,
  projection,
  provider: prepared,
  view: identityMat4(),
  viewportSize: [1_000, 800],
});

const manifest: VirtualTextureManifestModel = {
  borderTexels: 1,
  height: 4_096,
  mipCount: 5,
  pageSize: 256,
  pages: [],
  uriTemplate: "m{mip}-{x}-{y}.png",
  width: 4_096,
};

describe("prepared virtual-texture coverage", () => {
  it("preserves exact demand candidates across separately prepared adapters", () => {
    const first = planVirtualTextureDrawDemand({
      context: context(),
      flipY: false,
      generated: true,
      limit: 32,
      manifest,
    });
    const second = planVirtualTextureDrawDemand({
      context: context(),
      flipY: false,
      generated: true,
      limit: 32,
      manifest,
    });
    expect(second).toEqual(first);
  });

  it("retains invalid preparation evidence instead of rescanning repaired arrays", () => {
    const malformedPositions = positions();
    malformedPositions[0] = Number.NaN;
    const prepared = provider({ positions: malformedPositions });
    malformedPositions[0] = -1;
    const workspace = createVirtualTextureDemandPlanningWorkspace();

    expect(projectVirtualTextureScreenFootprint(context(prepared), false, workspace, manifest)).toEqual({
      kind: "indeterminate",
    });
    expect(planVirtualTextureDrawDemand({
      context: context(prepared),
      flipY: false,
      generated: true,
      limit: 4,
      manifest,
    }).coverageCandidates).toEqual([]);
  });

  it.each([
    { label: "short uv array", prepared: () => provider({ texCoords: new Float32Array([0, 0]) }) },
    { label: "partial index triangle", prepared: () => provider({ indices: new Uint16Array([0, 1]) }) },
    { label: "out-of-range index", prepared: () => provider({ indices: new Uint16Array([0, 1, 9]) }) },
  ])("makes $label indeterminate without entering the exact scan", ({ prepared }) => {
    expect(projectVirtualTextureScreenFootprint(context(prepared()), false)).toEqual({ kind: "indeterminate" });
  });

  it("asserts composed model-array parity instead of silently truncating instances", () => {
    expect(() => projectVirtualTextureScreenFootprint(context(provider(), {
      kind: "composed",
      localModels: [identityMat4(), identityMat4()],
      rootModels: [identityMat4()],
    }), false)).toThrow("matching lengths");
  });

  it("ignores a projected zero-area triangle", () => {
    const degenerate = provider({
      indices: new Uint16Array([0, 1, 2]),
      positions: new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0]),
      texCoords: new Float32Array([0, 0, 0.5, 0.5, 1, 1]),
    });
    expect(projectVirtualTextureScreenFootprint(context(degenerate), false)).toEqual({ kind: "not-visible" });
  });

  it("reuses one provider across stereo views without leaking the other eye's workspace", () => {
    const prepared = provider();
    const left = planVirtualTextureDrawDemand({
      context: context(prepared, { kind: "single", model: translationMat4([-0.4, 0, 0]) }),
      flipY: false,
      generated: true,
      manifest,
    });
    const right = planVirtualTextureDrawDemand({
      context: context(prepared, { kind: "single", model: translationMat4([0.4, 0, 0]) }),
      flipY: false,
      generated: true,
      manifest,
    });
    expect(right.demandCandidates).not.toEqual(left.demandCandidates);
    expect(planVirtualTextureDrawDemand({
      context: context(prepared, { kind: "single", model: translationMat4([-0.4, 0, 0]) }),
      flipY: false,
      generated: true,
      manifest,
    })).toEqual(left);
  });

  it("keeps a near-edge sliver visible and applies texture transform plus flipY", () => {
    const prepared = provider({
      indices: new Uint16Array([0, 1, 2]),
      positions: new Float32Array([0.99, -1, 0, 1.01, -1, 0, 0.99, 1, 0]),
      texCoords: new Float32Array([0, 0, 0.5, 0, 0, 0.25]),
    });
    const projected = projectVirtualTextureScreenFootprint({
      ...context(prepared),
      textureCoordinates: {
        row0: [0.5, 0, 0.25, 0],
        row1: [0, 0.5, 0.25, 0],
        set: 0,
      },
    }, true);
    expect(projected.kind).toBe("visible");
    if (projected.kind !== "visible") return;
    expect(projected.footprint.minU).toBeCloseTo(0.25);
    expect(projected.footprint.maxV).toBeCloseTo(0.75);
    expect(projected.footprint.screenWidth).toBeGreaterThan(0);
  });
});

describe("virtual-texture coverage provider cache", () => {
  const geometry = (): CpuGeometry => ({
    bucketKey: "coverage-cache-test",
    indices: indices(),
    mode: "triangles",
    positions: positions(),
    texCoords0: texCoords(),
    texCoords1: new Float32Array([0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5]),
  });

  it("caches independently by semantic geometry id and UV set", () => {
    const cache = createVirtualTextureCoverageProviderCache();
    const source = geometry();
    const first = cachedVirtualTextureCoverageProvider(cache, 7, source, 0);
    expect(cachedVirtualTextureCoverageProvider(cache, 7, source, 0)).toBe(first);
    expect(cachedVirtualTextureCoverageProvider(cache, 7, source, 1)).not.toBe(first);
    expect(cachedVirtualTextureCoverageProvider(cache, 8, source, 0)).not.toBe(first);
  });

  it("survives context-only lifecycle work and releases with semantic geometry", () => {
    const cache = createVirtualTextureCoverageProviderCache();
    const source = geometry();
    const retained = cachedVirtualTextureCoverageProvider(cache, 4, source, 0);
    // Context loss intentionally has no cache operation: this is prepared CPU state.
    expect(cachedVirtualTextureCoverageProvider(cache, 4, source, 0)).toBe(retained);
    releaseVirtualTextureCoverageProviders(cache, 4);
    expect(cachedVirtualTextureCoverageProvider(cache, 4, source, 0)).not.toBe(retained);
  });

  it("clears every provider on root disposal", () => {
    const cache = createVirtualTextureCoverageProviderCache();
    const source = geometry();
    const retained = cachedVirtualTextureCoverageProvider(cache, 1, source, 0);
    clearVirtualTextureCoverageProviderCache(cache);
    expect(cachedVirtualTextureCoverageProvider(cache, 1, source, 0)).not.toBe(retained);
  });
});
