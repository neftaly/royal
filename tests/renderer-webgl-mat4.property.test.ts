import { describe, expect, it } from "vitest";
import type { Transform } from "@royal/renderer-core";
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
  multiplyMat4,
  rotationXMat4,
  rotationYMat4,
  rotationZMat4,
  scaleMat4,
  transformMat4,
  translationMat4,
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

describe("renderer-webgl transform matrix properties", () => {
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
