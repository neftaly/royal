import { describe, expect, it } from "vitest";
import { perspectiveCamera } from "@royal/renderer-core";
import {
  identityMat4,
  projectionMat4,
} from "../packages/renderer-webgl/src/math/mat4";
import {
  createProjectedBoundsWorkspace,
  projectedBoundsScreenCoverage,
} from "../packages/renderer-webgl/src/math/projected-bounds";
import type { Bounds3 } from "../packages/renderer-webgl/src/math/picking";

const perspective = projectionMat4(perspectiveCamera({
  far: 100,
  fovY: Math.PI / 2,
  near: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
}), 100, 100);

const bounds = (minZ: number, maxZ: number, extent = 0.5): Bounds3 => ({
  max: [extent, extent, maxZ],
  min: [-extent, -extent, minZ],
});

describe("projected bounds screen coverage", () => {
  it("preserves ordinary unclipped orthographic and perspective projections", () => {
    expect(projectedBoundsScreenCoverage(bounds(0, 0), identityMat4())).toBeCloseTo(0.25);
    expect(projectedBoundsScreenCoverage(bounds(-3, -2), perspective)).toBeCloseTo(0.0625);
  });

  it("returns zero for bounds wholly behind the perspective camera", () => {
    expect(projectedBoundsScreenCoverage(bounds(0.25, 2), perspective)).toBe(0);
  });

  it("projects only the finite visible footprint of bounds crossing the near plane", () => {
    const coverage = projectedBoundsScreenCoverage(bounds(-2, 0.5), perspective);
    expect(Number.isFinite(coverage)).toBe(true);
    expect(coverage).toBeCloseTo(0.25);
  });

  it("approaches the near plane monotonically and remains stable while straddling it", () => {
    const workspace = createProjectedBoundsWorkspace();
    const coverages = [
      bounds(-5, -4),
      bounds(-3, -2),
      bounds(-2, -0.5),
      bounds(-1.8, 0.2),
      bounds(-1.5, 0.5),
    ].map((value) => projectedBoundsScreenCoverage(value, perspective, workspace));

    expect(coverages.every(Number.isFinite)).toBe(true);
    for (let index = 1; index < coverages.length; index += 1) {
      expect(coverages[index]!).toBeGreaterThanOrEqual(coverages[index - 1]!);
    }
    expect(coverages.at(-1)).toBeCloseTo(coverages.at(-2)!);
  });

  it("never publishes NaN or Infinity for non-finite inputs", () => {
    const invalidBounds: Bounds3 = {
      max: [Number.POSITIVE_INFINITY, 1, -2],
      min: [Number.NaN, -1, -3],
    };
    const coverage = projectedBoundsScreenCoverage(invalidBounds, perspective);
    expect(Number.isFinite(coverage)).toBe(true);
    expect(coverage).toBeGreaterThanOrEqual(0);
    expect(coverage).toBeLessThanOrEqual(1);
  });
});
