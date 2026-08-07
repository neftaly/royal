import { describe, expect, it } from 'vitest';

import { contextLossResourcesRecovered } from './context-loss-readiness.mjs';

const recoveredSnapshot = (overrides = {}) => ({
  gltfLoadDiagnostics: {
    assets: [{
      imageFailures: 0,
      imagesLoaded: 1,
      imageRequests: 1,
      status: 'ready',
    }],
  },
  lifecycle: { state: 'available' },
  resourcePressure: {},
  virtualTexturing: {
    automaticWaiting: 0,
    pendingPages: 0,
    residentPages: 21,
  },
  ...overrides,
});

describe('context-loss final-fidelity readiness', () => {
  it('waits for glTF images and preparation pressure after lifecycle recovery', () => {
    expect(contextLossResourcesRecovered(recoveredSnapshot())).toBe(true);
    expect(contextLossResourcesRecovered(recoveredSnapshot({
      gltfLoadDiagnostics: {
        assets: [{
          imageFailures: 0,
          imagesLoaded: 0,
          imageRequests: 1,
          status: 'streaming',
        }],
      },
    }))).toBe(false);
    expect(contextLossResourcesRecovered(recoveredSnapshot({
      resourcePressure: { activePreparationJobs: 1 },
    }))).toBe(false);
  });

  it('requires reconstructed VT residency only when the interrupted scene had it', () => {
    const missingPages = recoveredSnapshot({
      virtualTexturing: {
        automaticWaiting: 0,
        pendingPages: 1,
        residentPages: 0,
      },
    });
    expect(contextLossResourcesRecovered(missingPages)).toBe(true);
    expect(contextLossResourcesRecovered(missingPages, true)).toBe(false);
    expect(contextLossResourcesRecovered(recoveredSnapshot(), true)).toBe(true);
  });

  it('accepts a settled degraded asset and routes without glTF assets', () => {
    expect(contextLossResourcesRecovered(recoveredSnapshot({
      gltfLoadDiagnostics: {
        assets: [{
          imageFailures: 1,
          imagesLoaded: 0,
          imageRequests: 1,
          status: 'degraded',
        }],
      },
    }))).toBe(true);
    expect(contextLossResourcesRecovered(recoveredSnapshot({
      gltfLoadDiagnostics: { assets: [] },
    }))).toBe(true);
  });
});
