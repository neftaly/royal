import { describe, expect, it } from "vitest";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  rayAabbDistance,
  rayGeometryDistance,
  rayTriangleDistance,
  type Ray,
} from "../packages/renderer-webgl/src/math/picking";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const expectHitDistance = (actual: number | undefined, expected: number): void => {
  expect(actual).toBeDefined();
  expect(actual!).toBeCloseTo(expected);
};

const equivalentTriangleIndices = (mode: "triangle-fan" | "triangle-strip", vertexCount: number): Uint16Array => {
  const triangleCount = Math.max(0, vertexCount - 2);
  const triangles = Array.from({ length: triangleCount }, (_value, triangleIndex) => {
    if (mode === "triangle-fan") return [0, triangleIndex + 1, triangleIndex + 2];
    return triangleIndex % 2 === 0
      ? [triangleIndex, triangleIndex + 1, triangleIndex + 2]
      : [triangleIndex + 1, triangleIndex, triangleIndex + 2];
  }).flat();
  return new Uint16Array(triangles);
};

const randomPositions = (random: SeededRandom, vertexCount: number): Float32Array => {
  const values = random.array(vertexCount * 3, (index) => (
    index % 3 === 2 ? random.number(-0.25, 0.25) : random.number(-2, 2)
  ));
  return new Float32Array(values);
};

const randomRay = (random: SeededRandom): Ray => ({
  direction: [
    random.number(-0.2, 0.2),
    random.number(-0.2, 0.2),
    random.pick([-1, 1]) * random.number(0.5, 2),
  ],
  origin: [
    random.number(-2.5, 2.5),
    random.number(-2.5, 2.5),
    random.pick([-1, 1]) * random.number(0.75, 3),
  ],
});

const expectSameDistance = (actual: number | undefined, expected: number | undefined): void => {
  if (expected === undefined) {
    expect(actual).toBeUndefined();
    return;
  }

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

  it("replays a notched bounds false-positive as a geometry miss", () => {
    const bounds = {
      max: [4, 2, 0],
      min: [0, 0, 0],
    } as const;
    const positions = new Float32Array([
      0, 0, 0, 1.25, 0, 0, 1.25, 2, 0, 0, 0, 0, 1.25, 2, 0, 0, 2, 0,
      2.75, 0, 0, 4, 0, 0, 4, 2, 0, 2.75, 0, 0, 4, 2, 0, 2.75, 2, 0,
      1.25, 0, 0, 2.75, 0, 0, 2.75, 0.45, 0, 1.25, 0, 0, 2.75, 0.45, 0, 1.25, 0.45, 0,
      1.25, 1.55, 0, 2.75, 1.55, 0, 2.75, 2, 0, 1.25, 1.55, 0, 2.75, 2, 0, 1.25, 2, 0,
    ]);
    const rayThroughTransparentNotch: Ray = {
      direction: [0, 0, -1],
      origin: [2, 1, 1],
    };
    const rayThroughVisibleSurface: Ray = {
      direction: [0, 0, -1],
      origin: [0.5, 1, 1],
    };

    expectHitDistance(rayAabbDistance(rayThroughTransparentNotch, bounds), 1);
    expect(rayGeometryDistance({
      model: identityMat4(),
      positions,
      ray: rayThroughTransparentNotch,
    })).toBeUndefined();
    expectHitDistance(
      rayGeometryDistance({
        model: identityMat4(),
        positions,
        ray: rayThroughVisibleSurface,
      }),
      1,
    );
  });

  it("matches triangle-strip and triangle-fan picking against equivalent explicit triangles", () => {
    forEachFuzzCase({ cases: 32, seed: 0x5e1ec7ed }, ({ random }) => {
      const mode = random.pick(["triangle-fan", "triangle-strip"] as const);
      const vertexCount = random.int(3, 10);
      const positions = randomPositions(random, vertexCount);
      const ray = randomRay(random);
      const triangleIndices = equivalentTriangleIndices(mode, vertexCount);
      const modeIndices = new Uint16Array(Array.from({ length: vertexCount }, (_value, index) => index));

      const expected = rayGeometryDistance({
        indices: triangleIndices,
        mode: "triangles",
        model: identityMat4(),
        positions,
        ray,
      });

      expectSameDistance(
        rayGeometryDistance({
          indices: modeIndices,
          mode,
          model: identityMat4(),
          positions,
          ray,
        }),
        expected,
      );

      expectSameDistance(
        rayGeometryDistance({
          mode,
          model: identityMat4(),
          positions,
          ray,
        }),
        expected,
      );
    });
  });
});
