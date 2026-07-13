import { describe, expect, it } from 'vitest';
import {
  exampleCanvasContextOptionsForSearch,
  mobileExampleResourceGovernorPolicy,
} from './example-context-options';

describe('exampleCanvasContextOptionsForSearch', () => {
  it.each(['', '?bench=auto', '?resourceGovernor=desktop', '?resourceGovernor=MOBILE'])(
    'preserves renderer defaults for %s',
    (search) => {
      expect(exampleCanvasContextOptionsForSearch(search)).toEqual({
        alpha: true,
        generatedImageVirtualTextures: true,
      });
    },
  );

  it('selects the constrained policy explicitly without dropping other query parameters', () => {
    const context = exampleCanvasContextOptionsForSearch(
      '?bench=auto&resourceGovernor=mobile&frames=60',
    );

    expect(context.resourceGovernorPolicy).toBe(mobileExampleResourceGovernorPolicy);
    expect(context.alpha).toBe(true);
    expect(context.generatedImageVirtualTextures).toBe(true);
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
  });
});
