import { describe, expect, it } from "vitest";
import { perspectiveCamera, type Transform } from "@royal/renderer-core";
import {
  gltfImageBasedLightHasValidRotation,
  gltfImageBasedLightRotation,
} from "../packages/renderer-webgl/src/gltf/image-based-light";
import type {
  GltfImageBasedLight,
  GltfSceneNode,
} from "../packages/renderer-webgl/src/gltf/schema";
import { gltfNodeMat4 } from "../packages/renderer-webgl/src/gltf/transforms";
import {
  affineSurfaceNormalTransformInto,
  cameraWorldPositionFromViewInto,
  copyMat4ValuesInto,
  identityMat4,
  mat4ValuesEqual,
  multiplyMat4,
  rotationXMat4,
  rotationYMat4,
  rotationZMat4,
  scaleMat4,
  transformDirection,
  transformDirectionInto,
  transformMat4,
  transformPoint,
  transformPointInto,
  translationMat4,
  viewMat4,
} from "../packages/renderer-webgl/src/math/mat4";
import { forEachFuzzCase } from "./fuzz";

const composedTransformMat4 = (transform: Transform) => multiplyMat4(
  translationMat4(transform.position),
  multiplyMat4(
    rotationZMat4(transform.rotation[2]),
    multiplyMat4(
      rotationYMat4(transform.rotation[1]),
      multiplyMat4(rotationXMat4(transform.rotation[0]), scaleMat4(transform.scale)),
    ),
  ),
);

const referenceTransformVector = (
  transform: Transform,
  vector: readonly [number, number, number],
  point: boolean,
): [number, number, number] => {
  let x = vector[0] * transform.scale[0];
  let y = vector[1] * transform.scale[1];
  let z = vector[2] * transform.scale[2];
  const cosX = Math.cos(transform.rotation[0]);
  const sinX = Math.sin(transform.rotation[0]);
  [y, z] = [cosX * y - sinX * z, sinX * y + cosX * z];
  const cosY = Math.cos(transform.rotation[1]);
  const sinY = Math.sin(transform.rotation[1]);
  [x, z] = [cosY * x + sinY * z, -sinY * x + cosY * z];
  const cosZ = Math.cos(transform.rotation[2]);
  const sinZ = Math.sin(transform.rotation[2]);
  [x, y] = [cosZ * x - sinZ * y, sinZ * x + cosZ * y];
  if (point) return [x + transform.position[0], y + transform.position[1], z + transform.position[2]];
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, -1] : [x / length, y / length, z / length];
};

describe("renderer-webgl transform matrix properties", () => {
  it("compares and copies retained matrix values without aliasing", () => {
    const source = translationMat4([1, 2, 3]);
    const snapshot = new Float64Array(16);
    expect(mat4ValuesEqual(snapshot, source)).toBe(false);
    expect(copyMat4ValuesInto(snapshot, source)).toBe(snapshot);
    expect(mat4ValuesEqual(snapshot, source)).toBe(true);
    snapshot[3] = -0;
    expect(mat4ValuesEqual(snapshot, source), "signed zero remains an exact cache value").toBe(false);
  });

  it("builds reusable signed cofactor normal transforms", () => {
    const output = identityMat4();
    forEachFuzzCase({ cases: 64, seed: 0xc0fa_c701 }, ({ label, random }) => {
      const scale = random.array(3, () => random.number(0.05, 10)) as [number, number, number];
      if (random.boolean()) scale[random.int(0, 2)]! *= -1;
      const model = transformMat4({
        position: random.array(3, () => random.number(-100, 100)) as [number, number, number],
        rotation: random.array(3, () => random.number(-Math.PI, Math.PI)) as [number, number, number],
        scale,
      });
      expect(affineSurfaceNormalTransformInto(output, model), label).toBe(output);
      const determinant = scale[0] * scale[1] * scale[2];
      expect(output[15], label).toBe(determinant < 0 ? -1 : 1);
      const tangent = transformDirection(model, [1, 0, 0]);
      const normal = transformDirection(output, [0, 1, 0]);
      expect(tangent[0] * normal[0] + tangent[1] * normal[1] + tangent[2] * normal[2], label)
        .toBeCloseTo(0, 6);
    });
  });

  it("recovers camera world positions into reusable storage", () => {
    forEachFuzzCase({ cases: 64, seed: 0xca6e_a123 }, ({ label, random }) => {
      const position = random.array(3, () => random.number(-1_000, 1_000)) as [number, number, number];
      const camera = perspectiveCamera({
        far: 1_000,
        fovY: 1,
        near: 0.1,
        position,
        rotation: random.array(3, () => random.number(-Math.PI, Math.PI)) as [number, number, number],
      });
      const output: [number, number, number] = [0, 0, 0];

      expect(cameraWorldPositionFromViewInto(output, viewMat4(camera)), label).toBe(output);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(output[axis], `${label} axis=${axis}`).toBeCloseTo(position[axis]!, 8);
      }
    });
  });

  it("keeps write-into vector transforms equivalent to allocating wrappers", () => {
    forEachFuzzCase({ cases: 64, seed: 0x1a11_0ca7 }, ({ label, random }) => {
      const transform: Transform = {
        position: random.array(3, () => random.number(-100, 100)) as [number, number, number],
        rotation: random.array(3, () => random.number(-Math.PI, Math.PI)) as [number, number, number],
        scale: random.array(3, () => random.number(-10, 10)) as [number, number, number],
      };
      const matrix = transformMat4(transform);
      const vector = random.array(3, () => random.number(-100, 100)) as [number, number, number];
      const pointOutput: [number, number, number] = [0, 0, 0];
      const directionOutput: [number, number, number] = [0, 0, 0];

      const expectedPoint = referenceTransformVector(transform, vector, true);
      const expectedDirection = referenceTransformVector(transform, vector, false);

      expect(transformPointInto(pointOutput, matrix, vector), label).toBe(pointOutput);
      expect(pointOutput, label).toEqual(transformPoint(matrix, vector));
      expect(pointOutput[0], label).toBeCloseTo(expectedPoint[0]!, 5);
      expect(pointOutput[1], label).toBeCloseTo(expectedPoint[1]!, 5);
      expect(pointOutput[2], label).toBeCloseTo(expectedPoint[2]!, 5);
      expect(transformDirectionInto(directionOutput, matrix, vector), label).toBe(directionOutput);
      expect(directionOutput, label).toEqual(transformDirection(matrix, vector));
      expect(directionOutput[0], label).toBeCloseTo(expectedDirection[0]!, 5);
      expect(directionOutput[1], label).toBeCloseTo(expectedDirection[1]!, 5);
      expect(directionOutput[2], label).toBeCloseTo(expectedDirection[2]!, 5);

      const aliasedPoint = vector.slice() as [number, number, number];
      const aliasedDirection = vector.slice() as [number, number, number];
      transformPointInto(aliasedPoint, matrix, aliasedPoint);
      transformDirectionInto(aliasedDirection, matrix, aliasedDirection);
      expect(aliasedPoint, label).toEqual(pointOutput);
      expect(aliasedDirection, label).toEqual(directionOutput);
    });
  });

  it("matches the compositional TRS definition", () => {
    forEachFuzzCase({ cases: 64, seed: 0x7a5_4a71 }, ({ label, random }) => {
      const transform: Transform = {
        position: random.array(3, () => random.number(-1_000, 1_000)) as [number, number, number],
        rotation: random.array(3, () => random.number(-Math.PI * 4, Math.PI * 4)) as [number, number, number],
        scale: random.array(3, () => random.number(-10, 10)) as [number, number, number],
      };

      const actual = transformMat4(transform);
      const expected = composedTransformMat4(transform);
      for (let index = 0; index < expected.length; index += 1) {
        expect(actual[index], `${label} element=${index}`).toBeCloseTo(expected[index]!, 10);
      }
    });
  });

  it("rejects malformed glTF node transforms instead of repairing them", () => {
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as const;
    forEachFuzzCase({ cases: 72, seed: 0x6e0d_e7a1 }, ({ caseIndex, label, random }) => {
      const nonFinite = random.pick([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
      const invalidMatrixIndex = random.int(0, 16);
      const invalidNodes = [
        { matrix: identity.slice(0, 15) },
        { matrix: identity.map((value, index) => index === invalidMatrixIndex ? nonFinite : value) },
        { matrix: identity, translation: [0, 0, 0] },
        { translation: [0, 0] },
        { translation: [0, nonFinite, 0] },
        { rotation: [0, 0, 0] },
        { rotation: [0, 0, nonFinite, 1] },
        { rotation: [0, 0, 0, 0] },
        { scale: [1, 1] },
        { scale: [1, nonFinite, 1] },
      ] satisfies readonly GltfSceneNode[];
      const node = invalidNodes[caseIndex % invalidNodes.length]!;

      expect(() => gltfNodeMat4(node), label).toThrow(/glTF node/i);
    });
  });

  it("treats malformed and zero image-based-light rotations as invalid", () => {
    forEachFuzzCase({ cases: 48, seed: 0x1b1_20a7e }, ({ caseIndex, label, random }) => {
      const nonFinite = random.pick([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
      const invalidRotations = [
        [0, 0, 0, 0],
        [0, 0, 1],
        [0, 0, 0, 1, 0],
        [0, nonFinite, 0, 1],
      ] as const;
      const light = {
        rotation: invalidRotations[caseIndex % invalidRotations.length]!,
      } satisfies GltfImageBasedLight;

      expect(gltfImageBasedLightHasValidRotation(light), label).toBe(false);
      expect(() => gltfImageBasedLightRotation(light), label).toThrow(/finite non-zero quaternion/i);
    });
  });
});
