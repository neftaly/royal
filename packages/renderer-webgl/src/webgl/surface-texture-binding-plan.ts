import {
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  surfaceShaderFeatureMask,
  type SurfaceShaderFeatures,
  type SurfaceShaderTextureFeature,
} from "./surface-texture-features";

export {
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  type SurfaceMaterialTextureBindingDescriptor,
} from "./surface-texture-features";

export type SurfaceTextureCandidate = "ready" | "unavailable";
export type { SurfaceMaterialTextureKey } from "./surface-texture-features";
export type SurfaceIndependentTextureFeature = Exclude<
  SurfaceShaderTextureFeature,
  | "baseColorTexture"
  | "baseColorVirtualTextureAtlas"
  | "baseColorVirtualTexturePageTable"
>;

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
  readonly featureMask: number;
  readonly features: SurfaceShaderFeatures;
  readonly omissions: readonly SurfaceTextureBindingOmission[];
  readonly textureUnits: ReadonlyMap<SurfaceShaderTextureFeature, number>;
};

type MutableSurfaceTextureBindingPlan = {
  baseColor: SurfaceBaseColorBindingPlan;
  featureMask: number;
  readonly features: Set<SurfaceShaderTextureFeature>;
  readonly omissions: SurfaceTextureBindingOmission[];
  readonly textureUnits: Map<SurfaceShaderTextureFeature, number>;
};

/** Reusable scratch storage for the draw-time sampler planner. */
export interface SurfaceTextureBindingWorkspace {
  readonly omissionSlots: Array<{
    feature: SurfaceShaderTextureFeature;
    reason: SurfaceTextureOmissionReason;
  }>;
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
  omissionSlots: [],
  plan: {
    baseColor: BASE_COLOR_NONE,
    featureMask: 0,
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
  plan.featureMask = 0;
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

const omitSurfaceTexture = (
  workspace: SurfaceTextureBindingWorkspace,
  feature: SurfaceShaderTextureFeature,
  reason: SurfaceTextureOmissionReason,
): void => {
  const omissions = workspace.plan.omissions;
  const index = omissions.length;
  let omission = workspace.omissionSlots[index];
  if (omission === undefined) {
    omission = { feature, reason };
    workspace.omissionSlots.push(omission);
  } else {
    omission.feature = feature;
    omission.reason = reason;
  }
  omissions.push(omission);
};

const allocateSurfaceTextureUnit = (
  reserved: ReadonlySet<number>,
  used: Set<number>,
  maxUnits: number,
  preferred: number,
): number | undefined => {
  if (preferred >= 0 && preferred < maxUnits && !reserved.has(preferred) && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  for (let unit = 0; unit < maxUnits; unit += 1) {
    if (reserved.has(unit) || used.has(unit)) continue;
    used.add(unit);
    return unit;
  }
  return undefined;
};

const retainSurfaceTextureUnit = (
  workspace: SurfaceTextureBindingWorkspace,
  reserved: ReadonlySet<number>,
  maxUnits: number,
  feature: SurfaceShaderTextureFeature,
  preferred: number,
): number | undefined => {
  const unit = allocateSurfaceTextureUnit(reserved, workspace.usedTextureUnits, maxUnits, preferred);
  if (unit === undefined) omitSurfaceTexture(workspace, feature, "unit-exhausted");
  else {
    workspace.plan.textureUnits.set(feature, unit);
    workspace.plan.features.add(feature);
  }
  return unit;
};

const retainPreferredSurfaceTextureUnit = (
  workspace: SurfaceTextureBindingWorkspace,
  reserved: ReadonlySet<number>,
  maxUnits: number,
  feature: SurfaceShaderTextureFeature,
  preferred: number,
): number | undefined => {
  if (
    preferred < 0
    || preferred >= maxUnits
    || reserved.has(preferred)
    || workspace.usedTextureUnits.has(preferred)
  ) {
    omitSurfaceTexture(workspace, feature, "unit-exhausted");
    return undefined;
  }
  workspace.usedTextureUnits.add(preferred);
  workspace.plan.textureUnits.set(feature, preferred);
  workspace.plan.features.add(feature);
  return preferred;
};

const retainSurfaceTextureCandidate = (
  workspace: SurfaceTextureBindingWorkspace,
  input: SurfaceTextureBindingPlanInput,
  maxUnits: number,
  feature: SurfaceIndependentTextureFeature,
  preferred: number,
): void => {
  const status = input.candidates[feature];
  if (status === undefined) return;
  if (status === "unavailable") omitSurfaceTexture(workspace, feature, "unavailable");
  else retainSurfaceTextureUnit(workspace, input.reservedTextureUnits, maxUnits, feature, preferred);
};

const retainOrdinaryBaseColor = (
  workspace: SurfaceTextureBindingWorkspace,
  reserved: ReadonlySet<number>,
  maxUnits: number,
  status: SurfaceTextureCandidate | undefined,
): SurfaceBaseColorBindingPlan => {
  if (status === undefined) return BASE_COLOR_NONE;
  if (status === "unavailable") {
    omitSurfaceTexture(workspace, "baseColorTexture", "unavailable");
    return BASE_COLOR_NONE;
  }
  return retainSurfaceTextureUnit(workspace, reserved, maxUnits, "baseColorTexture", 0) === undefined
    ? BASE_COLOR_NONE
    : BASE_COLOR_ORDINARY;
};

const admitSurfaceTexture = (
  workspace: SurfaceTextureBindingWorkspace,
  admission: SurfaceTextureBindingPlan,
  feature: SurfaceShaderTextureFeature,
): void => {
  const unit = admission.textureUnits.get(feature);
  if (unit === undefined) return;
  workspace.plan.textureUnits.set(feature, unit);
  workspace.plan.features.add(feature);
};

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
  const { features, textureUnits } = output;

  let baseColor: SurfaceBaseColorBindingPlan;
  switch (input.baseColor.kind) {
    case "none":
      baseColor = BASE_COLOR_NONE;
      break;
    case "ordinary":
      baseColor = retainOrdinaryBaseColor(workspace, input.reservedTextureUnits, maxUnits, input.baseColor.ordinary);
      break;
    case "virtual": {
      if (input.baseColor.virtual === "unavailable") {
        omitSurfaceTexture(workspace, "baseColorVirtualTextureAtlas", "unavailable");
        omitSurfaceTexture(workspace, "baseColorVirtualTexturePageTable", "unavailable");
        baseColor = retainOrdinaryBaseColor(workspace, input.reservedTextureUnits, maxUnits, input.baseColor.fallback);
        break;
      }
      const atlas = allocateSurfaceTextureUnit(input.reservedTextureUnits, used, maxUnits, 0);
      const pageTable = atlas === undefined
        ? undefined
        : allocateSurfaceTextureUnit(input.reservedTextureUnits, used, maxUnits, 1);
      if (atlas === undefined || pageTable === undefined) {
        if (atlas !== undefined) used.delete(atlas);
        if (pageTable !== undefined) used.delete(pageTable);
        omitSurfaceTexture(workspace, "baseColorVirtualTextureAtlas", "unit-exhausted");
        omitSurfaceTexture(workspace, "baseColorVirtualTexturePageTable", "unit-exhausted");
        baseColor = retainOrdinaryBaseColor(workspace, input.reservedTextureUnits, maxUnits, input.baseColor.fallback);
        break;
      }
      textureUnits.set("baseColorVirtualTextureAtlas", atlas);
      textureUnits.set("baseColorVirtualTexturePageTable", pageTable);
      features.add("baseColorVirtualTextureAtlas");
      features.add("baseColorVirtualTexturePageTable");
      const fallback = input.baseColor.fallback === "ready" ? "atlas-unit" : "none";
      if (fallback === "atlas-unit") {
        textureUnits.set("baseColorTexture", atlas);
        features.add("baseColorTexture");
      }
      else if (input.baseColor.fallback === "unavailable") {
        omitSurfaceTexture(workspace, "baseColorTexture", "unavailable");
      }
      baseColor = fallback === "atlas-unit" ? BASE_COLOR_VIRTUAL_FALLBACK : BASE_COLOR_VIRTUAL;
      break;
    }
  }

  const iblSpecular = input.candidates.iblSpecularCube;
  if (iblSpecular === "unavailable") {
    omitSurfaceTexture(workspace, "iblSpecularCube", "unavailable");
  } else if (iblSpecular === "ready") {
    // This cube-map unit is part of the renderer's public pipeline contract.
    // Do not move it to a lower unit on constrained implementations.
    retainPreferredSurfaceTextureUnit(
      workspace,
      input.reservedTextureUnits,
      maxUnits,
      "iblSpecularCube",
      IBL_SPECULAR_PREFERRED_TEXTURE_UNIT,
    );
  }
  retainSurfaceTextureCandidate(workspace, input, maxUnits, "transmissionScreenTexture", 1);
  for (let index = 0; index < SURFACE_MATERIAL_TEXTURE_BINDINGS.length; index += 1) {
    const descriptor = SURFACE_MATERIAL_TEXTURE_BINDINGS[index]!;
    retainSurfaceTextureCandidate(workspace, input, maxUnits, descriptor.feature, descriptor.preferredUnit);
  }
  const brdf = input.candidates.iblBrdfLut;
  if (brdf !== undefined) {
    if (!textureUnits.has("iblSpecularCube")) omitSurfaceTexture(workspace, "iblBrdfLut", "dependency-omitted");
    else if (brdf === "unavailable") omitSurfaceTexture(workspace, "iblBrdfLut", "unavailable");
    else retainSurfaceTextureUnit(
      workspace,
      input.reservedTextureUnits,
      maxUnits,
      "iblBrdfLut",
      input.brdfLutPreferredUnit,
    );
  }

  output.baseColor = baseColor;
  output.featureMask = surfaceShaderFeatureMask(output.features);
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
  const { textureUnits } = output;
  for (let index = 0; index < admission.omissions.length; index += 1) {
    const omission = admission.omissions[index]!;
    omitSurfaceTexture(workspace, omission.feature, omission.reason);
  }

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
        admitSurfaceTexture(workspace, admission, "baseColorTexture");
        baseColor = BASE_COLOR_ORDINARY;
      } else if (status === "unavailable") omitSurfaceTexture(workspace, "baseColorTexture", "unavailable");
      break;
    }
    case "virtual": {
      if (readiness.baseColor.kind !== "virtual") break;
      if (readiness.baseColor.virtual === "ready") {
        admitSurfaceTexture(workspace, admission, "baseColorVirtualTextureAtlas");
        admitSurfaceTexture(workspace, admission, "baseColorVirtualTexturePageTable");
        if (readiness.baseColor.fallback === "ready") admitSurfaceTexture(workspace, admission, "baseColorTexture");
        else if (readiness.baseColor.fallback === "unavailable") {
          omitSurfaceTexture(workspace, "baseColorTexture", "unavailable");
        }
        baseColor = readiness.baseColor.fallback === "ready"
          ? BASE_COLOR_VIRTUAL_FALLBACK
          : BASE_COLOR_VIRTUAL;
      } else {
        omitSurfaceTexture(workspace, "baseColorVirtualTextureAtlas", "unavailable");
        omitSurfaceTexture(workspace, "baseColorVirtualTexturePageTable", "unavailable");
        if (readiness.baseColor.fallback === "ready") {
          admitSurfaceTexture(workspace, admission, "baseColorTexture");
          baseColor = BASE_COLOR_ORDINARY;
        } else if (readiness.baseColor.fallback === "unavailable") {
          omitSurfaceTexture(workspace, "baseColorTexture", "unavailable");
        }
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
      omitSurfaceTexture(workspace, feature, "dependency-omitted");
      continue;
    }
    if (readiness.candidates[feature] === "ready") admitSurfaceTexture(workspace, admission, feature);
    else omitSurfaceTexture(workspace, feature, "unavailable");
  }

  output.baseColor = baseColor;
  output.featureMask = surfaceShaderFeatureMask(output.features);
  return output;
};
