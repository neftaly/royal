import { describe, expect, it } from 'vitest';
import { gltf } from '@royal/react/scene';
import {
  benchmarkGltfDiagnostics,
  benchmarkTextureResidency,
  benchmarkVirtualTextureDiagnostics,
} from './BenchmarkRendererSnapshot';
import { copyVirtualTexturingCounters } from './BenchmarkRendererSnapshotCounters';

describe('copyVirtualTexturingCounters', () => {
  it('flattens active and cached mip residency', () => {
    expect(copyVirtualTexturingCounters({
      activePages: 1,
      activePagesByMip: [0, 0, 0, 1],
      cachedPages: 12,
      cachedPagesByMip: [5, 4, 2, 1],
      uploadedPages: 12,
    })).toEqual({
      activePages: 1,
      activePagesMip0: 0,
      activePagesMip1: 0,
      activePagesMip2: 0,
      activePagesMip3: 1,
      cachedPages: 12,
      cachedPagesMip0: 5,
      cachedPagesMip1: 4,
      cachedPagesMip2: 2,
      cachedPagesMip3: 1,
      uploadedPages: 12,
    });
  });

  it('prefers an explicit cached mip histogram and ignores invalid counters', () => {
    expect(copyVirtualTexturingCounters({
      activePagesByMip: [1, Number.NaN, '2'],
      cachedPagesByMip: [2, 3],
    })).toEqual({
      activePagesMip0: 1,
      cachedPagesMip0: 2,
      cachedPagesMip1: 3,
    });
  });
});

describe('current benchmark glTF adapter', () => {
  const asset = gltf({ src: '/bistro.gltf', version: 'web-v2' }).asset;

  it('keeps progressive image counts explicit while geometry is usable', () => {
    expect(benchmarkGltfDiagnostics(asset, {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lightCount: 4,
      nodeCount: 397,
      primitiveCount: 381,
      sceneIndex: 2,
      scenes: [
        { index: 0, name: 'Exterior' },
        { index: 1, name: 'Interior' },
        { index: 2, name: 'Interior Wine' },
      ],
      status: 'streaming',
      timings: {
        externalResourceReadDurationMs: 70,
        firstDrawableAfterMs: 360,
        preparationQueueDurationMs: 0,
        preparationDurationMs: 250,
        sourceReadDurationMs: 40,
        sourceReadStartedAfterMs: 0,
      },
      textures: { failed: 0, fallback: 0, loading: 30, ready: 80, total: 110 },
      variantNames: ['Day', 'Night'],
    })).toMatchObject({
      imageFailures: 0,
      imageFallbacks: 0,
      imagesLoaded: 80,
      imageRequests: 110,
      phaseMs: {
        externalResourceRead: 70,
        firstUsable: 360,
        preparation: 250,
        preparationQueue: 0,
        sourceRead: 40,
        sourceReadStart: 0,
      },
      primitiveCount: 381,
      lightCount: 4,
      nodeCount: 397,
      sceneIndex: 2,
      status: 'streaming',
      variantNames: ['Day', 'Night'],
      version: 'web-v2',
    });
  });

  it('reports terminal degradation without hiding drawable geometry', () => {
    expect(benchmarkGltfDiagnostics(asset, {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lightCount: 4,
      nodeCount: 397,
      primitiveCount: 381,
      sceneIndex: 2,
      scenes: [
        { index: 0, name: 'Exterior' },
        { index: 1, name: 'Interior' },
        { index: 2, name: 'Interior Wine' },
      ],
      status: 'degraded',
      timings: {
        externalResourceReadDurationMs: 70,
        firstDrawableAfterMs: 360,
        imagesCompleteAfterMs: 1_200,
        preparationQueueDurationMs: 0,
        preparationDurationMs: 250,
        sourceReadDurationMs: 40,
        sourceReadStartedAfterMs: 0,
      },
      textures: { failed: 2, fallback: 0, loading: 0, ready: 108, total: 110 },
      variantNames: ['Day', 'Night'],
    })).toMatchObject({
      imageFailures: 2,
      imageFallbacks: 0,
      imagesLoaded: 108,
      phaseMs: { imagesComplete: 1_200 },
      status: 'degraded',
    });
  });
});

describe('current benchmark VT adapter', () => {
  it('reports focused manifest and residency progress without frame counters', () => {
    expect(benchmarkVirtualTextureDiagnostics(undefined)).toBeNull();
    expect(benchmarkVirtualTextureDiagnostics({
      failedPages: 0,
      pendingPages: 0,
      residentPages: 0,
      status: 'idle',
    })?.manifestRequests).toBe(0);
    expect(benchmarkVirtualTextureDiagnostics({
      failedPages: 2,
      pendingPages: 3,
      residentPages: 17,
      status: 'ready',
    })).toEqual({
      failedPages: 2,
      manifestFailures: 0,
      manifestRequests: 1,
      manifestsReady: 1,
      pendingPages: 3,
      residentPages: 17,
    });
  });
});

describe('current benchmark texture residency adapter', () => {
  it('keeps resident and compressed bytes distinct', () => {
    expect(benchmarkTextureResidency({
      compressedBytes: 112,
      compressedTextures: 1,
      fittedTextures: 2,
      residentBytes: 1_472,
      residentTextures: 3,
    })).toEqual({
      bytes: 1_472,
      compressedBytes: 112,
      compressedResources: 1,
      fitted: 2,
      resources: 3,
    });
  });
});
