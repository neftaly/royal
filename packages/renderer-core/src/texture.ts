import type { LinearRgba } from './primitives';
import {
  identityScalar,
  nonEmptyString,
  objectWithAllowedFields,
  resolveRgba,
  stringChoice,
  validateRgba,
} from './descriptor-values';

/** Interpretation of encoded RGB texels before material sampling. */
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
  /** Filter used when texture texels are magnified across screen pixels. @defaultValue `"linear"` */
  readonly magFilter?: Extract<TextureSamplerFilter, 'linear' | 'nearest'>;
  /** Filter used when texture texels are minified. @defaultValue `"linear-mipmap-linear"` */
  readonly minFilter?: TextureSamplerFilter;
  /** Addressing along glTF/WebGL S, equivalent to horizontal U. @defaultValue `"clamp-to-edge"` */
  readonly wrapS?: TextureSamplerWrap;
  /** Addressing along glTF/WebGL T, equivalent to vertical V. @defaultValue `"clamp-to-edge"` */
  readonly wrapT?: TextureSamplerWrap;
}

/** A non-empty string or finite number identifying one revision of source bytes. */
export type TextureVersion = number | string;
/** A non-empty string or finite number identifying equal decoded content across sources. */
export type TextureContentKey = number | string;

export interface SolidTextureRef {
  readonly kind: 'solid';
  /** Scene-linear RGBA texel value. */
  readonly color: LinearRgba;
}

export interface TextureAssetRef {
  readonly kind: 'asset';
  /** Encoded RGB interpretation. @defaultValue `"srgb"` */
  readonly colorSpace?: TextureColorSpace;
  /** Caller-asserted identity for equal decoded content across source URIs. */
  readonly contentKey?: TextureContentKey;
  /** Sampling policy; omitted fields use the documented `TextureSampler` defaults. */
  readonly sampler?: TextureSampler;
  /** URI of the image asset, using the same field name as `imageTexture(...)`. */
  readonly src: string;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
  readonly version?: TextureVersion;
}

export interface VirtualTextureAssetRef {
  readonly kind: 'virtual-asset';
  /** Override for the manifest color space; otherwise the manifest declaration is authoritative. */
  readonly colorSpace?: TextureColorSpace;
  /** Caller-asserted identity for equal decoded content across manifest URIs. */
  readonly contentKey?: TextureContentKey;
  /** URI of the authored virtual-texture JSON manifest. */
  readonly manifestUri: string;
  /** Sampling policy; omitted fields use the documented `TextureSampler` defaults. */
  readonly sampler?: TextureSampler;
  /** Revision of bytes at `manifestUri`; change it when the URI serves different bytes. */
  readonly version?: TextureVersion;
}

export type TextureRef = SolidTextureRef | TextureAssetRef | VirtualTextureAssetRef;

export interface SolidTextureOptions {
  /** Scene-linear RGBA texel value. Use `linearRgbaFromSrgb` for authored sRGB values. */
  readonly color: LinearRgba;
}

interface TextureAssetBaseOptions {
  /** Encoded RGB interpretation. @defaultValue `"srgb"` */
  readonly colorSpace?: TextureColorSpace;
  /** Caller-asserted identity for equal decoded content across source URIs. */
  readonly contentKey?: TextureContentKey;
  /** Sampling policy; omitted fields use the documented `TextureSampler` defaults. */
  readonly sampler?: TextureSampler;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
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
  /** Caller-asserted identity for equal decoded content across manifest URIs. */
  readonly contentKey?: TextureContentKey;
  /** Sampling policy; omitted fields use the documented `TextureSampler` defaults. */
  readonly sampler?: TextureSampler;
  /** Revision of bytes at `manifestUri`; change it when the URI serves different bytes. */
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
const SOLID_TEXTURE_REF_FIELDS = ['color', 'kind'] as const;
const TEXTURE_ASSET_REF_FIELDS = [...TEXTURE_ASSET_FIELDS, 'kind'] as const;
const VIRTUAL_TEXTURE_REF_FIELDS = [...VIRTUAL_TEXTURE_FIELDS, 'kind'] as const;

const optionalChoice = <Choice extends string>(
  value: unknown,
  choices: readonly Choice[],
  label: string,
): Choice | undefined => value === undefined ? undefined : stringChoice(value, choices, label);

const validateSampler = (sampler: TextureSampler, label: string): void => {
  objectWithAllowedFields(sampler, TEXTURE_SAMPLER_FIELDS, label);
  if (sampler.magFilter !== undefined) {
    stringChoice(sampler.magFilter, TEXTURE_MAG_FILTERS, `${label} magFilter`);
  }
  if (sampler.minFilter !== undefined) {
    stringChoice(sampler.minFilter, TEXTURE_MIN_FILTERS, `${label} minFilter`);
  }
  if (sampler.wrapS !== undefined) stringChoice(sampler.wrapS, TEXTURE_WRAPS, `${label} wrapS`);
  if (sampler.wrapT !== undefined) stringChoice(sampler.wrapT, TEXTURE_WRAPS, `${label} wrapT`);
};

const resolveSampler = (sampler: TextureSampler | undefined): TextureSampler | undefined => {
  if (sampler === undefined) return undefined;
  validateSampler(sampler, 'texture sampler');
  return { ...sampler };
};

/** @internal Validates a structurally supplied texture at a material boundary. */
export const validateTextureRef: (
  value: unknown,
  label: string,
) => asserts value is TextureRef = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a Royal texture descriptor`);
  }
  const texture = value as Partial<TextureRef>;
  if (texture.kind === 'solid') {
    objectWithAllowedFields(value, SOLID_TEXTURE_REF_FIELDS, label);
    validateRgba(texture.color, `${label} color`);
    return;
  }
  if (texture.kind === 'asset') {
    objectWithAllowedFields(value, TEXTURE_ASSET_REF_FIELDS, label);
    optionalChoice(texture.colorSpace, TEXTURE_COLOR_SPACES, `${label} colorSpace`);
    if (texture.contentKey !== undefined) identityScalar(texture.contentKey, `${label} contentKey`);
    if (texture.sampler !== undefined) validateSampler(texture.sampler, `${label} sampler`);
    nonEmptyString(texture.src, `${label} src`);
    if (texture.version !== undefined) identityScalar(texture.version, `${label} version`);
    return;
  }
  if (texture.kind === 'virtual-asset') {
    objectWithAllowedFields(value, VIRTUAL_TEXTURE_REF_FIELDS, label);
    optionalChoice(texture.colorSpace, TEXTURE_COLOR_SPACES, `${label} colorSpace`);
    if (texture.contentKey !== undefined) identityScalar(texture.contentKey, `${label} contentKey`);
    nonEmptyString(texture.manifestUri, `${label} manifestUri`);
    if (texture.sampler !== undefined) validateSampler(texture.sampler, `${label} sampler`);
    if (texture.version !== undefined) identityScalar(texture.version, `${label} version`);
    return;
  }
  throw new TypeError(`${label} must be a solidTexture, imageTexture, textureAsset, or virtualTexture descriptor`);
};

/** Creates one scene-linear constant texture without an external asset lifecycle. */
export const solidTexture = (options: SolidTextureOptions): SolidTextureRef => {
  objectWithAllowedFields(options, SOLID_TEXTURE_FIELDS, 'solid texture');
  return {
    kind: 'solid',
    color: resolveRgba(options.color, 'solid texture color')
  };
};

/** Creates an explicit ordinary texture asset, including optional shared-content identity. */
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

/** Creates a friendly sRGB ordinary-image reference from a URI or image options. */
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
