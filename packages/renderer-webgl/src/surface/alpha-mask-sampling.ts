import { rayTriangleInto, type TriangleHit } from "../math/ray-triangle";
import {
  IDENTITY_TEXTURE_COORDINATES,
  type CanonicalTextureCoordinates,
} from "./texture-coordinates";
import type { DecodedTextureAlpha, TextureAlphaLevel } from "../texture/alpha-mipmap";
import type { CanonicalTriangleGeometry } from "./canonical-geometry";
import type { CanonicalSurfaceMaterial } from "./canonical-material";
import type { CanonicalTextureSampler } from "../texture/sampler";
import type {
  CanonicalLocalPickRay,
  CanonicalLocalPickRayFootprint,
} from "./picking-query";

export type CanonicalAlphaMaskSamplingScratch = Readonly<{
  /** Adjacent-ray untransformed UV pairs: x.u, x.v, y.u, y.v. */
  footprintUv: Float64Array;
  triangleHit: TriangleHit;
}>;

export const createCanonicalAlphaMaskSamplingScratch = (): CanonicalAlphaMaskSamplingScratch => ({
  footprintUv: new Float64Array(4),
  triangleHit: { distance: 0, u: 0, v: 0 },
});

const positiveModulo = (value: number, modulus: number): number => {
  const remainder = value % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
};

const wrappedIndex = (
  index: number,
  size: number,
  mode: CanonicalTextureSampler["wrapS"],
): number => {
  if (mode === "clamp-to-edge") return Math.max(0, Math.min(size - 1, index));
  if (mode === "repeat") return positiveModulo(index, size);
  const repeated = positiveModulo(index, size * 2);
  return repeated < size ? repeated : size * 2 - repeated - 1;
};

const texel = (
  alpha: TextureAlphaLevel,
  sampler: CanonicalTextureSampler,
  x: number,
  y: number,
): number => alpha.values[
  wrappedIndex(y, alpha.height, sampler.wrapT) * alpha.width
  + wrappedIndex(x, alpha.width, sampler.wrapS)
]!;

const sampleAlphaLevel = (
  alpha: TextureAlphaLevel,
  sampler: CanonicalTextureSampler,
  u: number,
  v: number,
  linear: boolean,
): number => {
  if (!linear) {
    return texel(alpha, sampler, Math.floor(u * alpha.width), Math.floor(v * alpha.height)) / 255;
  }
  const x = u * alpha.width - 0.5;
  const y = v * alpha.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xWeight = x - x0;
  const yWeight = y - y0;
  const top = texel(alpha, sampler, x0, y0) * (1 - xWeight)
    + texel(alpha, sampler, x0 + 1, y0) * xWeight;
  const bottom = texel(alpha, sampler, x0, y0 + 1) * (1 - xWeight)
    + texel(alpha, sampler, x0 + 1, y0 + 1) * xWeight;
  return (top * (1 - yWeight) + bottom * yWeight) / 255;
};

/** Pure base-level magnification rule used when no pixel footprint is available. */
export const sampleCanonicalTextureAlpha = (
  alpha: DecodedTextureAlpha,
  sampler: CanonicalTextureSampler,
  u: number,
  v: number,
): number => sampleAlphaLevel(alpha, sampler, u, v, sampler.magFilter === "linear");

/** Pure WebGL min/mipmap filter mirror for a known texel-footprint LOD. */
export const sampleCanonicalTextureAlphaAtLod = (
  alpha: DecodedTextureAlpha,
  sampler: CanonicalTextureSampler,
  u: number,
  v: number,
  lod: number,
): number => {
  if (!(lod > 0)) {
    return sampleCanonicalTextureAlpha(alpha, sampler, u, v);
  }
  const levels = alpha.levels;
  const maxLevel = (levels?.length ?? 1) - 1;
  const clamped = Math.min(lod, maxLevel);
  const filter = sampler.minFilter;
  const linearTexel = filter === "linear"
    || filter === "linear-mipmap-linear"
    || filter === "linear-mipmap-nearest";
  if (filter === "linear" || filter === "nearest" || maxLevel === 0) {
    return sampleAlphaLevel(alpha, sampler, u, v, linearTexel);
  }
  if (filter.endsWith("mipmap-nearest")) {
    return sampleAlphaLevel(
      levels?.[Math.round(clamped)] ?? alpha,
      sampler,
      u,
      v,
      linearTexel,
    );
  }
  const low = Math.floor(clamped);
  const high = Math.min(maxLevel, low + 1);
  const weight = clamped - low;
  const first = sampleAlphaLevel(levels?.[low] ?? alpha, sampler, u, v, linearTexel);
  if (high === low) return first;
  const second = sampleAlphaLevel(levels?.[high] ?? alpha, sampler, u, v, linearTexel);
  return first * (1 - weight) + second * weight;
};

const interpolatedCoordinate = (
  values: Float32Array,
  a: number,
  b: number,
  c: number,
  barycentricB: number,
  barycentricC: number,
  component: 0 | 1,
): number => {
  const barycentricA = 1 - barycentricB - barycentricC;
  return values[a * 2 + component]! * barycentricA
    + values[b * 2 + component]! * barycentricB
    + values[c * 2 + component]! * barycentricC;
};

const sampleTransformedTriangleAlpha = (
  coordinates: CanonicalTextureCoordinates,
  geometry: CanonicalTriangleGeometry,
  alpha: DecodedTextureAlpha,
  sampler: CanonicalTextureSampler,
  a: number,
  b: number,
  c: number,
  barycentricB: number,
  barycentricC: number,
  lod?: number,
): number | undefined => {
  const values = coordinates.row0[3] === 0
    ? geometry.textureCoordinates0
    : geometry.textureCoordinates1;
  if (values === undefined) return undefined;
  const u = interpolatedCoordinate(values, a, b, c, barycentricB, barycentricC, 0);
  const v = interpolatedCoordinate(values, a, b, c, barycentricB, barycentricC, 1);
  const transformedU = coordinates.row0[0] * u + coordinates.row0[1] * v + coordinates.row0[2];
  const transformedV = coordinates.row1[0] * u + coordinates.row1[1] * v + coordinates.row1[2];
  return lod === undefined
    ? sampleCanonicalTextureAlpha(alpha, sampler, transformedU, transformedV)
    : sampleCanonicalTextureAlphaAtLod(alpha, sampler, transformedU, transformedV, lod);
};

const rayTriangleUvInto = (
  target: Float64Array,
  offset: 0 | 2,
  hit: TriangleHit,
  ray: CanonicalLocalPickRay,
  positions: Float32Array,
  textureCoordinates: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
): boolean => {
  if (!rayTriangleInto(hit, positions, aIndex, bIndex, cIndex, ray, 1, true, false)) return false;
  const { u: barycentricB, v: barycentricC } = hit;
  target[offset] = interpolatedCoordinate(
    textureCoordinates, aIndex, bIndex, cIndex, barycentricB, barycentricC, 0,
  );
  target[offset + 1] = interpolatedCoordinate(
    textureCoordinates, aIndex, bIndex, cIndex, barycentricB, barycentricC, 1,
  );
  return Number.isFinite(target[offset]) && Number.isFinite(target[offset + 1]);
};

const triangleTextureLod = (
  coordinates: CanonicalTextureCoordinates,
  geometry: CanonicalTriangleGeometry,
  alpha: DecodedTextureAlpha,
  a: number,
  b: number,
  c: number,
  barycentricB: number,
  barycentricC: number,
  footprint: CanonicalLocalPickRayFootprint | undefined,
  scratch: CanonicalAlphaMaskSamplingScratch | undefined,
): number | undefined => {
  if (footprint === undefined || scratch === undefined) return undefined;
  const values = coordinates.row0[3] === 0
    ? geometry.textureCoordinates0
    : geometry.textureCoordinates1;
  if (values === undefined) return undefined;
  const footprintUv = scratch.footprintUv;
  if (
    !rayTriangleUvInto(footprintUv, 0, scratch.triangleHit, footprint.x, geometry.positions, values, a, b, c)
    || !rayTriangleUvInto(footprintUv, 2, scratch.triangleHit, footprint.y, geometry.positions, values, a, b, c)
  ) return undefined;
  const u = interpolatedCoordinate(values, a, b, c, barycentricB, barycentricC, 0);
  const v = interpolatedCoordinate(values, a, b, c, barycentricB, barycentricC, 1);
  const transformedU = coordinates.row0[0] * u + coordinates.row0[1] * v;
  const transformedV = coordinates.row1[0] * u + coordinates.row1[1] * v;
  const xU = coordinates.row0[0] * footprintUv[0]!
    + coordinates.row0[1] * footprintUv[1]!;
  const xV = coordinates.row1[0] * footprintUv[0]!
    + coordinates.row1[1] * footprintUv[1]!;
  const yU = coordinates.row0[0] * footprintUv[2]!
    + coordinates.row0[1] * footprintUv[3]!;
  const yV = coordinates.row1[0] * footprintUv[2]!
    + coordinates.row1[1] * footprintUv[3]!;
  const xFootprint = Math.hypot(
    (xU - transformedU) * alpha.width,
    (xV - transformedV) * alpha.height,
  );
  const yFootprint = Math.hypot(
    (yU - transformedU) * alpha.width,
    (yV - transformedV) * alpha.height,
  );
  const footprintTexels = Math.max(xFootprint, yFootprint);
  return footprintTexels > 0 && Number.isFinite(footprintTexels)
    ? Math.log2(footprintTexels)
    : undefined;
};

/** Mirrors the visible MASK discard rule; absent pixels use the renderer's opaque fallback. */
export const canonicalAlphaMaskAcceptsTrianglePoint = (
  material: CanonicalSurfaceMaterial,
  geometry: CanonicalTriangleGeometry,
  alpha: DecodedTextureAlpha | undefined,
  sampler: CanonicalTextureSampler | undefined,
  a: number,
  b: number,
  c: number,
  barycentricB: number,
  barycentricC: number,
  footprint?: CanonicalLocalPickRayFootprint,
  scratch?: CanonicalAlphaMaskSamplingScratch,
): boolean => {
  const cutoff = material.alphaCutoff;
  if (cutoff === undefined) return true;
  let sampled = material.baseColor[3];
  const colors = geometry.colors;
  if (colors !== undefined) {
    const barycentricA = 1 - barycentricB - barycentricC;
    sampled *= colors[a * 4 + 3]! * barycentricA
      + colors[b * 4 + 3]! * barycentricB
      + colors[c * 4 + 3]! * barycentricC;
  }
  if (alpha !== undefined && sampler !== undefined) {
    const coordinates = material.baseColorTextureCoordinates ?? IDENTITY_TEXTURE_COORDINATES;
    const textureAlpha = sampleTransformedTriangleAlpha(
      coordinates,
      geometry,
      alpha,
      sampler,
      a,
      b,
      c,
      barycentricB,
      barycentricC,
      triangleTextureLod(
        coordinates,
        geometry,
        alpha,
        a,
        b,
        c,
        barycentricB,
        barycentricC,
        footprint,
        scratch,
      ),
    );
    if (textureAlpha !== undefined) sampled *= textureAlpha;
  }
  return sampled >= cutoff;
};
