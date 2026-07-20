import { describe, expect, it } from "vitest";
import {
  readIndices,
  readPositions,
  readVertexColors,
  type AccessorContext,
} from "../../packages/renderer-webgl/src/gltf/accessor-reader";

const context = (
  binary: Uint8Array,
  accessors: unknown[],
  bufferViews: unknown[],
): AccessorContext => ({
  accessors,
  binary,
  bufferByteLength: binary.byteLength,
  bufferViews,
  label: "sparse.glb",
});

describe("glTF sparse accessors", () => {
  it("honors the core implicit-zero form even without overrides", () => {
    const source = context(new Uint8Array(), [{
      componentType: 5126,
      count: 3,
      type: "VEC3",
    }], []);
    expect(readPositions(source, 0)).toEqual({
      bounds: { max: [0, 0, 0], min: [0, 0, 0] },
      positions: new Float32Array(9),
    });
  });

  it("materializes an accessor with an implicit zero base", () => {
    const binary = new Uint8Array(40);
    binary.set([0, 1, 2]);
    new Float32Array(binary.buffer, 4, 9).set([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0,
    ]);
    const source = context(binary, [{
      componentType: 5126,
      count: 3,
      sparse: {
        count: 3,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 1 },
      },
      type: "VEC3",
    }], [
      { buffer: 0, byteLength: 3 },
      { buffer: 0, byteLength: 36, byteOffset: 4 },
    ]);

    expect(readPositions(source, 0)).toEqual({
      bounds: { max: [1, 1, 0], min: [-1, -1, 0] },
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    });
  });

  it("overrides a retained base without mutating its bytes", () => {
    const binary = new Uint8Array(52);
    const base = new Float32Array(binary.buffer, 0, 9);
    base.set([-1, -1, 0, 1, -1, 0, 0, 0, 0]);
    binary[36] = 2;
    new Float32Array(binary.buffer, 40, 3).set([0, 1, 0]);
    const source = context(binary, [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      sparse: {
        count: 1,
        indices: { bufferView: 1, componentType: 5121 },
        values: { bufferView: 2 },
      },
      type: "VEC3",
    }], [
      { buffer: 0, byteLength: 36 },
      { buffer: 0, byteLength: 1, byteOffset: 36 },
      { buffer: 0, byteLength: 12, byteOffset: 40 },
    ]);

    expect(readPositions(source, 0).positions).toEqual(
      new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    );
    expect(base).toEqual(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 0, 0]));
  });

  it("applies sparse index and normalized color values through the shared path", () => {
    const indexBinary = new Uint8Array([1, 2, 1, 2]);
    const indexSource = context(indexBinary, [{
      componentType: 5121,
      count: 3,
      sparse: {
        count: 2,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 1 },
      },
      type: "SCALAR",
    }], [
      { buffer: 0, byteLength: 2 },
      { buffer: 0, byteLength: 2, byteOffset: 2 },
    ]);
    expect(readIndices(indexSource, 0, 3)).toEqual(new Uint8Array([0, 1, 2]));

    const colorBinary = new Uint8Array([0, 255, 128, 0]);
    const colorSource = context(colorBinary, [{
      componentType: 5121,
      count: 1,
      normalized: true,
      sparse: {
        count: 1,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 1 },
      },
      type: "VEC3",
    }], [
      { buffer: 0, byteLength: 1 },
      { buffer: 0, byteLength: 3, byteOffset: 1 },
    ]);
    expect(readVertexColors(colorSource, 0)).toEqual(new Float32Array([
      1, 128 / 255, 0, 1,
    ]));
  });

  it("rejects unordered sparse indices before publication", () => {
    const binary = new Uint8Array(28);
    binary.set([2, 1]);
    const source = context(binary, [{
      componentType: 5126,
      count: 3,
      sparse: {
        count: 2,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 1 },
      },
      type: "VEC3",
    }], [
      { buffer: 0, byteLength: 2 },
      { buffer: 0, byteLength: 24, byteOffset: 4 },
    ]);
    expect(() => readPositions(source, 0)).toThrow("must be strictly increasing and in range");
  });
});
