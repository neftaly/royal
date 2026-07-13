import { describe, expect, it } from 'vitest';
import type {
  CanvasProps,
  CanvasRendererOptions,
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
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
import {
  perspectiveCamera,
  scene,
  type PickingId as ScenePickingId,
} from '@royal/react/scene';

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

  it('accepts VT root policy through Canvas rendererOptions', () => {
    const rendererOptions = {
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 8,
    } satisfies CanvasRendererOptions;

    const props = { rendererOptions, scene: renderScene } satisfies CanvasProps;
    expect(props.rendererOptions).toEqual(rendererOptions);
  });

  it('accepts a typed resource governor policy through Canvas rendererOptions', () => {
    const policy = DEFAULT_RESOURCE_GOVERNOR_POLICY satisfies ResourceGovernorPolicy;
    const rendererOptions = {
      resourceGovernorPolicy: policy,
    } satisfies CanvasRendererOptions;

    const props = { rendererOptions, scene: renderScene } satisfies CanvasProps;
    expect(props.rendererOptions?.resourceGovernorPolicy).toBe(policy);
  });

  it('does not expose the former context creation-options prop', () => {
    const rendererOptions = { alpha: false } satisfies CanvasRendererOptions;
    const invalid: CanvasProps = {
      // @ts-expect-error Renderer creation policy belongs under rendererOptions.
      context: rendererOptions,
      scene: renderScene,
    };

    expect(invalid).toHaveProperty('context', rendererOptions);
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

  it('re-exports the types used by React picking APIs', () => {
    const pickingId: PickingId = 'helmet';
    const scenePickingId: ScenePickingId = pickingId;
    const input = { clientX: 10, clientY: 20 } satisfies PickInput;
    const acceptTarget = (target: PickTarget): PickTarget => target;
    const acceptResult = (result: PickResult): PickResult => ({
      ...result,
      target: acceptTarget(result.target),
    });

    expect(pickingId).toBe('helmet');
    expect(scenePickingId).toBe('helmet');
    expect(input).toEqual({ clientX: 10, clientY: 20 });
    expect(typeof acceptResult).toBe('function');
  });
});
