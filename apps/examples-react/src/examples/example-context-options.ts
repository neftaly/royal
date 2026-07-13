import { type CanvasContextOptions } from '@royal/react';
import { type ResourceGovernorPolicy } from '@royal/renderer-webgl';

const mib = (value: number): number => value * 1024 * 1024;

const durableBudget = (
  mandatoryFloorMiB: number,
  softLimitMiB: number,
): { readonly mandatoryFloor: number; readonly softLimit: number } => ({
  mandatoryFloor: mib(mandatoryFloorMiB),
  softLimit: mib(softLimitMiB),
});

/**
 * Explicit constrained-device benchmark policy. This is opt-in so the examples
 * continue to exercise the renderer's production default unless a benchmark
 * URL asks for the mobile profile.
 */
export const mobileExampleResourceGovernorPolicy = {
  classes: {
    'asset-decode': {
      cpuDecodedBytes: durableBudget(16, 64),
      persistentGpuBytes: durableBudget(0, 0),
    },
    geometry: {
      cpuDecodedBytes: durableBudget(8, 32),
      persistentGpuBytes: durableBudget(16, 48),
    },
    'ordinary-texture': {
      cpuDecodedBytes: durableBudget(16, 48),
      persistentGpuBytes: durableBudget(16, 48),
    },
    'render-target': {
      cpuDecodedBytes: durableBudget(0, 0),
      persistentGpuBytes: durableBudget(32, 64),
    },
    'virtual-texture': {
      cpuDecodedBytes: durableBudget(16, 48),
      persistentGpuBytes: durableBudget(32, 96),
    },
  },
  limits: {
    cpuDecodedBytes: mib(192),
    jobs: 3,
    persistentGpuBytes: mib(192),
    transientPeakBytes: mib(64),
    uploadBytes: mib(8),
  },
} as const satisfies ResourceGovernorPolicy;

const defaultExampleCanvasContextOptions = {
  alpha: true,
  generatedImageVirtualTextures: true,
} as const satisfies CanvasContextOptions;

export const exampleCanvasContextOptionsForSearch = (
  search: string,
): CanvasContextOptions => {
  const profile = new URLSearchParams(search).get('resourceGovernor');
  if (profile !== 'mobile') return defaultExampleCanvasContextOptions;
  return {
    ...defaultExampleCanvasContextOptions,
    resourceGovernorPolicy: mobileExampleResourceGovernorPolicy,
  };
};

export const exampleCanvasContextOptions = exampleCanvasContextOptionsForSearch(
  globalThis.location?.search ?? '',
);
