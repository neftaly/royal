import {
  canonicalMaterialHasTransmission,
  canonicalMaterialHasVolume,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";

export type SurfacePassKind = "opaque" | "transmission" | "transparent";

export type SurfacePassPlan<Surface> = Readonly<{
  opaque: Surface[];
  requiresSceneColor: boolean;
  transmission: Surface[];
  transparent: Surface[];
}>;

/** Pure fixed-pass classification; transmission owns refraction even with authored alpha blend. */
export const canonicalSurfacePassKind = (
  material: CanonicalSurfaceMaterial,
): SurfacePassKind => {
  if (canonicalMaterialHasTransmission(material)) {
    return "transmission";
  }
  return material.alphaBlend === true ? "transparent" : "opaque";
};

/** Whether transmission needs a filtered scene-color mip chain rather than level zero. */
export const canonicalTransmissionNeedsMipmaps = (
  material: CanonicalSurfaceMaterial,
): boolean => canonicalMaterialHasTransmission(material)
  && (material.roughnessFactor >= 0.1 || material.metallicRoughnessAsset !== undefined);

/** glTF ignores authored double-sided state once nonzero thickness defines a volume boundary. */
export const canonicalSurfaceIsDoubleSided = (
  material: CanonicalSurfaceMaterial,
): boolean => material.doubleSided === true && !canonicalMaterialHasVolume(material);

/** Builds cold retained pass buckets without exposing a programmable render graph. */
export const planSurfacePasses = <Surface>(
  surfaces: readonly Surface[],
  materialOf: (surface: Surface) => CanonicalSurfaceMaterial,
): SurfacePassPlan<Surface> => {
  const opaque: Surface[] = [];
  const transmission: Surface[] = [];
  const transparent: Surface[] = [];
  for (const surface of surfaces) {
    switch (canonicalSurfacePassKind(materialOf(surface))) {
      case "opaque": opaque.push(surface); break;
      case "transmission": transmission.push(surface); break;
      case "transparent": transparent.push(surface); break;
    }
  }
  return {
    opaque,
    requiresSceneColor: transmission.length > 0,
    transmission,
    transparent,
  };
};
