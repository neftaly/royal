import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  prepareStaticGlb,
  prepareStaticGltfSource,
} from "../../packages/renderer-webgl/src/gltf/static-asset";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(
  `../../apps/examples-react/public/fixtures/khronos/${name}/glTF-Binary/${name}.glb`,
  import.meta.url,
)));

const dracoDuckFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(
  `../../apps/examples-react/public/fixtures/khronos/Duck/glTF-Draco/${name}`,
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

  it("executes official core texture transforms while keeping optional clearcoat opaque", () => {
    const transformed = materials("TextureTransformMultiTest");
    expect(transformed.length).toBeGreaterThan(0);
    expect(transformed.some((material) =>
      material.baseColorTextureCoordinates?.row0[2] !== 0
      || (
        material.kind === "standard"
        && material.normalTextureCoordinates?.row0[2] !== 0
      ))).toBe(true);
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

  it("decodes the pinned official external Duck Draco variant", async () => {
    const prepared = await prepareStaticGltfSource(
      dracoDuckFixture("Duck.gltf"),
      "official:DuckDraco",
      "DuckDraco.gltf",
      "/fixtures/khronos/Duck/glTF-Draco/Duck.gltf",
      async (uri) => dracoDuckFixture(uri.slice(uri.lastIndexOf("/") + 1)),
    );
    expect(prepared.primitives).toHaveLength(1);
    expect(prepared.primitives[0]!.geometry.positions).toHaveLength(2_399 * 3);
    expect(prepared.primitives[0]!.geometry.indices).toHaveLength(12_636);
    expect(prepared.textureAssets).toEqual([
      expect.objectContaining({
        kind: "asset",
        src: "/fixtures/khronos/Duck/glTF-Draco/DuckCM.png",
      }),
    ]);
  });

  it.each([
    ["ClearCoatCarPaint", "KHR_materials_clearcoat"],
    ["IridescenceSuzanne", "KHR_materials_iridescence"],
  ])("rejects unsupported required semantics in %s", (name, reason) => {
    expect(() => prepareStaticGlb(fixture(name), `official:${name}`, `${name}.glb`))
      .toThrow(reason);
  });
});
