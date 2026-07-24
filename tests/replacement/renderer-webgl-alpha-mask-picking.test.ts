import { describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  canonicalAlphaMaskAcceptsTrianglePoint,
  createCanonicalAlphaMaskSamplingScratch,
  sampleCanonicalTextureAlpha,
  sampleCanonicalTextureAlphaAtLod,
} from "../../packages/renderer-webgl/src/surface/alpha-mask-sampling";
import {
  textureAlphaStorageBytes,
  validateTextureAlphaMipChain,
} from "../../packages/renderer-webgl/src/texture/alpha-mipmap";
import { createTextureAlphaMipChain } from "../../packages/renderer-webgl/src/texture/alpha-mipmap-generation";
import { assertFuzz, forEachFuzzCase } from "../fuzz";
import type { CanonicalTriangleGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type {
  CanonicalSurfaceMaterial,
  CanonicalTextureSampler,
  CanonicalUnlitMaterial,
} from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  createCanonicalPickingScratch,
  pickCanonicalSurfaceInto,
  type CanonicalPickHitAcceptance,
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

  it("mirrors minification filters through a retained alpha-only mip chain", () => {
    const alpha = createTextureAlphaMipChain({
      height: 4,
      values: new Uint8Array([
        0, 0, 255, 255,
        0, 0, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
      width: 4,
    });
    expect(alpha.levels?.map((level) => [level.width, level.height])).toEqual([
      [4, 4], [2, 2], [1, 1],
    ]);
    expect(sampleCanonicalTextureAlpha(alpha, sampler(), 0.125, 0.125)).toBe(0);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha,
      sampler({ minFilter: "nearest-mipmap-nearest" }),
      0.125,
      0.125,
      2,
    )).toBeCloseTo(0.75, 2);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha,
      sampler({ minFilter: "nearest" }),
      0.125,
      0.125,
      2,
    )).toBe(0);
  });

  it("uses the authored texel and mip interpolation axes independently", () => {
    const base = { height: 4, values: new Uint8Array(16), width: 4 };
    const alpha = {
      ...base,
      levels: [
        base,
        { height: 2, values: new Uint8Array(4).fill(64), width: 2 },
        { height: 1, values: new Uint8Array([255]), width: 1 },
      ],
    };
    expect(sampleCanonicalTextureAlphaAtLod(alpha, sampler({ minFilter: "nearest" }), 0.5, 0.5, 2))
      .toBe(0);
    expect(sampleCanonicalTextureAlphaAtLod(alpha, sampler({ minFilter: "linear" }), 0.5, 0.5, 2))
      .toBe(0);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha, sampler({ minFilter: "nearest-mipmap-nearest" }), 0.5, 0.5, 1,
    )).toBeCloseTo(64 / 255);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha, sampler({ minFilter: "linear-mipmap-nearest" }), 0.5, 0.5, 1,
    )).toBeCloseTo(64 / 255);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha, sampler({ minFilter: "nearest-mipmap-linear" }), 0.5, 0.5, 1.5,
    )).toBeCloseTo((64 / 255 + 1) / 2);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha, sampler({ minFilter: "linear-mipmap-linear" }), 0.5, 0.5, 1.5,
    )).toBeCloseTo((64 / 255 + 1) / 2);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha, sampler({ minFilter: "nearest-mipmap-nearest" }), 0.5, 0.5, Infinity,
    )).toBe(1);
    expect(sampleCanonicalTextureAlphaAtLod(
      alpha, sampler({ magFilter: "nearest" }), 0.5, 0.5, Number.NaN,
    )).toBe(0);
  });

  it("keeps arbitrary alpha mip dimensions complete and bounded", () => {
    forEachFuzzCase({ cases: 64, seed: 0xa1_fa_11ce }, ({ random }) => {
      const width = random.int(1, 65);
      const height = random.int(1, 65);
      const values = new Uint8Array(width * height);
      for (let index = 0; index < values.length; index += 1) {
        values[index] = random.int(0, 256);
      }
      const alpha = createTextureAlphaMipChain({ height, values, width });
      validateTextureAlphaMipChain(alpha);
      const terminal = alpha.levels?.at(-1);
      assertFuzz(terminal?.width === 1 && terminal.height === 1, "terminal mip must be 1x1");
      assertFuzz(
        textureAlphaStorageBytes(alpha) < values.byteLength * 2,
        "alpha mip storage must stay below twice the base level",
      );
    });
  });

  it("rejects a mip chain whose base storage does not alias the decoded alpha", () => {
    expect(() => validateTextureAlphaMipChain({
      height: 1,
      levels: [{ height: 1, values: new Uint8Array([255]), width: 1 }],
      values: new Uint8Array([255]),
      width: 1,
    })).toThrow(/mip level 0/);
  });

  it("derives mip LOD from adjacent physical-pixel rays in the shared query", () => {
    const alpha = createTextureAlphaMipChain({
      height: 4,
      values: new Uint8Array([
        0, 0, 255, 255,
        0, 0, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
      width: 4,
    });
    const material = maskedMaterial();
    const footprint = {
      x: { direction: [0, 0, -1] as const, origin: [1.25, 0.25, 1] as const },
      y: { direction: [0, 0, -1] as const, origin: [0.25, 1.25, 1] as const },
    };
    expect(canonicalAlphaMaskAcceptsTrianglePoint(
      material,
      geometry(),
      alpha,
      sampler({ minFilter: "nearest-mipmap-nearest" }),
      0,
      1,
      2,
      0.25,
      0.25,
    )).toBe(false);
    expect(canonicalAlphaMaskAcceptsTrianglePoint(
      material,
      geometry(),
      alpha,
      sampler({ minFilter: "nearest-mipmap-nearest" }),
      0,
      1,
      2,
      0.25,
      0.25,
      footprint,
      createCanonicalAlphaMaskSamplingScratch(),
    )).toBe(true);
  });

  it("lets the shared exact query reject a cutout and continue to the next surface", () => {
    const node = { kind: "mesh" } as CanonicalPickSurface["node"];
    const surfaces: readonly CanonicalPickSurface[] = [geometry(0), geometry(-1)].map(
      (pickingGeometry) => ({
        inverseModel: identityMat4(),
        modelHandedness: 1,
        node,
        objectLocalModel: identityMat4(),
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
    expect(accepts.mock.calls[0]!.slice(1, 6)).toEqual([0, 1, 2, 0.25, 0.25]);
  });

  it("transforms adjacent footprint rays through the same instance model", () => {
    const inverseModel = identityMat4();
    inverseModel[12] = -2;
    const node = { kind: "mesh" } as CanonicalPickSurface["node"];
    const accepts = vi.fn<CanonicalPickHitAcceptance>(() => true);
    expect(pickCanonicalSurfaceInto(
      { distance: 0, surfaceIndex: -1 },
      { direction: [0, 0, -1], maxDistance: 10, minDistance: 0, origin: [2.25, 0.25, 1] },
      [{
        inverseModel,
        modelHandedness: 1,
        node,
        objectLocalModel: identityMat4(),
        pickingGeometry: geometry(),
      }],
      createCanonicalPickingScratch(),
      undefined,
      accepts,
      {
        x: { direction: [0, 0, -1], maxDistance: 10, minDistance: 0, origin: [3.25, 0.25, 1] },
        y: { direction: [0, 0, -1], maxDistance: 10, minDistance: 0, origin: [2.25, 1.25, 1] },
      },
    )).toBe(true);
    expect(accepts.mock.calls[0]![6]).toMatchObject({
      x: { origin: [1.25, 0.25, 1] },
      y: { origin: [0.25, 1.25, 1] },
    });
  });

  it("accepts a back-facing triangle only when canonical raster intent is double-sided", () => {
    const node = { kind: "mesh" } as CanonicalPickSurface["node"];
    const surface: CanonicalPickSurface = {
      inverseModel: identityMat4(),
      modelHandedness: 1,
      node,
      objectLocalModel: identityMat4(),
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
