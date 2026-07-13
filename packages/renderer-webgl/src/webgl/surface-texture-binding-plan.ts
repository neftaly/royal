import type { SurfaceMaterialTextureCoordinates } from "./materials";
import type {
  SurfaceShaderFeatures,
  SurfaceShaderTextureFeature,
} from "./shaders";

export type SurfaceTextureCandidate = "ready" | "unavailable";
export type SurfaceMaterialTextureKey = keyof SurfaceMaterialTextureCoordinates;
export type SurfaceIndependentTextureFeature = Exclude<
  SurfaceShaderTextureFeature,
  | "baseColorTexture"
  | "baseColorVirtualTextureAtlas"
  | "baseColorVirtualTexturePageTable"
>;

export type SurfaceMaterialTextureBindingDescriptor = {
  readonly feature: SurfaceShaderTextureFeature;
  readonly key: SurfaceMaterialTextureKey;
  readonly preferredUnit: number;
  readonly samplerUniform: string;
  readonly useUniform: string;
  readonly uvUniformStem: string;
};

const exhaustiveMaterialBindings = <Bindings extends readonly SurfaceMaterialTextureBindingDescriptor[]>(
  bindings: Bindings & (
    Exclude<SurfaceMaterialTextureKey, "baseColorTexture" | Bindings[number]["key"]> extends never
      ? unknown
      : { readonly missingMaterialTextureBindings: never }
  ),
): Bindings => bindings;

/** Priority is deliberate: emissive, core PBR maps, then optional extension maps. */
export const SURFACE_MATERIAL_TEXTURE_BINDINGS = exhaustiveMaterialBindings([
  { feature: "emissiveTexture", key: "emissiveTexture", preferredUnit: 4, samplerUniform: "u_emissiveTexture", useUniform: "u_useEmissiveTexture", uvUniformStem: "u_emissiveUv" },
  { feature: "metallicRoughnessTexture", key: "metallicRoughnessTexture", preferredUnit: 3, samplerUniform: "u_metallicRoughnessTexture", useUniform: "u_useMetallicRoughnessTexture", uvUniformStem: "u_metallicRoughnessUv" },
  { feature: "normalTexture", key: "normalTexture", preferredUnit: 1, samplerUniform: "u_normalTexture", useUniform: "u_useNormalTexture", uvUniformStem: "u_normalUv" },
  { feature: "occlusionTexture", key: "occlusionTexture", preferredUnit: 5, samplerUniform: "u_occlusionTexture", useUniform: "u_useOcclusionTexture", uvUniformStem: "u_occlusionUv" },
  { feature: "specularTexture", key: "specularTexture", preferredUnit: 6, samplerUniform: "u_specularTexture", useUniform: "u_useSpecularTexture", uvUniformStem: "u_specularUv" },
  { feature: "specularColorTexture", key: "specularColorTexture", preferredUnit: 7, samplerUniform: "u_specularColorTexture", useUniform: "u_useSpecularColorTexture", uvUniformStem: "u_specularColorUv" },
  { feature: "clearcoatTexture", key: "clearcoatTexture", preferredUnit: 8, samplerUniform: "u_clearcoatTexture", useUniform: "u_useClearcoatTexture", uvUniformStem: "u_clearcoatUv" },
  { feature: "clearcoatRoughnessTexture", key: "clearcoatRoughnessTexture", preferredUnit: 9, samplerUniform: "u_clearcoatRoughnessTexture", useUniform: "u_useClearcoatRoughnessTexture", uvUniformStem: "u_clearcoatRoughnessUv" },
  { feature: "sheenColorTexture", key: "sheenColorTexture", preferredUnit: 10, samplerUniform: "u_sheenColorTexture", useUniform: "u_useSheenColorTexture", uvUniformStem: "u_sheenColorUv" },
  { feature: "sheenRoughnessTexture", key: "sheenRoughnessTexture", preferredUnit: 11, samplerUniform: "u_sheenRoughnessTexture", useUniform: "u_useSheenRoughnessTexture", uvUniformStem: "u_sheenRoughnessUv" },
  { feature: "iridescenceTexture", key: "iridescenceTexture", preferredUnit: 12, samplerUniform: "u_iridescenceTexture", useUniform: "u_useIridescenceTexture", uvUniformStem: "u_iridescenceUv" },
  { feature: "iridescenceThicknessTexture", key: "iridescenceThicknessTexture", preferredUnit: 13, samplerUniform: "u_iridescenceThicknessTexture", useUniform: "u_useIridescenceThicknessTexture", uvUniformStem: "u_iridescenceThicknessUv" },
  { feature: "materialTransmissionTexture", key: "materialTransmissionTexture", preferredUnit: 14, samplerUniform: "u_materialTransmissionTexture", useUniform: "u_useMaterialTransmissionTexture", uvUniformStem: "u_materialTransmissionUv" },
  { feature: "thicknessTexture", key: "thicknessTexture", preferredUnit: 15, samplerUniform: "u_thicknessTexture", useUniform: "u_useThicknessTexture", uvUniformStem: "u_thicknessUv" },
] as const);

export type SurfaceBaseColorPlanInput =
  | { readonly kind: "none" }
  | { readonly kind: "ordinary"; readonly ordinary: SurfaceTextureCandidate }
  | {
      readonly fallback?: SurfaceTextureCandidate;
      readonly kind: "virtual";
      readonly virtual: SurfaceTextureCandidate;
    };

export type SurfaceTextureBindingPlanInput = {
  readonly baseColor: SurfaceBaseColorPlanInput;
  readonly brdfLutPreferredUnit: number;
  readonly candidates: Partial<Readonly<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>>>;
  readonly maxTextureUnits: number;
  readonly reservedTextureUnits: ReadonlySet<number>;
};

export type SurfaceTextureOmissionReason =
  | "dependency-omitted"
  | "unavailable"
  | "unit-exhausted";

export type SurfaceTextureBindingOmission = {
  readonly feature: SurfaceShaderTextureFeature;
  readonly reason: SurfaceTextureOmissionReason;
};

export type SurfaceBaseColorBindingPlan =
  | { readonly kind: "none" }
  | { readonly kind: "ordinary" }
  | { readonly fallback: "atlas-unit" | "none"; readonly kind: "virtual" };

export type SurfaceTextureBindingPlan = {
  readonly baseColor: SurfaceBaseColorBindingPlan;
  readonly features: SurfaceShaderFeatures;
  readonly omissions: readonly SurfaceTextureBindingOmission[];
  readonly textureUnits: ReadonlyMap<SurfaceShaderTextureFeature, number>;
};

export type AdmittedSurfaceTextureReadiness = Pick<
  SurfaceTextureBindingPlanInput,
  "baseColor" | "candidates"
>;

const IBL_SPECULAR_PREFERRED_TEXTURE_UNIT = 2;

/**
 * Pure sampler planner. Priority is base color (VT atomically), IBL specular,
 * transmission, material maps in descriptor order, then the optional BRDF LUT.
 */
export const planSurfaceTextureBindings = (
  input: SurfaceTextureBindingPlanInput,
): SurfaceTextureBindingPlan => {
  const maxUnits = Number.isSafeInteger(input.maxTextureUnits) ? Math.max(0, input.maxTextureUnits) : 0;
  const used = new Set<number>();
  const textureUnits = new Map<SurfaceShaderTextureFeature, number>();
  const omissions: SurfaceTextureBindingOmission[] = [];
  const allocate = (preferred: number): number | undefined => {
    if (preferred >= 0 && preferred < maxUnits && !input.reservedTextureUnits.has(preferred) && !used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    for (let unit = 0; unit < maxUnits; unit += 1) {
      if (input.reservedTextureUnits.has(unit) || used.has(unit)) continue;
      used.add(unit);
      return unit;
    }
    return undefined;
  };
  const assign = (feature: SurfaceShaderTextureFeature, preferred: number): number | undefined => {
    const unit = allocate(preferred);
    if (unit === undefined) omissions.push({ feature, reason: "unit-exhausted" });
    else textureUnits.set(feature, unit);
    return unit;
  };
  const assignPreferredOnly = (feature: SurfaceShaderTextureFeature, preferred: number): number | undefined => {
    if (
      preferred < 0
      || preferred >= maxUnits
      || input.reservedTextureUnits.has(preferred)
      || used.has(preferred)
    ) {
      omissions.push({ feature, reason: "unit-exhausted" });
      return undefined;
    }
    used.add(preferred);
    textureUnits.set(feature, preferred);
    return preferred;
  };
  const candidate = (feature: SurfaceIndependentTextureFeature, preferred: number): void => {
    const status = input.candidates[feature];
    if (status === undefined) return;
    if (status === "unavailable") omissions.push({ feature, reason: "unavailable" });
    else assign(feature, preferred);
  };
  const ordinaryBaseColor = (status: SurfaceTextureCandidate | undefined): SurfaceBaseColorBindingPlan => {
    if (status === undefined) return { kind: "none" };
    if (status === "unavailable") {
      omissions.push({ feature: "baseColorTexture", reason: "unavailable" });
      return { kind: "none" };
    }
    return assign("baseColorTexture", 0) === undefined ? { kind: "none" } : { kind: "ordinary" };
  };

  let baseColor: SurfaceBaseColorBindingPlan;
  switch (input.baseColor.kind) {
    case "none":
      baseColor = { kind: "none" };
      break;
    case "ordinary":
      baseColor = ordinaryBaseColor(input.baseColor.ordinary);
      break;
    case "virtual": {
      if (input.baseColor.virtual === "unavailable") {
        omissions.push(
          { feature: "baseColorVirtualTextureAtlas", reason: "unavailable" },
          { feature: "baseColorVirtualTexturePageTable", reason: "unavailable" },
        );
        baseColor = ordinaryBaseColor(input.baseColor.fallback);
        break;
      }
      const atlas = allocate(0);
      const pageTable = atlas === undefined ? undefined : allocate(1);
      if (atlas === undefined || pageTable === undefined) {
        if (atlas !== undefined) used.delete(atlas);
        if (pageTable !== undefined) used.delete(pageTable);
        omissions.push(
          { feature: "baseColorVirtualTextureAtlas", reason: "unit-exhausted" },
          { feature: "baseColorVirtualTexturePageTable", reason: "unit-exhausted" },
        );
        baseColor = ordinaryBaseColor(input.baseColor.fallback);
        break;
      }
      textureUnits.set("baseColorVirtualTextureAtlas", atlas);
      textureUnits.set("baseColorVirtualTexturePageTable", pageTable);
      const fallback = input.baseColor.fallback === "ready" ? "atlas-unit" : "none";
      if (fallback === "atlas-unit") textureUnits.set("baseColorTexture", atlas);
      else if (input.baseColor.fallback === "unavailable") {
        omissions.push({ feature: "baseColorTexture", reason: "unavailable" });
      }
      baseColor = { fallback, kind: "virtual" };
      break;
    }
  }

  const iblSpecular = input.candidates.iblSpecularCube;
  if (iblSpecular === "unavailable") {
    omissions.push({ feature: "iblSpecularCube", reason: "unavailable" });
  } else if (iblSpecular === "ready") {
    // This cube-map unit is part of the renderer's public pipeline contract.
    // Do not move it to a lower unit on constrained implementations.
    assignPreferredOnly("iblSpecularCube", IBL_SPECULAR_PREFERRED_TEXTURE_UNIT);
  }
  candidate("transmissionScreenTexture", 1);
  for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
    candidate(descriptor.feature, descriptor.preferredUnit);
  }
  const brdf = input.candidates.iblBrdfLut;
  if (brdf !== undefined) {
    if (!textureUnits.has("iblSpecularCube")) omissions.push({ feature: "iblBrdfLut", reason: "dependency-omitted" });
    else if (brdf === "unavailable") omissions.push({ feature: "iblBrdfLut", reason: "unavailable" });
    else assign("iblBrdfLut", input.brdfLutPreferredUnit);
  }

  return {
    baseColor,
    features: new Set(textureUnits.keys()),
    omissions,
    textureUnits,
  };
};

/**
 * Resolves readiness without reallocating sampler units. The admission plan is
 * authoritative, so unavailable high-priority features leave holes instead of
 * allowing semantically omitted lower-priority features to enter the draw.
 */
export const resolveAdmittedSurfaceTextureBindings = (
  admission: SurfaceTextureBindingPlan,
  readiness: AdmittedSurfaceTextureReadiness,
): SurfaceTextureBindingPlan => {
  const textureUnits = new Map<SurfaceShaderTextureFeature, number>();
  const omissions = [...admission.omissions];
  const admit = (feature: SurfaceShaderTextureFeature): void => {
    const unit = admission.textureUnits.get(feature);
    if (unit !== undefined) textureUnits.set(feature, unit);
  };
  const unavailable = (feature: SurfaceShaderTextureFeature): void => {
    omissions.push({ feature, reason: "unavailable" });
  };

  let baseColor: SurfaceBaseColorBindingPlan = { kind: "none" };
  switch (admission.baseColor.kind) {
    case "none":
      break;
    case "ordinary": {
      const status = readiness.baseColor.kind === "ordinary"
        ? readiness.baseColor.ordinary
        : readiness.baseColor.kind === "virtual"
          ? readiness.baseColor.fallback
          : undefined;
      if (status === "ready") {
        admit("baseColorTexture");
        baseColor = { kind: "ordinary" };
      } else if (status === "unavailable") unavailable("baseColorTexture");
      break;
    }
    case "virtual": {
      if (readiness.baseColor.kind !== "virtual") break;
      if (readiness.baseColor.virtual === "ready") {
        admit("baseColorVirtualTextureAtlas");
        admit("baseColorVirtualTexturePageTable");
        if (readiness.baseColor.fallback === "ready") admit("baseColorTexture");
        else if (readiness.baseColor.fallback === "unavailable") unavailable("baseColorTexture");
        baseColor = {
          fallback: readiness.baseColor.fallback === "ready" ? "atlas-unit" : "none",
          kind: "virtual",
        };
      } else {
        unavailable("baseColorVirtualTextureAtlas");
        unavailable("baseColorVirtualTexturePageTable");
        if (readiness.baseColor.fallback === "ready") {
          admit("baseColorTexture");
          baseColor = { kind: "ordinary" };
        } else if (readiness.baseColor.fallback === "unavailable") unavailable("baseColorTexture");
      }
      break;
    }
  }

  for (const [feature] of admission.textureUnits) {
    if (
      feature === "baseColorTexture"
      || feature === "baseColorVirtualTextureAtlas"
      || feature === "baseColorVirtualTexturePageTable"
    ) continue;
    if (feature === "iblBrdfLut" && !textureUnits.has("iblSpecularCube")) {
      omissions.push({ feature, reason: "dependency-omitted" });
      continue;
    }
    if (readiness.candidates[feature] === "ready") admit(feature);
    else unavailable(feature);
  }

  return {
    baseColor,
    features: new Set(textureUnits.keys()),
    omissions,
    textureUnits,
  };
};
