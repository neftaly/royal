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

export type TextureSource =
  | {
    readonly kind: 'image';
    readonly image: TexImageSource;
  }
  | {
    readonly kind: 'rgba8';
    readonly data: Uint8Array | Uint8ClampedArray;
    readonly height: number;
    readonly width: number;
  }
  | {
    readonly kind: 'uri';
    readonly uri: string;
  };

export interface TextureSampler {
  readonly magFilter?: Extract<TextureSamplerFilter, 'linear' | 'nearest'>;
  readonly minFilter?: TextureSamplerFilter;
  readonly wrapS?: TextureSamplerWrap;
  readonly wrapT?: TextureSamplerWrap;
}

export interface Texture2dResource {
  readonly id: string;
  readonly colorSpace?: TextureColorSpace;
  readonly fallbackColor?: Rgba;
  readonly revision?: number | string;
  readonly sampler?: TextureSampler;
  readonly source: TextureSource;
}
