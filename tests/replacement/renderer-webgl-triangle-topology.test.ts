import { describe, expect, it } from "vitest";
import { canonicalTriangleIndices } from "../../packages/renderer-webgl/src/gltf/triangle-topology";

describe("glTF triangle topology normalization", () => {
  it("preserves triangle lists without allocation", () => {
    const source = new Uint16Array([0, 1, 2]);
    expect(canonicalTriangleIndices(source, 4)).toBe(source);
  });

  it("alternates triangle-strip winding", () => {
    expect(canonicalTriangleIndices(new Uint8Array([0, 1, 2, 3, 4]), 5)).toEqual(
      new Uint8Array([0, 1, 2, 2, 1, 3, 2, 3, 4]),
    );
  });

  it("anchors triangle fans at their first vertex", () => {
    expect(canonicalTriangleIndices(new Uint32Array([3, 4, 5, 6]), 6)).toEqual(
      new Uint32Array([3, 4, 5, 3, 5, 6]),
    );
  });
});
