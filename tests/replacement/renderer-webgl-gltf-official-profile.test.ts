import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(
  `../../apps/examples-react/public/fixtures/khronos/${name}/glTF-Binary/${name}.glb`,
  import.meta.url,
)));

describe("official glTF extension-profile oracles", () => {
  const materials = (name: string) => prepareStaticGlb(
    fixture(name),
    `official:${name}`,
    `${name}.glb`,
  ).primitives.map(({ material }) => material);

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

  it("lowers the official punctual-light asset to canonical directional lights", () => {
    const prepared = prepareStaticGlb(
      fixture("DirectionalLight"),
      "official:DirectionalLight",
      "DirectionalLight.glb",
    );
    expect(prepared.lights.some(({ kind }) => kind === "directional")).toBe(true);
  });

  it("retains official unlit, emissive-strength, IOR, and specular semantics", () => {
    expect(materials("UnlitTest").every(({ kind }) => kind === "unlit")).toBe(true);
    expect(materials("EmissiveStrengthTest").some((material) =>
      material.kind === "standard"
      && material.emissiveFactor.some((channel) => channel > 1))).toBe(true);
    expect(materials("CompareIor").flatMap((material) =>
      material.kind === "standard" && material.indexOfRefraction !== undefined
        ? [material.indexOfRefraction]
        : []).some((indexOfRefraction) => indexOfRefraction !== 1.5)).toBe(true);
    expect(materials("SpecularTest").some((material) =>
      material.kind === "standard" && material.specularFactor !== undefined)).toBe(true);
  });

  it("retains official transmission and volume semantics", () => {
    expect(materials("TransmissionTest").some((material) =>
      material.kind === "standard" && (material.transmissionFactor ?? 0) > 0)).toBe(true);
    expect(materials("AttenuationTest").some((material) =>
      material.kind === "standard"
      && (material.transmissionFactor ?? 0) > 0
      && (material.thicknessFactor ?? 0) > 0
      && material.attenuationColor !== undefined)).toBe(true);
  });

  it("retains the official GPU-instancing batch instead of expanding nodes", () => {
    const prepared = prepareStaticGlb(
      fixture("SimpleInstancing"),
      "official:SimpleInstancing",
      "SimpleInstancing.glb",
    );
    expect(prepared.primitives.some(({ instanceBatch }) =>
      (instanceBatch?.localModels.length ?? 0) > 16)).toBe(true);
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
