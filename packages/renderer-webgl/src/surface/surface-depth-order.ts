import type { Mat4 } from "../math/mat4";
import type { WorldBounds } from "./surface-visibility";

export type DepthOrderedSurface = {
  depthOrder: number;
  readonly surface: Readonly<{ worldBounds: WorldBounds }>;
};

const viewDepth = (bounds: WorldBounds, view: Mat4): number => {
  const x = (bounds.min[0] + bounds.max[0]) * 0.5;
  const y = (bounds.min[1] + bounds.max[1]) * 0.5;
  const z = (bounds.min[2] + bounds.max[2]) * 0.5;
  const depth = view[2] * x + view[6] * y + view[10] * z + view[14];
  return Number.isFinite(depth) ? depth : 0;
};

const compareDepthOrder = (left: DepthOrderedSurface, right: DepthOrderedSurface): number =>
  left.depthOrder - right.depthOrder;

/** Uses the engines' stable sort only when the retained run is no longer ordered. */
export const sortSurfacesBackToFront = <Surface extends DepthOrderedSurface>(
  surfaces: Surface[],
  view: Mat4,
): void => {
  const count = surfaces.length;
  if (count < 2) return;
  let alreadyOrdered = true;
  let previousDepth = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const surface = surfaces[index]!;
    const depth = viewDepth(surface.surface.worldBounds, view);
    surface.depthOrder = depth;
    if (depth < previousDepth) alreadyOrdered = false;
    previousDepth = depth;
  }
  if (!alreadyOrdered) surfaces.sort(compareDepthOrder);
};
