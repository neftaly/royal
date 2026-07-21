import { describe, expect, it } from "vitest";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  createCanonicalMaterialUniformStorage,
  packCanonicalAttenuationUniformsInto,
  packCanonicalBaseMaterialUniformsInto,
  packCanonicalSpecularUniformsInto,
  packCanonicalTransmissionUniformsInto,
} from "../../packages/renderer-webgl/src/surface/material-uniform-packing";

const standard = (
  overrides: Partial<Extract<CanonicalSurfaceMaterial, { kind: "standard" }>> = {},
): Extract<CanonicalSurfaceMaterial, { kind: "standard" }> => ({
  baseColor: [1, 1, 1, 1],
  emissiveFactor: [0.25, 0.5, 1],
  kind: "standard",
  metallicFactor: 0.75,
  normalScale: 0.5,
  occlusionStrength: 1,
  requiresTextureCoordinates: false,
  roughnessFactor: 0.25,
  ...overrides,
});

describe("canonical material uniform packing", () => {
  it("packs base factors and substitutes neutral emissive while its texture is pending", () => {
    const output = createCanonicalMaterialUniformStorage();
    const material = standard({
      alphaCutoff: 0.75,
      emissiveAsset: {
        contentKey: "emissive",
        kind: "asset",
        src: "/emissive.png",
      },
      indexOfRefraction: 1.5,
    });
    packCanonicalBaseMaterialUniformsInto(material, true, false, output);
    expect([...output.emissiveAndF0]).toEqual([0, 0, 0, expect.closeTo(0.04)]);
    expect([...output.materialFactors]).toEqual([0.75, 0.25, 0.75, 0.5]);

    packCanonicalBaseMaterialUniformsInto(material, false, true, output);
    expect([...output.emissiveAndF0.slice(0, 3)]).toEqual([0.25, 0.5, 1]);
    expect(output.materialFactors[2]).toBe(0);
  });

  it("packs optional specular, transmission, and volume values only when requested", () => {
    const output = createCanonicalMaterialUniformStorage();
    const material = standard({
      attenuationColor: [0.25, 0.5, 1],
      attenuationDistance: 4,
      indexOfRefraction: 1.25,
      specularColorFactor: [0.5, 1, 0.25],
      specularFactor: 0.75,
      thicknessFactor: 2,
      transmissionFactor: 0.5,
    });
    packCanonicalSpecularUniformsInto(material, output);
    packCanonicalTransmissionUniformsInto(material, 6, output);
    packCanonicalAttenuationUniformsInto(material, output);
    expect([...output.specularFactors]).toEqual([0.5, 1, 0.25, 0.75]);
    expect([...output.transmissionFactors]).toEqual([0.5, 2, 1.25, 6]);
    expect([...output.attenuation]).toEqual([0.25, 0.5, 1, 0.25]);

    const defaults = standard();
    packCanonicalSpecularUniformsInto(defaults, output);
    packCanonicalTransmissionUniformsInto(defaults, 0, output);
    packCanonicalAttenuationUniformsInto(defaults, output);
    expect([...output.specularFactors]).toEqual([1, 1, 1, 1]);
    expect([...output.transmissionFactors]).toEqual([0, 0, 1.5, 0]);
    expect([...output.attenuation]).toEqual([1, 1, 1, 0]);
  });
});
