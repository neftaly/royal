import type { PrefilteredEnvironmentGpuBinding } from "../environment/gpu-owner";
import type { GpuTextureBinding } from "../texture/gpu-owner";
import type { VirtualTextureGpuBinding } from "../virtual-texture/runtime-contract";
import {
  canonicalMaterialHasTransmission,
  type CanonicalSurfaceMaterial,
  type CanonicalTextureBinding,
} from "./canonical-material";
import {
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_EMISSIVE_TEXTURE,
  SURFACE_FEATURE_LINEAR_OUTPUT,
  SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_OCCLUSION_TEXTURE,
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
  SURFACE_FEATURE_PUNCTUAL_LIGHTS,
  SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE,
  SURFACE_FEATURE_SPECULAR_MATERIAL,
  SURFACE_FEATURE_SPECULAR_TEXTURE,
  SURFACE_FEATURE_TANGENT,
  SURFACE_FEATURE_THICKNESS_TEXTURE,
  SURFACE_FEATURE_TRANSMISSION_MATERIAL,
  SURFACE_FEATURE_TRANSMISSION_TEXTURE,
  SURFACE_FEATURE_VERTEX_COLOR,
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
} from "./surface-program-features";

export const MATERIAL_TEXTURE_UNITS = 9;
const EMPTY_TEXTURE_BINDING: GpuTextureBinding = { sampler: null, target: "2d", texture: null };

/** Pure representation choice: one base-color sampler contract owns texture unit zero. */
export const baseColorTextureFeatureBits = (
  ordinaryResident: boolean,
  virtualResident: boolean,
): number => virtualResident
  ? SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
  : ordinaryResident ? SURFACE_FEATURE_BASE_COLOR_TEXTURE : 0;

/** Selects one shader feature set from canonical material and resident GPU state. */
export const surfaceTextureFeatureBits = (
  material: CanonicalSurfaceMaterial,
  hasVertexColor: boolean,
  hasTangent: boolean,
  environmentFeatures: number,
  hasPunctualLights: boolean,
  hasVirtualBaseColor: boolean,
  ordinaryTextureMask: number,
  linearOutput: boolean,
): number => {
  let features = baseColorTextureFeatureBits(
    (ordinaryTextureMask & 1) !== 0,
    hasVirtualBaseColor,
  );
  if (hasVertexColor) features |= SURFACE_FEATURE_VERTEX_COLOR;
  if (linearOutput) features |= SURFACE_FEATURE_LINEAR_OUTPUT;
  if (material.kind !== "standard") return features;
  if (ordinaryTextureMask & 2) features |= SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE;
  if (ordinaryTextureMask & 4) features |= SURFACE_FEATURE_NORMAL_TEXTURE;
  if ((features & SURFACE_FEATURE_NORMAL_TEXTURE) !== 0 && hasTangent) {
    features |= SURFACE_FEATURE_TANGENT;
  }
  if (ordinaryTextureMask & 8) features |= SURFACE_FEATURE_EMISSIVE_TEXTURE;
  if (environmentFeatures !== 0) {
    features |= environmentFeatures;
    if (ordinaryTextureMask & 16) features |= SURFACE_FEATURE_OCCLUSION_TEXTURE;
  }
  if (hasPunctualLights) features |= SURFACE_FEATURE_PUNCTUAL_LIGHTS;
  if (material.specularFactor !== undefined) {
    features |= SURFACE_FEATURE_SPECULAR_MATERIAL;
    if (ordinaryTextureMask & 32) features |= SURFACE_FEATURE_SPECULAR_TEXTURE;
    if (ordinaryTextureMask & 64) features |= SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE;
  }
  if (linearOutput && canonicalMaterialHasTransmission(material)) {
    features |= SURFACE_FEATURE_TRANSMISSION_MATERIAL;
    if (ordinaryTextureMask & 128) features |= SURFACE_FEATURE_TRANSMISSION_TEXTURE;
    if (ordinaryTextureMask & 256) features |= SURFACE_FEATURE_THICKNESS_TEXTURE;
  }
  return features;
};

/** Texture units consumed by one selected shader feature set. */
export const surfaceTextureUnitMask = (features: number): number => (
  features & 0b1111
) | (features & SURFACE_FEATURE_OCCLUSION_TEXTURE ? 0b1_0000 : 0)
  | (features & SURFACE_FEATURE_SPECULAR_TEXTURE ? 0b10_0000 : 0)
  | (features & SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE ? 0b100_0000 : 0)
  | (features & SURFACE_FEATURE_TRANSMISSION_TEXTURE ? 1 << 8 : 0)
  | (features & SURFACE_FEATURE_THICKNESS_TEXTURE ? 1 << 9 : 0)
  | (features & SURFACE_FEATURE_TRANSMISSION_MATERIAL ? 1 << 10 : 0)
  | (features & SURFACE_FEATURE_PREFILTERED_ENVIRONMENT ? 1 << 11 : 0)
  | (features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE ? 0b1000_0001 : 0);

export const residentOrdinaryTextureMask = (
  bindings: readonly GpuTextureBinding[],
  offset: number,
): number => {
  let mask = 0;
  for (let unit = 0; unit < MATERIAL_TEXTURE_UNITS; unit += 1) {
    if (bindings[offset + unit]!.texture !== null) mask |= 1 << unit;
  }
  return mask;
};

export const materialTextureBindingAt = (
  material: CanonicalSurfaceMaterial,
  unit: number,
): CanonicalTextureBinding | undefined => {
  if (unit === 0) return material.baseColorTexture;
  if (material.kind !== "standard") return undefined;
  switch (unit) {
    case 1: return material.metallicRoughnessTexture;
    case 2: return material.normalTexture;
    case 3: return material.emissiveTexture;
    case 4: return material.occlusionTexture;
    case 5: return material.specularTexture;
    case 6: return material.specularColorTexture;
    case 7: return material.transmissionTexture;
    case 8: return material.thicknessTexture;
    default: return undefined;
  }
};

/**
 * Owns the fixed shader-unit ABI. Optional representations replace only their
 * assigned slots; absent features receive explicit null bindings.
 */
export const composeSurfaceTextureBindings = (
  ordinary: readonly GpuTextureBinding[],
  offset: number,
  virtualTexture: VirtualTextureGpuBinding | undefined,
  sceneColor: GpuTextureBinding | undefined,
  environment: PrefilteredEnvironmentGpuBinding | undefined,
): GpuTextureBinding[] => {
  const bindings = [
    ordinary[offset]!,
    ordinary[offset + 1]!,
    ordinary[offset + 2]!,
    ordinary[offset + 3]!,
    ordinary[offset + 4]!,
    ordinary[offset + 5]!,
    ordinary[offset + 6]!,
    EMPTY_TEXTURE_BINDING,
    ordinary[offset + 7]!,
    ordinary[offset + 8]!,
    sceneColor ?? EMPTY_TEXTURE_BINDING,
    environment?.texture ?? EMPTY_TEXTURE_BINDING,
  ];
  if (virtualTexture !== undefined) {
    bindings[0] = virtualTexture.atlas;
    bindings[7] = virtualTexture.pageTable;
  }
  return bindings;
};
