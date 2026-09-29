import type { Mat4 } from "../math/mat4";
import type { WorldBounds } from "./surface-visibility";

export type DepthOrderedSurface = {
  depthOrder: number;
  readonly surface: Readonly<{ worldBounds: WorldBounds }>;
};

export type TransmissionDepthOrderedSurface = DepthOrderedSurface & Readonly<{
  /** Cold retained state-run order; equal values may be depth-sorted together. */
  depthOrderGroup?: number;
  drawPacket: Readonly<{ alphaBlend: boolean }>;
}>;

const viewDepth = (bounds: WorldBounds, view: Mat4): number => {
  const x = (bounds.min[0] + bounds.max[0]) * 0.5;
  const y = (bounds.min[1] + bounds.max[1]) * 0.5;
  const z = (bounds.min[2] + bounds.max[2]) * 0.5;
  const depth = view[2] * x + view[6] * y + view[10] * z + view[14];
  return Number.isFinite(depth) ? depth : 0;
};

const compareDepthOrder = (left: DepthOrderedSurface, right: DepthOrderedSurface): number =>
  left.depthOrder - right.depthOrder;

const compareFrontToBackDepthOrder = (
  left: DepthOrderedSurface,
  right: DepthOrderedSurface,
): number => right.depthOrder - left.depthOrder;

const compareTransmissionDepthOrder = (
  left: TransmissionDepthOrderedSurface,
  right: TransmissionDepthOrderedSurface,
): number => {
  const leftBlends = left.drawPacket.alphaBlend;
  const rightBlends = right.drawPacket.alphaBlend;
  if (leftBlends !== rightBlends) return leftBlends ? 1 : -1;
  if (!leftBlends) {
    const groupOrder = (left.depthOrderGroup ?? 0) - (right.depthOrderGroup ?? 0);
    if (groupOrder !== 0) return groupOrder;
  }
  return leftBlends
    ? left.depthOrder - right.depthOrder
    : right.depthOrder - left.depthOrder;
};

const sortSurfaces = <Surface extends DepthOrderedSurface>(
  surfaces: Surface[],
  view: Mat4,
  compare: (left: Surface, right: Surface) => number,
): void => {
  const count = surfaces.length;
  if (count < 2) return;
  let alreadyOrdered = true;
  let previous: Surface | undefined;
  for (let index = 0; index < count; index += 1) {
    const surface = surfaces[index]!;
    surface.depthOrder = viewDepth(surface.surface.worldBounds, view);
    if (previous !== undefined && compare(previous, surface) > 0) alreadyOrdered = false;
    previous = surface;
  }
  if (!alreadyOrdered) surfaces.sort(compare);
};

/** Uses the engines' stable sort only when the retained run is no longer ordered. */
export const sortSurfacesBackToFront = <Surface extends DepthOrderedSurface>(
  surfaces: Surface[],
  view: Mat4,
): void => sortSurfaces(surfaces, view, compareDepthOrder);

/**
 * Stably orders each retained state-equivalent run for early depth rejection.
 * Small runs use insertion sort. Large runs use stable mergesort: state-equivalent
 * runs are not size-limited, so a camera reversal must not cause quadratic work.
 * The caller can retain scratch capacity; used slots are cleared of references.
 */
export const sortSurfaceRunsFrontToBack = <Surface extends DepthOrderedSurface>(
  surfaces: Surface[],
  runEnds: Uint32Array,
  view: Mat4,
  scratch?: Array<Surface | undefined>,
): void => {
  for (let runStart = 0; runStart < surfaces.length;) {
    const runEnd = runEnds[runStart] ?? runStart + 1;
    let alreadyOrdered = true;
    for (let index = runStart; index < runEnd; index += 1) {
      const surface = surfaces[index]!;
      surface.depthOrder = viewDepth(surface.surface.worldBounds, view);
      if (
        index > runStart
        && compareFrontToBackDepthOrder(surfaces[index - 1]!, surface) > 0
      ) alreadyOrdered = false;
    }
    if (!alreadyOrdered && runEnd - runStart > 32) {
      const work = scratch ??= [];
      for (let width = 1; width < runEnd - runStart; width *= 2) {
        for (let start = runStart; start < runEnd; start += width * 2) {
          const middle = Math.min(start + width, runEnd);
          const end = Math.min(start + width * 2, runEnd);
          if (middle === end || compareFrontToBackDepthOrder(surfaces[middle - 1]!, surfaces[middle]!) <= 0) continue;
          let left = start, right = middle, count = 0;
          while (left < middle || right < end) {
            work[count++] = right === end || (left < middle
              && compareFrontToBackDepthOrder(surfaces[left]!, surfaces[right]!) <= 0)
              ? surfaces[left++]! : surfaces[right++]!;
          }
          for (let index = 0; index < count; index++) {
            surfaces[start + index] = work[index]!;
            work[index] = undefined;
          }
        }
      }
    } else if (!alreadyOrdered) {
      for (let index = runStart + 1; index < runEnd; index += 1) {
        const surface = surfaces[index]!;
        let destination = index;
        while (
          destination > runStart
          && compareFrontToBackDepthOrder(surfaces[destination - 1]!, surface) > 0
        ) {
          surfaces[destination] = surfaces[destination - 1]!;
          destination -= 1;
        }
        surfaces[destination] = surface;
      }
    }
    runStart = runEnd;
  }
};

/**
 * Depth-writing transmission stays within cold state-equivalent runs and sorts
 * front-to-back inside each run. Alpha-blended transmission follows it in one
 * global back-to-front order.
 */
export const sortTransmissionSurfaces = <Surface extends TransmissionDepthOrderedSurface>(
  surfaces: Surface[],
  view: Mat4,
): void => {
  sortSurfaces(surfaces, view, compareTransmissionDepthOrder);
};
