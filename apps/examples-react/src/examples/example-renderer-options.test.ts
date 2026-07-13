import { describe, expect, it } from 'vitest';
import {
  exampleCanvasRendererOptionsForSearch,
  mobileExampleResourceGovernorPolicy,
} from './example-renderer-options';

describe('exampleCanvasRendererOptionsForSearch', () => {
  it.each(['', '?bench=auto', '?resourceGovernor=desktop', '?resourceGovernor=MOBILE'])(
    'preserves renderer defaults for %s',
    (search) => {
      expect(exampleCanvasRendererOptionsForSearch(search)).toEqual({
        alpha: true,
        generatedImageVirtualTextures: true,
      });
    },
  );

  it('selects the constrained policy explicitly without dropping other query parameters', () => {
    const rendererOptions = exampleCanvasRendererOptionsForSearch(
      '?bench=auto&resourceGovernor=mobile&frames=60',
    );

    expect(rendererOptions.resourceGovernorPolicy).toBe(mobileExampleResourceGovernorPolicy);
    expect(rendererOptions.alpha).toBe(true);
    expect(rendererOptions.generatedImageVirtualTextures).toBe(true);
  });

  it('keeps mandatory floors within the global constrained capacities', () => {
    const classes = Object.values(mobileExampleResourceGovernorPolicy.classes);
    const cpuFloors = classes.reduce(
      (total, value) => total + value.cpuDecodedBytes.mandatoryFloor,
      0,
    );
    const gpuFloors = classes.reduce(
      (total, value) => total + value.persistentGpuBytes.mandatoryFloor,
      0,
    );

    expect(cpuFloors).toBeLessThanOrEqual(mobileExampleResourceGovernorPolicy.limits.cpuDecodedBytes);
    expect(gpuFloors).toBeLessThanOrEqual(mobileExampleResourceGovernorPolicy.limits.persistentGpuBytes);
    expect(mobileExampleResourceGovernorPolicy.limits.jobs).toBeGreaterThan(0);
    expect(mobileExampleResourceGovernorPolicy.limits.uploadBytes).toBeGreaterThan(0);
    expect(
      mobileExampleResourceGovernorPolicy.classes['virtual-texture'].persistentGpuBytes.hardLimit,
    ).toBe(112 * 1024 * 1024);
  });
});
