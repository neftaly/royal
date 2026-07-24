import { describe, expect, it } from "vitest";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import type { CanonicalDrawSurface } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  opaqueDepthPrepassRequested,
  planOpaqueDepthPrepass,
  surfaceCanUseOpaqueDepthPrepass,
  updateOpaqueDepthPrepassPlan,
} from "../../packages/renderer-webgl/src/surface/surface-depth-prepass";
import { SurfaceDepthPrepassOwner } from "../../packages/renderer-webgl/src/surface/surface-depth-prepass-owner";
import { SurfaceProgramOwner } from "../../packages/renderer-webgl/src/surface/surface-program-owner";
import { fakeGl } from "./support/canvas-root-harness";

const standard = (
  overrides: Partial<Extract<CanonicalSurfaceMaterial, { kind: "standard" }>> = {},
): CanonicalSurfaceMaterial => ({
  baseColor: [1, 1, 1, 1],
  emissiveFactor: [0, 0, 0],
  kind: "standard",
  metallicFactor: 0,
  normalScale: 1,
  occlusionStrength: 1,
  requiresTextureCoordinates: false,
  roughnessFactor: 1,
  ...overrides,
});

const surface = (
  material: CanonicalSurfaceMaterial = standard(),
  topology?: "lines",
): CanonicalDrawSurface => ({
  material,
  worldBounds: { max: [1, 1, 1], min: [-1, -1, -1] },
  ...(topology === undefined ? {} : { topology }),
}) as unknown as CanonicalDrawSurface;

describe("opaque depth-prepass policy core", () => {
  it("keeps clip positions invariant across the depth and color programs", () => {
    const gl = fakeGl();
    const depth = new SurfaceDepthPrepassOwner(gl, {
      multiDrawElementsWEBGL: () => undefined,
    });
    const color = new SurfaceProgramOwner(gl);

    depth.get(false);
    color.get("standard", 0, false, false, false);

    const vertexSources = gl.shaderSource.mock.calls
      .map(([, source]) => String(source))
      .filter((source) => source.includes("layout(location = 0) in vec3 position"));
    expect(vertexSources).toHaveLength(2);
    for (const source of vertexSources) expect(source).toContain("invariant gl_Position;");
  });

  it("activates only after enough exact opaque triangle work can amortize a pass", () => {
    const camera = [0, 0, 0];
    expect(opaqueDepthPrepassRequested(
      planOpaqueDepthPrepass(Array.from({ length: 31 }, () => surface())),
      camera,
    )).toBe(false);
    expect(opaqueDepthPrepassRequested(
      planOpaqueDepthPrepass(Array.from({ length: 32 }, () => surface())),
      camera,
    )).toBe(true);
  });

  it("avoids doubling draw work while the camera is outside the opaque volume", () => {
    const plan = planOpaqueDepthPrepass(Array.from({ length: 32 }, () => surface()));
    expect(opaqueDepthPrepassRequested(plan, [2, 0, 0])).toBe(false);
    expect(opaqueDepthPrepassRequested(plan, [0, 0, 0])).toBe(true);
  });

  it("keeps an active plan across a small boundary crossing", () => {
    const plan = planOpaqueDepthPrepass(Array.from({ length: 32 }, () => surface()));
    expect(opaqueDepthPrepassRequested(plan, [1.04, 0, 0])).toBe(false);
    expect(opaqueDepthPrepassRequested(plan, [1.04, 0, 0], true)).toBe(true);
    expect(opaqueDepthPrepassRequested(plan, [1.11, 0, 0], true)).toBe(false);
  });

  it("reuses retained plan storage while object bounds move", () => {
    const plan = planOpaqueDepthPrepass([surface()]);
    const min = plan.min;
    const max = plan.max;
    const moved = {
      ...surface(),
      worldBounds: { max: [6, 1, 1], min: [4, -1, -1] },
    } as CanonicalDrawSurface;

    expect(updateOpaqueDepthPrepassPlan(plan, [moved])).toBe(plan);
    expect(plan.min).toBe(min);
    expect(plan.max).toBe(max);
    expect(plan).toMatchObject({ candidateCount: 1, max: [6, 1, 1], min: [4, -1, -1] });
  });

  it("excludes surfaces whose depth depends on coverage or later composition", () => {
    expect(surfaceCanUseOpaqueDepthPrepass(surface())).toBe(true);
    expect(surfaceCanUseOpaqueDepthPrepass(surface(standard({ alphaBlend: true })))).toBe(false);
    expect(surfaceCanUseOpaqueDepthPrepass(surface(standard({ alphaCutoff: 0.5 })))).toBe(false);
    expect(surfaceCanUseOpaqueDepthPrepass(surface(standard({ transmissionFactor: 1 })))).toBe(false);
    expect(surfaceCanUseOpaqueDepthPrepass(surface(standard(), "lines"))).toBe(false);
    expect(surfaceCanUseOpaqueDepthPrepass(surface({
      baseColor: [1, 1, 1, 1],
      kind: "unlit",
      requiresTextureCoordinates: false,
    }))).toBe(false);
  });

  it("does not count excluded surfaces toward the admission threshold", () => {
    const excluded = Array.from(
      { length: 64 },
      () => surface(standard({ alphaCutoff: 0.5 })),
    );
    expect(opaqueDepthPrepassRequested(planOpaqueDepthPrepass(excluded), [0, 0, 0])).toBe(false);
  });
});
