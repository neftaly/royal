import type { PrefilteredEnvironmentGpuBinding } from "../environment/gpu-owner";
import type { GpuTextureBinding } from "../texture/gpu-owner";
import type { VirtualTextureGpuBinding } from "../virtual-texture/runtime-contract";
import {
  canonicalMaterialHasTransmission,
  canonicalMaterialHasVolume,
  type CanonicalSurfaceMaterial,
  type CanonicalTextureBinding,
} from "./canonical-material";
import {
  SURFACE_FEATURE_ALPHA_BLEND,
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_EMISSIVE_TEXTURE,
  SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
  SURFACE_FEATURE_LINEAR_OUTPUT,
  SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_OCCLUSION_TEXTURE,
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
  SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE,
  SURFACE_FEATURE_SPECULAR_MATERIAL,
  SURFACE_FEATURE_SPECULAR_TEXTURE,
  SURFACE_FEATURE_TANGENT,
  SURFACE_FEATURE_THICKNESS_TEXTURE,
  SURFACE_FEATURE_TRANSMISSION_MATERIAL,
  SURFACE_FEATURE_TRANSMISSION_TEXTURE,
  SURFACE_FEATURE_VERTEX_COLOR,
  SURFACE_FEATURE_VERTEX_NORMAL,
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_VOLUME_MATERIAL,
  SURFACE_TEXTURE_FEATURES,
  surfaceLightCountFeatureBits,
} from "./surface-program-features";

export const MATERIAL_TEXTURE_UNITS = 9;
const EMPTY_TEXTURE_BINDING: GpuTextureBinding = { sampler: null, target: "2d", texture: null };
const NEUTRAL_PERCEPTUAL_GREY_LINEAR = 0.214_041;

/**
 * Resolves one base-color presentation without changing canonical authored
 * material factors. Missing ordinary and virtual representations share the
 * same 50%-sRGB neutral fallback and caller-owned output storage.
 */
export const presentableBaseColorInto = (
  output: Float32Array,
  material: CanonicalSurfaceMaterial,
  textureResident: boolean,
): Float32List => {
  const textured = material.baseColorAsset !== undefined
    || material.baseColorVirtualAsset !== undefined;
  if (!textured || textureResident) return material.baseColor as unknown as Float32List;
  output[0] = material.baseColor[0] * NEUTRAL_PERCEPTUAL_GREY_LINEAR;
  output[1] = material.baseColor[1] * NEUTRAL_PERCEPTUAL_GREY_LINEAR;
  output[2] = material.baseColor[2] * NEUTRAL_PERCEPTUAL_GREY_LINEAR;
  output[3] = material.baseColor[3];
  return output;
};

/** Pure representation choice: one base-color sampler contract owns texture unit zero. */
export const baseColorTextureFeatureBits = (
  ordinaryResident: boolean,
  virtualResident: boolean,
): number => virtualResident
  ? SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
  : ordinaryResident ? SURFACE_FEATURE_BASE_COLOR_TEXTURE : 0;

/** Whether every sampled material slot uses the canonical untransformed TEXCOORD_0 lane. */
export const surfaceTexturesUseIdentityCoordinates = (
  material: CanonicalSurfaceMaterial,
  features: number,
): boolean => {
  if ((features & SURFACE_TEXTURE_FEATURES) === 0) return false;
  if (
    (features & (
      SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
    )) !== 0
    && material.baseColorTextureCoordinates !== undefined
  ) return false;
  if (material.kind !== "standard") return true;
  if (
    (features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE) !== 0
    && material.metallicRoughnessTextureCoordinates !== undefined
  ) return false;
  if (
    (features & SURFACE_FEATURE_NORMAL_TEXTURE) !== 0
    && material.normalTextureCoordinates !== undefined
  ) return false;
  if (
    (features & SURFACE_FEATURE_EMISSIVE_TEXTURE) !== 0
    && material.emissiveTextureCoordinates !== undefined
  ) return false;
  if (
    (features & SURFACE_FEATURE_OCCLUSION_TEXTURE) !== 0
    && material.occlusionTextureCoordinates !== undefined
  ) return false;
  if (
    (features & SURFACE_FEATURE_SPECULAR_TEXTURE) !== 0
    && material.specularTextureCoordinates !== undefined
  ) return false;
  if (
    (features & SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE) !== 0
    && material.specularColorTextureCoordinates !== undefined
  ) return false;
  if (
    (features & SURFACE_FEATURE_TRANSMISSION_TEXTURE) !== 0
    && material.transmissionTextureCoordinates !== undefined
  ) return false;
  return (features & SURFACE_FEATURE_THICKNESS_TEXTURE) === 0
    || material.thicknessTextureCoordinates === undefined;
};

export type SurfaceProgramFeatureInput = Readonly<{
  directionalLightCount: number;
  environmentFeatures: number;
  hasTangent: boolean;
  hasVertexColor: boolean;
  hasVertexNormal: boolean;
  hasVirtualBaseColor: boolean;
  linearOutput: boolean;
  material: CanonicalSurfaceMaterial;
  ordinaryTextureMask: number;
  punctualLightCount: number;
}>;

/** Pure selection of one shader feature set from canonical resident state. */
export const surfaceProgramFeatureBits = ({
  directionalLightCount,
  environmentFeatures,
  hasTangent,
  hasVertexColor,
  hasVertexNormal,
  hasVirtualBaseColor,
  linearOutput,
  material,
  ordinaryTextureMask,
  punctualLightCount,
}: SurfaceProgramFeatureInput): number => {
  let features = material.alphaBlend === true ? SURFACE_FEATURE_ALPHA_BLEND : 0;
  features |= baseColorTextureFeatureBits(
    (ordinaryTextureMask & 1) !== 0,
    hasVirtualBaseColor,
  );
  if (hasVertexColor) features |= SURFACE_FEATURE_VERTEX_COLOR;
  if (hasVertexNormal) features |= SURFACE_FEATURE_VERTEX_NORMAL;
  if (linearOutput) features |= SURFACE_FEATURE_LINEAR_OUTPUT;
  if (material.kind !== "standard") {
    return surfaceTexturesUseIdentityCoordinates(material, features)
      ? features | SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES
      : features;
  }
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
  features |= surfaceLightCountFeatureBits(directionalLightCount, punctualLightCount);
  if (material.specularFactor !== undefined) {
    features |= SURFACE_FEATURE_SPECULAR_MATERIAL;
    if (ordinaryTextureMask & 32) features |= SURFACE_FEATURE_SPECULAR_TEXTURE;
    if (ordinaryTextureMask & 64) features |= SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE;
  }
  if (linearOutput && canonicalMaterialHasTransmission(material)) {
    features |= SURFACE_FEATURE_TRANSMISSION_MATERIAL;
    if (canonicalMaterialHasVolume(material)) features |= SURFACE_FEATURE_VOLUME_MATERIAL;
    if (ordinaryTextureMask & 128) features |= SURFACE_FEATURE_TRANSMISSION_TEXTURE;
    if (ordinaryTextureMask & 256) features |= SURFACE_FEATURE_THICKNESS_TEXTURE;
  }
  return surfaceTexturesUseIdentityCoordinates(material, features)
    ? features | SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES
    : features;
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

const DETAIL_TEXTURE_MASK = 0b001_110_110;
const TRANSMISSION_TEXTURE_MASK = 0b110_000_000;

/**
 * Selects only visually coherent map groups. GPU uploads may be paced across
 * frames, but a material never presents a half-arrived lighting or volume set.
 */
export const presentableOrdinaryTextureMask = (
  material: CanonicalSurfaceMaterial,
  residentMask: number,
): number => {
  let resident = residentMask;
  if (material.kind !== "standard") return resident;
  const detail = (material.metallicRoughnessTexture === undefined ? 0 : 1 << 1)
    | (material.normalTexture === undefined ? 0 : 1 << 2)
    | (material.occlusionTexture === undefined ? 0 : 1 << 4)
    | (material.specularTexture === undefined ? 0 : 1 << 5)
    | (material.specularColorTexture === undefined ? 0 : 1 << 6);
  if (((material.mapWaits ?? 0) & 1) !== 0 || (resident & detail) !== detail) {
    resident &= ~DETAIL_TEXTURE_MASK;
  }
  const transmission = (material.transmissionTexture === undefined ? 0 : 1 << 7)
    | (material.thicknessTexture === undefined ? 0 : 1 << 8);
  if (
    ((material.mapWaits ?? 0) & 2) !== 0
    || (resident & transmission) !== transmission
  ) resident &= ~TRANSMISSION_TEXTURE_MASK;
  return resident;
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
export const composeSurfaceTextureBindingsInto = (
  bindings: GpuTextureBinding[],
  ordinary: readonly GpuTextureBinding[],
  offset: number,
  virtualTexture: VirtualTextureGpuBinding | undefined,
  sceneColor: GpuTextureBinding | undefined,
  environment: PrefilteredEnvironmentGpuBinding | undefined,
): void => {
  for (let unit = 0; unit < 7; unit += 1) bindings[unit] = ordinary[offset + unit]!;
  bindings[7] = EMPTY_TEXTURE_BINDING;
  bindings[8] = ordinary[offset + 7]!;
  bindings[9] = ordinary[offset + 8]!;
  bindings[10] = sceneColor ?? EMPTY_TEXTURE_BINDING;
  bindings[11] = environment?.texture ?? EMPTY_TEXTURE_BINDING;
  if (virtualTexture !== undefined) {
    bindings[0] = virtualTexture.atlas;
    bindings[7] = virtualTexture.pageTable;
  }
};
