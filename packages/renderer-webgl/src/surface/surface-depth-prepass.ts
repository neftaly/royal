import { canonicalMaterialHasTransmission } from "./canonical-material";
import type { CanonicalDrawSurface } from "./scene-lowering";

export type OpaqueDepthPrepassPlan = {
  candidateCount: number;
  readonly max: [number, number, number];
  readonly min: [number, number, number];
};

export const surfaceCanUseOpaqueDepthPrepass = (surface: CanonicalDrawSurface): boolean => (
  surface.topology !== "lines"
  && surface.material.kind === "standard"
  && surface.material.alphaBlend !== true
  && surface.material.alphaCutoff === undefined
  && !canonicalMaterialHasTransmission(surface.material)
);

/**
 * A position-only pass amortizes its extra vertex work only across scenes with
 * enough retained opaque surfaces to expose substantial hidden fragment work.
 */
export const updateOpaqueDepthPrepassPlan = (
  plan: OpaqueDepthPrepassPlan,
  surfaces: readonly CanonicalDrawSurface[],
): OpaqueDepthPrepassPlan => {
  let candidates = 0;
  const { max, min } = plan;
  min[0] = Infinity;
  min[1] = Infinity;
  min[2] = Infinity;
  max[0] = -Infinity;
  max[1] = -Infinity;
  max[2] = -Infinity;
  for (const surface of surfaces) {
    if (!surfaceCanUseOpaqueDepthPrepass(surface)) continue;
    candidates += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, surface.worldBounds.min[axis]!);
      max[axis] = Math.max(max[axis]!, surface.worldBounds.max[axis]!);
    }
  }
  plan.candidateCount = candidates;
  return plan;
};

export const planOpaqueDepthPrepass = (
  surfaces: readonly CanonicalDrawSurface[],
): OpaqueDepthPrepassPlan => updateOpaqueDepthPrepassPlan({
  candidateCount: 0,
  max: [-Infinity, -Infinity, -Infinity],
  min: [Infinity, Infinity, Infinity],
}, surfaces);

/**
 * Position-only depth work is useful only after enough opaque draws and while
 * the camera is inside their aggregate volume, where hidden fragments dominate.
 */
export const opaqueDepthPrepassRequested = (
  plan: OpaqueDepthPrepassPlan,
  cameraPosition: ArrayLike<number>,
  active = false,
): boolean => {
  if (plan.candidateCount < 32) return false;
  const margin = active ? 0.05 : 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const padding = (plan.max[axis]! - plan.min[axis]!) * margin;
    if (
      cameraPosition[axis]! < plan.min[axis]! - padding
      || cameraPosition[axis]! > plan.max[axis]! + padding
    ) return false;
  }
  return true;
};
