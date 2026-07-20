import {
  canonicalMaterialHasTransmission,
  canonicalMaterialHasVolume,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";

export type SurfacePassKind = "opaque" | "transmission" | "transparent";
export type SurfaceDrawPass = "all" | "opaque" | "remaining";

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

/** Whether this draw pass reaches work whose ordering depends on the current view. */
export const surfaceDrawPassNeedsDepthOrder = (
  pass: SurfaceDrawPass,
): boolean => pass !== "opaque";

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

/**
 * Builds the fixed pass buckets and groups only opaque draws by stable program
 * and authored-material identity. Order remains stable within every group;
 * transmission and transparent ordering are never changed here.
 */
export const planGroupedSurfacePasses = <Surface>(
  surfaces: readonly Surface[],
  materialOf: (surface: Surface) => CanonicalSurfaceMaterial,
  materialIdentityOf: (surface: Surface) => object,
  programIdentityOf: (surface: Surface) => object,
): SurfacePassPlan<Surface> => {
  const passes = planSurfacePasses(surfaces, materialOf);
  const groups = new Map<object, Map<object, Surface[]>>();
  let materialGroupCount = 0;
  for (const surface of passes.opaque) {
    const programIdentity = programIdentityOf(surface);
    let materialGroups = groups.get(programIdentity);
    if (materialGroups === undefined) {
      materialGroups = new Map<object, Surface[]>();
      groups.set(programIdentity, materialGroups);
    }
    const materialIdentity = materialIdentityOf(surface);
    const group = materialGroups.get(materialIdentity);
    if (group === undefined) {
      materialGroups.set(materialIdentity, [surface]);
      materialGroupCount += 1;
    } else group.push(surface);
  }
  if (materialGroupCount < 2) return passes;
  const opaque = Array<Surface>(passes.opaque.length);
  let index = 0;
  for (const materialGroups of groups.values()) {
    for (const group of materialGroups.values()) {
      for (const surface of group) {
        opaque[index] = surface;
        index += 1;
      }
    }
  }
  return { ...passes, opaque };
};
