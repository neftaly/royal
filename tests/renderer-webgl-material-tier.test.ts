import { standardMaterial, textureAsset } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
  surfaceMaterialUsesPbrExtensions,
  surfaceMaterialUsesTransmission,
  type SurfaceMaterial,
  type SurfaceMaterialExtensionFactors,
} from "../packages/renderer-webgl/src/webgl/materials";

const material = (
  overrides: Partial<SurfaceMaterialExtensionFactors> = {},
): SurfaceMaterial => ({
  ...standardMaterial({ color: [1, 1, 1, 1] }),
  extensionFactors: {
    ...DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
    ...overrides,
  },
});

describe("surface material shader tier", () => {
  it("keeps defaults and visually inert metadata on core PBR", () => {
    expect(surfaceMaterialUsesPbrExtensions(standardMaterial({ color: [1, 1, 1, 1] }))).toBe(false);
    expect(surfaceMaterialUsesPbrExtensions(material({
      anisotropyRotation: 0.75,
      clearcoatNormalScale: 0.25,
      clearcoatRoughnessFactor: 0.8,
      diffuseTransmissionColorFactor: [0.2, 0.3, 0.4],
      dispersionFactor: 1,
      iridescenceIor: 2,
      iridescenceThicknessMaximum: 900,
      iridescenceThicknessMinimum: 200,
      sheenRoughnessFactor: 0.7,
      thicknessFactor: 1,
    }))).toBe(false);
  });

  it.each([
    ["anisotropy", { anisotropyStrength: 0.5 }],
    ["specular", { specularFactor: 0.5 }],
    ["specular color", { specularColorFactor: [0.5, 1, 1] }],
    ["ior", { ior: 1.33 }],
    ["clearcoat", { clearcoatFactor: 0.5 }],
    ["diffuse transmission", { diffuseTransmissionFactor: 0.5 }],
    ["sheen", { sheenColorFactor: [0.2, 0, 0] }],
    ["iridescence", { iridescenceFactor: 0.5 }],
    ["transmission", { transmissionFactor: 0.5 }],
  ] as const)("classifies effective %s state as extension PBR", (_label, overrides) => {
    expect(surfaceMaterialUsesPbrExtensions(material(overrides))).toBe(true);
  });

  it("treats specular maps as effective at their default scalar factors", () => {
    const specularTexture = textureAsset({ src: "/specular.png" });
    expect(surfaceMaterialUsesPbrExtensions({
      ...standardMaterial({ color: [1, 1, 1, 1] }),
      specularTexture,
    })).toBe(true);
  });

  it("requests screen transmission only when its effective factor is nonzero", () => {
    expect(surfaceMaterialUsesTransmission(material({ thicknessFactor: 1 }))).toBe(false);
    expect(surfaceMaterialUsesTransmission(material({ transmissionFactor: 0.5 }))).toBe(true);
  });
});
