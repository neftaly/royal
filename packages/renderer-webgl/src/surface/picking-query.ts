import type { Vec3 } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import type { CanonicalPickSurface } from "./scene-lowering";

export type CanonicalPickRay = Readonly<{
  direction: Vec3;
  maxDistance: number;
  minDistance: number;
  origin: Vec3;
}>;

export type MutableCanonicalPickHit = {
  distance: number;
  surfaceIndex: number;
};

type MutableLocalRay = {
  readonly direction: [number, number, number];
  readonly origin: [number, number, number];
};

export type CanonicalPickingScratch = Readonly<{
  localRay: MutableLocalRay;
}>;

export const createCanonicalPickingScratch = (): CanonicalPickingScratch => ({
  localRay: {
    direction: [0, 0, -1],
    origin: [0, 0, 0],
  },
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
  positions: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
  ray: MutableLocalRay,
  handedness: 1 | -1,
): number | undefined => {
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
  const determinant = (edge1X * pX + edge1Y * pY + edge1Z * pZ) * handedness;
  if (!(determinant > 0) || !Number.isFinite(determinant)) return undefined;
  const inverseDeterminant = handedness / determinant;
  const relativeX = ray.origin[0] - positions[a]!;
  const relativeY = ray.origin[1] - positions[a + 1]!;
  const relativeZ = ray.origin[2] - positions[a + 2]!;
  const u = (relativeX * pX + relativeY * pY + relativeZ * pZ) * inverseDeterminant;
  if (u < 0 || u > 1) return undefined;
  const qX = relativeY * edge1Z - relativeZ * edge1Y;
  const qY = relativeZ * edge1X - relativeX * edge1Z;
  const qZ = relativeX * edge1Y - relativeY * edge1X;
  const v = (ray.direction[0] * qX + ray.direction[1] * qY + ray.direction[2] * qZ)
    * inverseDeterminant;
  if (v < 0 || u + v > 1) return undefined;
  return (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverseDeterminant;
};

const exactSurfaceDistance = (
  surface: CanonicalPickSurface,
  ray: MutableLocalRay,
  minDistance: number,
  maxDistance: number,
): number | undefined => {
  const { indices, positions } = surface.pickingGeometry;
  let nearest = maxDistance;
  let hit = false;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const distance = triangleDistance(
      positions,
      indices[index]!,
      indices[index + 1]!,
      indices[index + 2]!,
      ray,
      surface.modelHandedness,
    );
    if (distance !== undefined && distance >= minDistance && distance <= nearest) {
      nearest = distance;
      hit = true;
    }
  }
  return hit ? nearest : undefined;
};

/** Exact, allocation-free query shared by pointer and future XR ray adapters. */
export const pickCanonicalSurfaceInto = (
  target: MutableCanonicalPickHit,
  ray: CanonicalPickRay,
  surfaces: readonly CanonicalPickSurface[],
  scratch: CanonicalPickingScratch,
): boolean => {
  let nearest = ray.maxDistance;
  let surfaceIndex = -1;
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index]!;
    if (surface.inverseModel === undefined) continue;
    transformRayInto(scratch.localRay, ray, surface.inverseModel);
    if (!rayIntersectsBounds(scratch.localRay, surface, ray.minDistance, nearest)) continue;
    const distance = exactSurfaceDistance(surface, scratch.localRay, ray.minDistance, nearest);
    if (distance !== undefined && (surfaceIndex < 0 || distance < nearest)) {
      nearest = distance;
      surfaceIndex = index;
    }
  }
  if (surfaceIndex < 0) return false;
  target.distance = nearest;
  target.surfaceIndex = surfaceIndex;
  return true;
};
