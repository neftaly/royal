import { describe, expect, it } from "vitest";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  rayGeometryDistance,
  rayTriangleDistance,
  type Ray,
} from "../packages/renderer-webgl/src/math/picking";

const expectHitDistance = (actual: number | undefined, expected: number): void => {
  expect(actual).toBeDefined();
  expect(actual!).toBeCloseTo(expected);
};

describe("renderer-webgl picking math", () => {
  it("accepts a ray that lands on a shared triangle edge", () => {
    const ray: Ray = {
      direction: [0, 0, -1],
      origin: [0.5, 0.5, 1],
    };

    expectHitDistance(
      rayTriangleDistance(ray, [0, 0, 0], [1, 0, 0], [0, 1, 0]),
      1,
    );
    expectHitDistance(
      rayTriangleDistance(ray, [1, 0, 0], [1, 1, 0], [0, 1, 0]),
      1,
    );
  });

  it("accepts a ray that lands on a shared vertex", () => {
    const ray: Ray = {
      direction: [0, 0, -1],
      origin: [0, 0, 1],
    };

    expectHitDistance(
      rayTriangleDistance(ray, [0, 0, 0], [1, 0, 0], [0, 1, 0]),
      1,
    );
    expectHitDistance(
      rayTriangleDistance(ray, [0, 0, 0], [0, -1, 0], [-1, 0, 0]),
      1,
    );
  });

  it("remains two-sided for opposite triangle winding", () => {
    const ray: Ray = {
      direction: [0, 0, -1],
      origin: [0.25, 0.25, 1],
    };

    expectHitDistance(
      rayTriangleDistance(ray, [0, 0, 0], [1, 0, 0], [0, 1, 0]),
      1,
    );
    expectHitDistance(
      rayTriangleDistance(ray, [0, 0, 0], [0, 1, 0], [1, 0, 0]),
      1,
    );
  });

  it("hits needle triangles below the old determinant epsilon", () => {
    const ray: Ray = {
      direction: [0, 0, -1],
      origin: [2.5e-13, 0.25, 1],
    };

    expectHitDistance(
      rayTriangleDistance(ray, [0, 0, 0], [1e-12, 0, 0], [0, 1, 0]),
      1,
    );
  });

  it("uses the watertight triangle test for indexed geometry picking", () => {
    const ray: Ray = {
      direction: [0, 0, -1],
      origin: [2.5e-13, 0.25, 1],
    };
    const distance = rayGeometryDistance({
      indices: new Uint16Array([0, 1, 2]),
      model: identityMat4(),
      positions: new Float32Array([
        0, 0, 0,
        1e-12, 0, 0,
        0, 1, 0,
      ]),
      ray,
    });

    expectHitDistance(distance, 1);
  });
});
