import type {
  LoadedGltfMaterialExtensionTextures,
} from "./prepared-asset";
import type { GltfMaterial, GltfTextureInfo } from "./schema";

export type GltfMaterialExtensionTextureDefinition = {
  readonly colorSpace: "linear" | "srgb";
  readonly key: keyof LoadedGltfMaterialExtensionTextures;
  readonly textureInfo: (material: GltfMaterial | undefined) => GltfTextureInfo | undefined;
};

export const GLTF_CORE_MATERIAL_TEXTURES = [
  ["baseColorTexture", "srgb"],
  ["emissiveTexture", "srgb"],
  ["metallicRoughnessTexture", "linear"],
  ["normalTexture", "linear"],
  ["occlusionTexture", "linear"],
] as const;

/** Shared declarative metadata used by scene preparation and material binding. */
export const GLTF_MATERIAL_EXTENSION_TEXTURES = [
  {
    colorSpace: "linear",
    key: "anisotropyTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_anisotropy?.anisotropyTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatNormalTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatRoughnessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatTexture,
  },
  {
    colorSpace: "srgb",
    key: "diffuseTransmissionColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionColorTexture,
  },
  {
    colorSpace: "linear",
    key: "diffuseTransmissionTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionTexture,
  },
  {
    colorSpace: "linear",
    key: "iridescenceTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_iridescence?.iridescenceTexture,
  },
  {
    colorSpace: "linear",
    key: "iridescenceThicknessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_iridescence?.iridescenceThicknessTexture,
  },
  {
    colorSpace: "linear",
    key: "materialTransmissionTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_transmission?.transmissionTexture,
  },
  {
    colorSpace: "srgb",
    key: "sheenColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_sheen?.sheenColorTexture,
  },
  {
    colorSpace: "linear",
    key: "sheenRoughnessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_sheen?.sheenRoughnessTexture,
  },
  {
    colorSpace: "srgb",
    key: "specularColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_specular?.specularColorTexture,
  },
  {
    colorSpace: "linear",
    key: "specularTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_specular?.specularTexture,
  },
  {
    colorSpace: "linear",
    key: "thicknessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_volume?.thicknessTexture,
  },
] as const satisfies readonly GltfMaterialExtensionTextureDefinition[];
