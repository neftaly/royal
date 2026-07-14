import type { LinearRgba } from './primitives';
import { frozenRgba } from './descriptor-values';

export type TextureColorSpace = 'linear' | 'srgb';

export type TextureSamplerFilter =
  | 'linear'
  | 'linear-mipmap-linear'
  | 'linear-mipmap-nearest'
  | 'nearest'
  | 'nearest-mipmap-linear'
  | 'nearest-mipmap-nearest';

export type TextureSamplerWrap = 'clamp-to-edge' | 'mirrored-repeat' | 'repeat';

export interface TextureSampler {
  readonly magFilter?: Extract<TextureSamplerFilter, 'linear' | 'nearest'>;
  readonly minFilter?: TextureSamplerFilter;
  readonly wrapS?: TextureSamplerWrap;
  readonly wrapT?: TextureSamplerWrap;
}

export type TextureVersion = number | string;
export type TextureContentKey = number | string;

export interface SolidTextureRef {
  readonly kind: 'solid';
  readonly color: LinearRgba;
  readonly colorSpace?: TextureColorSpace;
  readonly version?: TextureVersion;
}

export interface TextureAssetRef {
  readonly kind: 'asset';
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-URI sharing. */
  readonly contentKey?: TextureContentKey;
  readonly sampler?: TextureSampler;
  readonly uri: string;
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetRef {
  readonly kind: 'virtual-asset';
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-manifest sharing. */
  readonly contentKey?: TextureContentKey;
  readonly manifestUri: string;
  readonly sampler?: TextureSampler;
  readonly version?: TextureVersion;
}

export type TextureRef = SolidTextureRef | TextureAssetRef | VirtualTextureAssetRef;

export interface SolidTextureOptions {
  readonly color: LinearRgba;
  readonly colorSpace?: TextureColorSpace;
  readonly version?: TextureVersion;
}

interface TextureAssetBaseOptions {
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-URI sharing. */
  readonly contentKey?: TextureContentKey;
  readonly sampler?: TextureSampler;
  /** Preferred asset version override for cache keys. */
  readonly version?: TextureVersion;
}

export interface TextureAssetOptions extends TextureAssetBaseOptions {
  /** URI of the image asset. */
  readonly src: string;
}

export type ImageTextureOptions = TextureAssetOptions;

interface VirtualTextureAssetBaseOptions {
  /** Color-space override. Otherwise the manifest declaration is used when available. */
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-manifest sharing. */
  readonly contentKey?: TextureContentKey;
  readonly sampler?: TextureSampler;
  /** Preferred asset version override for cache keys. */
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetOptions extends VirtualTextureAssetBaseOptions {
  /** URI of the authored virtual-texture JSON manifest. */
  readonly manifestUri: string;
}

/** A manifest URI string or the equivalent authored-manifest options object. */
export type VirtualTextureInput = string | VirtualTextureAssetOptions;

export const defaultImageTextureSampler: TextureSampler = Object.freeze({
  magFilter: 'linear',
  minFilter: 'linear-mipmap-linear',
  wrapS: 'clamp-to-edge',
  wrapT: 'clamp-to-edge'
});

const frozenSampler = (sampler: TextureSampler | undefined): TextureSampler | undefined =>
  sampler === undefined ? undefined : Object.freeze({ ...sampler });

const nonEmptySource = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

export const solidTexture = (options: SolidTextureOptions): SolidTextureRef => {
  return Object.freeze({
    kind: 'solid',
    color: frozenRgba(options.color, 'solid texture color'),
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(options.version === undefined ? {} : { version: options.version })
  });
};

export const textureAsset = (options: TextureAssetOptions): TextureAssetRef => {
  const uri = nonEmptySource(options.src, 'texture asset "src"');
  const sampler = frozenSampler(options.sampler);

  return Object.freeze({
    kind: 'asset',
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(options.contentKey === undefined ? {} : { contentKey: options.contentKey }),
    ...(sampler === undefined ? {} : { sampler }),
    uri,
    ...(options.version === undefined ? {} : { version: options.version })
  });
};

export function imageTexture(src: string): TextureAssetRef;
export function imageTexture(options: ImageTextureOptions): TextureAssetRef;
export function imageTexture(srcOrOptions: string | ImageTextureOptions): TextureAssetRef {
  const options: ImageTextureOptions =
    typeof srcOrOptions === 'string' ? { src: srcOrOptions } : srcOrOptions;
  const uri = nonEmptySource(options.src, 'image texture "src"');

  return textureAsset({
    colorSpace: options.colorSpace ?? 'srgb',
    sampler: {
      ...defaultImageTextureSampler,
      ...options.sampler
    },
    src: uri,
    ...(options.contentKey === undefined ? {} : { contentKey: options.contentKey }),
    ...(options.version === undefined ? {} : { version: options.version })
  });
}

const virtualTextureAsset = (options: VirtualTextureAssetOptions): VirtualTextureAssetRef => {
  const manifestUri = nonEmptySource(options.manifestUri, 'virtual texture "manifestUri"');
  const sampler = frozenSampler(options.sampler);

  return Object.freeze({
    kind: 'virtual-asset',
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(options.contentKey === undefined ? {} : { contentKey: options.contentKey }),
    manifestUri,
    ...(sampler === undefined ? {} : { sampler }),
    ...(options.version === undefined ? {} : { version: options.version })
  });
};

/** Creates an authored virtual-texture reference from its JSON manifest URI. */
export function virtualTexture(src: string): VirtualTextureAssetRef;
export function virtualTexture(options: VirtualTextureAssetOptions): VirtualTextureAssetRef;
export function virtualTexture(input: VirtualTextureInput): VirtualTextureAssetRef;
export function virtualTexture(input: VirtualTextureInput): VirtualTextureAssetRef {
  return virtualTextureAsset(typeof input === 'string' ? { manifestUri: input } : input);
}
