import { canonicalMaterialHasTransmission } from "./canonical-material";
import type { CanonicalDrawSurface } from "./scene-lowering";

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
export const opaqueDepthPrepassRequested = (
  surfaces: readonly CanonicalDrawSurface[],
): boolean => {
  let candidates = 0;
  for (const surface of surfaces) {
    if (!surfaceCanUseOpaqueDepthPrepass(surface)) continue;
    candidates += 1;
    if (candidates >= 32) return true;
  }
  return false;
};
