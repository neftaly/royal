import type { CanonicalDrawSurface } from "./scene-lowering";
import { canonicalMaterialUsesTextureCoordinateSet } from "./canonical-material";

export const surfaceUsesRuntimeTextureCoordinates = (
  surface: CanonicalDrawSurface,
): boolean => {
  const material = surface.material;
  return material.baseColorAsset !== undefined
    || (material.kind === "standard" && (
      material.metallicRoughnessAsset !== undefined
      || material.normalAsset !== undefined
      || material.occlusionAsset !== undefined
      || material.emissiveAsset !== undefined
    ));
};

export const surfaceUsesTextureCoordinateSet = (
  surface: CanonicalDrawSurface,
  set: 0 | 1,
): boolean => canonicalMaterialUsesTextureCoordinateSet(surface.material, set);

export const surfaceGeometryResourceKey = (surface: CanonicalDrawSurface): string => {
  const geometryBaseKey = surface.material.kind === "standard"
    && surface.geometry.normals !== undefined
    ? `${surface.geometry.key}:normal`
    : `${surface.geometry.key}:position`;
  const tangentKey = surface.material.kind === "standard"
    && surface.material.normalAsset !== undefined
    && surface.material.normalTextureCoordinates === undefined
    && surface.geometry.tangents !== undefined
    ? "tangent"
    : "no-tangent";
  const uvKey = surfaceUsesTextureCoordinateSet(surface, 1)
    ? "uv01"
    : surfaceUsesTextureCoordinateSet(surface, 0) ? "uv0" : "no-uv";
  return `${geometryBaseKey}:${uvKey}:${tangentKey}`;
};

const surfaceAdmissionKey = (surface: CanonicalDrawSurface): string => JSON.stringify([
  surfaceGeometryResourceKey(surface),
  surface.instances?.key ?? null,
]);

/** Preserves only the admitted prefix whose GPU resource identities remain reusable. */
export const retainedSurfaceAdmissionCount = (
  previous: readonly CanonicalDrawSurface[],
  next: readonly CanonicalDrawSurface[],
  admitted: number,
): number => {
  const retained = Math.min(admitted, previous.length, next.length);
  for (let index = 0; index < retained; index += 1) {
    if (surfaceAdmissionKey(previous[index]!) !== surfaceAdmissionKey(next[index]!)) return index;
  }
  return retained;
};

/** Advances a cold GPU-admission cursor without making frame or WebGL decisions. */
export const nextSurfaceAdmissionCount = (
  admitted: number,
  total: number,
  budget: number,
): number => Math.min(total, admitted + budget);
