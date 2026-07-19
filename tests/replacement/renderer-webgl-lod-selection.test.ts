import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  CULLED_LOD_LEVEL,
  closestDrawableLodLevel,
  createProjectedBoundsWorkspace,
  hystereticLodLevel,
  maximumProjectedBoundsScreenCoverage,
  normalizeLodThresholds,
  projectedBoundsScreenCoverage,
} from "../../packages/renderer-webgl/src/surface/lod-selection";

describe("canonical LOD selection", () => {
  it("normalizes incomplete authored thresholds to one descending contract", () => {
    expect(normalizeLodThresholds([0.8, 2, -1], 4)).toEqual([0.8, 0.8, 0, 0]);
    expect(normalizeLodThresholds(undefined, 3)).toEqual([0.2, 0.05, 0]);
  });

  it("selects levels with hysteresis and preserves an authored terminal cull", () => {
    const thresholds = [0.5, 0.2, 0.01];
    expect(hystereticLodLevel(0.6, thresholds, undefined)).toBe(0);
    expect(hystereticLodLevel(0.3, thresholds, undefined)).toBe(1);
    expect(hystereticLodLevel(0.005, thresholds, undefined)).toBe(CULLED_LOD_LEVEL);
    expect(hystereticLodLevel(0.48, thresholds, 0)).toBe(0);
    expect(hystereticLodLevel(0.4, thresholds, 0)).toBe(1);
  });

  it("projects clipped world bounds without allocating frame scratch", () => {
    const workspace = createProjectedBoundsWorkspace();
    expect(projectedBoundsScreenCoverage(
      { max: [0.5, 0.5, 0], min: [-0.5, -0.5, 0] },
      identityMat4(),
      workspace,
    )).toBeCloseTo(0.25);
    expect(projectedBoundsScreenCoverage(
      { max: [4, 4, 0], min: [-4, -4, 0] },
      identityMat4(),
      workspace,
    )).toBe(1);
  });

  it("selects conservative maximum demand across ordered views", () => {
    const workspace = createProjectedBoundsWorkspace();
    const near = identityMat4();
    near[0] = 2;
    near[5] = 2;
    expect(maximumProjectedBoundsScreenCoverage(
      { max: [0.5, 0.5, 0], min: [-0.5, -0.5, 0] },
      [{ viewProjection: identityMat4() }, { viewProjection: near }],
      workspace,
    )).toBe(1);
  });

  it("keeps a drawable level while an ideal replacement is unavailable", () => {
    expect(closestDrawableLodLevel(2, 0, new Uint8Array([1, 0, 0, 1]))).toBe(0);
    expect(closestDrawableLodLevel(2, undefined, new Uint8Array([1, 0, 0, 1]))).toBe(3);
    expect(closestDrawableLodLevel(CULLED_LOD_LEVEL, 0, new Uint8Array([1]))).toBe(
      CULLED_LOD_LEVEL,
    );
  });
});
