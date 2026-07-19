import { describe, expect, it } from 'vitest';
import { gltf } from '@royal/react/scene';
import {
  benchmarkGltfDiagnostics,
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
      primitiveCount: 381,
      state: 'streaming',
      timings: {
        externalResourceReadDurationMs: 70,
        preparationDurationMs: 250,
        sourceReadDurationMs: 40,
      },
      textures: { failed: 0, loading: 30, ready: 80, total: 110 },
    })).toMatchObject({
      imageFailures: 0,
      imagesLoaded: 80,
      imageRequests: 110,
      phaseMs: {
        externalResourceRead: 70,
        firstUsable: 360,
        preparation: 250,
        sourceRead: 40,
      },
      primitiveCount: 381,
      status: 'streaming',
      version: 'web-v2',
    });
  });

  it('reports terminal degradation without hiding drawable geometry', () => {
    expect(benchmarkGltfDiagnostics(asset, {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      primitiveCount: 381,
      state: 'degraded',
      timings: {
        externalResourceReadDurationMs: 70,
        imagesCompleteAfterMs: 1_200,
        preparationDurationMs: 250,
        sourceReadDurationMs: 40,
      },
      textures: { failed: 2, loading: 0, ready: 108, total: 110 },
    })).toMatchObject({
      imageFailures: 2,
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
      failedPages: 2,
      pendingPages: 3,
      residentPages: 17,
      state: 'ready',
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
