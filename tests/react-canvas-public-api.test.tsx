import { describe, expect, it } from 'vitest';
import type {
  CanvasProps,
  GltfInstancesPickTarget,
  GltfPickTarget,
  MeshPickTarget,
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
  GltfAssetStatus,
  RendererOptions,
  RoyalPointerEventHandlers,
  RoyalRendererRootLifecycleSnapshot,
} from '@royal/react';
import type {
  TextureAssetRef,
  TextureAssetOptions,
  TextureColorSpace,
  GltfAssetRef,
  GltfMaterialVariantName,
  TextureSampler,
  VirtualTextureAssetOptions,
  VirtualTextureAssetRef,
  VirtualTextureInput,
} from '@royal/react/scene';
import {
  gltf,
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

  it('forwards ordinary canvas metadata while reserving backing dimensions', () => {
    const props = {
      'aria-label': 'Interactive Royal scene',
      'data-testid': 'royal-canvas',
      className: 'scene-canvas',
      scene: renderScene,
      style: { blockSize: '100%', inlineSize: '100%' },
    } satisfies CanvasProps;

    expect(props['data-testid']).toBe('royal-canvas');

    if (false) {
      // @ts-expect-error Royal derives backing width from CSS pixels and DPR.
      const width = { scene: renderScene, width: 800 } satisfies CanvasProps;
      // @ts-expect-error Royal derives backing height from CSS pixels and DPR.
      const height = { height: 600, scene: renderScene } satisfies CanvasProps;
      expect([width, height]).toHaveLength(2);
    }
  });

  it('keeps Canvas renderer options at product-level creation choices', () => {
    const rendererOptions = {
      automaticVirtualTextures: true,
    } satisfies RendererOptions;

    const props = { rendererOptions, scene: renderScene } satisfies CanvasProps;
    expect(props.rendererOptions).toEqual(rendererOptions);

    if (false) {
      // @ts-expect-error Backend scheduling classes are not React renderer options.
      const internalPolicy = { resourceGovernorPolicy: {} } satisfies RendererOptions;
      // @ts-expect-error The implementation-shaped pre-release option was removed.
      const legacyAutomaticVt = { generatedImageVirtualTextures: true } satisfies RendererOptions;
      expect([internalPolicy, legacyAutomaticVt]).toHaveLength(2);
    }
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
    const ordinary: TextureAssetRef = { colorSpace, kind: 'asset', sampler, src: '/map.png' };
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
    const asset = { src: '/model.glb' } satisfies GltfAssetRef;
    expect([ordinary.kind, virtual.kind]).toEqual(['asset', 'virtual-asset']);
    expect([asset.src, ordinary.src]).toEqual(['/model.glb', '/map.png']);
    expect(virtualInput.manifestUri).toBe('/map.vt.json');

    if (false) {
      // @ts-expect-error Image object options use only the canonical src field.
      const legacyImage = { uri: '/map.png' } satisfies TextureAssetOptions;
      // @ts-expect-error Normalized glTF references preserve the constructor's src spelling.
      const legacyGltfAsset = { uri: '/model.glb' } satisfies GltfAssetRef;
      // @ts-expect-error VT object options name the manifest explicitly.
      const legacyVirtual = { src: '/map.vt.json' } satisfies VirtualTextureAssetOptions;
      expect([legacyImage, legacyGltfAsset, legacyVirtual]).toHaveLength(3);
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
    if (false) {
      const target = null as unknown as PickTarget;
      // @ts-expect-error Pick results preserve the scene descriptor's pickingId spelling.
      target.id;
    }
    const targetIndex = (target: PickTarget): number => {
      if (target.kind === 'gltf-instances') {
        const instance: GltfInstancesPickTarget = target;
        return instance.instanceIndex;
      }
      if (target.kind === 'gltf') {
        const gltfTarget: GltfPickTarget = target;
        return gltfTarget.node.kind === 'gltf' ? 0 : -1;
      }
      const meshTarget: MeshPickTarget = target;
      return meshTarget.node.kind === 'mesh' ? 0 : -1;
    };
    const acceptResult = (result: PickResult): PickResult => ({
      ...result,
      target: acceptTarget(result.target),
    });

    expect(pickingId).toBe('helmet');
    expect(scenePickingId).toBe('helmet');
    expect(input).toEqual({ clientX: 10, clientY: 20 });
    expect(typeof acceptResult).toBe('function');
    expect(typeof targetIndex).toBe('function');
  });

  it('exposes asset and renderer failures as discriminated unions', () => {
    const asset = {
      error: 'missing buffer',
      images: { failed: 0, loaded: 0, pending: 0, requested: 0, total: 0 },
      phaseMs: {},
      scene: { lights: 0, nodes: 0, primitives: 0 },
      state: 'error',
      variantNames: [],
    } satisfies GltfAssetStatus;
    const lifecycle = {
      error: 'context recovery failed',
      generation: 2,
      interruptions: 1,
      recoveries: 0,
      state: 'failed',
    } satisfies RoyalRendererRootLifecycleSnapshot;

    expect(asset.error).toBe('missing buffer');
    expect(asset.variantNames).toEqual([]);
    expect(lifecycle.error).toBe('context recovery failed');

    if (false) {
      // @ts-expect-error Status state names come from the discriminated union instead of a parallel alias.
      const legacyState: import('@royal/react').GltfAssetLoadState = 'ready';
      // @ts-expect-error Asset failures require an error message.
      const invalidAsset = { state: 'error', variantNames: [] } satisfies GltfAssetStatus;
      // @ts-expect-error Every status carries the same immutable variant-name list.
      const missingVariants = { state: 'loading' } satisfies GltfAssetStatus;
      const acceptLifecycle = (_value: RoyalRendererRootLifecycleSnapshot): void => undefined;
      // @ts-expect-error Available renderer snapshots cannot carry an error.
      acceptLifecycle({ error: 'impossible', generation: 1, interruptions: 0, recoveries: 0, state: 'available' });
      expect([legacyState, invalidAsset, missingVariants]).toHaveLength(3);
    }
  });

  it('names the glTF material-variant selection contract', () => {
    const byName = 'ruby' satisfies GltfMaterialVariantName;
    expect(byName).toBe('ruby');

    if (false) {
      // @ts-expect-error Material variants use stable authored names, not declaration-order indices.
      const byIndex = 1 satisfies GltfMaterialVariantName;
      // @ts-expect-error The public descriptor spells out that this selects a material variant.
      const legacyField = gltf({ src: '/model.gltf', variant: 'ruby' });
      expect([byIndex, legacyField]).toHaveLength(2);
    }
  });
});
