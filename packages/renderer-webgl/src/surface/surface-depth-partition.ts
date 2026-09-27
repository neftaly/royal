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
  // Sort each axis once. Descendants filter these ordered lists in linear
  // time instead of sorting all three axes again at every tree level.
  const indices = Array.from({ length: surfaces.length }, (_, index) => index);
  const sorted = [0, 1, 2].map(axis => [...indices].sort((left, right) =>
    surfaces[left]!.surface.worldBounds.min[axis]!
      - surfaces[right]!.surface.worldBounds.min[axis]! || left - right));
  const build = (members: number[], axes: number[][], depth: number): SurfaceDepthPartition<Surface> => {
    const count = members.length;
    let bestAxis = -1, splitMin = 0, bestBalance = 0, plane = 0;
    if (count > 1 && depth > 0) {
      for (let axis = 0; axis < 3; axis++) {
        const ordered = axes[axis]!;
        let lowerMax = -Infinity;
        for (let index = 1; index < count; index++) {
          lowerMax = Math.max(lowerMax, surfaces[ordered[index - 1]!]!.surface.worldBounds.max[axis]!);
          const upperMin = surfaces[ordered[index]!]!.surface.worldBounds.min[axis]!;
          const balance = Math.min(index, count - index);
          const lowerMin = surfaces[ordered[index - 1]!]!.surface.worldBounds.min[axis]!;
          if (lowerMax <= upperMin && lowerMin < upperMin && balance > bestBalance) {
            bestAxis = axis;
            splitMin = upperMin;
            bestBalance = balance;
            plane = lowerMax * 0.5 + upperMin * 0.5;
          }
        }
      }
    }
    if (bestAxis < 0) return { count, surfaces: members.map(index => surfaces[index]!) };
    const lower: number[] = [], upper: number[] = [];
    const below = (index: number) => surfaces[index]!.surface.worldBounds.min[bestAxis]! < splitMin;
    for (const index of members) (below(index) ? lower : upper).push(index);
    const lowerAxes = [[], [], []] as number[][], upperAxes = [[], [], []] as number[][];
    for (let axis = 0; axis < 3; axis++) for (const index of axes[axis]!) {
      (below(index) ? lowerAxes[axis]! : upperAxes[axis]!).push(index);
    }
    return { count, axis: bestAxis, plane,
      lower: build(lower, lowerAxes, depth - 1), upper: build(upper, upperAxes, depth - 1) };
  };
  return build(indices, sorted, remainingDepth);
};

/** Reuses geometric splits after binding-only replacement of the same draw members.
 * Bounds mutation still requires explicit invalidation by the geometry owner. */
export const rebindSurfaceDepthPartition = <Surface extends DepthOrderedSurface>(
  partition: SurfaceDepthPartition<Surface>,
  surfaces: readonly Surface[],
  identity: (surface: Surface) => number,
): SurfaceDepthPartition<Surface> | undefined => {
  if (partition.count !== surfaces.length) return undefined;
  const replacements = new Map(surfaces.map(surface => [identity(surface), surface]));
  if (replacements.size !== surfaces.length) return undefined;
  const rebind = (part: SurfaceDepthPartition<Surface>): SurfaceDepthPartition<Surface> | undefined => {
    if ("surfaces" in part) {
      const next: Surface[] = [];
      for (const previous of part.surfaces) {
        const replacement = replacements.get(identity(previous));
        if (replacement === undefined || replacement.surface.worldBounds !== previous.surface.worldBounds) return undefined;
        next.push(replacement);
      }
      return { count: part.count, surfaces: next };
    }
    const lower = rebind(part.lower);
    if (lower === undefined) return undefined;
    const upper = rebind(part.upper);
    return upper === undefined ? undefined : { ...part, lower, upper };
  };
  return rebind(partition);
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
