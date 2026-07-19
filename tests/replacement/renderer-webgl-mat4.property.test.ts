import { perspectiveCamera } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  identityMat4,
  inverseMat4Into,
  multiplyMat4Into,
  transformMat4,
  transformPointInto,
  viewMat4Into,
} from "../../packages/renderer-webgl/src/math/mat4";
import { forEachFuzzCase } from "../fuzz";

const expectIdentity = (matrix: readonly number[]): void => {
  for (let index = 0; index < 16; index += 1) {
    expect(matrix[index]).toBeCloseTo(index % 5 === 0 ? 1 : 0, 9);
  }
};

describe("retained matrix core", () => {
  it("inverts varied affine transforms into caller storage", () => {
    const inverse = identityMat4();
    const product = identityMat4();
    forEachFuzzCase({ cases: 128, seed: 0x5e_ed_12_34 }, ({ random }) => {
      const matrix = transformMat4({
        position: [random.number(-10, 10), random.number(-10, 10), random.number(-10, 10)],
        rotation: [random.number(-3, 3), random.number(-3, 3), random.number(-3, 3)],
        scale: [random.number(0.1, 3.1), random.number(0.1, 3.1), random.number(0.1, 3.1)],
      });
      expect(inverseMat4Into(inverse, matrix)).toBe(inverse);
      multiplyMat4Into(product, matrix, inverse);
      expectIdentity(product);
    });
  });

  it("maps an arbitrarily rotated camera position to view-space origin", () => {
    const camera = perspectiveCamera({
      position: [4, -2, 7],
      rotation: [0.31, -0.72, 1.13],
    });
    const view = viewMat4Into(identityMat4(), camera);
    const origin = transformPointInto([0, 0, 0], view, camera.position);
    expect(origin[0]).toBeCloseTo(0, 12);
    expect(origin[1]).toBeCloseTo(0, 12);
    expect(origin[2]).toBeCloseTo(0, 12);
  });
});
