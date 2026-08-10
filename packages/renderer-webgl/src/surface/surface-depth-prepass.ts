import { canonicalMaterialHasTransmission } from "./canonical-material";
import type { CanonicalDrawSurface } from "./scene-lowering";

export type OpaqueDepthPrepassPlan = {
  candidateCount: number;
  /** Summed candidate AABB area / aggregate AABB area when viewed along X/Y/Z. */
  readonly facingCoverage: [number, number, number];
  readonly max: [number, number, number];
  readonly min: [number, number, number];
};

const OUTSIDE_MULTISAMPLED_COVERAGE_THRESHOLD = 2;

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
  const { facingCoverage, max, min } = plan;
  facingCoverage.fill(0);
  min[0] = Infinity;
  min[1] = Infinity;
  min[2] = Infinity;
  max[0] = -Infinity;
  max[1] = -Infinity;
  max[2] = -Infinity;
  for (const surface of surfaces) {
    if (!surfaceCanUseOpaqueDepthPrepass(surface)) continue;
    candidates += 1;
    const x = Math.max(0, surface.worldBounds.max[0] - surface.worldBounds.min[0]);
    const y = Math.max(0, surface.worldBounds.max[1] - surface.worldBounds.min[1]);
    const z = Math.max(0, surface.worldBounds.max[2] - surface.worldBounds.min[2]);
    facingCoverage[0] += y * z;
    facingCoverage[1] += x * z;
    facingCoverage[2] += x * y;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, surface.worldBounds.min[axis]!);
      max[axis] = Math.max(max[axis]!, surface.worldBounds.max[axis]!);
    }
  }
  plan.candidateCount = candidates;
  const x = Math.max(0, max[0] - min[0]);
  const y = Math.max(0, max[1] - min[1]);
  const z = Math.max(0, max[2] - min[2]);
  facingCoverage[0] /= y * z || 1;
  facingCoverage[1] /= x * z || 1;
  facingCoverage[2] /= x * y || 1;
  return plan;
};

export const planOpaqueDepthPrepass = (
  surfaces: readonly CanonicalDrawSurface[],
): OpaqueDepthPrepassPlan => updateOpaqueDepthPrepassPlan({
  candidateCount: 0,
  facingCoverage: [0, 0, 0],
  max: [-Infinity, -Infinity, -Infinity],
  min: [Infinity, Infinity, Infinity],
}, surfaces);

/**
 * Position-only depth work is useful only after enough opaque draws and either
 * while the camera is inside their aggregate volume or when a direct
 * multisampled view has substantial camera-facing retained-bound overlap.
 */
export const opaqueDepthPrepassRequested = (
  plan: OpaqueDepthPrepassPlan,
  cameraPosition: ArrayLike<number>,
  active = false,
  multisampledDirect = false,
): boolean => {
  if (plan.candidateCount < 32) return false;
  const margin = active ? 0.05 : 0;
  let outsideAxis = -1;
  let outsideDistance = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const padding = (plan.max[axis]! - plan.min[axis]!) * margin;
    const extent = plan.max[axis]! - plan.min[axis]! || 1;
    const below = plan.min[axis]! - padding - cameraPosition[axis]!;
    const above = cameraPosition[axis]! - plan.max[axis]! - padding;
    const distance = Math.max(below, above, 0) / extent;
    if (distance > outsideDistance) {
      outsideAxis = axis;
      outsideDistance = distance;
    }
  }
  if (outsideAxis < 0) return true;
  if (!multisampledDirect) return false;
  return plan.facingCoverage[outsideAxis]! >= OUTSIDE_MULTISAMPLED_COVERAGE_THRESHOLD;
};
