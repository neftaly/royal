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
  type GltfAssetRef,
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
      revision: 1
    });
    const asset = textureAsset({
      colorSpace: 'srgb',
      fallback: solid,
      revision: 'v2',
      sampler: { minFilter: 'linear-mipmap-linear', wrapS: 'repeat', wrapT: 'repeat' },
      src: '/textures/albedo.png'
    });

    expect(solid).toEqual({
      color: [1, 0, 0, 1],
      kind: 'solid',
      revision: 1
    });
    expect(asset).toMatchObject({
      colorSpace: 'srgb',
      fallback: solid,
      id: '/textures/albedo.png',
      kind: 'asset',
      revision: 'v2',
      uri: '/textures/albedo.png'
    });
    expect(standardMaterial({ texture: asset }).baseColor).toBe(asset);
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();

    expect(defaultTextureFallbackColor).toEqual([0.5, 0.5, 0.5, 1]);
    expect(textureAsset({
      src: '/textures/albedo-default.png'
    })).not.toHaveProperty('fallback');
  });

  it('uses explicit glTF asset identity on gltf nodes', () => {
    const asset: GltfAssetRef = {
      bounds: {
        max: [1, 2, 3],
        min: [-1, -2, -3]
      },
      id: 'damaged-helmet',
      revision: '2026-06-28',
      uri: '/DamagedHelmet/DamagedHelmet.gltf'
    };
    const node = gltf({
      asset,
      transform: { position: [1, 2, 3], rotation: [0, 0, 0] }
    });

    expect(node).toMatchObject({
      asset,
      kind: 'gltf',
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
    expectTypeOf(node.asset).toEqualTypeOf<GltfAssetRef>();
  });

  it('normalizes glTF src options into asset references', () => {
    const bounds = {
      max: [1, 2, 3],
      min: [-1, -2, -3]
    } satisfies GltfAssetRef['bounds'];
    const node = gltf({
      bounds,
      id: 'helmet',
      revision: 2,
      src: '/DamagedHelmet/DamagedHelmet.gltf'
    });
    const srcNode = gltf('/PlainCube/PlainCube.gltf');
    const fallbackIdNode = gltf({ src: '/PlainCube/PlainCube.gltf' });

    expect(node.asset).toEqual({
      bounds,
      id: 'helmet',
      revision: 2,
      uri: '/DamagedHelmet/DamagedHelmet.gltf'
    });
    expect(srcNode.asset).toEqual({
      id: '/PlainCube/PlainCube.gltf',
      uri: '/PlainCube/PlainCube.gltf'
    });
    expect(fallbackIdNode.asset).toEqual({
      id: '/PlainCube/PlainCube.gltf',
      uri: '/PlainCube/PlainCube.gltf'
    });
    expectTypeOf(srcNode).toEqualTypeOf<GltfNode>();
    expectTypeOf<{
      readonly asset: GltfAssetRef;
      readonly src: string;
    }>().not.toMatchTypeOf<GltfOptions>();
  });
});
