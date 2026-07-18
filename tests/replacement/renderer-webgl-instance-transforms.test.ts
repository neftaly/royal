import { describe, expect, it } from "vitest";
import {
  prepareStaticInstanceBatches,
} from "../../packages/renderer-webgl/src/gltf/instance-transforms";
import { translationMat4 } from "../../packages/renderer-webgl/src/math/mat4";

describe("static glTF instance transform core", () => {
  it("composes flat instance matrices relative to the node", () => {
    const batches = prepareStaticInstanceBatches(translationMat4([10, 20, 30]), {
      count: 2,
      translations: new Float32Array([1, 2, 3, -4, -5, -6]),
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.handedness).toBe(1);
    expect(batches[0]!.localModels).toEqual(new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 11, 22, 33, 1,
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6, 15, 24, 1,
    ]));
  });

  it("splits mixed handedness into stable front-face batches", () => {
    const batches = prepareStaticInstanceBatches(translationMat4([0, 0, 0]), {
      count: 3,
      scales: new Float32Array([
        1, 1, 1,
        -1, 1, 1,
        2, 3, 4,
      ]),
      translations: new Float32Array([
        1, 0, 0,
        2, 0, 0,
        3, 0, 0,
      ]),
    });
    expect(batches.map((batch) => [batch.handedness, batch.localModels.length / 16]))
      .toEqual([[1, 2], [-1, 1]]);
    expect([batches[0]!.localModels[12], batches[0]!.localModels[28]])
      .toEqual([1, 3]);
    expect(batches[1]!.localModels[12]).toBe(2);
  });

  it("rejects invalid stream ownership at the pure boundary", () => {
    expect(() => prepareStaticInstanceBatches(translationMat4([0, 0, 0]), {
      count: 2,
      scales: new Float32Array([1, 1, 1]),
    })).toThrow("instance scale stream length must be 6");
    expect(() => prepareStaticInstanceBatches(translationMat4([0, 0, 0]), {
      count: 1,
      rotations: new Float32Array([0, 0, 0, 0]),
    })).toThrow("rotation must be a finite non-zero quaternion");
  });
});
