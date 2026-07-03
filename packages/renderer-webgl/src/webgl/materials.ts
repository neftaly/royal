import type {
  Material,
  Rgba,
  StandardMaterial,
  TextureRef,
  UnlitMaterial,
  Vec3,
} from "@royal/renderer-core";
import {
  surfaceLightValueKey,
  surfaceLightVectorKey,
} from "./lights";

export type TextureAssetUploadRef = Extract<TextureRef, { readonly kind: "asset" }> & {
  readonly flipY?: boolean;
};

export type SurfaceMaterial = (StandardMaterial | UnlitMaterial) & {
  readonly emissive?: Rgba;
  readonly emissiveTexture?: TextureAssetUploadRef;
  readonly extensionFactors?: SurfaceMaterialExtensionFactors;
  readonly metallicRoughnessTexture?: TextureAssetUploadRef;
  readonly occlusionStrength?: number;
  readonly occlusionTexture?: TextureAssetUploadRef;
};

export type SurfaceMaterialExtensionFactors = {
  readonly attenuationColor: Vec3;
  readonly attenuationDistance: number;
  readonly clearcoatFactor: number;
  readonly clearcoatRoughnessFactor: number;
  readonly dispersionFactor: number;
  readonly ior: number;
  readonly iridescenceFactor: number;
  readonly iridescenceIor: number;
  readonly iridescenceThicknessMaximum: number;
  readonly iridescenceThicknessMinimum: number;
  readonly sheenColorFactor: Vec3;
  readonly sheenRoughnessFactor: number;
  readonly specularColorFactor: Vec3;
  readonly specularFactor: number;
  readonly thicknessFactor: number;
  readonly transmissionFactor: number;
};

export const DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS: SurfaceMaterialExtensionFactors = {
  attenuationColor: [1, 1, 1],
  attenuationDistance: Infinity,
  clearcoatFactor: 0,
  clearcoatRoughnessFactor: 0,
  dispersionFactor: 0,
  ior: 1.5,
  iridescenceFactor: 0,
  iridescenceIor: 1.3,
  iridescenceThicknessMaximum: 400,
  iridescenceThicknessMinimum: 100,
  sheenColorFactor: [0, 0, 0],
  sheenRoughnessFactor: 0,
  specularColorFactor: [1, 1, 1],
  specularFactor: 1,
  thicknessFactor: 0,
  transmissionFactor: 0,
};

const UNSUPPORTED_VIRTUAL_TEXTURE_COLOR: Rgba = [1, 0, 1, 1];

export const textureCacheKey = (texture: TextureRef): string => {
  if (texture.kind === "solid") {
    return `solid:${texture.color.join(",")}:${texture.colorSpace ?? ""}:${texture.version ?? ""}`;
  }
  if (texture.kind === "asset") {
    const sampler = texture.sampler;
    const upload = texture as TextureAssetUploadRef;
    return [
      "asset",
      texture.uri,
      texture.version ?? "",
      texture.colorSpace ?? "",
      sampler?.magFilter ?? "",
      sampler?.minFilter ?? "",
      sampler?.wrapS ?? "",
      sampler?.wrapT ?? "",
      upload.flipY === false ? "flipY:false" : "",
    ].join(":");
  }

  const sampler = texture.sampler;
  return [
    "virtual",
    texture.manifestUri,
    texture.version ?? "",
    texture.colorSpace ?? "",
    sampler?.magFilter ?? "",
    sampler?.minFilter ?? "",
    sampler?.wrapS ?? "",
    sampler?.wrapT ?? "",
  ].join(":");
};

export const materialEmissiveColor = (material: Material): Rgba =>
  "emissive" in material && Array.isArray(material.emissive) && material.emissive.length >= 3
    ? [
        material.emissive[0] ?? 0,
        material.emissive[1] ?? 0,
        material.emissive[2] ?? 0,
        material.emissive[3] ?? 1,
      ]
    : [0, 0, 0, 1];

export const surfaceMaterialExtensionFactors = (
  material: SurfaceMaterial,
): SurfaceMaterialExtensionFactors =>
  material.extensionFactors ?? DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS;

export const isTransmissiveSurfaceMaterial = (material: SurfaceMaterial): boolean =>
  material.kind === "standard" && surfaceMaterialExtensionFactors(material).transmissionFactor > 0;

export const surfaceMaterialMetallicFactor = (material: SurfaceMaterial): number =>
  material.kind === "standard" ? material.metallicFactor : 0;

export const surfaceMaterialRoughnessFactor = (material: SurfaceMaterial): number =>
  material.kind === "standard" ? material.roughnessFactor : 1;

export const surfaceMaterialOcclusionStrength = (material: SurfaceMaterial): number =>
  material.kind === "standard" ? material.occlusionStrength ?? 1 : 1;

export const surfaceMaterialExtensionFactorsKey = (
  factors: SurfaceMaterialExtensionFactors,
): string =>
  [
    factors.specularFactor,
    ...factors.specularColorFactor,
    factors.ior,
    factors.clearcoatFactor,
    factors.clearcoatRoughnessFactor,
    factors.dispersionFactor,
    ...factors.sheenColorFactor,
    factors.sheenRoughnessFactor,
    factors.iridescenceFactor,
    factors.iridescenceIor,
    factors.iridescenceThicknessMinimum,
    factors.iridescenceThicknessMaximum,
    factors.transmissionFactor,
    factors.thicknessFactor,
    ...factors.attenuationColor,
    factors.attenuationDistance,
  ].map((value) => surfaceLightValueKey(value)).join(",");

export const surfaceMaterialBatchKey = (material: SurfaceMaterial): string =>
  [
    material.kind,
    textureCacheKey(material.baseColor),
    material.emissiveTexture === undefined ? "" : textureCacheKey(material.emissiveTexture),
    material.metallicRoughnessTexture === undefined ? "" : textureCacheKey(material.metallicRoughnessTexture),
    material.occlusionTexture === undefined ? "" : textureCacheKey(material.occlusionTexture),
    surfaceLightValueKey(surfaceMaterialMetallicFactor(material)),
    surfaceLightValueKey(surfaceMaterialOcclusionStrength(material)),
    surfaceLightValueKey(surfaceMaterialRoughnessFactor(material)),
    surfaceLightVectorKey(materialEmissiveColor(material)),
    surfaceMaterialExtensionFactorsKey(surfaceMaterialExtensionFactors(material)),
  ].join(":");

export const materialColor = (material: Material): Rgba => {
  const texture = material.baseColor;
  if (texture.kind === "solid") return texture.color;
  if (texture.kind === "virtual-asset") return UNSUPPORTED_VIRTUAL_TEXTURE_COLOR;

  return texture.fallback?.color ?? [0.5, 0.5, 0.5, 1];
};
