import { describe, expect, it, vi } from 'vitest';
import {
  exampleContract,
  exampleRoutes,
  installRendererBenchmarkBridge,
  readRendererBenchmarkSnapshot,
  rendererBenchmarkSnapshotReady,
  type RendererBenchmarkSnapshot,
} from './example-contract';
import { examples } from './examples';

describe('examples contract', () => {
  it('is a versioned serializable source of route metadata', () => {
    expect(JSON.parse(JSON.stringify(exampleContract))).toEqual(exampleContract);
    expect(exampleContract.schema).toBe('royal-examples-contract');
    expect(exampleContract.version).toBe(1);
    expect(new Set(exampleRoutes.map(({ id }) => id)).size).toBe(exampleRoutes.length);
    expect(new Set(exampleRoutes.map(({ path }) => path)).size).toBe(exampleRoutes.length);
    expect(exampleContract.benchmark.gltfExampleIds.every((id) =>
      exampleRoutes.some((entry) => entry.id === id))).toBe(true);
    expect(examples.map(({ load: _load, ...entry }) => entry)).toEqual(exampleRoutes);
  });

  it('installs, reads, and conditionally removes the named benchmark bridge', () => {
    const target: Record<string, unknown> = {};
    const snapshot = vi.fn(() => ({ frame: 7 }) as RendererBenchmarkSnapshot);
    const renderNow = vi.fn();
    const cleanup = installRendererBenchmarkBridge(snapshot, renderNow, target);

    expect(readRendererBenchmarkSnapshot(target)).toEqual({ frame: 7 });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(target[exampleContract.benchmark.bridge.renderNowGlobal]).toBe(renderNow);

    target[exampleContract.benchmark.bridge.rendererSnapshotGlobal] = () => null;
    cleanup();
    expect(target[exampleContract.benchmark.bridge.rendererSnapshotGlobal]).toBeTypeOf('function');
    expect(target[exampleContract.benchmark.bridge.renderNowGlobal]).toBeUndefined();
  });

  it('waits for requested glTF images without forcing dormant candidates to load', () => {
    type Asset = NonNullable<RendererBenchmarkSnapshot['gltfLoadDiagnostics']>['assets'][number];
    const snapshot = (asset: Partial<Asset>) => ({
      frame: 1,
      gltfInstancing: null,
      gltfLoadDiagnostics: {
        assets: [{
          imageCandidates: 3,
          imageFailures: 0,
          imageFallbacks: 0,
          imagesLoaded: 2,
          imageRequests: 3,
          lightCount: 0,
          nodeCount: 1,
          phaseMs: {},
          primitiveCount: 1,
          src: '/scene.gltf',
          status: 'ready',
          variantNames: [],
          ...asset,
        }],
      },
      lifecycle: null,
      resourcePressure: null,
      textureResidency: null,
      virtualTexturing: null,
    }) satisfies RendererBenchmarkSnapshot;

    expect(rendererBenchmarkSnapshotReady(null)).toBe(false);
    expect(rendererBenchmarkSnapshotReady({
      ...snapshot({}),
      gltfLoadDiagnostics: null,
    }, { requireGltfAsset: true })).toBe(false);
    expect(rendererBenchmarkSnapshotReady(snapshot({}))).toBe(false);
    expect(rendererBenchmarkSnapshotReady(snapshot({ imageRequests: 2 }))).toBe(true);
    expect(rendererBenchmarkSnapshotReady(snapshot({ imagesLoaded: 3 }))).toBe(true);
    expect(rendererBenchmarkSnapshotReady(snapshot({ imageFailures: 1 }))).toBe(true);
    expect(rendererBenchmarkSnapshotReady(snapshot({ status: 'loading' }))).toBe(false);
    expect(rendererBenchmarkSnapshotReady(snapshot({ error: 'bad asset', status: 'error' }))).toBe(true);
    expect(rendererBenchmarkSnapshotReady({
      ...snapshot({ imageRequests: 2 }),
      resourcePressure: { pendingOrdinaryTextureStorageRepresentations: 1 },
    })).toBe(false);
    expect(rendererBenchmarkSnapshotReady({
      ...snapshot({ imageRequests: 2 }),
      resourcePressure: { pendingOrdinaryTextureStorageRepresentations: 0 },
    })).toBe(true);
  });
});
