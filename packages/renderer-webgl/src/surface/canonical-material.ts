import {
  defaultImageTextureSampler,
  type LinearRgba,
  type Material,
  type TextureAssetRef,
  type TextureColorSpace,
  type TextureSamplerFilter,
  type TextureSamplerWrap,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import {
  decodedTextureKey,
  type DecodedTextureSource,
  textureStorageKey,
  type TextureSourceRef,
} from "../texture/asset-owner";
import type { CanonicalTextureCoordinates } from "../gltf/texture-coordinates";

export type CanonicalTextureSampler = Readonly<{
  magFilter: "linear" | "nearest";
  minFilter: TextureSamplerFilter;
  wrapS: TextureSamplerWrap;
  wrapT: TextureSamplerWrap;
}>;

export type CanonicalTextureBinding = Readonly<{
  colorSpace: TextureColorSpace;
  decoded: DecodedTextureSource;
  sampler: CanonicalTextureSampler;
  samplerKey: string;
  storageKey: string;
}>;

export type CanonicalUnlitMaterial = Readonly<{
  alphaBlend?: true;
  alphaCutoff?: number;
  baseColor: LinearRgba;
  baseColorAsset?: TextureSourceRef;
  baseColorVirtualAsset?: VirtualTextureAssetRef;
  baseColorTexture?: CanonicalTextureBinding;
  baseColorTextureCoordinates?: CanonicalTextureCoordinates;
  doubleSided?: true;
  kind: "unlit";
  requiresTextureCoordinates: boolean;
}>;

export type CanonicalStandardMaterial = Readonly<{
  alphaBlend?: true;
  alphaCutoff?: number;
  baseColor: LinearRgba;
  baseColorAsset?: TextureSourceRef;
  baseColorVirtualAsset?: VirtualTextureAssetRef;
  baseColorTexture?: CanonicalTextureBinding;
  baseColorTextureCoordinates?: CanonicalTextureCoordinates;
  doubleSided?: true;
  emissiveAsset?: TextureSourceRef;
  emissiveFactor: readonly [number, number, number];
  emissiveTexture?: CanonicalTextureBinding;
  emissiveTextureCoordinates?: CanonicalTextureCoordinates;
  kind: "standard";
  metallicFactor: number;
  metallicRoughnessAsset?: TextureSourceRef;
  metallicRoughnessTexture?: CanonicalTextureBinding;
  metallicRoughnessTextureCoordinates?: CanonicalTextureCoordinates;
  normalAsset?: TextureSourceRef;
  normalScale: number;
  normalTexture?: CanonicalTextureBinding;
  normalTextureCoordinates?: CanonicalTextureCoordinates;
  occlusionAsset?: TextureSourceRef;
  occlusionStrength: number;
  occlusionTexture?: CanonicalTextureBinding;
  occlusionTextureCoordinates?: CanonicalTextureCoordinates;
  requiresTextureCoordinates: boolean;
  roughnessFactor: number;
}>;

export type CanonicalSurfaceMaterial = CanonicalStandardMaterial | CanonicalUnlitMaterial;

/** Reports whether one authored material use requires a particular UV stream. */
export const canonicalMaterialUsesTextureCoordinateSet = (
  material: CanonicalSurfaceMaterial,
  set: 0 | 1,
): boolean => {
  if (
    (material.baseColorAsset !== undefined || material.baseColorVirtualAsset !== undefined)
    && (material.baseColorTextureCoordinates?.row0[3] ?? 0) === set
  ) return true;
  if (material.kind === "unlit") return false;
  return (
    material.metallicRoughnessAsset !== undefined
      && (material.metallicRoughnessTextureCoordinates?.row0[3] ?? 0) === set
  ) || (
    material.normalAsset !== undefined
      && (material.normalTextureCoordinates?.row0[3] ?? 0) === set
  ) || (
    material.occlusionAsset !== undefined
      && (material.occlusionTextureCoordinates?.row0[3] ?? 0) === set
  ) || (
    material.emissiveAsset !== undefined
      && (material.emissiveTextureCoordinates?.row0[3] ?? 0) === set
  );
};

const NEUTRAL_PERCEPTUAL_GREY: LinearRgba = [0.214_041, 0.214_041, 0.214_041, 1];

export const canonicalTextureSampler = (
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "sampler">,
): CanonicalTextureSampler => ({
  magFilter: asset.sampler?.magFilter ?? defaultImageTextureSampler.magFilter ?? "linear",
  minFilter: asset.sampler?.minFilter
    ?? defaultImageTextureSampler.minFilter
    ?? "linear-mipmap-linear",
  wrapS: asset.sampler?.wrapS ?? defaultImageTextureSampler.wrapS ?? "clamp-to-edge",
  wrapT: asset.sampler?.wrapT ?? defaultImageTextureSampler.wrapT ?? "clamp-to-edge",
});

const textureBinding = (
  asset: TextureSourceRef,
  decoded: DecodedTextureSource,
): CanonicalTextureBinding => {
  const colorSpace = asset.colorSpace ?? "srgb";
  const sampler = canonicalTextureSampler(asset);
  return {
    colorSpace,
    decoded,
    sampler,
    samplerKey: JSON.stringify([
      sampler.magFilter,
      sampler.minFilter,
      sampler.wrapS,
      sampler.wrapT,
    ]),
    storageKey: textureStorageKey(asset),
  };
};

/** Resolves a cold glTF texture recipe through the same ordinary-texture binding contract. */
export const resolveCanonicalMaterialTexture = (
  material: CanonicalSurfaceMaterial,
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined,
): CanonicalSurfaceMaterial => {
  const baseColorAsset = material.baseColorAsset;
  const baseColorDecoded = baseColorAsset === undefined ? undefined : decodedTexture(baseColorAsset);
  const baseColorTexture = baseColorAsset === undefined || baseColorDecoded === undefined
    ? undefined
    : textureBinding(baseColorAsset, baseColorDecoded);
  const common = {
    ...material,
    ...(baseColorTexture === undefined ? {} : { baseColorTexture }),
    ...(baseColorAsset !== undefined && baseColorDecoded === undefined ? {
      baseColor: [
        material.baseColor[0] * NEUTRAL_PERCEPTUAL_GREY[0],
        material.baseColor[1] * NEUTRAL_PERCEPTUAL_GREY[1],
        material.baseColor[2] * NEUTRAL_PERCEPTUAL_GREY[2],
        material.baseColor[3],
      ] as LinearRgba,
    } : {}),
  };
  if (material.kind === "unlit") return common;
  const resolve = (asset: TextureSourceRef | undefined): CanonicalTextureBinding | undefined => {
    if (asset === undefined) return undefined;
    const decoded = decodedTexture(asset);
    return decoded === undefined ? undefined : textureBinding(asset, decoded);
  };
  const metallicRoughnessTexture = resolve(material.metallicRoughnessAsset);
  const normalTexture = resolve(material.normalAsset);
  const emissiveTexture = resolve(material.emissiveAsset);
  const occlusionTexture = resolve(material.occlusionAsset);
  return {
    ...common,
    ...(emissiveTexture === undefined ? {} : { emissiveTexture }),
    ...(metallicRoughnessTexture === undefined ? {} : { metallicRoughnessTexture }),
    ...(normalTexture === undefined ? {} : { normalTexture }),
    ...(occlusionTexture === undefined ? {} : { occlusionTexture }),
  };
};

/** Erases the public material shape while retaining cold texture recipes. */
export const prepareCanonicalMaterialSource = (material: Material): CanonicalSurfaceMaterial => {
  if (material.kind === "wireframe") {
    throw new Error("Royal canonical surface slice does not yet support wireframe materials");
  }
  const source = material.baseColor;
  const baseColor = source.kind === "solid"
    ? source.color
    : [1, 1, 1, 1] as const;
  const common = {
    ...(source.kind === "solid" && source.color[3] < 1 ? { alphaBlend: true as const } : {}),
    baseColor,
    ...(source.kind === "asset" ? { baseColorAsset: source } : {}),
    ...(source.kind === "virtual-asset" ? { baseColorVirtualAsset: source } : {}),
    requiresTextureCoordinates: source.kind !== "solid",
  };
  return material.kind === "unlit"
    ? { ...common, kind: "unlit" }
    : {
      ...common,
      emissiveFactor: [0, 0, 0],
      kind: "standard",
      metallicFactor: material.metallicFactor,
      normalScale: 1,
      occlusionStrength: 1,
      roughnessFactor: material.roughnessFactor,
    };
};

/** Erases the public material shape before frame or WebGL work. */
export const prepareCanonicalMaterial = (
  material: Material,
  decodedTexture: (asset: TextureAssetRef) => DecodedTextureSource | undefined,
): CanonicalSurfaceMaterial =>
  resolveCanonicalMaterialTexture(
    prepareCanonicalMaterialSource(material),
    (asset) => asset.kind === "asset" ? decodedTexture(asset) : undefined,
  );

const EMPTY_TEXTURE_KEYS: readonly string[] = [];

/** Stable decoded-content claims used to target asynchronous texture publication. */
export const canonicalMaterialTextureKeys = (
  material: CanonicalSurfaceMaterial,
): readonly string[] => {
  const keys: string[] = [];
  const add = (asset: TextureSourceRef | undefined): void => {
    if (asset === undefined) return;
    const key = decodedTextureKey(asset);
    if (!keys.includes(key)) keys.push(key);
  };
  add(material.baseColorAsset);
  if (material.kind === "standard") {
    add(material.metallicRoughnessAsset);
    add(material.normalAsset);
    add(material.emissiveAsset);
    add(material.occlusionAsset);
  }
  return keys.length === 0 ? EMPTY_TEXTURE_KEYS : keys;
};
