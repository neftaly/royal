import { describe, expect, it } from "vitest";
import { identityMat4, type Mat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  createRayGeometryScratch,
  isBoundsVisible,
  nearestExactHitByLowerBound,
  rayAabbDistance,
  rayGeometryDistanceWithScratch,
  rayTriangleDistance,
  transformBoundsInto,
  worldBounds,
  worldBoundsInto,
  type Bounds3,
  type MutableBounds3,
  type Ray,
} from "../packages/renderer-webgl/src/math/picking";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const verticesVisible = (positions: Float32Array, matrix: Mat4): boolean => {
  if (positions.length === 0) return false;
  let left = true;
  let right = true;
  let bottom = true;
  let top = true;
  let near = true;
  let far = true;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    left &&= clipX < -clipW;
    right &&= clipX > clipW;
    bottom &&= clipY < -clipW;
    top &&= clipY > clipW;
    near &&= clipZ < -clipW;
    far &&= clipZ > clipW;
  }
  return !(left || right || bottom || top || near || far);
};

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

const rayGeometryDistance = ({
  indices,
  mode = "triangles",
  model,
  positions,
  ray,
}: {
  readonly indices?: Uint16Array | Uint32Array | Uint8Array;
  readonly mode?: "triangle-fan" | "triangle-strip" | "triangles";
  readonly model: Mat4;
  readonly positions: Float32Array;
  readonly ray: Ray;
}): number | undefined => rayGeometryDistanceWithScratch(
  positions,
  indices,
  mode,
  model,
  ray,
  createRayGeometryScratch(),
);

const cornerTransformedBounds = (positions: Float32Array, model: Mat4): Bounds3 | undefined => {
  if (positions.length < 3) return undefined;
  const local = {
    max: [-Infinity, -Infinity, -Infinity],
    min: [Infinity, Infinity, Infinity],
  } as MutableBounds3;
  for (let index = 0; index < positions.length; index += 3) {
    for (const axis of [0, 1, 2] as const) {
      local.min[axis] = Math.min(local.min[axis], positions[index + axis]!);
      local.max[axis] = Math.max(local.max[axis], positions[index + axis]!);
    }
  }

  const result = {
    max: [-Infinity, -Infinity, -Infinity],
    min: [Infinity, Infinity, Infinity],
  } as MutableBounds3;
  for (let corner = 0; corner < 8; corner += 1) {
    const x = (corner & 1) === 0 ? local.min[0] : local.max[0];
    const y = (corner & 2) === 0 ? local.min[1] : local.max[1];
    const z = (corner & 4) === 0 ? local.min[2] : local.max[2];
    for (const axis of [0, 1, 2] as const) {
      const value = model[axis]! * x
        + model[axis + 4]! * y
        + model[axis + 8]! * z
        + model[axis + 12]!;
      result.min[axis] = Math.min(result.min[axis], value);
      result.max[axis] = Math.max(result.max[axis], value);
    }
  }
  return result;
};

const expectBoundsClose = (actual: Bounds3 | undefined, expected: Bounds3 | undefined): void => {
  if (expected === undefined) {
    expect(actual).toBeUndefined();
    return;
  }
  expect(actual).toBeDefined();
  for (const axis of [0, 1, 2] as const) {
    expect(actual!.min[axis]).toBeCloseTo(expected.min[axis], 10);
    expect(actual!.max[axis]).toBeCloseTo(expected.max[axis], 10);
  }
};

describe("renderer-webgl picking math", () => {
  it("fuzzes cached local bounds against the previous vertex-plane visibility test", () => {
    forEachFuzzCase({ cases: 128, seed: 0xc011_1de5 }, ({ label, random }) => {
      const positions = new Float32Array(random.array(
        random.int(1, 512) * 3,
        () => random.number(-20, 20),
      ));
      const viewProjectionModel = random.array(16, () => random.number(-4, 4)) as Mat4;
      const oldVisible = verticesVisible(positions, viewProjectionModel);
      const boundsVisible = isBoundsVisible(worldBounds(positions, identityMat4()), viewProjectionModel);

      if (oldVisible) expect(boundsVisible, label).toBe(true);
    });
  });

  it("fuzzes allocation-free affine world bounds against transformed local-AABB corners", () => {
    forEachFuzzCase({ cases: 96, seed: 0xaabb_1f1e }, ({ random }) => {
      const positions = new Float32Array(random.array(random.int(1, 2_000) * 3, () => random.number(-100, 100)));
      const model: Mat4 = [
        random.number(-3, 3), random.number(-3, 3), random.number(-3, 3), 0,
        random.number(-3, 3), random.number(-3, 3), random.number(-3, 3), 0,
        random.number(-3, 3), random.number(-3, 3), random.number(-3, 3), 0,
        random.number(-1_000, 1_000), random.number(-1_000, 1_000), random.number(-1_000, 1_000), 1,
      ];
      const expected = cornerTransformedBounds(positions, model);
      const out: MutableBounds3 = { max: [NaN, NaN, NaN], min: [NaN, NaN, NaN] };

      expectBoundsClose(worldBounds(positions, model), expected);
      expect(worldBoundsInto(out, positions, model)).toBe(out);
      expectBoundsClose(out, expected);

      const local = cornerTransformedBounds(positions, identityMat4())!;
      expectBoundsClose(transformBoundsInto(out, local, model), expected);
    });
  });

  it("preserves empty and malformed position policies", () => {
    const out: MutableBounds3 = { max: [7, 8, 9], min: [4, 5, 6] };
    expect(worldBoundsInto(out, new Float32Array(0), identityMat4())).toBeUndefined();
    expect(out).toEqual({ max: [7, 8, 9], min: [4, 5, 6] });
    expect(worldBounds(new Float32Array([1, 2]), identityMat4())).toBeUndefined();

    const malformed = worldBounds(new Float32Array([1, 2, 3, 4]), identityMat4());
    expect(malformed).toBeDefined();
    expect([...malformed!.min, ...malformed!.max].every(Number.isNaN)).toBe(true);
  });

  it("fuzzes lower-bound pruning against exhaustive nearest-hit selection", () => {
    forEachFuzzCase({ cases: 64, seed: 0xb04d5e1e }, ({ random }) => {
      const candidates = random.array(random.int(1, 80), (ordinal) => {
        const distance = random.number(0.1, 200);
        return {
          distance,
          lowerBound: random.number(0, distance),
          ordinal,
        };
      });
      const expected = candidates.reduce((best, candidate) =>
        candidate.distance < best.distance ? candidate : best);

      const actual = nearestExactHitByLowerBound(
        candidates,
        (candidate) => candidate.lowerBound,
        (candidate) => candidate,
        (candidate) => candidate.distance,
      );
      expect(actual).toBe(expected);
    });
  });

  it("stops exact tests once the next conservative bound is beyond the nearest hit", () => {
    const candidates = [
      { distance: 1, lowerBound: 0.5 },
      ...Array.from({ length: 10_000 }, (_value, index) => ({
        distance: index + 101,
        lowerBound: index + 100,
      })),
    ];
    let exactTests = 0;

    expect(nearestExactHitByLowerBound(
      candidates,
      (candidate) => candidate.lowerBound,
      (candidate) => {
        exactTests += 1;
        return candidate;
      },
      (candidate) => candidate.distance,
    )).toBe(candidates[0]);
    expect(exactTests).toBe(1);
  });

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
