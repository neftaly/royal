import { canonicalMaterialUsesTextureCoordinateSet } from "./canonical-material";
import type { CanonicalDrawSurface } from "./scene-lowering";

export const surfaceUsesTextureCoordinateSet = (
  surface: CanonicalDrawSurface,
  set: 0 | 1,
): boolean => canonicalMaterialUsesTextureCoordinateSet(surface.material, set);

/** Vertex streams required by one surface, independent of source geometry identity. */
export const surfaceGeometryLayoutKey = (surface: CanonicalDrawSurface): string => {
  const normalKey = surface.material.kind === "standard"
    && surface.geometry.normals !== undefined
    ? "normal"
    : "position";
  const tangentKey = surface.material.kind === "standard"
    && surface.material.normalAsset !== undefined
    && surface.material.normalTextureCoordinates === undefined
    && surface.geometry.tangents !== undefined
    ? "tangent"
    : "no-tangent";
  const usesTextureCoordinates0 = surfaceUsesTextureCoordinateSet(surface, 0);
  const usesTextureCoordinates1 = surfaceUsesTextureCoordinateSet(surface, 1);
  const uvKey = usesTextureCoordinates1
    ? usesTextureCoordinates0 ? "uv01" : "uv1"
    : usesTextureCoordinates0 ? "uv0" : "no-uv";
  return `${normalKey}:${uvKey}:${tangentKey}`;
};

export const surfaceGeometryResourceKey = (surface: CanonicalDrawSurface): string =>
  `${surface.geometry.key}:${surfaceGeometryLayoutKey(surface)}`;

/** Exact source bytes transferred while publishing one canonical geometry. */
export const surfaceGeometryUploadByteLength = (
  surface: CanonicalDrawSurface,
  indexBytes: 1 | 2 | 4,
): number => {
  const { geometry, material } = surface;
  let byteLength = geometry.indices.length * indexBytes + geometry.positions.byteLength;
  if (material.kind === "standard" && geometry.normals !== undefined) {
    byteLength += geometry.normals.byteLength;
  }
  if (geometry.colors !== undefined) byteLength += geometry.colors.byteLength;
  if (surfaceUsesTextureCoordinateSet(surface, 0)) {
    byteLength += geometry.textureCoordinates0?.byteLength ?? 0;
  }
  if (surfaceUsesTextureCoordinateSet(surface, 1)) {
    byteLength += geometry.textureCoordinates1?.byteLength ?? 0;
  }
  if (
    material.kind === "standard"
    && material.normalAsset !== undefined
    && material.normalTextureCoordinates === undefined
    && geometry.tangents !== undefined
  ) byteLength += geometry.tangents.byteLength;
  if (!Number.isSafeInteger(byteLength)) {
    throw new RangeError("Royal surface geometry upload exceeds safe integer range");
  }
  return byteLength;
};

/** Exact packed model and normal-transform bytes transferred for one instance set. */
export const surfaceInstanceUploadByteLength = (
  surface: CanonicalDrawSurface,
): number => {
  const count = surface.instances?.count ?? 0;
  const byteLength = count * 28 * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("Royal surface instance upload exceeds safe integer range");
  }
  return byteLength;
};

/** Preserves only the admitted prefix whose GPU resource identities remain reusable. */
export const retainedSurfaceAdmissionCount = (
  previous: readonly CanonicalDrawSurface[],
  next: readonly CanonicalDrawSurface[],
  admitted: number,
): number => {
  const retained = Math.min(admitted, previous.length, next.length);
  for (let index = 0; index < retained; index += 1) {
    const previousSurface = previous[index]!;
    const nextSurface = next[index]!;
    if (
      surfaceGeometryResourceKey(previousSurface) !== surfaceGeometryResourceKey(nextSurface)
      || previousSurface.instances?.key !== nextSurface.instances?.key
    ) return index;
  }
  return retained;
};
