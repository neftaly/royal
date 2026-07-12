import { describe, expect, it } from 'vitest';
import type {
  CanvasProps,
  TextureAssetRef,
  TextureColorSpace,
  TextureSampler,
  VirtualTextureAssetRef,
} from '@royal/react';
import { perspectiveCamera, scene } from '@royal/react/scene';

const renderScene = scene({
  camera: perspectiveCamera({
    far: 10,
    fovY: Math.PI / 3,
    near: 0.1,
    position: [0, 0, 2],
    rotation: [0, 0, 0],
  }),
  nodes: [],
});

describe('Canvas public scene boundary', () => {
  it('keeps the main JSX runtime ordinary React and scene input pure', () => {
    const dom = <div className="shell" />;
    const props = { scene: renderScene } satisfies Pick<CanvasProps, 'scene'>;

    // @ts-expect-error React elements are not renderer scene data.
    const invalid: Pick<CanvasProps, 'scene'> = { scene: dom };
    expect(dom).toMatchObject({ type: 'div' });
    expect(props.scene.kind).toBe('scene');
    expect(invalid.scene).toBe(dom);
  });

  it('accepts VT root policy through Canvas context', () => {
    const context = {
      generatedRasterVirtualTextures: true,
      virtualTexturePhysicalByteBudget: 32 * 1024 * 1024,
    } satisfies NonNullable<CanvasProps['context']>;

    const props = { context, scene: renderScene } satisfies CanvasProps;
    expect(props.context).toEqual(context);
  });

  it('re-exports concrete public texture types', () => {
    const colorSpace: TextureColorSpace = 'srgb';
    const sampler: TextureSampler = { wrapS: 'repeat' };
    const ordinary: TextureAssetRef = { colorSpace, kind: 'asset', sampler, uri: '/map.png' };
    const virtual: VirtualTextureAssetRef = {
      colorSpace,
      kind: 'virtual-asset',
      manifestUri: '/map.vt.json',
      sampler,
    };
    expect([ordinary.kind, virtual.kind]).toEqual(['asset', 'virtual-asset']);
  });
});
