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

export type TextureRevision = number | string;

export const defaultTextureFallbackColor: Rgba = [0.5, 0.5, 0.5, 1];

export interface SolidTextureRef {
  readonly kind: 'solid';
  readonly color: Rgba;
  readonly colorSpace?: TextureColorSpace;
  readonly id?: string;
  readonly revision?: TextureRevision;
}

export interface TextureAssetRef {
  readonly kind: 'asset';
  readonly colorSpace?: TextureColorSpace;
  readonly fallback?: SolidTextureRef;
  readonly id: string;
  readonly revision?: TextureRevision;
  readonly sampler?: TextureSampler;
  readonly uri: string;
}

export interface VirtualTextureAssetRef {
  readonly kind: 'virtual-asset';
  readonly colorSpace?: TextureColorSpace;
  readonly fallback?: SolidTextureRef;
  readonly id: string;
  readonly manifestId?: string;
  readonly manifestUri: string;
  readonly revision?: TextureRevision;
  readonly sampler?: TextureSampler;
}

export type TextureRef = SolidTextureRef | TextureAssetRef | VirtualTextureAssetRef;

export interface SolidTextureOptions {
  readonly color: Rgba;
  readonly colorSpace?: TextureColorSpace;
  readonly id?: string;
  readonly revision?: TextureRevision;
}

export type TextureAssetOptions = Omit<TextureAssetRef, 'kind'>;

export type VirtualTextureAssetOptions = Omit<VirtualTextureAssetRef, 'kind'>;

export const solidTexture = (options: SolidTextureOptions): SolidTextureRef => ({
  kind: 'solid',
  color: options.color,
  ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
  ...(options.id === undefined ? {} : { id: options.id }),
  ...(options.revision === undefined ? {} : { revision: options.revision })
});

export const textureAsset = (options: TextureAssetOptions): TextureAssetRef => ({
  kind: 'asset',
  ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
  ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
  id: options.id,
  ...(options.revision === undefined ? {} : { revision: options.revision }),
  ...(options.sampler === undefined ? {} : { sampler: options.sampler }),
  uri: options.uri
});

export const virtualTextureAsset = (options: VirtualTextureAssetOptions): VirtualTextureAssetRef => ({
  kind: 'virtual-asset',
  ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
  ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
  id: options.id,
  ...(options.manifestId === undefined ? {} : { manifestId: options.manifestId }),
  manifestUri: options.manifestUri,
  ...(options.revision === undefined ? {} : { revision: options.revision }),
  ...(options.sampler === undefined ? {} : { sampler: options.sampler })
});
