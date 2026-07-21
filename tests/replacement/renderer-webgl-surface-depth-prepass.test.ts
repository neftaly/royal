import { describe, expect, it } from "vitest";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import type { CanonicalDrawSurface } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  opaqueDepthPrepassRequested,
  surfaceCanUseOpaqueDepthPrepass,
} from "../../packages/renderer-webgl/src/surface/surface-depth-prepass";

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
  ...(topology === undefined ? {} : { topology }),
}) as CanonicalDrawSurface;

describe("opaque depth-prepass policy core", () => {
  it("activates only after enough exact opaque triangle work can amortize a pass", () => {
    expect(opaqueDepthPrepassRequested(Array.from({ length: 31 }, () => surface()))).toBe(false);
    expect(opaqueDepthPrepassRequested(Array.from({ length: 32 }, () => surface()))).toBe(true);
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
    expect(opaqueDepthPrepassRequested(excluded)).toBe(false);
  });
});
