import type { SurfaceMaterialTextureCoordinates } from "./materials";

export const SURFACE_SHADER_TEXTURE_FEATURES = [
  "baseColorTexture",
  "baseColorVirtualTextureAtlas",
  "baseColorVirtualTexturePageTable",
  "emissiveTexture",
  "metallicRoughnessTexture",
  "normalTexture",
  "occlusionTexture",
  "anisotropyTexture",
  "specularTexture",
  "specularColorTexture",
  "clearcoatTexture",
  "clearcoatRoughnessTexture",
  "clearcoatNormalTexture",
  "diffuseTransmissionTexture",
  "diffuseTransmissionColorTexture",
  "sheenColorTexture",
  "sheenRoughnessTexture",
  "iridescenceTexture",
  "iridescenceThicknessTexture",
  "materialTransmissionTexture",
  "thicknessTexture",
  "transmissionScreenTexture",
  "iblSpecularCube",
  "iblBrdfLut",
] as const;

export type SurfaceShaderTextureFeature = typeof SURFACE_SHADER_TEXTURE_FEATURES[number];
export type SurfaceShaderFeatures = ReadonlySet<SurfaceShaderTextureFeature>;
export type SurfaceMaterialTextureKey = keyof SurfaceMaterialTextureCoordinates;

export type SurfaceMaterialTextureBindingDescriptor = {
  readonly feature: SurfaceShaderTextureFeature;
  readonly key: SurfaceMaterialTextureKey;
  readonly preferredUnit: number;
  readonly samplerUniform: string;
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
  { feature: "emissiveTexture", key: "emissiveTexture", preferredUnit: 4, samplerUniform: "u_emissiveTexture", uvUniformStem: "u_emissiveUv" },
  { feature: "metallicRoughnessTexture", key: "metallicRoughnessTexture", preferredUnit: 3, samplerUniform: "u_metallicRoughnessTexture", uvUniformStem: "u_metallicRoughnessUv" },
  { feature: "normalTexture", key: "normalTexture", preferredUnit: 1, samplerUniform: "u_normalTexture", uvUniformStem: "u_normalUv" },
  { feature: "occlusionTexture", key: "occlusionTexture", preferredUnit: 5, samplerUniform: "u_occlusionTexture", uvUniformStem: "u_occlusionUv" },
  { feature: "anisotropyTexture", key: "anisotropyTexture", preferredUnit: 13, samplerUniform: "u_anisotropyTexture", uvUniformStem: "u_anisotropyUv" },
  { feature: "specularTexture", key: "specularTexture", preferredUnit: 6, samplerUniform: "u_specularTexture", uvUniformStem: "u_specularUv" },
  { feature: "specularColorTexture", key: "specularColorTexture", preferredUnit: 7, samplerUniform: "u_specularColorTexture", uvUniformStem: "u_specularColorUv" },
  { feature: "clearcoatTexture", key: "clearcoatTexture", preferredUnit: 8, samplerUniform: "u_clearcoatTexture", uvUniformStem: "u_clearcoatUv" },
  { feature: "clearcoatRoughnessTexture", key: "clearcoatRoughnessTexture", preferredUnit: 9, samplerUniform: "u_clearcoatRoughnessTexture", uvUniformStem: "u_clearcoatRoughnessUv" },
  { feature: "clearcoatNormalTexture", key: "clearcoatNormalTexture", preferredUnit: 10, samplerUniform: "u_clearcoatNormalTexture", uvUniformStem: "u_clearcoatNormalUv" },
  { feature: "diffuseTransmissionTexture", key: "diffuseTransmissionTexture", preferredUnit: 11, samplerUniform: "u_diffuseTransmissionTexture", uvUniformStem: "u_diffuseTransmissionUv" },
  { feature: "diffuseTransmissionColorTexture", key: "diffuseTransmissionColorTexture", preferredUnit: 12, samplerUniform: "u_diffuseTransmissionColorTexture", uvUniformStem: "u_diffuseTransmissionColorUv" },
  { feature: "sheenColorTexture", key: "sheenColorTexture", preferredUnit: 10, samplerUniform: "u_sheenColorTexture", uvUniformStem: "u_sheenColorUv" },
  { feature: "sheenRoughnessTexture", key: "sheenRoughnessTexture", preferredUnit: 11, samplerUniform: "u_sheenRoughnessTexture", uvUniformStem: "u_sheenRoughnessUv" },
  { feature: "iridescenceTexture", key: "iridescenceTexture", preferredUnit: 12, samplerUniform: "u_iridescenceTexture", uvUniformStem: "u_iridescenceUv" },
  { feature: "iridescenceThicknessTexture", key: "iridescenceThicknessTexture", preferredUnit: 13, samplerUniform: "u_iridescenceThicknessTexture", uvUniformStem: "u_iridescenceThicknessUv" },
  { feature: "materialTransmissionTexture", key: "materialTransmissionTexture", preferredUnit: 14, samplerUniform: "u_materialTransmissionTexture", uvUniformStem: "u_materialTransmissionUv" },
  { feature: "thicknessTexture", key: "thicknessTexture", preferredUnit: 15, samplerUniform: "u_thicknessTexture", uvUniformStem: "u_thicknessUv" },
] as const);
