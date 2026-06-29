import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  boxGeometry,
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  solidTexture,
  standardMaterial,
  textureAsset,
  unlitMaterial,
  type GltfAssetRef,
  type GltfOptions,
  type RenderNode,
  type TextureRef
} from './index';

describe('renderer descriptor authoring API', () => {
  it('uses string discriminants for descriptor factories', () => {
    const baseColor = solidTexture({ color: [0.3, 0.4, 0.5, 1] });
    const geometry = boxGeometry({ size: [1, 2, 3] });
    const material = standardMaterial({ baseColor });
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
    expect(unlitMaterial({ baseColor }).kind).toBe('unlit');
    expect(root.children[0]?.children[1]?.kind).toBe('directional-light');
    expectTypeOf(root.children[0]?.children[0]).toMatchTypeOf<RenderNode | undefined>();
  });

  it('represents material base color as solid or asset texture references', () => {
    const solid = solidTexture({
      color: [1, 0, 0, 1],
      id: 'debug-red',
      revision: 1
    });
    const asset = textureAsset({
      colorSpace: 'srgb',
      fallback: solid,
      id: 'albedo',
      revision: 'v2',
      sampler: { minFilter: 'linear-mipmap-linear', wrapS: 'repeat', wrapT: 'repeat' },
      uri: '/textures/albedo.png'
    });

    expect(solid).toEqual({
      color: [1, 0, 0, 1],
      id: 'debug-red',
      kind: 'solid',
      revision: 1
    });
    expect(asset).toMatchObject({
      colorSpace: 'srgb',
      fallback: solid,
      id: 'albedo',
      kind: 'asset',
      revision: 'v2',
      uri: '/textures/albedo.png'
    });
    expect(standardMaterial({ baseColor: asset }).baseColor).toBe(asset);
    expectTypeOf(asset).toMatchTypeOf<TextureRef>();
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
    const fallbackIdNode = gltf({ src: '/PlainCube/PlainCube.gltf' });

    expect(node.asset).toEqual({
      bounds,
      id: 'helmet',
      revision: 2,
      uri: '/DamagedHelmet/DamagedHelmet.gltf'
    });
    expect(fallbackIdNode.asset).toEqual({
      id: '/PlainCube/PlainCube.gltf',
      uri: '/PlainCube/PlainCube.gltf'
    });
    expectTypeOf<{
      readonly asset: GltfAssetRef;
      readonly src: string;
    }>().not.toMatchTypeOf<GltfOptions>();
  });
});
