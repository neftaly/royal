import {
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
} from "../texture/source";
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
  attenuationColor?: readonly [number, number, number];
  attenuationDistance?: number;
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
  /** Authored dielectric index of refraction; omitted for glTF's 1.5 default. */
  indexOfRefraction?: number;
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
  /** Bit 0 waits for lighting maps; bit 1 waits for transmission/volume maps. */
  mapWaits?: number;
  requiresTextureCoordinates: boolean;
  roughnessFactor: number;
  specularColorAsset?: TextureSourceRef;
  specularColorFactor?: readonly [number, number, number];
  specularColorTexture?: CanonicalTextureBinding;
  specularColorTextureCoordinates?: CanonicalTextureCoordinates;
  specularFactor?: number;
  specularTextureAsset?: TextureSourceRef;
  specularTexture?: CanonicalTextureBinding;
  specularTextureCoordinates?: CanonicalTextureCoordinates;
  thicknessAsset?: TextureSourceRef;
  thicknessFactor?: number;
  thicknessTexture?: CanonicalTextureBinding;
  thicknessTextureCoordinates?: CanonicalTextureCoordinates;
  transmissionAsset?: TextureSourceRef;
  transmissionFactor?: number;
  transmissionTexture?: CanonicalTextureBinding;
  transmissionTextureCoordinates?: CanonicalTextureCoordinates;
}>;

export type CanonicalSurfaceMaterial = CanonicalStandardMaterial | CanonicalUnlitMaterial;

export const canonicalMaterialHasTransmission = (
  material: CanonicalSurfaceMaterial,
): material is CanonicalStandardMaterial => material.kind === "standard"
  && (material.transmissionFactor ?? 0) > 0;

export const canonicalMaterialHasVolume = (
  material: CanonicalSurfaceMaterial,
): material is CanonicalStandardMaterial => canonicalMaterialHasTransmission(material)
  && (material.thicknessFactor ?? 0) > 0;

/** Applies one presentation multiplier without changing texture or geometry identity. */
export const tintCanonicalMaterial = (
  material: CanonicalSurfaceMaterial,
  tint: LinearRgba,
): CanonicalSurfaceMaterial => {
  if (tint[0] === 1 && tint[1] === 1 && tint[2] === 1 && tint[3] === 1) return material;
  const baseColor: LinearRgba = [
    material.baseColor[0] * tint[0],
    material.baseColor[1] * tint[1],
    material.baseColor[2] * tint[2],
    material.baseColor[3] * tint[3],
  ];
  return {
    ...material,
    ...(material.alphaBlend === true
      || (material.alphaCutoff === undefined && baseColor[3] < 1)
      ? { alphaBlend: true as const }
      : {}),
    baseColor,
  };
};

/** Pure glTF dielectric Fresnel-at-normal-incidence rule, including IOR 0 compatibility. */
export const dielectricF0FromIndexOfRefraction = (indexOfRefraction: number): number => {
  if (indexOfRefraction === 0) return 1;
  const ratio = (indexOfRefraction - 1) / (indexOfRefraction + 1);
  return ratio * ratio;
};

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
  ) || (
    material.specularTextureAsset !== undefined
      && (material.specularTextureCoordinates?.row0[3] ?? 0) === set
  ) || (
    material.specularColorAsset !== undefined
      && (material.specularColorTextureCoordinates?.row0[3] ?? 0) === set
  ) || (
    canonicalMaterialHasTransmission(material)
      && material.transmissionAsset !== undefined
      && (material.transmissionTextureCoordinates?.row0[3] ?? 0) === set
  ) || (
    canonicalMaterialHasVolume(material)
      && material.thicknessAsset !== undefined
      && (material.thicknessTextureCoordinates?.row0[3] ?? 0) === set
  );
};

export const canonicalTextureSampler = (
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "sampler">,
): CanonicalTextureSampler => ({
  magFilter: asset.sampler?.magFilter ?? "linear",
  minFilter: asset.sampler?.minFilter ?? "linear-mipmap-linear",
  wrapS: asset.sampler?.wrapS ?? "clamp-to-edge",
  wrapT: asset.sampler?.wrapT ?? "clamp-to-edge",
});

/** Stable GPU sampler identity for one normalized authored sampler recipe. */
export const canonicalTextureSamplerKey = (sampler: CanonicalTextureSampler): string => JSON.stringify([
  sampler.magFilter,
  sampler.minFilter,
  sampler.wrapS,
  sampler.wrapT,
]);

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
    samplerKey: canonicalTextureSamplerKey(sampler),
    storageKey: textureStorageKey(asset),
  };
};

/** Resolves a cold glTF texture recipe through the same ordinary-texture binding contract. */
export const resolveCanonicalMaterialTexture = (
  material: CanonicalSurfaceMaterial,
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined,
  texturePending: (asset: TextureSourceRef) => boolean = () => true,
): CanonicalSurfaceMaterial => {
  const baseColorAsset = material.baseColorAsset;
  const baseColorDecoded = baseColorAsset === undefined ? undefined : decodedTexture(baseColorAsset);
  const baseColorTexture = baseColorAsset === undefined || baseColorDecoded === undefined
    ? undefined
    : textureBinding(baseColorAsset, baseColorDecoded);
  const common = {
    ...material,
    ...(baseColorTexture === undefined ? {} : { baseColorTexture }),
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
  const specularTexture = resolve(material.specularTextureAsset);
  const specularColorTexture = resolve(material.specularColorAsset);
  const thicknessTexture = resolve(canonicalMaterialHasVolume(material)
    ? material.thicknessAsset : undefined);
  const transmissionTexture = resolve(canonicalMaterialHasTransmission(material)
    ? material.transmissionAsset : undefined);
  const pending = (
    asset: TextureSourceRef | undefined,
    binding: CanonicalTextureBinding | undefined,
  ): boolean => asset !== undefined && binding === undefined && texturePending(asset);
  const detailTexturesPending = pending(
    material.metallicRoughnessAsset,
    metallicRoughnessTexture,
  ) || pending(material.normalAsset, normalTexture)
    || pending(material.occlusionAsset, occlusionTexture)
    || pending(material.specularTextureAsset, specularTexture)
    || pending(material.specularColorAsset, specularColorTexture);
  const transmissionTexturesPending = pending(
    canonicalMaterialHasTransmission(material) ? material.transmissionAsset : undefined,
    transmissionTexture,
  ) || pending(
    canonicalMaterialHasVolume(material) ? material.thicknessAsset : undefined,
    thicknessTexture,
  );
  const {
    mapWaits: _previousMapWaits,
    ...stableCommon
  } = common as CanonicalStandardMaterial;
  const mapWaits = (detailTexturesPending ? 1 : 0)
    | (transmissionTexturesPending ? 2 : 0);
  return {
    ...stableCommon,
    ...(mapWaits === 0 ? {} : { mapWaits }),
    ...(emissiveTexture === undefined ? {} : { emissiveTexture }),
    ...(metallicRoughnessTexture === undefined ? {} : { metallicRoughnessTexture }),
    ...(normalTexture === undefined ? {} : { normalTexture }),
    ...(occlusionTexture === undefined ? {} : { occlusionTexture }),
    ...(specularTexture === undefined ? {} : { specularTexture }),
    ...(specularColorTexture === undefined ? {} : { specularColorTexture }),
    ...(thicknessTexture === undefined ? {} : { thicknessTexture }),
    ...(transmissionTexture === undefined ? {} : { transmissionTexture }),
  };
};

/** Erases the public material shape while retaining cold texture recipes. */
export const prepareCanonicalMaterialSource = (material: Material): CanonicalSurfaceMaterial => {
  const source = material.baseColor;
  const tint = material.kind === "wireframe" ? undefined : material.tint;
  const baseColor = source.kind === "solid"
    ? source.color
    : tint ?? [1, 1, 1, 1] as const;
  const common = {
    ...(baseColor[3] < 1 ? { alphaBlend: true as const } : {}),
    baseColor,
    ...(source.kind === "asset" ? { baseColorAsset: source } : {}),
    ...(source.kind === "virtual-asset" ? { baseColorVirtualAsset: source } : {}),
    requiresTextureCoordinates: source.kind !== "solid",
  };
  return material.kind !== "standard"
    ? { ...common, kind: "unlit" }
    : {
      ...common,
      emissiveFactor: [0, 0, 0],
      kind: "standard",
      metallicFactor: material.metallic,
      normalScale: 1,
      occlusionStrength: 1,
      roughnessFactor: material.roughness,
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
    add(material.specularColorAsset);
    add(material.specularTextureAsset);
    if (canonicalMaterialHasVolume(material)) add(material.thicknessAsset);
    if (canonicalMaterialHasTransmission(material)) add(material.transmissionAsset);
  }
  return keys.length === 0 ? EMPTY_TEXTURE_KEYS : keys;
};
