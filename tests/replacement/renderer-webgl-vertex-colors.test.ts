import { describe, expect, it } from "vitest";
import { readVertexColors, type AccessorContext } from "../../packages/renderer-webgl/src/gltf/accessor-reader";
import { canonicalAlphaMaskAcceptsTrianglePoint } from "../../packages/renderer-webgl/src/surface/alpha-mask-sampling";
import type { CanonicalTriangleGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type { CanonicalUnlitMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";

const context = (
  binary: Uint8Array,
  accessor: Record<string, unknown>,
): AccessorContext => ({
  accessors: [{ bufferView: 0, count: 2, type: "VEC3", ...accessor }],
  binary,
  bufferByteLength: binary.byteLength,
  bufferViews: [{ buffer: 0, byteLength: binary.byteLength }],
  label: "colors.gltf",
});

describe("canonical glTF vertex colors", () => {
  it("normalizes unsigned byte RGB and supplies opaque alpha", () => {
    expect(readVertexColors(context(
      new Uint8Array([0, 127, 255, 255, 64, 0]),
      { componentType: 5121, normalized: true },
    ), 0)).toEqual(new Float32Array([
      0, 127 / 255, 1, 1,
      1, 64 / 255, 0, 1,
    ]));
  });

  it("rejects integer color data without normalized semantics", () => {
    expect(() => readVertexColors(context(
      new Uint8Array(6),
      { componentType: 5121 },
    ), 0)).toThrow("normalized: must be true for integer COLOR_0");
  });

  it("includes interpolated vertex alpha in the shared visual/picking mask rule", () => {
    const geometry: CanonicalTriangleGeometry = {
      bounds: { max: [1, 1, 0], min: [0, 0, 0] },
      colors: new Float32Array([
        1, 1, 1, 0,
        1, 1, 1, 1,
        1, 1, 1, 1,
      ]),
      indices: new Uint8Array([0, 1, 2]),
      key: "colored-mask",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    };
    const material: CanonicalUnlitMaterial = {
      alphaCutoff: 0.5,
      baseColor: [1, 1, 1, 1],
      kind: "unlit",
      requiresTextureCoordinates: false,
    };
    expect(canonicalAlphaMaskAcceptsTrianglePoint(
      material, geometry, undefined, undefined, 0, 1, 2, 0.1, 0.1,
    )).toBe(false);
    expect(canonicalAlphaMaskAcceptsTrianglePoint(
      material, geometry, undefined, undefined, 0, 1, 2, 0.4, 0.4,
    )).toBe(true);
  });
});
