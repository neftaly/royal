import { describe, expect, it, vi } from "vitest";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import {
  createScreenSpacePartitionPattern,
  SCREEN_SPACE_PARTITION_PATTERN_BYTES,
  ScreenSpacePartitionPatternOwner,
  screenSpacePartitionCellIndex,
} from "../../packages/renderer-webgl/src/surface/screen-space-partition-pattern";
import { fakeGl } from "./support/canvas-root-harness";

describe("screen-space edge partition", () => {
  it("exposes every two- and three-way partition across common edge orientations", () => {
    const directions = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as const;
    for (const count of [2, 3]) {
      for (const [deltaX, deltaY] of directions) {
        const observed = new Set<number>();
        for (let offset = 0; offset < 32; offset += 1) {
          observed.add(screenSpacePartitionCellIndex(
            64 + offset * deltaX,
            64 + offset * deltaY,
            count,
          ));
        }
        expect([...observed].sort()).toEqual(
          Array.from({ length: count }, (_, index) => index),
        );
      }
    }
  });

  it("maps each cell to exactly one valid partition in the shared tile", () => {
    for (const count of [1, 2, 3, 5, 17, 4096]) {
      const observed = new Set<number>();
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const index = screenSpacePartitionCellIndex(x, y, count);
          observed.add(index);
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(count);
        }
      }
      expect(observed.size).toBe(count);
    }
    const pattern = createScreenSpacePartitionPattern();
    expect(pattern).toBeInstanceOf(Uint16Array);
    expect(pattern.byteLength).toBe(SCREEN_SPACE_PARTITION_PATTERN_BYTES);
    expect(new Set(pattern).size).toBe(4096);
  });

  it("releases its budget claim when a WebGL allocation throws", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner();
    const owner = new ScreenSpacePartitionPatternOwner(gl, budget);
    vi.mocked(gl.createSampler).mockImplementationOnce(() => {
      throw new Error("injected sampler allocation failure");
    });

    expect(() => owner.ensure()).toThrow("injected sampler allocation failure");
    expect(budget.snapshot().retainedBytes).toBe(0);
    expect(gl.deleteTexture).toHaveBeenCalledOnce();
    expect(() => owner.ensure()).not.toThrow();
  });
});
