import { describe, expect, it } from "vitest";
import {
  fragmentShaderSource,
  surfaceShaderFeatureKey,
  SURFACE_SHADER_TEXTURE_FEATURES,
  type SurfaceShaderTextureFeature,
} from "../packages/renderer-webgl/src/webgl/shaders";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const samplerDeclarations = {
  baseColorTexture: "uniform sampler2D u_texture;",
  baseColorVirtualTextureAtlas: "uniform sampler2D u_vtAtlas;",
  baseColorVirtualTexturePageTable: "uniform sampler2D u_vtPageTable;",
  emissiveTexture: "uniform sampler2D u_emissiveTexture;",
  metallicRoughnessTexture: "uniform sampler2D u_metallicRoughnessTexture;",
  normalTexture: "uniform sampler2D u_normalTexture;",
  occlusionTexture: "uniform sampler2D u_occlusionTexture;",
  specularTexture: "uniform sampler2D u_specularTexture;",
  specularColorTexture: "uniform sampler2D u_specularColorTexture;",
  clearcoatTexture: "uniform sampler2D u_clearcoatTexture;",
  clearcoatRoughnessTexture: "uniform sampler2D u_clearcoatRoughnessTexture;",
  sheenColorTexture: "uniform sampler2D u_sheenColorTexture;",
  sheenRoughnessTexture: "uniform sampler2D u_sheenRoughnessTexture;",
  iridescenceTexture: "uniform sampler2D u_iridescenceTexture;",
  iridescenceThicknessTexture: "uniform sampler2D u_iridescenceThicknessTexture;",
  materialTransmissionTexture: "uniform sampler2D u_materialTransmissionTexture;",
  thicknessTexture: "uniform sampler2D u_thicknessTexture;",
  transmissionScreenTexture: "uniform sampler2D u_transmissionScreenTexture;",
  iblSpecularCube: "uniform samplerCube u_iblSpecularCube;",
  iblBrdfLut: "uniform sampler2D u_iblBrdfLut;",
} as const satisfies Record<SurfaceShaderTextureFeature, string>;

const samplerDeclarationCount = (source: string): number =>
  source.match(/uniform sampler(?:2D|Cube) /gu)?.length ?? 0;

const randomFeatureSet = (random: SeededRandom): ReadonlySet<SurfaceShaderTextureFeature> =>
  new Set(SURFACE_SHADER_TEXTURE_FEATURES.filter(() => random.boolean()));

describe("surface shader variants", () => {
  it("generates sampler declarations only for enabled texture features", () => {
    forEachFuzzCase({
      cases: 32,
      replays: [
        { label: "empty", value: [] },
        { label: "full", value: SURFACE_SHADER_TEXTURE_FEATURES },
      ],
      seed: 0x5a9a_fade,
    }, ({ label, random, replay }) => {
      const features = replay === undefined
        ? randomFeatureSet(random)
        : new Set(replay as readonly SurfaceShaderTextureFeature[]);
      const source = fragmentShaderSource("surface", features);
      const expectedKey = SURFACE_SHADER_TEXTURE_FEATURES
        .filter((feature) => features.has(feature))
        .join(",");

      expect(surfaceShaderFeatureKey(features), label).toBe(expectedKey);
      expect(source, label).not.toMatch(/__[A-Z0-9_]+__/u);
      expect(samplerDeclarationCount(source), label).toBe(features.size);
      for (const feature of SURFACE_SHADER_TEXTURE_FEATURES) {
        expect(source.includes(samplerDeclarations[feature]), `${label} ${feature}`).toBe(features.has(feature));
      }
    });
  });
});
