import type { Vec3 } from "@royal/renderer-core";
import type { Mat4 } from "./mat4";

export type Ray = {
  readonly direction: Vec3;
  readonly origin: Vec3;
};

export type Bounds3 = {
  readonly max: Vec3;
  readonly min: Vec3;
};

export type MutableBounds3 = {
  readonly max: [number, number, number];
  readonly min: [number, number, number];
};

const isBoundsOutsideClipPlane = (
  centerX: number,
  centerY: number,
  centerZ: number,
  extentX: number,
  extentY: number,
  extentZ: number,
  planeX: number,
  planeY: number,
  planeZ: number,
  planeW: number,
): boolean =>
  planeX * centerX + planeY * centerY + planeZ * centerZ + planeW
  + Math.abs(planeX) * extentX
  + Math.abs(planeY) * extentY
  + Math.abs(planeZ) * extentZ < 0;

export const isBoundsVisible = (
  bounds: Bounds3 | undefined,
  viewProjectionModel: Mat4,
): boolean => {
  if (bounds === undefined) return false;
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  const extentX = (bounds.max[0] - bounds.min[0]) * 0.5;
  const extentY = (bounds.max[1] - bounds.min[1]) * 0.5;
  const extentZ = (bounds.max[2] - bounds.min[2]) * 0.5;
  const m = viewProjectionModel;

  return !isBoundsOutsideClipPlane(
    centerX, centerY, centerZ, extentX, extentY, extentZ,
    m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12],
  ) && !isBoundsOutsideClipPlane(
    centerX, centerY, centerZ, extentX, extentY, extentZ,
    m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12],
  ) && !isBoundsOutsideClipPlane(
    centerX, centerY, centerZ, extentX, extentY, extentZ,
    m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13],
  ) && !isBoundsOutsideClipPlane(
    centerX, centerY, centerZ, extentX, extentY, extentZ,
    m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13],
  ) && !isBoundsOutsideClipPlane(
    centerX, centerY, centerZ, extentX, extentY, extentZ,
    m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14],
  ) && !isBoundsOutsideClipPlane(
    centerX, centerY, centerZ, extentX, extentY, extentZ,
    m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14],
  );
};

type ClipAxis = 0 | 1 | 2;

const isAffineBoundsOutsideClipPlane = (
  bounds: Bounds3,
  viewProjection: Mat4,
  model: Mat4,
  axis: ClipAxis,
  sign: -1 | 1,
): boolean => {
  const planeX = viewProjection[3] + sign * viewProjection[axis]!;
  const planeY = viewProjection[7] + sign * viewProjection[axis + 4]!;
  const planeZ = viewProjection[11] + sign * viewProjection[axis + 8]!;
  const planeW = viewProjection[15] + sign * viewProjection[axis + 12]!;
  const localX = planeX * model[0] + planeY * model[1] + planeZ * model[2];
  const localY = planeX * model[4] + planeY * model[5] + planeZ * model[6];
  const localZ = planeX * model[8] + planeY * model[9] + planeZ * model[10];
  const localW = planeX * model[12] + planeY * model[13] + planeZ * model[14] + planeW;
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  const extentX = (bounds.max[0] - bounds.min[0]) * 0.5;
  const extentY = (bounds.max[1] - bounds.min[1]) * 0.5;
  const extentZ = (bounds.max[2] - bounds.min[2]) * 0.5;
  return localX * centerX + localY * centerY + localZ * centerZ + localW
    + Math.abs(localX) * extentX
    + Math.abs(localY) * extentY
    + Math.abs(localZ) * extentZ < 0;
};

/** Tests an affine-transformed local AABB without materializing viewProjection * model. */
export const isAffineBoundsVisible = (
  bounds: Bounds3 | undefined,
  viewProjection: Mat4,
  model: Mat4,
): boolean => {
  if (bounds === undefined) return false;
  return !isAffineBoundsOutsideClipPlane(bounds, viewProjection, model, 0, 1)
    && !isAffineBoundsOutsideClipPlane(bounds, viewProjection, model, 0, -1)
    && !isAffineBoundsOutsideClipPlane(bounds, viewProjection, model, 1, 1)
    && !isAffineBoundsOutsideClipPlane(bounds, viewProjection, model, 1, -1)
    && !isAffineBoundsOutsideClipPlane(bounds, viewProjection, model, 2, 1)
    && !isAffineBoundsOutsideClipPlane(bounds, viewProjection, model, 2, -1);
};

/**
 * Resolves the nearest exact hit after ordering candidates by conservative
 * distance bounds. The lower bound permits early exit without changing exact
 * nearest-hit or authored-order tie semantics.
 */
export const nearestExactHitByLowerBound = <Candidate, Hit>(
  candidates: readonly Candidate[],
  lowerBound: (candidate: Candidate) => number,
  exactHit: (candidate: Candidate) => Hit | undefined,
  hitDistance: (hit: Hit) => number,
): Hit | undefined => {
  const ordered = candidates
    .map((candidate, ordinal) => ({ candidate, lowerBound: lowerBound(candidate), ordinal }))
    .sort((left, right) => left.lowerBound - right.lowerBound || left.ordinal - right.ordinal);
  let best: Hit | undefined;
  let bestDistance = Infinity;
  let bestOrdinal = Infinity;
  for (const candidate of ordered) {
    if (candidate.lowerBound > bestDistance) break;
    const hit = exactHit(candidate.candidate);
    if (hit === undefined) continue;
    const distance = hitDistance(hit);
    if (distance < bestDistance || (distance === bestDistance && candidate.ordinal < bestOrdinal)) {
      best = hit;
      bestDistance = distance;
      bestOrdinal = candidate.ordinal;
    }
  }
  return best;
};

export type RayGeometryMode = "triangle-fan" | "triangle-strip" | "triangles";

type Axis = 0 | 1 | 2;

const RAY_TRIANGLE_MIN_DISTANCE = 1e-8;

const nextAxis = (axis: Axis): Axis => axis === 0 ? 1 : axis === 1 ? 2 : 0;

const maximumDirectionAxis = (direction: Vec3): Axis | undefined => {
  const absX = Math.abs(direction[0]);
  const absY = Math.abs(direction[1]);
  const absZ = Math.abs(direction[2]);
  const maximum = Math.max(absX, absY, absZ);
  if (maximum === 0 || !Number.isFinite(maximum)) return undefined;

  if (absX > absY) return absX > absZ ? 0 : 2;
  return absY > absZ ? 1 : 2;
};

const transformBoundsScalarsInto = (
  out: MutableBounds3,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  model: Mat4,
): MutableBounds3 => {
  for (let axis = 0; axis < 3; axis += 1) {
    const x = model[axis]!;
    const y = model[axis + 4]!;
    const z = model[axis + 8]!;
    const translation = model[axis + 12]!;
    const transformedMinX = x * minX;
    const transformedMaxX = x * maxX;
    const transformedMinY = y * minY;
    const transformedMaxY = y * maxY;
    const transformedMinZ = z * minZ;
    const transformedMaxZ = z * maxZ;
    out.min[axis] = translation
      + Math.min(transformedMinX, transformedMaxX)
      + Math.min(transformedMinY, transformedMaxY)
      + Math.min(transformedMinZ, transformedMaxZ);
    out.max[axis] = translation
      + Math.max(transformedMinX, transformedMaxX)
      + Math.max(transformedMinY, transformedMaxY)
      + Math.max(transformedMinZ, transformedMaxZ);
  }
  return out;
};

export const worldBoundsInto = (
  out: MutableBounds3,
  positions: Float32Array,
  model: Mat4,
): MutableBounds3 | undefined => {
  if (positions.length < 3) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return transformBoundsScalarsInto(out, minX, minY, minZ, maxX, maxY, maxZ, model);
};

export const worldBounds = (positions: Float32Array, model: Mat4): Bounds3 | undefined =>
  positions.length < 3
    ? undefined
    : worldBoundsInto({ max: [0, 0, 0], min: [0, 0, 0] }, positions, model);

export const transformBoundsInto = (
  out: MutableBounds3,
  bounds: Bounds3,
  model: Mat4,
): MutableBounds3 => {
  return transformBoundsScalarsInto(
    out,
    bounds.min[0], bounds.min[1], bounds.min[2],
    bounds.max[0], bounds.max[1], bounds.max[2],
    model,
  );
};

export const rayAabbDistance = (ray: Ray, bounds: Bounds3): number | undefined => {
  return rayAabbDistanceScalars(
    ray,
    bounds.min[0], bounds.min[1], bounds.min[2],
    bounds.max[0], bounds.max[1], bounds.max[2],
  );
};

export const rayAabbDistanceScalars = (
  ray: Ray,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | undefined => {
  let near = 0;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis]!;
    const direction = ray.direction[axis]!;
    const axisMin = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const axisMax = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;

    if (Math.abs(direction) < 1e-8) {
      if (origin < axisMin || origin > axisMax) return undefined;
      continue;
    }

    const t1 = (axisMin - origin) / direction;
    const t2 = (axisMax - origin) / direction;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return undefined;
  }

  return near;
};

export const rayTriangleDistance = (
  ray: Ray,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): number | undefined => {
  const kz = maximumDirectionAxis(ray.direction);
  if (kz === undefined) return undefined;

  let kx = nextAxis(kz);
  let ky = nextAxis(kx);
  const directionZ = ray.direction[kz];
  if (directionZ < 0) {
    const previousKx = kx;
    kx = ky;
    ky = previousKx;
  }

  const sx = ray.direction[kx] / directionZ;
  const sy = ray.direction[ky] / directionZ;
  const sz = 1 / directionZ;

  const azRelative = a[kz] - ray.origin[kz];
  const bzRelative = b[kz] - ray.origin[kz];
  const czRelative = c[kz] - ray.origin[kz];

  const ax = a[kx] - ray.origin[kx] - sx * azRelative;
  const ay = a[ky] - ray.origin[ky] - sy * azRelative;
  const bx = b[kx] - ray.origin[kx] - sx * bzRelative;
  const by = b[ky] - ray.origin[ky] - sy * bzRelative;
  const cx = c[kx] - ray.origin[kx] - sx * czRelative;
  const cy = c[ky] - ray.origin[ky] - sy * czRelative;

  const u = cx * by - cy * bx;
  const v = ax * cy - ay * cx;
  const w = bx * ay - by * ax;
  if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) return undefined;

  const determinant = u + v + w;
  if (determinant === 0 || !Number.isFinite(determinant)) return undefined;

  const az = sz * azRelative;
  const bz = sz * bzRelative;
  const cz = sz * czRelative;
  const distance = (u * az + v * bz + w * cz) / determinant;
  return Number.isFinite(distance) && distance > RAY_TRIANGLE_MIN_DISTANCE ? distance : undefined;
};

export type RayGeometryScratch = {
  readonly a: [number, number, number];
  readonly b: [number, number, number];
  readonly c: [number, number, number];
};

export const createRayGeometryScratch = (): RayGeometryScratch => ({
  a: [0, 0, 0],
  b: [0, 0, 0],
  c: [0, 0, 0],
});

const transformedVertexInto = (
  out: [number, number, number],
  positions: Float32Array,
  vertexIndex: number,
  model: Mat4,
): boolean => {
  const index = vertexIndex * 3;
  if (index + 2 >= positions.length) return false;

  const x = positions[index]!;
  const y = positions[index + 1]!;
  const z = positions[index + 2]!;
  const transformedX = model[0] * x + model[4] * y + model[8] * z + model[12];
  const transformedY = model[1] * x + model[5] * y + model[9] * z + model[13];
  const transformedZ = model[2] * x + model[6] * y + model[10] * z + model[14];
  const w = model[3] * x + model[7] * y + model[11] * z + model[15];
  const divisor = w === 0 ? 1 : w;
  out[0] = transformedX / divisor;
  out[1] = transformedY / divisor;
  out[2] = transformedZ / divisor;
  return true;
};

const transformedTriangleDistance = (
  positions: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
  model: Mat4,
  ray: Ray,
  scratch: RayGeometryScratch,
): number | undefined => {
  if (
    !transformedVertexInto(scratch.a, positions, aIndex, model)
    || !transformedVertexInto(scratch.b, positions, bIndex, model)
    || !transformedVertexInto(scratch.c, positions, cIndex, model)
  ) return undefined;
  return rayTriangleDistance(ray, scratch.a, scratch.b, scratch.c);
};

const nearerDistance = (best: number | undefined, candidate: number | undefined): number | undefined =>
  candidate !== undefined && (best === undefined || candidate < best) ? candidate : best;

export const rayGeometryDistanceWithScratch = (
  positions: Float32Array,
  indices: Uint16Array | Uint32Array | Uint8Array | undefined,
  mode: RayGeometryMode,
  model: Mat4,
  ray: Ray,
  scratch: RayGeometryScratch,
): number | undefined => {
  let best: number | undefined;

  if (indices !== undefined) {
    switch (mode) {
      case "triangle-fan":
        for (let index = 1; index + 1 < indices.length; index += 1) {
          best = nearerDistance(best, transformedTriangleDistance(
            positions, indices[0]!, indices[index]!, indices[index + 1]!, model, ray, scratch,
          ));
        }
        break;
      case "triangle-strip":
        for (let index = 0; index + 2 < indices.length; index += 1) {
          best = nearerDistance(best, transformedTriangleDistance(
            positions, indices[index]!, indices[index + 1]!, indices[index + 2]!, model, ray, scratch,
          ));
        }
        break;
      case "triangles":
        for (let index = 0; index + 2 < indices.length; index += 3) {
          best = nearerDistance(best, transformedTriangleDistance(
            positions, indices[index]!, indices[index + 1]!, indices[index + 2]!, model, ray, scratch,
          ));
        }
        break;
    }
    return best;
  }

  const vertexCount = Math.floor(positions.length / 3);
  switch (mode) {
    case "triangle-fan":
      for (let vertex = 1; vertex + 1 < vertexCount; vertex += 1) {
        best = nearerDistance(best, transformedTriangleDistance(
          positions, 0, vertex, vertex + 1, model, ray, scratch,
        ));
      }
      break;
    case "triangle-strip":
      for (let vertex = 0; vertex + 2 < vertexCount; vertex += 1) {
        best = nearerDistance(best, transformedTriangleDistance(
          positions, vertex, vertex + 1, vertex + 2, model, ray, scratch,
        ));
      }
      break;
    case "triangles":
      for (let vertex = 0; vertex + 2 < vertexCount; vertex += 3) {
        best = nearerDistance(best, transformedTriangleDistance(
          positions, vertex, vertex + 1, vertex + 2, model, ray, scratch,
        ));
      }
      break;
  }

  return best;
};

export const pointOnRay = (ray: Ray, distance: number): Vec3 => [
  ray.origin[0] + ray.direction[0] * distance,
  ray.origin[1] + ray.direction[1] * distance,
  ray.origin[2] + ray.direction[2] * distance,
];
