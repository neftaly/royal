import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  defineResourceGovernorPolicy,
} from '@royal/react';
import type {
  CanvasProps,
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
  GltfAssetStatus,
  ResourceGovernorPolicy,
  ResourceGovernorPolicyInput,
  RendererOptions,
  RoyalPointerEventHandlers,
  RoyalRendererRootLifecycleSnapshot,
} from '@royal/react';
import type {
  TextureAssetRef,
  TextureAssetOptions,
  TextureColorSpace,
  GltfMaterialVariantSelection,
  TextureSampler,
  VirtualTextureAssetOptions,
  VirtualTextureAssetRef,
  VirtualTextureInput,
} from '@royal/react/scene';
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
    } satisfies RendererOptions;

    const props = { rendererOptions, scene: renderScene } satisfies CanvasProps;
    expect(props.rendererOptions).toEqual(rendererOptions);
  });

  it('accepts a typed resource governor policy through Canvas rendererOptions', () => {
    const policy = DEFAULT_RESOURCE_GOVERNOR_POLICY satisfies ResourceGovernorPolicy;
    const rendererOptions = {
      resourceGovernorPolicy: policy,
    } satisfies RendererOptions;

    const props = { rendererOptions, scene: renderScene } satisfies CanvasProps;
    expect(props.rendererOptions?.resourceGovernorPolicy).toBe(policy);
  });

  it('defines concise resource policy overrides without a backend import', () => {
    const overrides = {
      classes: {
        'virtual-texture': { persistentGpuBytes: { hardLimit: 96 * 1024 * 1024 } },
      },
      limits: { jobs: 3 },
    } satisfies ResourceGovernorPolicyInput;
    const rendererOptions = { resourceGovernorPolicy: overrides } satisfies RendererOptions;
    const policy = defineResourceGovernorPolicy(overrides);

    expect(rendererOptions.resourceGovernorPolicy).toBe(overrides);
    expect(policy.limits.jobs).toBe(3);
    expect(policy.classes['virtual-texture'].persistentGpuBytes.hardLimit).toBe(96 * 1024 * 1024);
  });

  it('does not expose the former context creation-options prop', () => {
    const rendererOptions = { alpha: false } satisfies RendererOptions;
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
    const virtualManifest = {
      manifestUri: '/map.vt.json',
    } satisfies VirtualTextureAssetOptions;
    const virtualInput: VirtualTextureInput = virtualManifest;
    expect([ordinary.kind, virtual.kind]).toEqual(['asset', 'virtual-asset']);
    expect(virtualInput.manifestUri).toBe('/map.vt.json');

    if (false) {
      // @ts-expect-error Image object options use only the canonical src field.
      const legacyImage = { uri: '/map.png' } satisfies TextureAssetOptions;
      // @ts-expect-error VT object options name the manifest explicitly.
      const legacyVirtual = { src: '/map.vt.json' } satisfies VirtualTextureAssetOptions;
      expect([legacyImage, legacyVirtual]).toHaveLength(2);
    }
  });

  it('exports the scene pointer handler-map shape users pass to Canvas', () => {
    const handlers = {
      onClick: (event) => event.preventDefault(),
    } satisfies RoyalPointerEventHandlers;

    expect(handlers.onClick).toBeTypeOf('function');
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

  it('exposes asset and renderer failures as discriminated unions', () => {
    const asset = { error: 'missing buffer', state: 'error' } satisfies GltfAssetStatus;
    const lifecycle = {
      error: 'context recovery failed',
      generation: 2,
      interruptions: 1,
      recoveries: 0,
      state: 'failed',
    } satisfies RoyalRendererRootLifecycleSnapshot;

    expect(asset.error).toBe('missing buffer');
    expect(lifecycle.error).toBe('context recovery failed');

    if (false) {
      // @ts-expect-error Asset failures require an error message.
      const invalidAsset = { state: 'error' } satisfies GltfAssetStatus;
      const acceptLifecycle = (_value: RoyalRendererRootLifecycleSnapshot): void => undefined;
      // @ts-expect-error Available renderer snapshots cannot carry an error.
      acceptLifecycle({ error: 'impossible', generation: 1, interruptions: 0, recoveries: 0, state: 'available' });
      expect(invalidAsset).toHaveProperty('state', 'error');
    }
  });

  it('names the glTF material-variant selection contract', () => {
    const byName = 'ruby' satisfies GltfMaterialVariantSelection;
    const byIndex = 1 satisfies GltfMaterialVariantSelection;
    expect([byName, byIndex]).toEqual(['ruby', 1]);
  });
});
