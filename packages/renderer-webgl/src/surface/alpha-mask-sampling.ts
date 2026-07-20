import {
  IDENTITY_TEXTURE_COORDINATES,
  type CanonicalTextureCoordinates,
} from "../gltf/texture-coordinates";
import type { DecodedTextureAlpha } from "../texture/asset-owner";
import type { CanonicalTriangleGeometry } from "./canonical-geometry";
import type { CanonicalSurfaceMaterial, CanonicalTextureSampler } from "./canonical-material";

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
  alpha: DecodedTextureAlpha,
  sampler: CanonicalTextureSampler,
  x: number,
  y: number,
): number => alpha.values[
  wrappedIndex(y, alpha.height, sampler.wrapT) * alpha.width
  + wrappedIndex(x, alpha.width, sampler.wrapS)
]!;

/** Pure base-level sampling rule used by exact CPU alpha-mask picking. */
export const sampleCanonicalTextureAlpha = (
  alpha: DecodedTextureAlpha,
  sampler: CanonicalTextureSampler,
  u: number,
  v: number,
): number => {
  if (sampler.magFilter === "nearest") {
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
): number | undefined => {
  const values = coordinates.row0[3] === 0
    ? geometry.textureCoordinates0
    : geometry.textureCoordinates1;
  if (values === undefined) return undefined;
  const u = interpolatedCoordinate(values, a, b, c, barycentricB, barycentricC, 0);
  const v = interpolatedCoordinate(values, a, b, c, barycentricB, barycentricC, 1);
  return sampleCanonicalTextureAlpha(
    alpha,
    sampler,
    coordinates.row0[0] * u + coordinates.row0[1] * v + coordinates.row0[2],
    coordinates.row1[0] * u + coordinates.row1[1] * v + coordinates.row1[2],
  );
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
  if (
    alpha !== undefined
    && sampler !== undefined
  ) {
    const textureAlpha = sampleTransformedTriangleAlpha(
      material.baseColorTextureCoordinates ?? IDENTITY_TEXTURE_COORDINATES,
      geometry,
      alpha,
      sampler,
      a,
      b,
      c,
      barycentricB,
      barycentricC,
    );
    if (textureAlpha !== undefined) sampled *= textureAlpha;
  }
  return sampled >= cutoff;
};
