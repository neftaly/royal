import { describe, expect, it } from "vitest";
import type { Transform } from "@royal/renderer-core";
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
});
