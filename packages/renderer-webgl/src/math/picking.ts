import type { Vec3 } from "@royal/renderer-core";
import {
  crossVec3,
  dotVec3,
  subtractVec3,
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
  const edge1 = subtractVec3(b, a);
  const edge2 = subtractVec3(c, a);
  const h = crossVec3(ray.direction, edge2);
  const determinant = dotVec3(edge1, h);
  if (Math.abs(determinant) < 1e-8) return undefined;

  const inverseDeterminant = 1 / determinant;
  const s = subtractVec3(ray.origin, a);
  const u = inverseDeterminant * dotVec3(s, h);
  if (u < 0 || u > 1) return undefined;

  const q = crossVec3(s, edge1);
  const v = inverseDeterminant * dotVec3(ray.direction, q);
  if (v < 0 || u + v > 1) return undefined;

  const distance = inverseDeterminant * dotVec3(edge2, q);
  return distance > 1e-8 ? distance : undefined;
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
  model,
  positions,
  ray,
}: {
  readonly indices?: Uint16Array | Uint32Array | Uint8Array;
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
    for (let index = 0; index + 2 < indices.length; index += 3) {
      consider(indices[index]!, indices[index + 1]!, indices[index + 2]!);
    }
    return best;
  }

  const vertexCount = Math.floor(positions.length / 3);
  for (let vertex = 0; vertex + 2 < vertexCount; vertex += 3) {
    consider(vertex, vertex + 1, vertex + 2);
  }

  return best;
};

export const pointOnRay = (ray: Ray, distance: number): Vec3 => [
  ray.origin[0] + ray.direction[0] * distance,
  ray.origin[1] + ray.direction[1] * distance,
  ray.origin[2] + ray.direction[2] * distance,
];
