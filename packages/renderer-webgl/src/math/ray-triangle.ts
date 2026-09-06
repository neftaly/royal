import type { Vec3 } from "@royal/renderer-core";

type TriangleRay = Readonly<{ origin: Vec3; direction: Vec3 }>;
export type TriangleHit = { distance: number; u: number; v: number };

/** Writes a ray/plane intersection without allocation. Footprint rays may extrapolate beyond triangle edges. */
export const rayTriangleInto = (
  target: TriangleHit,
  positions: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
  ray: TriangleRay,
  handedness: 1 | -1,
  doubleSided: boolean,
  bounded = true,
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
  const determinant = (edge1X * pX + edge1Y * pY + edge1Z * pZ) * handedness;
  if (!Number.isFinite(determinant) || (doubleSided ? determinant === 0 : !(determinant > 0)))
    return false;
  const inverseDeterminant = handedness / determinant;
  const relativeX = ray.origin[0] - positions[a]!;
  const relativeY = ray.origin[1] - positions[a + 1]!;
  const relativeZ = ray.origin[2] - positions[a + 2]!;
  const u = (relativeX * pX + relativeY * pY + relativeZ * pZ) * inverseDeterminant;
  if (bounded && (u < 0 || u > 1)) return false;
  const qX = relativeY * edge1Z - relativeZ * edge1Y;
  const qY = relativeZ * edge1X - relativeX * edge1Z;
  const qZ = relativeX * edge1Y - relativeY * edge1X;
  const v =
    (ray.direction[0] * qX + ray.direction[1] * qY + ray.direction[2] * qZ) * inverseDeterminant;
  if (bounded && (v < 0 || u + v > 1)) return false;
  target.distance = (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverseDeterminant;
  target.u = u;
  target.v = v;
  return true;
};
