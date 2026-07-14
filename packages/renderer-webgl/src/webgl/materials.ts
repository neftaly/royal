import type {
  Material,
  LinearRgba,
  StandardMaterial,
  TextureRef,
  UnlitMaterial,
  Vec3,
} from "@royal/renderer-core";
import {
  surfaceLightValueKey,
  surfaceLightVectorKey,
} from "./lights";
import type { GltfTextureCoordinates } from "../gltf/texture-coordinates";

export type TextureAssetUploadRef = Extract<TextureRef, { readonly kind: "asset" }> & {
  readonly flipY?: boolean;
  /** Internal dependency whose decoded source is supplied by the owning prepared asset. */
  readonly preparedOnly?: boolean;
};

export type SurfaceMaterialAlphaMode = "OPAQUE" | "MASK" | "BLEND";

export type SurfaceMaterial = (StandardMaterial | UnlitMaterial) & {
  readonly baseColorFactor?: LinearRgba;
  readonly alphaCutoff?: number;
  readonly alphaMode?: SurfaceMaterialAlphaMode;
  readonly clearcoatRoughnessTexture?: TextureAssetUploadRef;
  readonly clearcoatTexture?: TextureAssetUploadRef;
  readonly doubleSided?: boolean;
  readonly emissive?: LinearRgba;
  readonly emissiveTexture?: TextureAssetUploadRef;
  readonly extensionFactors?: SurfaceMaterialExtensionFactors;
  readonly iridescenceTexture?: TextureAssetUploadRef;
  readonly iridescenceThicknessTexture?: TextureAssetUploadRef;
  readonly materialTransmissionTexture?: TextureAssetUploadRef;
  readonly metallicRoughnessTexture?: TextureAssetUploadRef;
  readonly normalScale?: number;
  readonly normalTexture?: TextureAssetUploadRef;
  readonly occlusionStrength?: number;
  readonly occlusionTexture?: TextureAssetUploadRef;
  readonly sheenColorTexture?: TextureAssetUploadRef;
  readonly sheenRoughnessTexture?: TextureAssetUploadRef;
  readonly specularColorTexture?: TextureAssetUploadRef;
  readonly specularTexture?: TextureAssetUploadRef;
  readonly thicknessTexture?: TextureAssetUploadRef;
  readonly textureCoordinates?: SurfaceMaterialTextureCoordinates;
};

export type SurfaceMaterialTextureCoordinates = Partial<Readonly<Record<
  | "baseColorTexture"
  | "clearcoatRoughnessTexture"
  | "clearcoatTexture"
  | "emissiveTexture"
  | "iridescenceTexture"
  | "iridescenceThicknessTexture"
  | "materialTransmissionTexture"
  | "metallicRoughnessTexture"
  | "normalTexture"
  | "occlusionTexture"
  | "sheenColorTexture"
  | "sheenRoughnessTexture"
  | "specularColorTexture"
  | "specularTexture"
  | "thicknessTexture",
  GltfTextureCoordinates
>>>;

export type SurfaceMaterialExtensionFactors = {
  readonly anisotropyRotation: number;
  readonly anisotropyStrength: number;
  readonly attenuationColor: Vec3;
  readonly attenuationDistance: number;
  readonly clearcoatFactor: number;
  readonly clearcoatRoughnessFactor: number;
  readonly diffuseTransmissionColorFactor: Vec3;
  readonly diffuseTransmissionFactor: number;
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
  anisotropyRotation: 0,
  anisotropyStrength: 0,
  attenuationColor: [1, 1, 1],
  attenuationDistance: Infinity,
  clearcoatFactor: 0,
  clearcoatRoughnessFactor: 0,
  diffuseTransmissionColorFactor: [1, 1, 1],
  diffuseTransmissionFactor: 0,
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

const UNSUPPORTED_VIRTUAL_TEXTURE_COLOR: LinearRgba = [1, 0, 1, 1];

type TextureCacheScalar = number | string;

const textureCacheScalarKey = (value: TextureCacheScalar | undefined): readonly [string, TextureCacheScalar] | null =>
  value === undefined ? null : [typeof value, value];

const textureCacheTupleKey = (parts: readonly unknown[]): string =>
  JSON.stringify(parts);

const textureSourceCacheKey = (texture: TextureRef): readonly unknown[] => {
  if ("contentKey" in texture && texture.contentKey !== undefined) {
    return ["content", textureCacheScalarKey(texture.contentKey)];
  }
  switch (texture.kind) {
    case "asset":
      return ["uri", texture.uri];
    case "virtual-asset":
      return ["manifest", texture.manifestUri];
    case "solid":
      return ["solid", texture.color];
  }
};

export const textureCacheKey = (texture: TextureRef): string => {
  if (texture.kind === "solid") {
    return textureCacheTupleKey([
      "solid",
      texture.color,
      texture.colorSpace ?? null,
      textureCacheScalarKey(texture.version),
    ]);
  }
  if (texture.kind === "asset") {
    const sampler = texture.sampler;
    const upload = texture as TextureAssetUploadRef;
    return textureCacheTupleKey([
      "asset",
      textureSourceCacheKey(texture),
      textureCacheScalarKey(texture.version),
      texture.colorSpace ?? null,
      sampler?.magFilter ?? null,
      sampler?.minFilter ?? null,
      sampler?.wrapS ?? null,
      sampler?.wrapT ?? null,
      upload.flipY === false ? false : true,
    ]);
  }

  const sampler = texture.sampler;
  return textureCacheTupleKey([
    "virtual",
    textureSourceCacheKey(texture),
    textureCacheScalarKey(texture.version),
    texture.colorSpace ?? null,
    sampler?.magFilter ?? null,
    sampler?.minFilter ?? null,
    sampler?.wrapS ?? null,
    sampler?.wrapT ?? null,
    texture.flipY ?? true,
  ]);
};

export const materialEmissiveColor = (material: Material): LinearRgba =>
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

export const surfaceMaterialAlphaMode = (material: SurfaceMaterial): SurfaceMaterialAlphaMode =>
  material.alphaMode ?? "OPAQUE";

export const surfaceMaterialAlphaCutoff = (material: SurfaceMaterial): number =>
  surfaceMaterialAlphaMode(material) === "MASK" ? material.alphaCutoff ?? 0.5 : 0;

export const isBlendedSurfaceMaterial = (material: SurfaceMaterial): boolean =>
  surfaceMaterialAlphaMode(material) === "BLEND";

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
    factors.anisotropyStrength,
    factors.anisotropyRotation,
    factors.specularFactor,
    ...factors.specularColorFactor,
    factors.ior,
    factors.clearcoatFactor,
    factors.clearcoatRoughnessFactor,
    factors.diffuseTransmissionFactor,
    ...factors.diffuseTransmissionColorFactor,
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
    material.doubleSided === true ? "double-sided" : "front-sided",
    surfaceMaterialAlphaMode(material),
    surfaceLightValueKey(surfaceMaterialAlphaCutoff(material)),
    textureCacheKey(material.baseColor),
    surfaceLightVectorKey(materialColor(material)),
    material.emissiveTexture === undefined ? "" : textureCacheKey(material.emissiveTexture),
    material.metallicRoughnessTexture === undefined ? "" : textureCacheKey(material.metallicRoughnessTexture),
    material.normalTexture === undefined ? "" : `${textureCacheKey(material.normalTexture)}:${surfaceLightValueKey(material.normalScale ?? 1)}`,
    material.occlusionTexture === undefined ? "" : textureCacheKey(material.occlusionTexture),
    material.specularTexture === undefined ? "" : textureCacheKey(material.specularTexture),
    material.specularColorTexture === undefined ? "" : textureCacheKey(material.specularColorTexture),
    material.clearcoatTexture === undefined ? "" : textureCacheKey(material.clearcoatTexture),
    material.clearcoatRoughnessTexture === undefined ? "" : textureCacheKey(material.clearcoatRoughnessTexture),
    material.sheenColorTexture === undefined ? "" : textureCacheKey(material.sheenColorTexture),
    material.sheenRoughnessTexture === undefined ? "" : textureCacheKey(material.sheenRoughnessTexture),
    material.iridescenceTexture === undefined ? "" : textureCacheKey(material.iridescenceTexture),
    material.iridescenceThicknessTexture === undefined ? "" : textureCacheKey(material.iridescenceThicknessTexture),
    material.materialTransmissionTexture === undefined ? "" : textureCacheKey(material.materialTransmissionTexture),
    material.thicknessTexture === undefined ? "" : textureCacheKey(material.thicknessTexture),
    ...Object.entries(material.textureCoordinates ?? {}).flatMap(([key, coordinates]) => [
      key,
      coordinates.set,
      ...coordinates.row0,
      ...coordinates.row1,
    ]),
    surfaceLightValueKey(surfaceMaterialMetallicFactor(material)),
    surfaceLightValueKey(surfaceMaterialOcclusionStrength(material)),
    surfaceLightValueKey(surfaceMaterialRoughnessFactor(material)),
    surfaceLightVectorKey(materialEmissiveColor(material)),
    surfaceMaterialExtensionFactorsKey(surfaceMaterialExtensionFactors(material)),
  ].join(":");

export const materialColor = (material: Material): LinearRgba => {
  if ("baseColorFactor" in material && Array.isArray(material.baseColorFactor)) {
    const base = material.baseColor.kind === "solid" ? material.baseColor.color : [1, 1, 1, 1];
    return [
      (material.baseColorFactor[0] ?? 1) * (base[0] ?? 1),
      (material.baseColorFactor[1] ?? 1) * (base[1] ?? 1),
      (material.baseColorFactor[2] ?? 1) * (base[2] ?? 1),
      (material.baseColorFactor[3] ?? 1) * (base[3] ?? 1),
    ];
  }
  const texture = material.baseColor;
  if (texture.kind === "solid") return texture.color;
  if (texture.kind === "virtual-asset") return UNSUPPORTED_VIRTUAL_TEXTURE_COLOR;

  return [1, 1, 1, 1];
};
