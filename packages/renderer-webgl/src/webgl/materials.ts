import type {
  Material,
  LinearRgba,
  StandardMaterial,
  TextureRef,
  UnlitMaterial,
  Vec3,
} from "@royal/renderer-core";
import type { GltfTextureCoordinates } from "../gltf/texture-coordinates";

export type TextureAssetUploadRef = Extract<TextureRef, { readonly kind: "asset" }> & {
  /** Internal dependency whose decoded source is supplied by the owning prepared asset. */
  readonly preparedOnly?: boolean;
};

export type SurfaceMaterialAlphaMode = "OPAQUE" | "MASK" | "BLEND";

/** Mutable renderer-owned state shared by every material from one glTF asset. */
export type SurfaceMaterialPublication = {
  pending: boolean;
  ready: boolean;
};

export type SurfaceMaterial = (StandardMaterial | UnlitMaterial) & {
  readonly anisotropyTexture?: TextureAssetUploadRef;
  /** Internal glTF base/alpha publication barrier; never authored through the public API. */
  readonly basePending?: true;
  /** Internal asset-wide glTF publication state; never authored through the public API. */
  readonly publication?: SurfaceMaterialPublication;
  readonly baseColorFactor?: LinearRgba;
  readonly alphaCutoff?: number;
  readonly alphaMode?: SurfaceMaterialAlphaMode;
  readonly clearcoatNormalTexture?: TextureAssetUploadRef;
  readonly clearcoatRoughnessTexture?: TextureAssetUploadRef;
  readonly clearcoatTexture?: TextureAssetUploadRef;
  readonly doubleSided?: boolean;
  readonly diffuseTransmissionColorTexture?: TextureAssetUploadRef;
  readonly diffuseTransmissionTexture?: TextureAssetUploadRef;
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
  | "anisotropyTexture"
  | "baseColorTexture"
  | "clearcoatNormalTexture"
  | "clearcoatRoughnessTexture"
  | "clearcoatTexture"
  | "diffuseTransmissionColorTexture"
  | "diffuseTransmissionTexture"
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
  readonly clearcoatNormalScale: number;
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
  clearcoatNormalScale: 1,
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
const textureCacheKeys = new WeakMap<TextureRef, string>();

type TextureCacheScalar = number | string;

const textureCacheScalarKey = (value: TextureCacheScalar | undefined): readonly [string, string] | null =>
  value === undefined ? null : [typeof value, String(value)];

const textureCacheTupleKey = (parts: readonly unknown[]): string =>
  JSON.stringify(parts);

const textureSourceCacheKey = (texture: TextureRef): readonly unknown[] => {
  if ("contentKey" in texture && texture.contentKey !== undefined) {
    return ["content", textureCacheScalarKey(texture.contentKey)];
  }
  switch (texture.kind) {
    case "asset":
      return ["uri", texture.src];
    case "virtual-asset":
      return ["manifest", texture.manifestUri];
    case "solid":
      return ["solid", texture.color];
  }
};

export const textureCacheKey = (texture: TextureRef): string => {
  const cached = textureCacheKeys.get(texture);
  if (cached !== undefined) return cached;
  let key: string;
  if (texture.kind === "solid") {
    key = textureCacheTupleKey(["solid", texture.color]);
  } else if (texture.kind === "asset") {
    const sampler = texture.sampler;
    key = textureCacheTupleKey([
      "asset",
      textureSourceCacheKey(texture),
      textureCacheScalarKey(texture.version),
      texture.colorSpace ?? null,
      sampler?.magFilter ?? null,
      sampler?.minFilter ?? null,
      sampler?.wrapS ?? null,
      sampler?.wrapT ?? null,
    ]);
  } else {
    const sampler = texture.sampler;
    key = textureCacheTupleKey([
      "virtual",
      textureSourceCacheKey(texture),
      textureCacheScalarKey(texture.version),
      texture.colorSpace ?? null,
      sampler?.magFilter ?? null,
      sampler?.minFilter ?? null,
      sampler?.wrapS ?? null,
      sampler?.wrapT ?? null,
    ]);
  }
  textureCacheKeys.set(texture, key);
  return key;
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

/** Pure shader-tier classification; inert extension metadata stays on core PBR. */
export const surfaceMaterialUsesPbrExtensions = (material: SurfaceMaterial): boolean => {
  if (material.kind !== "standard") return false;
  const factors = surfaceMaterialExtensionFactors(material);
  return material.specularTexture !== undefined
    || material.specularColorTexture !== undefined
    || factors.anisotropyStrength !== 0
    || factors.specularFactor !== 1
    || factors.specularColorFactor[0] !== 1
    || factors.specularColorFactor[1] !== 1
    || factors.specularColorFactor[2] !== 1
    || factors.ior !== 1.5
    || factors.clearcoatFactor !== 0
    || factors.diffuseTransmissionFactor !== 0
    || factors.sheenColorFactor[0] !== 0
    || factors.sheenColorFactor[1] !== 0
    || factors.sheenColorFactor[2] !== 0
    || factors.iridescenceFactor !== 0
    || factors.transmissionFactor !== 0;
};

export const surfaceMaterialUsesTransmission = (material: SurfaceMaterial): boolean =>
  material.kind === "standard" && surfaceMaterialExtensionFactors(material).transmissionFactor !== 0;

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
