import {
  defaultImageTextureSampler,
  type LinearRgba,
  type Material,
  type TextureAssetRef,
  type TextureColorSpace,
  type TextureSamplerFilter,
  type TextureSamplerWrap,
} from "@royal/renderer-core";
import {
  decodedTextureKey,
  type DecodedTextureSource,
} from "../texture/asset-owner";

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
  baseColor: LinearRgba;
  baseColorTexture?: CanonicalTextureBinding;
  kind: "unlit";
  requiresTextureCoordinates: boolean;
}>;

export type CanonicalStandardMaterial = Readonly<{
  baseColor: LinearRgba;
  baseColorTexture?: CanonicalTextureBinding;
  kind: "standard";
  metallicFactor: number;
  requiresTextureCoordinates: boolean;
  roughnessFactor: number;
}>;

export type CanonicalSurfaceMaterial = CanonicalStandardMaterial | CanonicalUnlitMaterial;

const NEUTRAL_PERCEPTUAL_GREY: LinearRgba = [0.214_041, 0.214_041, 0.214_041, 1];

const canonicalSampler = (asset: TextureAssetRef): CanonicalTextureSampler => ({
  magFilter: asset.sampler?.magFilter ?? defaultImageTextureSampler.magFilter ?? "linear",
  minFilter: asset.sampler?.minFilter
    ?? defaultImageTextureSampler.minFilter
    ?? "linear-mipmap-linear",
  wrapS: asset.sampler?.wrapS ?? defaultImageTextureSampler.wrapS ?? "clamp-to-edge",
  wrapT: asset.sampler?.wrapT ?? defaultImageTextureSampler.wrapT ?? "clamp-to-edge",
});

const textureBinding = (
  asset: TextureAssetRef,
  decoded: DecodedTextureSource,
): CanonicalTextureBinding => {
  const colorSpace = asset.colorSpace ?? "srgb";
  const sampler = canonicalSampler(asset);
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
    storageKey: JSON.stringify([decodedTextureKey(asset), colorSpace]),
  };
};

/** Erases the public material shape before frame or WebGL work. */
export const prepareCanonicalMaterial = (
  material: Material,
  decodedTexture: (asset: TextureAssetRef) => DecodedTextureSource | undefined,
): CanonicalSurfaceMaterial => {
  if (material.kind === "wireframe") {
    throw new Error("Royal canonical surface slice does not yet support wireframe materials");
  }
  const source = material.baseColor;
  if (source.kind === "virtual-asset") {
    throw new Error("Royal canonical surface slice does not yet support virtual textures");
  }
  if (source.kind === "solid" && source.color[3] !== 1) {
    throw new Error("Royal canonical surface slice does not yet support non-opaque materials");
  }
  const decoded = source.kind === "asset" ? decodedTexture(source) : undefined;
  const baseColor = source.kind === "solid"
    ? source.color
    : decoded === undefined ? NEUTRAL_PERCEPTUAL_GREY : [1, 1, 1, 1] as const;
  const baseColorTexture = source.kind === "asset" && decoded !== undefined
    ? textureBinding(source, decoded)
    : undefined;
  const common = {
    baseColor,
    ...(baseColorTexture === undefined ? {} : { baseColorTexture }),
    requiresTextureCoordinates: source.kind === "asset",
  };
  return material.kind === "unlit"
    ? { ...common, kind: "unlit" }
    : {
      ...common,
      kind: "standard",
      metallicFactor: material.metallicFactor,
      roughnessFactor: material.roughnessFactor,
    };
};
