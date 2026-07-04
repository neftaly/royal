import { describe, expect, it } from "vitest";
import {
  applyGltfMorphTargets,
  gltfMorphWeights,
} from "../packages/renderer-webgl/src/gltf/morph";
import type { GltfDocument, GltfMeshPrimitive } from "../packages/renderer-webgl/src/gltf/schema";

const arrayBufferFromFloats = (values: readonly number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(values.length * Float32Array.BYTES_PER_ELEMENT);
  new Float32Array(buffer).set(values);

  return buffer;
};

const round = (values: Float32Array): readonly number[] =>
  Array.from(values, (value) => Number(value.toFixed(6)));

describe("renderer-webgl glTF morph helpers", () => {
  it("uses node weights before mesh weights and coerces non-finite values to zero", () => {
    expect(gltfMorphWeights({ weights: [0.25] }, { weights: [0.5, Number.NaN, Infinity] }))
      .toEqual([0.5, 0, 0]);
    expect(gltfMorphWeights({ weights: [0.25] }, {})).toEqual([0.25]);
  });

  it("applies weighted position, normal, and tangent deltas", () => {
    const document: GltfDocument = {
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: "VEC3" },
        { bufferView: 1, componentType: 5126, count: 2, type: "VEC3" },
        { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
      ],
      bufferViews: [
        { buffer: 0, byteLength: 24 },
        { buffer: 1, byteLength: 24 },
        { buffer: 2, byteLength: 24 },
      ],
    };
    const primitive: GltfMeshPrimitive = {
      targets: [
        {
          NORMAL: 1,
          POSITION: 0,
          TANGENT: 2,
        },
      ],
    };

    const result = applyGltfMorphTargets(
      document,
      [
        arrayBufferFromFloats([1, 0, 0, 0, 2, 0]),
        arrayBufferFromFloats([0, 0, 0.5, 0, 0, -0.25]),
        arrayBufferFromFloats([0, 1, 0, 0, 0, 1]),
      ],
      primitive,
      [0.5],
      {
        normals: new Float32Array([0, 0, 1, 0, 0, 1]),
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, -1]),
      },
    );

    expect(round(result.positions)).toEqual([0.5, 0, 0, 1, 1, 0]);
    expect(round(result.normals ?? new Float32Array())).toEqual([0, 0, 1.25, 0, 0, 0.875]);
    expect(round(result.tangents ?? new Float32Array())).toEqual([1, 0.5, 0, 1, 1, 0, 0.5, -1]);
  });
});
