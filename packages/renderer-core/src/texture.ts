import type { LinearRgba } from './primitives';
import {
  resolveRgba,
  identityScalar,
  nonEmptyString,
  objectWithAllowedFields,
  stringChoice,
} from './descriptor-values';

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
  /** Filter used when texture texels are magnified across screen pixels. */
  readonly magFilter?: Extract<TextureSamplerFilter, 'linear' | 'nearest'>;
  /** Filter used when texture texels are minified; `mipmap` values select between mip levels. */
  readonly minFilter?: TextureSamplerFilter;
  /** Addressing along glTF/WebGL S, equivalent to the horizontal U coordinate. */
  readonly wrapS?: TextureSamplerWrap;
  /** Addressing along glTF/WebGL T, equivalent to the vertical V coordinate. */
  readonly wrapT?: TextureSamplerWrap;
}

/** A non-empty string or finite number identifying one revision of source bytes. */
export type TextureVersion = number | string;
/** A non-empty string or finite number identifying equal decoded content across sources. */
export type TextureContentKey = number | string;

export interface SolidTextureRef {
  readonly kind: 'solid';
  readonly color: LinearRgba;
}

export interface TextureAssetRef {
  readonly kind: 'asset';
  readonly colorSpace?: TextureColorSpace;
  /** Stable decoded-content identity supplied by the asset layer for cross-URI sharing. */
  readonly contentKey?: TextureContentKey;
  readonly sampler?: TextureSampler;
  /** URI of the image asset, using the same field name as `imageTexture(...)`. */
  readonly src: string;
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

/** Friendly image options; use `textureAsset` for explicit cross-URI content identity. */
export type ImageTextureOptions = Omit<TextureAssetOptions, 'contentKey'>;

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

const DEFAULT_IMAGE_TEXTURE_SAMPLER: TextureSampler = {
  magFilter: 'linear',
  minFilter: 'linear-mipmap-linear',
  wrapS: 'clamp-to-edge',
  wrapT: 'clamp-to-edge'
};

const TEXTURE_COLOR_SPACES = ['linear', 'srgb'] as const;
const TEXTURE_MAG_FILTERS = ['linear', 'nearest'] as const;
const TEXTURE_MIN_FILTERS = [
  'linear',
  'linear-mipmap-linear',
  'linear-mipmap-nearest',
  'nearest',
  'nearest-mipmap-linear',
  'nearest-mipmap-nearest',
] as const;
const TEXTURE_WRAPS = ['clamp-to-edge', 'mirrored-repeat', 'repeat'] as const;
const TEXTURE_SAMPLER_FIELDS = ['magFilter', 'minFilter', 'wrapS', 'wrapT'] as const;
const SOLID_TEXTURE_FIELDS = ['color'] as const;
const TEXTURE_ASSET_FIELDS = ['colorSpace', 'contentKey', 'sampler', 'src', 'version'] as const;
const IMAGE_TEXTURE_FIELDS = ['colorSpace', 'sampler', 'src', 'version'] as const;
const VIRTUAL_TEXTURE_FIELDS = [
  'colorSpace', 'contentKey', 'manifestUri', 'sampler', 'version',
] as const;

const optionalChoice = <Choice extends string>(
  value: unknown,
  choices: readonly Choice[],
  label: string,
): Choice | undefined => value === undefined ? undefined : stringChoice(value, choices, label);

const resolveSampler = (sampler: TextureSampler | undefined): TextureSampler | undefined => {
  if (sampler === undefined) return undefined;
  objectWithAllowedFields(sampler, TEXTURE_SAMPLER_FIELDS, 'texture sampler');
  if (sampler.magFilter !== undefined) {
    stringChoice(sampler.magFilter, TEXTURE_MAG_FILTERS, 'texture sampler magFilter');
  }
  if (sampler.minFilter !== undefined) {
    stringChoice(sampler.minFilter, TEXTURE_MIN_FILTERS, 'texture sampler minFilter');
  }
  if (sampler.wrapS !== undefined) stringChoice(sampler.wrapS, TEXTURE_WRAPS, 'texture sampler wrapS');
  if (sampler.wrapT !== undefined) stringChoice(sampler.wrapT, TEXTURE_WRAPS, 'texture sampler wrapT');
  return { ...sampler };
};

export const solidTexture = (options: SolidTextureOptions): SolidTextureRef => {
  objectWithAllowedFields(options, SOLID_TEXTURE_FIELDS, 'solid texture');
  return {
    kind: 'solid',
    color: resolveRgba(options.color, 'solid texture color')
  };
};

export const textureAsset = (options: TextureAssetOptions): TextureAssetRef => {
  objectWithAllowedFields(options, TEXTURE_ASSET_FIELDS, 'texture asset');
  const uri = nonEmptyString(options.src, 'texture asset "src"');
  const colorSpace = optionalChoice(options.colorSpace, TEXTURE_COLOR_SPACES, 'texture asset colorSpace');
  const sampler = resolveSampler(options.sampler);
  const contentKey = options.contentKey === undefined
    ? undefined
    : identityScalar(options.contentKey, 'texture asset contentKey');
  const version = options.version === undefined
    ? undefined
    : identityScalar(options.version, 'texture asset version');

  return {
    kind: 'asset',
    ...(colorSpace === undefined ? {} : { colorSpace }),
    ...(contentKey === undefined ? {} : { contentKey }),
    ...(sampler === undefined ? {} : { sampler }),
    src: uri,
    ...(version === undefined ? {} : { version })
  };
};

export function imageTexture(src: string): TextureAssetRef;
export function imageTexture(options: ImageTextureOptions): TextureAssetRef;
export function imageTexture(srcOrOptions: string | ImageTextureOptions): TextureAssetRef {
  const options: ImageTextureOptions =
    typeof srcOrOptions === 'string' ? { src: srcOrOptions } : srcOrOptions;
  objectWithAllowedFields(options, IMAGE_TEXTURE_FIELDS, 'image texture');
  const uri = nonEmptyString(options.src, 'image texture "src"');

  return textureAsset({
    colorSpace: options.colorSpace ?? 'srgb',
    sampler: {
      ...DEFAULT_IMAGE_TEXTURE_SAMPLER,
      ...options.sampler
    },
    src: uri,
    ...(options.version === undefined ? {} : { version: options.version })
  });
}

const virtualTextureAsset = (options: VirtualTextureAssetOptions): VirtualTextureAssetRef => {
  objectWithAllowedFields(options, VIRTUAL_TEXTURE_FIELDS, 'virtual texture');
  const manifestUri = nonEmptyString(options.manifestUri, 'virtual texture "manifestUri"');
  const colorSpace = optionalChoice(options.colorSpace, TEXTURE_COLOR_SPACES, 'virtual texture colorSpace');
  const sampler = resolveSampler(options.sampler);
  const contentKey = options.contentKey === undefined
    ? undefined
    : identityScalar(options.contentKey, 'virtual texture contentKey');
  const version = options.version === undefined
    ? undefined
    : identityScalar(options.version, 'virtual texture version');

  return {
    kind: 'virtual-asset',
    ...(colorSpace === undefined ? {} : { colorSpace }),
    ...(contentKey === undefined ? {} : { contentKey }),
    manifestUri,
    ...(sampler === undefined ? {} : { sampler }),
    ...(version === undefined ? {} : { version })
  };
};

/** Creates an authored virtual-texture reference from its JSON manifest URI. */
export function virtualTexture(manifestUri: string): VirtualTextureAssetRef;
export function virtualTexture(options: VirtualTextureAssetOptions): VirtualTextureAssetRef;
export function virtualTexture(input: VirtualTextureInput): VirtualTextureAssetRef;
export function virtualTexture(input: VirtualTextureInput): VirtualTextureAssetRef {
  return virtualTextureAsset(typeof input === 'string' ? { manifestUri: input } : input);
}
