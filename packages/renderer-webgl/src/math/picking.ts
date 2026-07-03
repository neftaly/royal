import type { Vec3 } from "@royal/renderer-core";
import {
  transformPoint,
  type Mat4,
} from "./mat4";

export type Ray = {
  readonly direction: Vec3;
  readonly origin: Vec3;
};

export type Bounds3 = {
  readonly max: Vec3;
  readonly min: Vec3;
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

export const worldBounds = (positions: Float32Array, model: Mat4): Bounds3 | undefined => {
  if (positions.length < 3) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = transformPoint(model, [
      positions[index]!,
      positions[index + 1]!,
      positions[index + 2]!,
    ]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    max: [maxX, maxY, maxZ],
    min: [minX, minY, minZ],
  };
};

export const rayAabbDistance = (ray: Ray, bounds: Bounds3): number | undefined => {
  let near = 0;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis]!;
    const direction = ray.direction[axis]!;
    const min = bounds.min[axis]!;
    const max = bounds.max[axis]!;

    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return undefined;
      continue;
    }

    const t1 = (min - origin) / direction;
    const t2 = (max - origin) / direction;
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

const transformedVertex = (positions: Float32Array, vertexIndex: number, model: Mat4): Vec3 | undefined => {
  const index = vertexIndex * 3;
  if (index + 2 >= positions.length) return undefined;

  return transformPoint(model, [
    positions[index]!,
    positions[index + 1]!,
    positions[index + 2]!,
  ]);
};

export const rayGeometryDistance = ({
  indices,
  mode = "triangles",
  model,
  positions,
  ray,
}: {
  readonly indices?: Uint16Array | Uint32Array | Uint8Array;
  readonly mode?: RayGeometryMode;
  readonly model: Mat4;
  readonly positions: Float32Array;
  readonly ray: Ray;
}): number | undefined => {
  let best: number | undefined;
  const consider = (aIndex: number, bIndex: number, cIndex: number): void => {
    const a = transformedVertex(positions, aIndex, model);
    const b = transformedVertex(positions, bIndex, model);
    const c = transformedVertex(positions, cIndex, model);
    if (a === undefined || b === undefined || c === undefined) return;

    const distance = rayTriangleDistance(ray, a, b, c);
    if (distance !== undefined && (best === undefined || distance < best)) best = distance;
  };

  if (indices !== undefined) {
    switch (mode) {
      case "triangle-fan":
        for (let index = 1; index + 1 < indices.length; index += 1) {
          consider(indices[0]!, indices[index]!, indices[index + 1]!);
        }
        break;
      case "triangle-strip":
        for (let index = 0; index + 2 < indices.length; index += 1) {
          consider(indices[index]!, indices[index + 1]!, indices[index + 2]!);
        }
        break;
      case "triangles":
        for (let index = 0; index + 2 < indices.length; index += 3) {
          consider(indices[index]!, indices[index + 1]!, indices[index + 2]!);
        }
        break;
    }
    return best;
  }

  const vertexCount = Math.floor(positions.length / 3);
  switch (mode) {
    case "triangle-fan":
      for (let vertex = 1; vertex + 1 < vertexCount; vertex += 1) {
        consider(0, vertex, vertex + 1);
      }
      break;
    case "triangle-strip":
      for (let vertex = 0; vertex + 2 < vertexCount; vertex += 1) {
        consider(vertex, vertex + 1, vertex + 2);
      }
      break;
    case "triangles":
      for (let vertex = 0; vertex + 2 < vertexCount; vertex += 3) {
        consider(vertex, vertex + 1, vertex + 2);
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
