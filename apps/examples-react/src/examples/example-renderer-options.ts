import { type RendererOptions, type ResourceGovernorPolicy } from '@royal/react';

const mib = (value: number): number => value * 1024 * 1024;

const durableBudget = (
  mandatoryFloorMiB: number,
  softLimitMiB: number,
  hardLimitMiB?: number,
): { readonly hardLimit?: number; readonly mandatoryFloor: number; readonly softLimit: number } => ({
  ...(hardLimitMiB === undefined ? {} : { hardLimit: mib(hardLimitMiB) }),
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
      // Keep a little borrowable headroom while preventing VT atlases from
      // consuming the entire constrained-device GPU pool.
      persistentGpuBytes: durableBudget(32, 96, 112),
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

const defaultExampleCanvasRendererOptions = {
  alpha: true,
  generatedImageVirtualTextures: true,
} as const satisfies RendererOptions;

export const exampleCanvasRendererOptionsForSearch = (
  search: string,
): RendererOptions => {
  const profile = new URLSearchParams(search).get('resourceGovernor');
  if (profile !== 'mobile') return defaultExampleCanvasRendererOptions;
  return {
    ...defaultExampleCanvasRendererOptions,
    resourceGovernorPolicy: mobileExampleResourceGovernorPolicy,
  };
};

export const exampleCanvasRendererOptions = exampleCanvasRendererOptionsForSearch(
  globalThis.location?.search ?? '',
);
