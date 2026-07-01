import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  defaultImageTextureSampler,
  imageTexture,
  solidTexture,
  standardMaterial,
  textureAsset,
  virtualTexture,
  virtualTextureAsset,
  type ImageTextureOptions,
  type TextureAssetRef,
  type TextureRef,
  type VirtualTextureAssetOptions,
  type VirtualTextureAssetRef
} from './index';

describe('texture descriptors', () => {
  it('creates image textures with color and sampler defaults', () => {
    expect(imageTexture('/textures/albedo.png')).toEqual({
      colorSpace: 'srgb',
      kind: 'asset',
      sampler: defaultImageTextureSampler,
      uri: '/textures/albedo.png'
    });

    expect(imageTexture({
      colorSpace: 'linear',
      sampler: {
        minFilter: 'nearest',
        wrapS: 'repeat'
      },
      src: '/textures/albedo.png'
    })).toEqual({
      colorSpace: 'linear',
      kind: 'asset',
      sampler: {
        magFilter: 'linear',
        minFilter: 'nearest',
        wrapS: 'repeat',
        wrapT: 'clamp-to-edge'
      },
      uri: '/textures/albedo.png'
    });

    expectTypeOf(imageTexture('/textures/albedo.png')).toEqualTypeOf<TextureAssetRef>();
    expectTypeOf(imageTexture('/textures/albedo.png')).toMatchTypeOf<TextureRef>();
  });

  it('keeps normal texture asset descriptors unchanged', () => {
    const fallback = solidTexture({
      color: [0.1, 0.2, 0.3, 1],
      id: 'fallback'
    });
    const asset = textureAsset({
      colorSpace: 'srgb',
      fallback,
      sampler: {
        magFilter: 'linear',
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      },
      uri: '/textures/albedo.png',
      version: 'v2'
    });

    expect(asset).toEqual({
      colorSpace: 'srgb',
      fallback,
      kind: 'asset',
      revision: 'v2',
      sampler: {
        magFilter: 'linear',
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      },
      uri: '/textures/albedo.png'
    });
    expect(textureAsset({
      uri: '/textures/roughness.png'
    })).toEqual({
      kind: 'asset',
      uri: '/textures/roughness.png'
    });
    expectTypeOf(asset).toEqualTypeOf<TextureAssetRef>();
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();
  });

  it('normalizes texture asset src options into asset references', () => {
    const fallback = solidTexture({ color: [0.1, 0.2, 0.3, 1] });
    const asset = textureAsset({
      colorSpace: 'srgb',
      fallback,
      sampler: {
        magFilter: 'linear',
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      },
      src: '/textures/albedo.png',
      version: 'v2'
    });

    expect(asset).toEqual({
      colorSpace: 'srgb',
      fallback,
      kind: 'asset',
      revision: 'v2',
      sampler: {
        magFilter: 'linear',
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      },
      uri: '/textures/albedo.png'
    });
    expect(textureAsset({
      uri: '/textures/roughness.png'
    })).toEqual({
      kind: 'asset',
      uri: '/textures/roughness.png'
    });
    expect(textureAsset({
      src: '/textures/roughness.png'
    })).toEqual({
      kind: 'asset',
      uri: '/textures/roughness.png'
    });
    expectTypeOf(asset).toEqualTypeOf<TextureAssetRef>();
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();
  });

  it('normalizes texture asset version options', () => {
    expect(textureAsset({
      fallbackColor: [0.5, 0.5, 0.5, 1],
      src: '/textures/albedo.png',
      version: 2
    })).toEqual({
      fallback: {
        color: [0.5, 0.5, 0.5, 1],
        kind: 'solid'
      },
      kind: 'asset',
      revision: 2,
      uri: '/textures/albedo.png'
    });

    expect(imageTexture({
      fallbackColor: [0.25, 0.25, 0.25, 1],
      src: '/textures/normal.png',
      version: 'v3'
    })).toEqual({
      colorSpace: 'srgb',
      fallback: {
        color: [0.25, 0.25, 0.25, 1],
        kind: 'solid'
      },
      kind: 'asset',
      revision: 'v3',
      sampler: defaultImageTextureSampler,
      uri: '/textures/normal.png'
    });
    expectTypeOf<ImageTextureOptions>().not.toHaveProperty('id');
    expectTypeOf<ImageTextureOptions>().not.toHaveProperty('revision');
    expectTypeOf<ImageTextureOptions>().not.toHaveProperty('assetId');
    expectTypeOf<TextureAssetRef>().not.toHaveProperty('id');
  });

  it('normalizes virtual texture asset descriptors without renderer runtime details', () => {
    const fallback = solidTexture({
      color: [0.5, 0.5, 0.5, 1],
      id: 'vt-fallback'
    });
    const preview = textureAsset({
      fallback,
      uri: '/textures/terrain-albedo-preview.png',
      version: 'preview-v1'
    });
    const asset = virtualTextureAsset({
      colorSpace: 'srgb',
      fallback,
      manifestUri: '/textures/terrain-albedo.vt.json',
      preview,
      sampler: {
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      },
      version: 3
    });

    expect(asset).toEqual({
      colorSpace: 'srgb',
      fallback,
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-albedo.vt.json',
      preview,
      revision: 3,
      sampler: {
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      }
    });
    expect(virtualTextureAsset({
      manifestUri: '/textures/terrain-normal.vt.json'
    })).toEqual({
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-normal.vt.json'
    });
    expect(standardMaterial({ texture: asset }).baseColor).toBe(asset);
    expect(standardMaterial({ color: [0.2, 0.4, 0.6, 1] }).baseColor).toEqual({
      color: [0.2, 0.4, 0.6, 1],
      kind: 'solid'
    });
    expectTypeOf(asset).toEqualTypeOf<VirtualTextureAssetRef>();
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();
  });

  it('keeps virtual texture asset identity on the manifest URI', () => {
    expect(virtualTextureAsset({
      manifestUri: '/textures/terrain-albedo.vt.json'
    })).toEqual({
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-albedo.vt.json'
    });
    expect(virtualTextureAsset({
      manifestUri: '/textures/terrain-normal.vt.json'
    })).toEqual({
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-normal.vt.json'
    });

    expectTypeOf(virtualTextureAsset({
      manifestUri: '/textures/terrain-normal.vt.json'
    })).toEqualTypeOf<VirtualTextureAssetRef>();
    expectTypeOf<{
      readonly manifestUri: string;
    }>().toMatchTypeOf<VirtualTextureAssetOptions>();
  });

  it('normalizes virtual texture src options into manifest references', () => {
    expect(virtualTexture('/textures/terrain-albedo.vt.json')).toEqual({
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-albedo.vt.json'
    });
    expect(virtualTextureAsset({
      src: '/textures/terrain-albedo.vt.json'
    })).toEqual({
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-albedo.vt.json'
    });
    expectTypeOf(virtualTextureAsset({
      src: '/textures/terrain-normal.vt.json'
    })).toEqualTypeOf<VirtualTextureAssetRef>();
    expectTypeOf(virtualTexture('/textures/terrain-normal.vt.json')).toEqualTypeOf<VirtualTextureAssetRef>();
    expectTypeOf<{
      readonly src: string;
    }>().toMatchTypeOf<VirtualTextureAssetOptions>();
  });

  it('normalizes virtual texture version options', () => {
    expect(virtualTexture({
      fallbackColor: [0.5, 0.5, 0.5, 1],
      src: '/textures/terrain-albedo.vt.json',
      version: 2
    })).toEqual({
      fallback: {
        color: [0.5, 0.5, 0.5, 1],
        kind: 'solid'
      },
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-albedo.vt.json',
      revision: 2
    });
    expectTypeOf<VirtualTextureAssetOptions>().not.toHaveProperty('id');
    expectTypeOf<VirtualTextureAssetOptions>().not.toHaveProperty('revision');
    expectTypeOf<VirtualTextureAssetOptions>().not.toHaveProperty('assetId');
    expectTypeOf<VirtualTextureAssetOptions>().not.toHaveProperty('manifestId');
    expectTypeOf<VirtualTextureAssetRef>().not.toHaveProperty('id');
  });
});
