import type { Mat4 } from "../math/mat4";
import type { WorldBounds } from "./surface-visibility";

export type DepthOrderedSurface = Readonly<{
  surface: Readonly<{ worldBounds: WorldBounds }>;
}>;

const viewDepth = (bounds: WorldBounds, view: Mat4): number => {
  const x = (bounds.min[0] + bounds.max[0]) * 0.5;
  const y = (bounds.min[1] + bounds.max[1]) * 0.5;
  const z = (bounds.min[2] + bounds.max[2]) * 0.5;
  const depth = view[2] * x + view[6] * y + view[10] * z + view[14];
  return Number.isFinite(depth) ? depth : 0;
};

/** Stable O(n log n) depth order using only caller-retained workspace. */
export const sortSurfacesBackToFrontInto = <Surface extends DepthOrderedSurface>(
  surfaces: Surface[],
  view: Mat4,
  depths: Float64Array,
  scratchSurfaces: Surface[],
  scratchDepths: Float64Array,
): void => {
  const count = surfaces.length;
  if (count < 2) return;
  if (
    depths.length < count
    || scratchSurfaces.length < count
    || scratchDepths.length < count
  ) throw new RangeError("Royal surface depth-order workspace is too small");

  let alreadyOrdered = true;
  let previousDepth = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const depth = viewDepth(surfaces[index]!.surface.worldBounds, view);
    depths[index] = depth;
    if (depth < previousDepth) alreadyOrdered = false;
    previousDepth = depth;
  }
  if (alreadyOrdered) return;

  let sourceSurfaces = surfaces;
  let sourceDepths = depths;
  let targetSurfaces = scratchSurfaces;
  let targetDepths = scratchDepths;
  for (let width = 1; width < count; width *= 2) {
    for (let start = 0; start < count; start += width * 2) {
      const middle = Math.min(start + width, count);
      const end = Math.min(start + width * 2, count);
      let left = start;
      let right = middle;
      for (let output = start; output < end; output += 1) {
        const takeLeft = right >= end
          || (left < middle && sourceDepths[left]! <= sourceDepths[right]!);
        const selected = takeLeft ? left++ : right++;
        targetSurfaces[output] = sourceSurfaces[selected]!;
        targetDepths[output] = sourceDepths[selected]!;
      }
    }
    const previousSourceSurfaces = sourceSurfaces;
    sourceSurfaces = targetSurfaces;
    targetSurfaces = previousSourceSurfaces;
    const previousSourceDepths = sourceDepths;
    sourceDepths = targetDepths;
    targetDepths = previousSourceDepths;
  }
  if (sourceSurfaces === surfaces) return;
  for (let index = 0; index < count; index += 1) {
    surfaces[index] = sourceSurfaces[index]!;
  }
};
