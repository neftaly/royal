import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  boxGeometry,
  defaultTextureFallbackColor,
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  planeGeometry,
  scene,
  solidTexture,
  standardMaterial,
  textureAsset,
  unlitMaterial,
  type BoxGeometry,
  type GltfAssetBounds,
  type GltfNode,
  type GltfOptions,
  type PlaneGeometry,
  type RenderNode,
  type TextureRef
} from './index';

describe('renderer descriptor authoring API', () => {
  it('uses string discriminants for descriptor factories', () => {
    const color = [0.3, 0.4, 0.5, 1] as const;
    const geometry = boxGeometry({ size: [1, 2, 3] });
    const material = standardMaterial({ color });
    const node = mesh({ geometry, material });
    const camera = perspectiveCamera({
      far: 100,
      fovY: 1,
      near: 0.1,
      position: [0, 0, 4],
      rotation: [0, 0, 0]
    });
    const root = scene({
      children: [pass({
        camera,
        children: [node, directionalLight({
          color: [1, 1, 1, 1],
          direction: [0, -1, -1]
        })]
      })]
    });

    expect(root.kind).toBe('scene');
    expect(root.children[0]?.kind).toBe('pass');
    expect(camera.kind).toBe('perspective-camera');
    expect(orthographicCamera({
      bottom: -1,
      far: 10,
      left: -1,
      near: 0.1,
      position: [0, 0, 4],
      right: 1,
      rotation: [0, 0, 0],
      top: 1
    }).kind).toBe('orthographic-camera');
    expect(node.kind).toBe('mesh');
    expect(geometry.kind).toBe('box');
    expect(material.kind).toBe('standard');
    expect(unlitMaterial({ color }).kind).toBe('unlit');
    expect(root.children[0]?.children[1]?.kind).toBe('directional-light');
    expectTypeOf(root.children[0]?.children[0]).toMatchTypeOf<RenderNode | undefined>();
  });

  it('normalizes geometry convenience inputs into descriptor sizes', () => {
    expect(boxGeometry(1)).toEqual({
      kind: 'box',
      size: [1, 1, 1]
    });
    expect(boxGeometry([1, 2, 3])).toEqual({
      kind: 'box',
      size: [1, 2, 3]
    });
    expect(boxGeometry({ size: 2 })).toEqual({
      kind: 'box',
      size: [2, 2, 2]
    });
    expect(planeGeometry([4, 5])).toEqual({
      kind: 'plane',
      size: [4, 5]
    });
    expect(planeGeometry(3)).toEqual({
      kind: 'plane',
      size: [3, 3]
    });
    expect(planeGeometry({ size: 6 })).toEqual({
      kind: 'plane',
      size: [6, 6]
    });

    expectTypeOf(boxGeometry(1)).toEqualTypeOf<BoxGeometry>();
    expectTypeOf(planeGeometry([1, 2])).toEqualTypeOf<PlaneGeometry>();
  });

  it('represents material base color as solid or asset texture references', () => {
    const solid = solidTexture({
      color: [1, 0, 0, 1],
      version: 1
    });
    const asset = textureAsset({
      colorSpace: 'srgb',
      fallback: solid,
      sampler: { minFilter: 'linear-mipmap-linear', wrapS: 'repeat', wrapT: 'repeat' },
      src: '/textures/albedo.png',
      version: 'v2'
    });

    expect(solid).toEqual({
      color: [1, 0, 0, 1],
      kind: 'solid',
      version: 1
    });
    expect(asset).toMatchObject({
      colorSpace: 'srgb',
      fallback: solid,
      kind: 'asset',
      uri: '/textures/albedo.png',
      version: 'v2'
    });
    expect(standardMaterial({ texture: asset }).baseColor).toBe(asset);
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();

    expect(defaultTextureFallbackColor).toEqual([0.5, 0.5, 0.5, 1]);
    expect(textureAsset({
      src: '/textures/albedo-default.png'
    })).not.toHaveProperty('fallback');
  });

  it('normalizes glTF src options into asset references', () => {
    const bounds = {
      max: [1, 2, 3],
      min: [-1, -2, -3]
    } satisfies GltfAssetBounds;
    const node = gltf({
      bounds,
      src: '/DamagedHelmet/DamagedHelmet.gltf',
      version: 2
    });
    const srcNode = gltf('/PlainCube/PlainCube.gltf');
    const fallbackIdNode = gltf({ src: '/PlainCube/PlainCube.gltf' });

    expect(node.asset).toEqual({
      bounds,
      uri: '/DamagedHelmet/DamagedHelmet.gltf',
      version: 2
    });
    expect(node.src).toBe('/DamagedHelmet/DamagedHelmet.gltf');
    expect(srcNode.asset).toEqual({
      uri: '/PlainCube/PlainCube.gltf'
    });
    expect(fallbackIdNode.asset).toEqual({
      uri: '/PlainCube/PlainCube.gltf'
    });
    expectTypeOf(srcNode).toEqualTypeOf<GltfNode>();
    expectTypeOf<GltfOptions>().not.toHaveProperty('asset');
    expectTypeOf<GltfOptions>().not.toHaveProperty('id');
    expectTypeOf<GltfOptions>().not.toHaveProperty('revision');
    expectTypeOf<GltfOptions>().not.toHaveProperty('assetId');
  });
});
