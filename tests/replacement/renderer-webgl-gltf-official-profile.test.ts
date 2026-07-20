import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(
  `../../apps/examples-react/public/fixtures/khronos/${name}/glTF-Binary/${name}.glb`,
  import.meta.url,
)));

describe("official glTF extension-profile oracles", () => {
  it.each(["BoxVertexColors", "VertexColorTest"])(
    "retains core COLOR_0 data from %s",
    (name) => {
      const prepared = prepareStaticGlb(fixture(name), `vertex-color:${name}`);
      const colors = prepared.primitives.flatMap(({ geometry }) =>
        geometry.colors === undefined ? [] : [geometry.colors]);
      expect(colors.length).toBeGreaterThan(0);
      for (const values of colors) {
        expect(values.length).toBeGreaterThan(0);
        expect(values.length % 4).toBe(0);
        expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
      }
    },
  );

  it("renders valid core fallback without claiming optional clearcoat", () => {
    const prepared = prepareStaticGlb(fixture("ClearCoatTest"), "clearcoat-core-fallback");
    expect(prepared.primitives.length).toBeGreaterThan(0);
    expect(prepared.primitives.every(({ material }) => material.kind === "standard")).toBe(true);
  });

  it.each([
    ["ClearCoatCarPaint", "KHR_materials_clearcoat"],
    ["IridescenceSuzanne", "KHR_materials_iridescence"],
    ["TextureTransformMultiTest", "outside Royal's supported placement profile"],
  ])("rejects unsupported required semantics in %s", (name, reason) => {
    expect(() => prepareStaticGlb(fixture(name), `official:${name}`, `${name}.glb`))
      .toThrow(reason);
  });
});
