import type { Vec3 } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import { lodMembershipsSelected, type LodLevelSelections } from "./lod-selection";
import type { CanonicalPickSurface } from "./scene-lowering";
import type { CanonicalTriangleGeometry } from "./canonical-geometry";

export type CanonicalPickRay = Readonly<{
  direction: Vec3;
  maxDistance: number;
  minDistance: number;
  origin: Vec3;
}>;

/** Adjacent physical-pixel rays used only to mirror texture minification. */
export type CanonicalPickRayFootprint = Readonly<{
  x: CanonicalPickRay;
  y: CanonicalPickRay;
}>;

export type MutableCanonicalPickHit = {
  aIndex: number;
  barycentricB: number;
  barycentricC: number;
  bIndex: number;
  cIndex: number;
  distance: number;
  surfaceIndex: number;
};

const normalizeVec3Into = (
  target: [number, number, number],
  x: number,
  y: number,
  z: number,
): boolean => {
  const length = Math.hypot(x, y, z);
  if (!(length > 0) || !Number.isFinite(length)) return false;
  target[0] = x / length || 0;
  target[1] = y / length || 0;
  target[2] = z / length || 0;
  return true;
};

/** Resolves the exact hit's interpolated local normal without allocating. */
export const canonicalPickLocalNormalInto = (
  target: [number, number, number],
  hit: MutableCanonicalPickHit,
  geometry: CanonicalTriangleGeometry,
): [number, number, number] => {
  const a = hit.aIndex * 3;
  const b = hit.bIndex * 3;
  const c = hit.cIndex * 3;
  const barycentricA = 1 - hit.barycentricB - hit.barycentricC;
  const normals = geometry.normals;
  const edge1X = geometry.positions[b]! - geometry.positions[a]!;
  const edge1Y = geometry.positions[b + 1]! - geometry.positions[a + 1]!;
  const edge1Z = geometry.positions[b + 2]! - geometry.positions[a + 2]!;
  const edge2X = geometry.positions[c]! - geometry.positions[a]!;
  const edge2Y = geometry.positions[c + 1]! - geometry.positions[a + 1]!;
  const edge2Z = geometry.positions[c + 2]! - geometry.positions[a + 2]!;
  const faceX = edge1Y * edge2Z - edge1Z * edge2Y;
  const faceY = edge1Z * edge2X - edge1X * edge2Z;
  const faceZ = edge1X * edge2Y - edge1Y * edge2X;
  if (normals !== undefined) {
    const x = normals[a]! * barycentricA
      + normals[b]! * hit.barycentricB
      + normals[c]! * hit.barycentricC;
    const y = normals[a + 1]! * barycentricA
      + normals[b + 1]! * hit.barycentricB
      + normals[c + 1]! * hit.barycentricC;
    const z = normals[a + 2]! * barycentricA
      + normals[b + 2]! * hit.barycentricB
      + normals[c + 2]! * hit.barycentricC;
    if (normalizeVec3Into(target, x, y, z)) return target;
  }
  if (normalizeVec3Into(target, faceX, faceY, faceZ)) return target;
  target[0] = 0;
  target[1] = 0;
  target[2] = 1;
  return target;
};

/** Resolves and transforms the exact hit normal from already-retained pick state. */
export const canonicalPickWorldNormalInto = (
  target: [number, number, number],
  hit: MutableCanonicalPickHit,
  geometry: CanonicalTriangleGeometry,
  inverseModel: Mat4,
): [number, number, number] => {
  canonicalPickLocalNormalInto(target, hit, geometry);
  const localX = target[0];
  const localY = target[1];
  const localZ = target[2];
  if (normalizeVec3Into(
    target,
    inverseModel[0] * localX + inverseModel[1] * localY + inverseModel[2] * localZ,
    inverseModel[4] * localX + inverseModel[5] * localY + inverseModel[6] * localZ,
    inverseModel[8] * localX + inverseModel[9] * localY + inverseModel[10] * localZ,
  )) return target;
  target[0] = 0;
  target[1] = 0;
  target[2] = -1;
  return target;
};

export type CanonicalLocalPickRay = Readonly<{
  readonly direction: readonly [number, number, number];
  readonly origin: readonly [number, number, number];
}>;

type MutableLocalRay = {
  readonly direction: [number, number, number];
  readonly origin: [number, number, number];
};

export type CanonicalLocalPickRayFootprint = Readonly<{
  x: CanonicalLocalPickRay;
  y: CanonicalLocalPickRay;
}>;

export type CanonicalPickingScratch = Readonly<{
  exactHit: MutableExactSurfaceHit;
  localFootprint: Readonly<{ x: MutableLocalRay; y: MutableLocalRay }>;
  localRay: MutableLocalRay;
  triangleHit: MutableTriangleHit;
}>;

type MutableTriangleHit = {
  distance: number;
  u: number;
  v: number;
};

type MutableExactSurfaceHit = Omit<MutableCanonicalPickHit, "surfaceIndex">;

export type CanonicalPickHitAcceptance = (
  surface: CanonicalPickSurface,
  aIndex: number,
  bIndex: number,
  cIndex: number,
  barycentricB: number,
  barycentricC: number,
  footprint?: CanonicalLocalPickRayFootprint,
) => boolean;

export const createCanonicalPickingScratch = (): CanonicalPickingScratch => ({
  exactHit: {
    aIndex: -1,
    barycentricB: 0,
    barycentricC: 0,
    bIndex: -1,
    cIndex: -1,
    distance: 0,
  },
  localFootprint: {
    x: { direction: [0, 0, -1], origin: [0, 0, 0] },
    y: { direction: [0, 0, -1], origin: [0, 0, 0] },
  },
  localRay: {
    direction: [0, 0, -1],
    origin: [0, 0, 0],
  },
  triangleHit: { distance: 0, u: 0, v: 0 },
});

const transformRayInto = (
  target: MutableLocalRay,
  ray: CanonicalPickRay,
  inverseModel: Mat4,
): void => {
  const origin = target.origin;
  const direction = target.direction;
  const x = ray.origin[0];
  const y = ray.origin[1];
  const z = ray.origin[2];
  origin[0] = inverseModel[0] * x + inverseModel[4] * y + inverseModel[8] * z + inverseModel[12];
  origin[1] = inverseModel[1] * x + inverseModel[5] * y + inverseModel[9] * z + inverseModel[13];
  origin[2] = inverseModel[2] * x + inverseModel[6] * y + inverseModel[10] * z + inverseModel[14];
  const dx = ray.direction[0];
  const dy = ray.direction[1];
  const dz = ray.direction[2];
  direction[0] = inverseModel[0] * dx + inverseModel[4] * dy + inverseModel[8] * dz;
  direction[1] = inverseModel[1] * dx + inverseModel[5] * dy + inverseModel[9] * dz;
  direction[2] = inverseModel[2] * dx + inverseModel[6] * dy + inverseModel[10] * dz;
};

const rayIntersectsBounds = (
  ray: MutableLocalRay,
  surface: CanonicalPickSurface,
  minDistance: number,
  maxDistance: number,
): boolean => {
  let near = minDistance;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis]!;
    const direction = ray.direction[axis]!;
    const min = surface.pickingGeometry.bounds.min[axis]!;
    const max = surface.pickingGeometry.bounds.max[axis]!;
    if (direction === 0) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / direction;
    const second = (max - origin) / direction;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return true;
};

const triangleDistance = (
  target: MutableTriangleHit,
  positions: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
  ray: MutableLocalRay,
  doubleSided: boolean,
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
  if (
    !Number.isFinite(determinant)
    || (doubleSided ? determinant === 0 : !(determinant > 0))
  ) return false;
  const inverseDeterminant = 1 / determinant;
  const relativeX = ray.origin[0] - positions[a]!;
  const relativeY = ray.origin[1] - positions[a + 1]!;
  const relativeZ = ray.origin[2] - positions[a + 2]!;
  const u = (relativeX * pX + relativeY * pY + relativeZ * pZ) * inverseDeterminant;
  if (u < 0 || u > 1) return false;
  const qX = relativeY * edge1Z - relativeZ * edge1Y;
  const qY = relativeZ * edge1X - relativeX * edge1Z;
  const qZ = relativeX * edge1Y - relativeY * edge1X;
  const v = (ray.direction[0] * qX + ray.direction[1] * qY + ray.direction[2] * qZ)
    * inverseDeterminant;
  if (v < 0 || u + v > 1) return false;
  target.distance = (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverseDeterminant;
  target.u = u;
  target.v = v;
  return true;
};

const exactSurfaceHitInto = (
  target: MutableExactSurfaceHit,
  surface: CanonicalPickSurface,
  ray: MutableLocalRay,
  minDistance: number,
  maxDistance: number,
  triangleHit: MutableTriangleHit,
  acceptsHit?: CanonicalPickHitAcceptance,
  footprint?: CanonicalLocalPickRayFootprint,
): boolean => {
  const { indices, positions } = surface.pickingGeometry;
  let nearest = maxDistance;
  let hit = false;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const aIndex = indices[index]!;
    const bIndex = indices[index + 1]!;
    const cIndex = indices[index + 2]!;
    if (!triangleDistance(
      triangleHit,
      positions,
      aIndex,
      bIndex,
      cIndex,
      ray,
      surface.doubleSided === true,
    )) continue;
    const distance = triangleHit.distance;
    if (
      distance >= minDistance
      && distance <= nearest
      && (acceptsHit === undefined || acceptsHit(
        surface,
        aIndex,
        bIndex,
        cIndex,
        triangleHit.u,
        triangleHit.v,
        footprint,
      ))
    ) {
      nearest = distance;
      hit = true;
      target.aIndex = aIndex;
      target.barycentricB = triangleHit.u;
      target.barycentricC = triangleHit.v;
      target.bIndex = bIndex;
      target.cIndex = cIndex;
      target.distance = distance;
    }
  }
  return hit;
};

/** Exact, allocation-free query shared by pointer and future XR ray adapters. */
export const pickCanonicalSurfaceInto = (
  target: MutableCanonicalPickHit,
  ray: CanonicalPickRay,
  surfaces: readonly CanonicalPickSurface[],
  scratch: CanonicalPickingScratch,
  selectedLodLevels?: LodLevelSelections,
  acceptsHit?: CanonicalPickHitAcceptance,
  footprint?: CanonicalPickRayFootprint,
): boolean => {
  let nearest = ray.maxDistance;
  let surfaceIndex = -1;
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index]!;
    if (!lodMembershipsSelected(surface.lods, selectedLodLevels)) continue;
    if (surface.inverseModel === undefined) continue;
    transformRayInto(scratch.localRay, ray, surface.inverseModel);
    const localFootprint = footprint === undefined ? undefined : scratch.localFootprint;
    if (footprint !== undefined) {
      transformRayInto(scratch.localFootprint.x, footprint.x, surface.inverseModel);
      transformRayInto(scratch.localFootprint.y, footprint.y, surface.inverseModel);
    }
    if (!rayIntersectsBounds(scratch.localRay, surface, ray.minDistance, nearest)) continue;
    const hit = exactSurfaceHitInto(
      scratch.exactHit,
      surface,
      scratch.localRay,
      ray.minDistance,
      nearest,
      scratch.triangleHit,
      acceptsHit,
      localFootprint,
    );
    if (hit && (surfaceIndex < 0 || scratch.exactHit.distance < nearest)) {
      nearest = scratch.exactHit.distance;
      surfaceIndex = index;
      target.aIndex = scratch.exactHit.aIndex;
      target.barycentricB = scratch.exactHit.barycentricB;
      target.barycentricC = scratch.exactHit.barycentricC;
      target.bIndex = scratch.exactHit.bIndex;
      target.cIndex = scratch.exactHit.cIndex;
    }
  }
  if (surfaceIndex < 0) return false;
  target.distance = nearest;
  target.surfaceIndex = surfaceIndex;
  return true;
};
