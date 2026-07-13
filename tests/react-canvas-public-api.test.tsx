import { describe, expect, it } from 'vitest';
import type {
  CanvasProps,
  ResourceGovernorPolicy,
  TextureAssetRef,
  TextureColorSpace,
  TextureSampler,
  VirtualTextureAssetManifestOptions,
  VirtualTextureAssetRef,
  VirtualTextureAssetSrcOptions,
  VirtualTextureInput,
} from '@royal/react';
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
} from '@royal/renderer-webgl';
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
      generatedSvgVirtualTextureRasterDensity: 8,
      virtualTexturePhysicalByteBudget: 32 * 1024 * 1024,
    } satisfies NonNullable<CanvasProps['context']>;

    const props = { context, scene: renderScene } satisfies CanvasProps;
    expect(props.context).toEqual(context);
  });

  it('accepts a typed resource governor policy through Canvas context', () => {
    const policy = DEFAULT_RESOURCE_GOVERNOR_POLICY satisfies ResourceGovernorPolicy;
    const context = {
      resourceGovernorPolicy: policy,
    } satisfies NonNullable<CanvasProps['context']>;

    const props = { context, scene: renderScene } satisfies CanvasProps;
    expect(props.context?.resourceGovernorPolicy).toBe(policy);
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
    const virtualSrc = { src: '/map.vt.json' } satisfies VirtualTextureAssetSrcOptions;
    const virtualManifest = {
      manifestUri: '/map.vt.json',
    } satisfies VirtualTextureAssetManifestOptions;
    const virtualInput: VirtualTextureInput = virtualManifest;
    expect([ordinary.kind, virtual.kind]).toEqual(['asset', 'virtual-asset']);
    expect([virtualSrc.src, virtualInput.manifestUri]).toEqual([
      '/map.vt.json',
      '/map.vt.json',
    ]);
  });
});
