import type { Mat4 } from "../math/mat4";
import { sortSurfacesBackToFront, type DepthOrderedSurface } from "./surface-depth-order";

export type SurfaceDepthPartition<Surface> = Readonly<{
  count: number;
}> & (
  | Readonly<{ surfaces: Surface[] }>
  | Readonly<{
    axis: number;
    plane: number;
    lower: SurfaceDepthPartition<Surface>;
    upper: SurfaceDepthPartition<Surface>;
  }>
);

/**
 * Cold, conservative BSP over whole draw bounds. Only empty separating planes
 * are accepted (including touching bounds): no triangle splitting or changes to
 * authored alpha. Inseparable groups retain the centre-depth approximation.
 * The depth limit bounds construction work and recursion for adversarial scenes.
 */
export const planSurfaceDepthPartition = <Surface extends DepthOrderedSurface>(
  surfaces: readonly Surface[],
  remainingDepth = 32,
): SurfaceDepthPartition<Surface> => {
  const count = surfaces.length;
  let bestAxis = -1;
  let splitMin = 0;
  let bestBalance = 0;
  let plane = 0;
  if (count > 1 && remainingDepth > 0) {
    const indices = Array.from({ length: count }, (_, index) => index);
    for (let axis = 0; axis < 3; axis += 1) {
      indices.sort((left, right) =>
        surfaces[left]!.surface.worldBounds.min[axis]!
          - surfaces[right]!.surface.worldBounds.min[axis]! || left - right);
      let lowerMax = -Infinity;
      for (let index = 1; index < count; index += 1) {
        lowerMax = Math.max(lowerMax, surfaces[indices[index - 1]!]!.surface.worldBounds.max[axis]!);
        const upperMin = surfaces[indices[index]!]!.surface.worldBounds.min[axis]!;
        const balance = Math.min(index, count - index);
        // Keep equal-minimum groups together, particularly coplanar faces.
        const lowerMin = surfaces[indices[index - 1]!]!.surface.worldBounds.min[axis]!;
        if (lowerMax <= upperMin && lowerMin < upperMin && balance > bestBalance) {
          bestAxis = axis;
          splitMin = upperMin;
          bestBalance = balance;
          plane = lowerMax * 0.5 + upperMin * 0.5;
        }
      }
    }
  }
  if (bestAxis < 0) return { count, surfaces: [...surfaces] };
  const lower: Surface[] = [];
  const upper: Surface[] = [];
  for (const surface of surfaces) {
    (surface.surface.worldBounds.min[bestAxis]! < splitMin ? lower : upper).push(surface);
  }
  return {
    count,
    axis: bestAxis,
    plane,
    lower: planSurfaceDepthPartition(lower, remainingDepth - 1),
    upper: planSurfaceDepthPartition(upper, remainingDepth - 1),
  };
};

/** Allocation-free camera traversal; the caller invalidates the plan on bounds/membership changes. */
export const sortSurfaceDepthPartitionInto = <Surface extends DepthOrderedSurface>(
  output: Surface[],
  partition: SurfaceDepthPartition<Surface>,
  view: Mat4,
  cameraPosition: ArrayLike<number>,
  perspective: boolean,
  offset = 0,
): number => {
  if ("surfaces" in partition) {
    sortSurfacesBackToFront(partition.surfaces, view);
    for (const surface of partition.surfaces) output[offset++] = surface;
    return offset;
  }
  // Perspective rays share an eye; orthographic rays share a direction.
  const lowerFirst = perspective
    ? cameraPosition[partition.axis]! >= partition.plane
    : view[partition.axis * 4 + 2]! >= 0;
  const next = sortSurfaceDepthPartitionInto(
    output, lowerFirst ? partition.lower : partition.upper,
    view, cameraPosition, perspective, offset,
  );
  return sortSurfaceDepthPartitionInto(
    output, lowerFirst ? partition.upper : partition.lower,
    view, cameraPosition, perspective, next,
  );
};
