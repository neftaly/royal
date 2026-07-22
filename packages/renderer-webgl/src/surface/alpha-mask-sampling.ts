import {
  IDENTITY_TEXTURE_COORDINATES,
  type CanonicalTextureCoordinates,
} from "../gltf/texture-coordinates";
import type { DecodedTextureAlpha, TextureAlphaLevel } from "../texture/alpha-mipmap";
import type { CanonicalTriangleGeometry } from "./canonical-geometry";
import type { CanonicalSurfaceMaterial, CanonicalTextureSampler } from "./canonical-material";
import type {
  CanonicalLocalPickRay,
  CanonicalLocalPickRayFootprint,
} from "./picking-query";

export type CanonicalAlphaMaskSamplingScratch = Readonly<{
  /** Adjacent-ray untransformed UV pairs: x.u, x.v, y.u, y.v. */
  footprintUv: Float64Array;
}>;

export const createCanonicalAlphaMaskSamplingScratch = (): CanonicalAlphaMaskSamplingScratch => ({
  footprintUv: new Float64Array(4),
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
  ray: CanonicalLocalPickRay,
  positions: Float32Array,
  textureCoordinates: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
): boolean => {
  const a = aIndex * 3;
  const b = bIndex * 3;
  const c = cIndex * 3;
  const edge1X = positions[b]! - positions[a]!;
  const edge1Y = positions[b + 1]! - positions[a + 1]!;
  const edge1Z = positions[b + 2]! - positions[a + 2]!;
  const edge2X = positions[c]! - positions[a]!;
  const edge2Y = positions[c + 1]! - positions[a + 1]!;
  const edge2Z = positions[c + 2]! - positions[a + 2]!;
  const pX = ray.direction[1] * edge2Z - ray.direction[2] * edge2Y;
  const pY = ray.direction[2] * edge2X - ray.direction[0] * edge2Z;
  const pZ = ray.direction[0] * edge2Y - ray.direction[1] * edge2X;
  const determinant = edge1X * pX + edge1Y * pY + edge1Z * pZ;
  if (determinant === 0 || !Number.isFinite(determinant)) return false;
  const inverseDeterminant = 1 / determinant;
  const relativeX = ray.origin[0] - positions[a]!;
  const relativeY = ray.origin[1] - positions[a + 1]!;
  const relativeZ = ray.origin[2] - positions[a + 2]!;
  const barycentricB = (relativeX * pX + relativeY * pY + relativeZ * pZ)
    * inverseDeterminant;
  const qX = relativeY * edge1Z - relativeZ * edge1Y;
  const qY = relativeZ * edge1X - relativeX * edge1Z;
  const qZ = relativeX * edge1Y - relativeY * edge1X;
  const barycentricC = (
    ray.direction[0] * qX + ray.direction[1] * qY + ray.direction[2] * qZ
  ) * inverseDeterminant;
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
    !rayTriangleUvInto(footprintUv, 0, footprint.x, geometry.positions, values, a, b, c)
    || !rayTriangleUvInto(footprintUv, 2, footprint.y, geometry.positions, values, a, b, c)
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
