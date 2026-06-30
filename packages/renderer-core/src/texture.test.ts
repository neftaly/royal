import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  solidTexture,
  standardMaterial,
  textureAsset,
  virtualTextureAsset,
  type TextureAssetRef,
  type TextureRef,
  type VirtualTextureAssetRef
} from './index';

describe('texture descriptors', () => {
  it('keeps normal texture asset descriptors unchanged', () => {
    const fallback = solidTexture({
      color: [0.1, 0.2, 0.3, 1],
      id: 'fallback'
    });
    const asset = textureAsset({
      colorSpace: 'srgb',
      fallback,
      id: 'albedo',
      revision: 'v2',
      sampler: {
        magFilter: 'linear',
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      },
      uri: '/textures/albedo.png'
    });

    expect(asset).toEqual({
      colorSpace: 'srgb',
      fallback,
      id: 'albedo',
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
      id: 'roughness',
      uri: '/textures/roughness.png'
    })).toEqual({
      id: 'roughness',
      kind: 'asset',
      uri: '/textures/roughness.png'
    });
    expectTypeOf(asset).toEqualTypeOf<TextureAssetRef>();
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();
  });

  it('normalizes virtual texture asset descriptors without renderer runtime details', () => {
    const fallback = solidTexture({
      color: [0.5, 0.5, 0.5, 1],
      id: 'vt-fallback'
    });
    const preview = textureAsset({
      fallback,
      id: 'terrain-albedo-preview',
      revision: 'preview-v1',
      uri: '/textures/terrain-albedo-preview.png'
    });
    const asset = virtualTextureAsset({
      colorSpace: 'srgb',
      fallback,
      id: 'terrain-albedo',
      manifestId: 'terrain-albedo-manifest',
      manifestUri: '/textures/terrain-albedo.vt.json',
      preview,
      revision: 3,
      sampler: {
        minFilter: 'linear-mipmap-linear',
        wrapS: 'repeat',
        wrapT: 'repeat'
      }
    });

    expect(asset).toEqual({
      colorSpace: 'srgb',
      fallback,
      id: 'terrain-albedo',
      kind: 'virtual-asset',
      manifestId: 'terrain-albedo-manifest',
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
      id: 'terrain-normal',
      manifestUri: '/textures/terrain-normal.vt.json'
    })).toEqual({
      id: 'terrain-normal',
      kind: 'virtual-asset',
      manifestUri: '/textures/terrain-normal.vt.json'
    });
    expect(standardMaterial({ baseColor: asset }).baseColor).toBe(asset);
    expectTypeOf(asset).toEqualTypeOf<VirtualTextureAssetRef>();
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();
  });
});
