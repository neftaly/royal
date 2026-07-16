import { describe, expect, it } from "vitest";
import {
  fragmentShaderSource,
  surfaceShaderFeatureKey,
  surfaceShaderFeatureMask,
  SURFACE_SHADER_TEXTURE_FEATURES,
  vertexShaderSource,
  type ProgramKind,
  type SurfaceShaderTextureFeature,
} from "../packages/renderer-webgl/src/webgl/shaders";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";
import { SURFACE_MATERIAL_TEXTURE_BINDINGS } from "../packages/renderer-webgl/src/webgl/surface-texture-binding-plan";

const samplerDeclarations = {
  baseColorTexture: "uniform sampler2D u_texture;",
  baseColorVirtualTextureAtlas: "uniform sampler2D u_vtAtlas;",
  baseColorVirtualTexturePageTable: "uniform highp usampler2D u_vtPageTable;",
  emissiveTexture: "uniform sampler2D u_emissiveTexture;",
  metallicRoughnessTexture: "uniform sampler2D u_metallicRoughnessTexture;",
  normalTexture: "uniform sampler2D u_normalTexture;",
  occlusionTexture: "uniform sampler2D u_occlusionTexture;",
  anisotropyTexture: "uniform sampler2D u_anisotropyTexture;",
  specularTexture: "uniform sampler2D u_specularTexture;",
  specularColorTexture: "uniform sampler2D u_specularColorTexture;",
  clearcoatTexture: "uniform sampler2D u_clearcoatTexture;",
  clearcoatRoughnessTexture: "uniform sampler2D u_clearcoatRoughnessTexture;",
  clearcoatNormalTexture: "uniform sampler2D u_clearcoatNormalTexture;",
  diffuseTransmissionTexture: "uniform sampler2D u_diffuseTransmissionTexture;",
  diffuseTransmissionColorTexture: "uniform sampler2D u_diffuseTransmissionColorTexture;",
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
  source.match(/uniform (?:highp )?[ui]?sampler(?:2D|Cube) /gu)?.length ?? 0;

const virtualBaseColorFeaturePair = [
  "baseColorVirtualTextureAtlas",
  "baseColorVirtualTexturePageTable",
] as const satisfies readonly SurfaceShaderTextureFeature[];

const virtualBaseColorSourceInvariants = [
  "uniform vec2 u_vtAtlasPageUvSize;",
  "uniform vec2 u_vtPageTableSize;",
  "uniform float u_vtBorderPageRatio;",
  "uniform vec2 u_vtVirtualPageScale;",
  "uniform vec2 u_vtVirtualSize;",
  "uniform int u_vtWrapS;",
  "uniform int u_vtWrapT;",
  "wrapVirtualTextureUv",
  "sampleVirtualBaseColor",
  "vec2(tableEntry.rg)",
  "residentMip",
  "ivec2(floor(sourcePage))",
  "halfTexel",
  "reflected",
  "residentLocalPageUv",
  "atlasCellPages",
  "atlasPageUv",
  "atlasLocalUv",
  "if (tableEntry.a == 0u)",
  "sampleVirtualBaseColor(materialTextureUv(u_baseColorUvSet",
] as const;

const randomFeatureSet = (random: SeededRandom): ReadonlySet<SurfaceShaderTextureFeature> =>
  new Set(SURFACE_SHADER_TEXTURE_FEATURES.filter(() => random.boolean()));

const hasVirtualBaseColorSource = (features: ReadonlySet<SurfaceShaderTextureFeature>): boolean =>
  virtualBaseColorFeaturePair.every((feature) => features.has(feature));

describe("surface shader variants", () => {
  it("keeps affine normal and orthogonal tangent handling in every surface vertex variant", () => {
    const surfaceKinds = [
      "surface",
      "surface-instanced-split",
    ] as const satisfies readonly ProgramKind[];

    for (const kind of surfaceKinds) {
      const source = vertexShaderSource(kind);

      expect(source, kind).toContain("orthogonalizeSurfaceTangent(");
      expect(source, kind).toContain("normalizeSurfaceDirection(");
      expect(source, kind).toContain("lengthSquared > 0.0");
      expect(source, kind).toContain("localTangentHandedness *");
      expect(source, kind).not.toMatch(/__[A-Z0-9_]+__/u);
      if (kind.startsWith("surface-instanced-split")) {
        expect(source, kind).toContain("cross(basis[1], basis[2]) * normal.x");
        expect(source, kind).toContain("transformRootNormal(");
        expect(source, kind).toContain("a_instanceScale.y * a_instanceScale.z * localNormal.x");
      } else {
        expect(source, kind).toContain("uniform mat4 u_modelNormalTransform;");
        expect(source, kind).toContain("mat3(u_modelNormalTransform) * localNormal");
      }
    }
  });

  it("keeps unlit vertex variants free of unused lighting work", () => {
    for (const kind of ["unlit", "unlit-instanced-split"] as const) {
      const source = vertexShaderSource(kind);
      expect(source, kind).not.toContain("a_normal");
      expect(source, kind).not.toContain("a_tangent");
      expect(source, kind).not.toContain("v_normal");
      expect(source, kind).not.toContain("v_tangent");
      expect(source, kind).not.toContain("basisHandedness");
      expect(source, kind).not.toContain("orthogonalizeSurfaceTangent");
      expect(source, kind).toContain("v_uv0 = a_uv0;");
      expect(source, kind).toContain("v_uv1 = a_uv1;");
      expect(source, kind).toContain("v_color = a_color;");
    }
    expect(vertexShaderSource("unlit")).toContain("u_model * vec4(a_position, 1.0)");
    expect(vertexShaderSource("unlit-instanced-split")).toContain("transformRootPoint(assetPosition.xyz)");
  });

  it("generates sampler declarations only for enabled texture features", () => {
    forEachFuzzCase({
      cases: 32,
      replays: [
        { label: "empty", value: [] },
        { label: "base-color-texture", value: ["baseColorTexture"] },
        { label: "virtual-atlas-only", value: ["baseColorVirtualTextureAtlas"] },
        { label: "virtual-page-table-only", value: ["baseColorVirtualTexturePageTable"] },
        { label: "virtual-base-color", value: virtualBaseColorFeaturePair },
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
      const expectedMask = SURFACE_SHADER_TEXTURE_FEATURES.reduce(
        (mask, feature, index) => features.has(feature) ? mask | (1 << index) : mask,
        0,
      ) >>> 0;
      const hasVirtualBaseColor = hasVirtualBaseColorSource(features);

      expect(surfaceShaderFeatureKey(features), label).toBe(expectedKey);
      expect(surfaceShaderFeatureMask(features), label).toBe(expectedMask);
      expect(source, label).not.toMatch(/__[A-Z0-9_]+__/u);
      expect(source, `${label} sampler readiness is specialized`).not.toMatch(
        /uniform bool u_use(?:Texture|VirtualTexture|EmissiveTexture|MetallicRoughnessTexture|NormalTexture|OcclusionTexture|AnisotropyTexture|SpecularTexture|SpecularColorTexture|ClearcoatTexture|ClearcoatRoughnessTexture|ClearcoatNormalTexture|DiffuseTransmissionTexture|DiffuseTransmissionColorTexture|SheenColorTexture|SheenRoughnessTexture|IridescenceTexture|IridescenceThicknessTexture|MaterialTransmissionTexture|ThicknessTexture|TransmissionTexture);/u,
      );
      expect(source, `${label} shared PBR sample`).toContain(
        "vec2 metallicRoughness = materialMetallicRoughness();",
      );
      expect(source, `${label} camera position uniform`).toContain(
        "u_cameraWorldPosition.xyz - v_worldPosition",
      );
      expect(source, `${label} per-fragment camera recovery`).not.toContain(
        "transpose(mat3(u_view))",
      );
      expect(source.match(/texture\(u_metallicRoughnessTexture/gu)?.length ?? 0, `${label} PBR sample count`)
        .toBe(features.has("metallicRoughnessTexture") ? 1 : 0);
      expect(source, `${label} specular occlusion`).toContain("iblSpecularOcclusion(NdotV, occlusion, roughness)");
      expect(source, `${label} single DFG evaluation`).toContain(
        "IblGgxScattering scattering = iblGgxScattering(f0, f90, environmentBrdf, NdotV);",
      );
      expect(source.match(/iblEnvironmentBrdf\(roughness, NdotV\)/gu)?.length, label).toBe(2);
      expect(source, `${label} energy-conserving diffuse`).toContain(
        "float diffuseEnergy = 1.0 - clamp(maxComponent(totalScattering), 0.0, 1.0);",
      );
      expect(source, `${label} scene-referred glTF emission`).toContain(
        "materialEmissiveColor() * GLTF_EMISSIVE_REFERENCE_NITS",
      );
      expect(source, `${label} output-independent glTF emission`).not.toContain(
        "u_toneMappingSettings.z > 0.5 ? GLTF_EMISSIVE_REFERENCE_NITS",
      );
      expect(source, `${label} multiscatter irradiance`).toContain(
        "+ cosineWeightedIrradiance * scattering.multi",
      );
      expect(samplerDeclarationCount(source), label).toBe(features.size);
      for (const feature of SURFACE_SHADER_TEXTURE_FEATURES) {
        expect(source.includes(samplerDeclarations[feature]), `${label} ${feature}`).toBe(features.has(feature));
      }
      expect(source.includes("uniform int u_baseColorUvSet;"), `${label} base color UV uniforms`)
        .toBe(features.has("baseColorTexture") || hasVirtualBaseColor);
      for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
        expect(
          source.includes(`uniform int ${descriptor.uvUniformStem}Set;`),
          `${label} ${descriptor.feature} UV uniforms`,
        ).toBe(features.has(descriptor.feature));
      }
      for (const invariant of virtualBaseColorSourceInvariants) {
        expect(source.includes(invariant), `${label} ${invariant}`).toBe(hasVirtualBaseColor);
      }
      expect(source.includes("residentPageMax"), `${label} NPOT page stretching`).toBe(false);
      expect(source.includes("atlasSlotMax"), `${label} interior half-texel clamp`).toBe(false);
      expect(source.includes("texture(u_normalTexture,"), `${label} base normal sampling`)
        .toBe(features.has("normalTexture"));
      expect(source.includes("texture(u_clearcoatNormalTexture,"), `${label} clearcoat normal sampling`)
        .toBe(features.has("clearcoatNormalTexture"));
      expect(source.includes("texture(u_anisotropyTexture,"), `${label} anisotropy sampling`)
        .toBe(features.has("anisotropyTexture"));
      expect(source.includes("texture(u_iblBrdfLut, vec2(NdotV, roughness)).rg"), label)
        .toBe(features.has("iblBrdfLut"));
    });
  });
});
