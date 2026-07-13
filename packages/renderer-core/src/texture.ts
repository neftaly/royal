import type { Rgba } from './primitives';
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
  readonly color: Rgba;
  readonly colorSpace?: TextureColorSpace;
  readonly version?: TextureVersion;
}

export interface TextureAssetRef {
  readonly kind: 'asset';
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-URI sharing. */
  readonly contentKey?: TextureContentKey;
  /** Flip the decoded image vertically during upload. @defaultValue `true` */
  readonly flipY?: boolean;
  readonly sampler?: TextureSampler;
  readonly uri: string;
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetRef {
  readonly kind: 'virtual-asset';
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-manifest sharing. */
  readonly contentKey?: TextureContentKey;
  /** Flip authored UV Y before virtual page lookup. @defaultValue `true` */
  readonly flipY?: boolean;
  readonly manifestUri: string;
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
  /** Stable decoded-content identity supplied by the asset layer for cross-URI sharing. */
  readonly contentKey?: TextureContentKey;
  /** Flip the decoded image vertically during upload. @defaultValue `true` */
  readonly flipY?: boolean;
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

interface VirtualTextureAssetBaseOptions {
  /** Color-space override. Otherwise the manifest declaration is used when available. */
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-manifest sharing. */
  readonly contentKey?: TextureContentKey;
  /** Flip authored UV Y before virtual page lookup. @defaultValue `true` */
  readonly flipY?: boolean;
  readonly sampler?: TextureSampler;
  /** Preferred asset version override for cache keys. */
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetSrcOptions extends VirtualTextureAssetBaseOptions {
  readonly manifestUri?: never;
  /** URI of the authored virtual-texture JSON manifest. */
  readonly src: string;
}

export interface VirtualTextureAssetManifestOptions extends VirtualTextureAssetBaseOptions {
  /** URI of the authored virtual-texture JSON manifest; explicit alias for `src`. */
  readonly manifestUri: string;
  readonly src?: never;
}

/** Options for an authored manifest. Supply exactly one of `src` or `manifestUri`. */
export type VirtualTextureAssetOptions = VirtualTextureAssetSrcOptions | VirtualTextureAssetManifestOptions;
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

const sourceUri = (
  src: string | undefined,
  uri: string | undefined,
  label: string,
  fields: readonly [string, string],
): string => {
  if ((src === undefined) === (uri === undefined)) {
    throw new Error(`${label} requires exactly one of "${fields[0]}" or "${fields[1]}"`);
  }
  const value = src ?? uri!;
  if (value.length === 0) {
    throw new Error(`${label} "${src === undefined ? fields[1] : fields[0]}" must not be empty`);
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

export function textureAsset(options: TextureAssetSrcOptions): TextureAssetRef;
export function textureAsset(options: TextureAssetUriOptions): TextureAssetRef;
export function textureAsset(options: TextureAssetOptions): TextureAssetRef {
  const uri = sourceUri(options.src, options.uri, 'texture asset', ['src', 'uri']);
  const sampler = frozenSampler(options.sampler);

  return Object.freeze({
    kind: 'asset',
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(options.contentKey === undefined ? {} : { contentKey: options.contentKey }),
    ...(options.flipY === undefined ? {} : { flipY: options.flipY }),
    ...(sampler === undefined ? {} : { sampler }),
    uri,
    ...(options.version === undefined ? {} : { version: options.version })
  });
}

export function imageTexture(src: string): TextureAssetRef;
export function imageTexture(options: ImageTextureOptions): TextureAssetRef;
export function imageTexture(srcOrOptions: string | ImageTextureOptions): TextureAssetRef {
  const options: ImageTextureOptions =
    typeof srcOrOptions === 'string' ? { src: srcOrOptions } : srcOrOptions;
  const uri = sourceUri(options.src, options.uri, 'image texture', ['src', 'uri']);

  return textureAsset({
    colorSpace: options.colorSpace ?? 'srgb',
    sampler: {
      ...defaultImageTextureSampler,
      ...options.sampler
    },
    src: uri,
    ...(options.contentKey === undefined ? {} : { contentKey: options.contentKey }),
    ...(options.flipY === undefined ? {} : { flipY: options.flipY }),
    ...(options.version === undefined ? {} : { version: options.version })
  });
}

const virtualTextureAsset = (options: VirtualTextureAssetOptions): VirtualTextureAssetRef => {
  const manifestUri = sourceUri(
    options.src,
    options.manifestUri,
    'virtual texture',
    ['src', 'manifestUri'],
  );
  const sampler = frozenSampler(options.sampler);

  return Object.freeze({
    kind: 'virtual-asset',
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    ...(options.contentKey === undefined ? {} : { contentKey: options.contentKey }),
    ...(options.flipY === undefined ? {} : { flipY: options.flipY }),
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
  return virtualTextureAsset(typeof input === 'string' ? { src: input } : input);
}
