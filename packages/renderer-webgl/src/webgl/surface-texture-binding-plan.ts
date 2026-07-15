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
  { feature: "anisotropyTexture", key: "anisotropyTexture", preferredUnit: 13, samplerUniform: "u_anisotropyTexture", useUniform: "u_useAnisotropyTexture", uvUniformStem: "u_anisotropyUv" },
  { feature: "specularTexture", key: "specularTexture", preferredUnit: 6, samplerUniform: "u_specularTexture", useUniform: "u_useSpecularTexture", uvUniformStem: "u_specularUv" },
  { feature: "specularColorTexture", key: "specularColorTexture", preferredUnit: 7, samplerUniform: "u_specularColorTexture", useUniform: "u_useSpecularColorTexture", uvUniformStem: "u_specularColorUv" },
  { feature: "clearcoatTexture", key: "clearcoatTexture", preferredUnit: 8, samplerUniform: "u_clearcoatTexture", useUniform: "u_useClearcoatTexture", uvUniformStem: "u_clearcoatUv" },
  { feature: "clearcoatRoughnessTexture", key: "clearcoatRoughnessTexture", preferredUnit: 9, samplerUniform: "u_clearcoatRoughnessTexture", useUniform: "u_useClearcoatRoughnessTexture", uvUniformStem: "u_clearcoatRoughnessUv" },
  { feature: "clearcoatNormalTexture", key: "clearcoatNormalTexture", preferredUnit: 10, samplerUniform: "u_clearcoatNormalTexture", useUniform: "u_useClearcoatNormalTexture", uvUniformStem: "u_clearcoatNormalUv" },
  { feature: "diffuseTransmissionTexture", key: "diffuseTransmissionTexture", preferredUnit: 11, samplerUniform: "u_diffuseTransmissionTexture", useUniform: "u_useDiffuseTransmissionTexture", uvUniformStem: "u_diffuseTransmissionUv" },
  { feature: "diffuseTransmissionColorTexture", key: "diffuseTransmissionColorTexture", preferredUnit: 12, samplerUniform: "u_diffuseTransmissionColorTexture", useUniform: "u_useDiffuseTransmissionColorTexture", uvUniformStem: "u_diffuseTransmissionColorUv" },
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

type MutableSurfaceTextureBindingPlan = {
  baseColor: SurfaceBaseColorBindingPlan;
  readonly features: Set<SurfaceShaderTextureFeature>;
  readonly omissions: SurfaceTextureBindingOmission[];
  readonly textureUnits: Map<SurfaceShaderTextureFeature, number>;
};

/** Reusable scratch storage for the draw-time sampler planner. */
export interface SurfaceTextureBindingWorkspace {
  readonly plan: MutableSurfaceTextureBindingPlan;
  readonly usedTextureUnits: Set<number>;
}

const BASE_COLOR_NONE: SurfaceBaseColorBindingPlan = { kind: "none" };
const BASE_COLOR_ORDINARY: SurfaceBaseColorBindingPlan = { kind: "ordinary" };
const BASE_COLOR_VIRTUAL: SurfaceBaseColorBindingPlan = { fallback: "none", kind: "virtual" };
const BASE_COLOR_VIRTUAL_FALLBACK: SurfaceBaseColorBindingPlan = {
  fallback: "atlas-unit",
  kind: "virtual",
};

export const createSurfaceTextureBindingWorkspace = (): SurfaceTextureBindingWorkspace => ({
  plan: {
    baseColor: BASE_COLOR_NONE,
    features: new Set(),
    omissions: [],
    textureUnits: new Map(),
  },
  usedTextureUnits: new Set(),
});

const resetWorkspace = (
  workspace: SurfaceTextureBindingWorkspace,
): MutableSurfaceTextureBindingPlan => {
  const { plan } = workspace;
  plan.baseColor = BASE_COLOR_NONE;
  plan.features.clear();
  plan.omissions.length = 0;
  plan.textureUnits.clear();
  workspace.usedTextureUnits.clear();
  return plan;
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
  workspace: SurfaceTextureBindingWorkspace = createSurfaceTextureBindingWorkspace(),
): SurfaceTextureBindingPlan => {
  const output = resetWorkspace(workspace);
  const maxUnits = Number.isSafeInteger(input.maxTextureUnits) ? Math.max(0, input.maxTextureUnits) : 0;
  const used = workspace.usedTextureUnits;
  const { features, omissions, textureUnits } = output;
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
    if (status === undefined) return BASE_COLOR_NONE;
    if (status === "unavailable") {
      omissions.push({ feature: "baseColorTexture", reason: "unavailable" });
      return BASE_COLOR_NONE;
    }
    return assign("baseColorTexture", 0) === undefined ? BASE_COLOR_NONE : BASE_COLOR_ORDINARY;
  };

  let baseColor: SurfaceBaseColorBindingPlan;
  switch (input.baseColor.kind) {
    case "none":
      baseColor = BASE_COLOR_NONE;
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
        baseColor = fallback === "atlas-unit" ? BASE_COLOR_VIRTUAL_FALLBACK : BASE_COLOR_VIRTUAL;
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

  output.baseColor = baseColor;
  for (const feature of textureUnits.keys()) features.add(feature);
  return output;
};

/**
 * Resolves readiness without reallocating sampler units. The admission plan is
 * authoritative, so unavailable high-priority features leave holes instead of
 * allowing semantically omitted lower-priority features to enter the draw.
 */
export const resolveAdmittedSurfaceTextureBindings = (
  admission: SurfaceTextureBindingPlan,
  readiness: AdmittedSurfaceTextureReadiness,
  workspace: SurfaceTextureBindingWorkspace = createSurfaceTextureBindingWorkspace(),
): SurfaceTextureBindingPlan => {
  const output = resetWorkspace(workspace);
  const { features, omissions, textureUnits } = output;
  omissions.push(...admission.omissions);
  const admit = (feature: SurfaceShaderTextureFeature): void => {
    const unit = admission.textureUnits.get(feature);
    if (unit !== undefined) textureUnits.set(feature, unit);
  };
  const unavailable = (feature: SurfaceShaderTextureFeature): void => {
    omissions.push({ feature, reason: "unavailable" });
  };

  let baseColor: SurfaceBaseColorBindingPlan = BASE_COLOR_NONE;
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
        baseColor = BASE_COLOR_ORDINARY;
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
        baseColor = readiness.baseColor.fallback === "ready"
          ? BASE_COLOR_VIRTUAL_FALLBACK
          : BASE_COLOR_VIRTUAL;
      } else {
        unavailable("baseColorVirtualTextureAtlas");
        unavailable("baseColorVirtualTexturePageTable");
        if (readiness.baseColor.fallback === "ready") {
          admit("baseColorTexture");
          baseColor = BASE_COLOR_ORDINARY;
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

  output.baseColor = baseColor;
  for (const feature of textureUnits.keys()) features.add(feature);
  return output;
};
