import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(
  "apps/examples-react/public/fixtures/khronos",
  name,
  "glTF-Binary",
  `${name}.glb`,
)));

describe("official glTF extension-profile oracles", () => {
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
