import {
  rayTriangleInto as triangleDistance,
  type TriangleHit as MutableTriangleHit,
} from "../math/ray-triangle";
import type { Vec3 } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import { lodMembershipsSelected, type LodLevelSelections } from "./lod-selection";
import type { CanonicalPickSurface } from "./scene-lowering";

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
  distance: number;
  surfaceIndex: number;
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
  localFootprint: Readonly<{ x: MutableLocalRay; y: MutableLocalRay }>;
  localRay: MutableLocalRay;
  triangleHit: MutableTriangleHit;
}>;

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

const exactSurfaceDistance = (
  surface: CanonicalPickSurface,
  ray: MutableLocalRay,
  minDistance: number,
  maxDistance: number,
  triangleHit: MutableTriangleHit,
  acceptsHit?: CanonicalPickHitAcceptance,
  footprint?: CanonicalLocalPickRayFootprint,
): number | undefined => {
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
      surface.modelHandedness,
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
    const distance = exactSurfaceDistance(
      surface,
      scratch.localRay,
      ray.minDistance,
      nearest,
      scratch.triangleHit,
      acceptsHit,
      localFootprint,
    );
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
