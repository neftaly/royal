import type { Rgba } from './primitives';

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

export const defaultTextureFallbackColor: Rgba = [0.5, 0.5, 0.5, 1];

export interface SolidTextureRef {
  readonly kind: 'solid';
  readonly color: Rgba;
  readonly colorSpace?: TextureColorSpace;
  readonly version?: TextureVersion;
}

export interface TextureAssetRef {
  readonly kind: 'asset';
  readonly colorSpace?: TextureColorSpace;
  readonly fallback?: SolidTextureRef;
  readonly sampler?: TextureSampler;
  readonly uri: string;
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetRef {
  readonly kind: 'virtual-asset';
  readonly colorSpace?: TextureColorSpace;
  readonly fallback?: SolidTextureRef;
  readonly manifestUri: string;
  readonly preview?: TextureAssetRef;
  readonly sampler?: TextureSampler;
  readonly version?: TextureVersion;
}

export type TextureRef = SolidTextureRef | TextureAssetRef | VirtualTextureAssetRef;

export interface SolidTextureOptions {
  readonly color: Rgba;
  readonly colorSpace?: TextureColorSpace;
  readonly version?: TextureVersion;
}

interface TextureAssetBaseOptions {
  readonly colorSpace?: TextureColorSpace;
  readonly fallback?: SolidTextureRef;
  readonly fallbackColor?: Rgba;
  readonly sampler?: TextureSampler;
  /** Preferred asset version override for cache keys. */
  readonly version?: TextureVersion;
}

export interface TextureAssetSrcOptions extends TextureAssetBaseOptions {
  readonly src: string;
  readonly uri?: never;
}

export interface TextureAssetUriOptions extends TextureAssetBaseOptions {
  readonly src?: never;
  readonly uri: string;
}

export type TextureAssetOptions = TextureAssetSrcOptions | TextureAssetUriOptions;

export type ImageTextureOptions = TextureAssetOptions;

interface VirtualTextureAssetBaseOptions extends Omit<VirtualTextureAssetRef, 'kind' | 'manifestUri' | 'version'> {
  readonly fallbackColor?: Rgba;
  /** Preferred asset version override for cache keys. */
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetSrcOptions extends VirtualTextureAssetBaseOptions {
  readonly manifestUri?: never;
  readonly src: string;
}

export interface VirtualTextureAssetManifestOptions extends VirtualTextureAssetBaseOptions {
  readonly manifestUri: string;
  readonly src?: never;
}

export type VirtualTextureAssetOptions = VirtualTextureAssetSrcOptions | VirtualTextureAssetManifestOptions;
export type VirtualTextureInput = string | VirtualTextureAssetOptions;

export const defaultImageTextureSampler: TextureSampler = {
  magFilter: 'linear',
  minFilter: 'linear-mipmap-linear',
  wrapS: 'clamp-to-edge',
  wrapT: 'clamp-to-edge'
};

export const solidTexture = (options: SolidTextureOptions): SolidTextureRef => {
  return {
    kind: 'solid',
    color: options.color,
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(options.version === undefined ? {} : { version: options.version })
  };
};

const resolveTextureFallback = (options: {
  readonly fallback?: SolidTextureRef;
  readonly fallbackColor?: Rgba;
}): SolidTextureRef | undefined => {
  if (options.fallback !== undefined) return options.fallback;
  if (options.fallbackColor === undefined) return undefined;

  return solidTexture({ color: options.fallbackColor });
};

export function textureAsset(options: TextureAssetSrcOptions): TextureAssetRef;
export function textureAsset(options: TextureAssetUriOptions): TextureAssetRef;
export function textureAsset(options: TextureAssetOptions): TextureAssetRef {
  const uri = options.src ?? options.uri;
  const fallback = resolveTextureFallback(options);

  return {
    kind: 'asset',
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(fallback === undefined ? {} : { fallback }),
    ...(options.sampler === undefined ? {} : { sampler: options.sampler }),
    uri,
    ...(options.version === undefined ? {} : { version: options.version })
  };
}

export function imageTexture(src: string): TextureAssetRef;
export function imageTexture(options: ImageTextureOptions): TextureAssetRef;
export function imageTexture(srcOrOptions: string | ImageTextureOptions): TextureAssetRef {
  const options: ImageTextureOptions =
    typeof srcOrOptions === 'string' ? { src: srcOrOptions } : srcOrOptions;
  const uri = options.src ?? options.uri;

  return textureAsset({
    colorSpace: options.colorSpace ?? 'srgb',
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    ...(options.fallbackColor === undefined ? {} : { fallbackColor: options.fallbackColor }),
    sampler: {
      ...defaultImageTextureSampler,
      ...options.sampler
    },
    src: uri,
    ...(options.version === undefined ? {} : { version: options.version })
  });
}

export const virtualTextureAsset = (options: VirtualTextureAssetOptions): VirtualTextureAssetRef => {
  const manifestUri = options.src ?? options.manifestUri;
  const fallback = resolveTextureFallback(options);

  return {
    kind: 'virtual-asset',
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(fallback === undefined ? {} : { fallback }),
    manifestUri,
    ...(options.preview === undefined ? {} : { preview: options.preview }),
    ...(options.sampler === undefined ? {} : { sampler: options.sampler }),
    ...(options.version === undefined ? {} : { version: options.version })
  };
};

export function virtualTexture(src: string): VirtualTextureAssetRef;
export function virtualTexture(options: VirtualTextureAssetOptions): VirtualTextureAssetRef;
export function virtualTexture(input: VirtualTextureInput): VirtualTextureAssetRef {
  return virtualTextureAsset(typeof input === 'string' ? { src: input } : input);
}
