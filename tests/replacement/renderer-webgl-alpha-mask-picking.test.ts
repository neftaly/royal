import { describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  canonicalAlphaMaskAcceptsTrianglePoint,
  sampleCanonicalTextureAlpha,
} from "../../packages/renderer-webgl/src/surface/alpha-mask-sampling";
import type { CanonicalTriangleGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type {
  CanonicalSurfaceMaterial,
  CanonicalTextureSampler,
  CanonicalUnlitMaterial,
} from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  createCanonicalPickingScratch,
  pickCanonicalSurfaceInto,
} from "../../packages/renderer-webgl/src/surface/picking-query";
import type { CanonicalPickSurface } from "../../packages/renderer-webgl/src/surface/scene-lowering";

const sampler = (overrides: Partial<CanonicalTextureSampler> = {}): CanonicalTextureSampler => ({
  magFilter: "nearest",
  minFilter: "nearest",
  wrapS: "clamp-to-edge",
  wrapT: "clamp-to-edge",
  ...overrides,
});

const geometry = (z = 0): CanonicalTriangleGeometry => ({
  bounds: { max: [1, 1, z], min: [0, 0, z] },
  indices: new Uint8Array([0, 1, 2]),
  key: `triangle:${z}`,
  positions: new Float32Array([0, 0, z, 1, 0, z, 0, 1, z]),
  textureCoordinates0: new Float32Array([0, 0, 1, 0, 0, 1]),
  textureCoordinates1: new Float32Array([1, 0, 0, 0, 1, 1]),
});

const maskedMaterial = (
  overrides: Partial<CanonicalUnlitMaterial> = {},
): CanonicalSurfaceMaterial => ({
  alphaCutoff: 0.5,
  baseColor: [1, 1, 1, 1],
  baseColorTextureCoordinates: {
    row0: [1, 0, 0, 0],
    row1: [0, 1, 0, 0],
  },
  kind: "unlit",
  requiresTextureCoordinates: true,
  ...overrides,
});

describe("canonical alpha-mask picking", () => {
  it("samples base-level nearest and bilinear alpha with canonical wrap modes", () => {
    const alpha = { height: 1, values: new Uint8Array([0, 255]), width: 2 };
    expect(sampleCanonicalTextureAlpha(alpha, sampler(), 0.25, 0.5)).toBe(0);
    expect(sampleCanonicalTextureAlpha(alpha, sampler(), 0.75, 0.5)).toBe(1);
    expect(sampleCanonicalTextureAlpha(alpha, sampler({ magFilter: "linear" }), 0.5, 0.5))
      .toBeCloseTo(0.5);
    expect(sampleCanonicalTextureAlpha(alpha, sampler({ wrapS: "repeat" }), 1.25, 0.5))
      .toBe(0);
    expect(sampleCanonicalTextureAlpha(alpha, sampler({ wrapS: "mirrored-repeat" }), 1.25, 0.5))
      .toBe(1);
  });

  it("applies the authored UV set, transform, factor, and cutoff without GPU state", () => {
    const alpha = { height: 1, values: new Uint8Array([0, 255]), width: 2 };
    const transformed = maskedMaterial({
      baseColor: [1, 1, 1, 0.75],
      baseColorTextureCoordinates: {
        row0: [-1, 0, 1, 1],
        row1: [0, 1, 0, 0],
      },
    });
    expect(canonicalAlphaMaskAcceptsTrianglePoint(
      transformed,
      geometry(),
      alpha,
      sampler(),
      0,
      1,
      2,
      0.75,
      0.1,
    )).toBe(true);
    expect(canonicalAlphaMaskAcceptsTrianglePoint(
      { ...transformed, baseColor: [1, 1, 1, 0.4] },
      geometry(),
      alpha,
      sampler(),
      0,
      1,
      2,
      0.75,
      0.1,
    )).toBe(false);
  });

  it("lets the shared exact query reject a cutout and continue to the next surface", () => {
    const node = { kind: "mesh" } as CanonicalPickSurface["node"];
    const surfaces: readonly CanonicalPickSurface[] = [geometry(0), geometry(-1)].map(
      (pickingGeometry) => ({
        inverseModel: identityMat4(),
        modelHandedness: 1,
        node,
        pickingGeometry,
      }),
    );
    const accepts = vi.fn((surface: CanonicalPickSurface) => surface === surfaces[1]);
    const hit = { distance: 0, surfaceIndex: -1 };
    expect(pickCanonicalSurfaceInto(
      hit,
      { direction: [0, 0, -1], maxDistance: 10, minDistance: 0, origin: [0.25, 0.25, 1] },
      surfaces,
      createCanonicalPickingScratch(),
      undefined,
      accepts,
    )).toBe(true);
    expect(hit).toEqual({ distance: 2, surfaceIndex: 1 });
    expect(accepts).toHaveBeenCalledTimes(2);
    expect(accepts.mock.calls[0]!.slice(1)).toEqual([0, 1, 2, 0.25, 0.25]);
  });

  it("accepts a back-facing triangle only when canonical raster intent is double-sided", () => {
    const node = { kind: "mesh" } as CanonicalPickSurface["node"];
    const surface: CanonicalPickSurface = {
      inverseModel: identityMat4(),
      modelHandedness: 1,
      node,
      pickingGeometry: geometry(),
    };
    const ray = {
      direction: [0, 0, 1] as const,
      maxDistance: 10,
      minDistance: 0,
      origin: [0.25, 0.25, -1] as const,
    };
    const hit = { distance: 0, surfaceIndex: -1 };
    expect(pickCanonicalSurfaceInto(
      hit,
      ray,
      [surface],
      createCanonicalPickingScratch(),
    )).toBe(false);
    expect(pickCanonicalSurfaceInto(
      hit,
      ray,
      [{ ...surface, doubleSided: true }],
      createCanonicalPickingScratch(),
    )).toBe(true);
    expect(hit.distance).toBe(1);
  });
});
