import { MAX_SURFACE_LIGHTS } from "./lights";
import surfaceFragmentTemplate from "./shaders/surface.frag";
import surfaceVertexShaderSource from "./shaders/surface.vert";
import surfaceInstancedSplitVertexShaderSource from "./shaders/surface-instanced-split.vert";
import wireframeFragmentShaderSource from "./shaders/wireframe.frag";
import wireframeVertexShaderSource from "./shaders/wireframe.vert";

export type ProgramKind =
  | "surface"
  | "surface-instanced-split"
  | "wireframe";

export const SURFACE_SHADER_TEXTURE_FEATURES = [
  "baseColorTexture",
  "baseColorVirtualTextureAtlas",
  "baseColorVirtualTexturePageTable",
  "emissiveTexture",
  "metallicRoughnessTexture",
  "normalTexture",
  "occlusionTexture",
  "specularTexture",
  "specularColorTexture",
  "clearcoatTexture",
  "clearcoatRoughnessTexture",
  "sheenColorTexture",
  "sheenRoughnessTexture",
  "iridescenceTexture",
  "iridescenceThicknessTexture",
  "materialTransmissionTexture",
  "thicknessTexture",
  "transmissionScreenTexture",
  "iblSpecularCube",
  "iblBrdfLut",
] as const;

export type SurfaceShaderTextureFeature = typeof SURFACE_SHADER_TEXTURE_FEATURES[number];
export type SurfaceShaderFeatures = ReadonlySet<SurfaceShaderTextureFeature>;

const ALL_SURFACE_SHADER_TEXTURE_FEATURES: SurfaceShaderFeatures = new Set(SURFACE_SHADER_TEXTURE_FEATURES);

const hasSurfaceShaderFeature = (
  features: SurfaceShaderFeatures,
  feature: SurfaceShaderTextureFeature,
): boolean => features.has(feature);

const hasSurfaceShaderVirtualBaseColor = (features: SurfaceShaderFeatures): boolean =>
  hasSurfaceShaderFeature(features, "baseColorVirtualTextureAtlas")
  && hasSurfaceShaderFeature(features, "baseColorVirtualTexturePageTable");

export const surfaceShaderFeatureKey = (features: SurfaceShaderFeatures): string =>
  SURFACE_SHADER_TEXTURE_FEATURES
    .filter((feature) => hasSurfaceShaderFeature(features, feature))
    .join(",");

const surfaceSamplerUniformDeclarations = (features: SurfaceShaderFeatures): string =>
  [
    hasSurfaceShaderFeature(features, "iblSpecularCube") ? "uniform samplerCube u_iblSpecularCube;" : "",
    hasSurfaceShaderFeature(features, "iblBrdfLut") ? "uniform sampler2D u_iblBrdfLut;" : "",
    hasSurfaceShaderFeature(features, "baseColorTexture") ? "uniform sampler2D u_texture;" : "",
    hasSurfaceShaderFeature(features, "baseColorVirtualTextureAtlas") ? "uniform sampler2D u_vtAtlas;" : "",
    hasSurfaceShaderFeature(features, "baseColorVirtualTexturePageTable") ? "uniform sampler2D u_vtPageTable;" : "",
    hasSurfaceShaderFeature(features, "emissiveTexture") ? "uniform sampler2D u_emissiveTexture;" : "",
    hasSurfaceShaderFeature(features, "metallicRoughnessTexture")
      ? "uniform sampler2D u_metallicRoughnessTexture;"
      : "",
    hasSurfaceShaderFeature(features, "normalTexture") ? "uniform sampler2D u_normalTexture;" : "",
    hasSurfaceShaderFeature(features, "occlusionTexture") ? "uniform sampler2D u_occlusionTexture;" : "",
    hasSurfaceShaderFeature(features, "specularTexture") ? "uniform sampler2D u_specularTexture;" : "",
    hasSurfaceShaderFeature(features, "specularColorTexture")
      ? "uniform sampler2D u_specularColorTexture;"
      : "",
    hasSurfaceShaderFeature(features, "clearcoatTexture") ? "uniform sampler2D u_clearcoatTexture;" : "",
    hasSurfaceShaderFeature(features, "clearcoatRoughnessTexture")
      ? "uniform sampler2D u_clearcoatRoughnessTexture;"
      : "",
    hasSurfaceShaderFeature(features, "sheenColorTexture") ? "uniform sampler2D u_sheenColorTexture;" : "",
    hasSurfaceShaderFeature(features, "sheenRoughnessTexture")
      ? "uniform sampler2D u_sheenRoughnessTexture;"
      : "",
    hasSurfaceShaderFeature(features, "iridescenceTexture")
      ? "uniform sampler2D u_iridescenceTexture;"
      : "",
    hasSurfaceShaderFeature(features, "iridescenceThicknessTexture")
      ? "uniform sampler2D u_iridescenceThicknessTexture;"
      : "",
    hasSurfaceShaderFeature(features, "materialTransmissionTexture")
      ? "uniform sampler2D u_materialTransmissionTexture;"
      : "",
    hasSurfaceShaderFeature(features, "thicknessTexture") ? "uniform sampler2D u_thicknessTexture;" : "",
    hasSurfaceShaderFeature(features, "transmissionScreenTexture")
      ? "uniform sampler2D u_transmissionScreenTexture;"
      : "",
  ].filter((declaration) => declaration.length > 0).join("\n");

const surfaceTextureExpression = (
  features: SurfaceShaderFeatures,
  feature: SurfaceShaderTextureFeature,
  expression: string,
  fallback: string,
): string => hasSurfaceShaderFeature(features, feature) ? expression : fallback;

const surfaceFeatureBlock = (
  features: SurfaceShaderFeatures,
  feature: SurfaceShaderTextureFeature,
  block: string,
  fallback: string,
): string => hasSurfaceShaderFeature(features, feature) ? block : fallback;

const surfaceBaseColorVirtualTextureUniforms = (features: SurfaceShaderFeatures): string =>
  hasSurfaceShaderVirtualBaseColor(features)
    ? `uniform bool u_useVirtualTexture;
uniform vec2 u_vtAtlasGrid;
uniform vec2 u_vtPageTableSize;
uniform int u_vtWrapS;
uniform int u_vtWrapT;`
    : "";

const surfaceBaseColorVirtualTextureFunctions = (features: SurfaceShaderFeatures): string =>
  hasSurfaceShaderVirtualBaseColor(features)
    ? `float wrapVirtualTextureCoord(float coord, int mode) {
  if (mode == 1) {
    return fract(coord);
  }

  if (mode == 2) {
    float mirrored = mod(coord, 2.0);
    if (mirrored < 0.0) {
      mirrored += 2.0;
    }

    return min(mirrored <= 1.0 ? mirrored : 2.0 - mirrored, 0.999999);
  }

  return clamp(coord, 0.0, 0.999999);
}

vec2 wrapVirtualTextureUv(vec2 uv) {
  return vec2(
    wrapVirtualTextureCoord(uv.x, u_vtWrapS),
    wrapVirtualTextureCoord(uv.y, u_vtWrapT)
  );
}

vec4 sampleVirtualBaseColor(vec2 uv) {
  vec2 wrappedUv = wrapVirtualTextureUv(uv);
  vec2 pageCoord = floor(wrappedUv * u_vtPageTableSize);
  vec4 tableEntry = texture(
    u_vtPageTable,
    (pageCoord + vec2(0.5)) / u_vtPageTableSize
  );
  float encodedSlot = floor(tableEntry.r * 255.0 + 0.5)
    + floor(tableEntry.g * 255.0 + 0.5) * 256.0;
  float fallbackMipOffset = floor(tableEntry.b * 255.0 + 0.5);
  // tableEntry.a is reserved for future page-table flags/addressing.

  if (encodedSlot < 1.0) {
    return u_color;
  }

  float slot = encodedSlot - 1.0;
  vec2 atlasSlotCoord = vec2(mod(slot, u_vtAtlasGrid.x), floor(slot / u_vtAtlasGrid.x));
  vec2 residentPageTableSize = max(
    vec2(1.0),
    floor(u_vtPageTableSize / exp2(fallbackMipOffset))
  );
  vec2 localUv = fract(wrappedUv * residentPageTableSize);
  vec2 atlasUv = (atlasSlotCoord + localUv) / u_vtAtlasGrid;

  return texture(u_vtAtlas, atlasUv) * u_color;
}`
    : "";

const surfaceBaseColorExpression = (features: SurfaceShaderFeatures): string => {
  const fallback = "u_color";
  const ordinary = surfaceTextureExpression(
    features,
    "baseColorTexture",
    "u_useTexture ? texture(u_texture, v_uv) : u_color",
    fallback,
  );

  return hasSurfaceShaderVirtualBaseColor(features)
    ? `u_useVirtualTexture ? sampleVirtualBaseColor(v_uv) : (${ordinary})`
    : ordinary;
};

const replaceShaderTokens = (source: string, replacements: ReadonlyMap<string, string>): string => {
  let next = source;
  for (const [token, value] of replacements) {
    next = next.replaceAll(token, value);
  }

  return next;
};

const assertNoShaderTokens = (source: string): string => {
  const token = source.match(/__[A-Z0-9_]+__/u)?.[0];
  if (token !== undefined) {
    throw new Error(`Unreplaced shader token: ${token}`);
  }

  return source;
};

export const vertexShaderSource = (kind: ProgramKind): string => {
  switch (kind) {
    case "wireframe":
      return wireframeVertexShaderSource;
    case "surface-instanced-split":
      return surfaceInstancedSplitVertexShaderSource;
    case "surface":
      return surfaceVertexShaderSource;
  }
};

export const fragmentShaderSource = (
  kind: ProgramKind,
  surfaceFeatures: SurfaceShaderFeatures = ALL_SURFACE_SHADER_TEXTURE_FEATURES,
): string => {
  switch (kind) {
    case "wireframe":
      return wireframeFragmentShaderSource;
    case "surface":
    case "surface-instanced-split":
      return surfaceFragmentShaderSource(surfaceFeatures);
  }
};

const surfaceFragmentShaderSource = (features: SurfaceShaderFeatures): string =>
  assertNoShaderTokens(replaceShaderTokens(surfaceFragmentTemplate, new Map([
    ["__MAX_SURFACE_LIGHTS__", String(MAX_SURFACE_LIGHTS)],
    ["__SURFACE_SAMPLER_UNIFORMS__", surfaceSamplerUniformDeclarations(features)],
    ["__BASE_COLOR_VIRTUAL_TEXTURE_UNIFORMS__", surfaceBaseColorVirtualTextureUniforms(features)],
    ["__BASE_COLOR_VIRTUAL_TEXTURE_FUNCTIONS__", surfaceBaseColorVirtualTextureFunctions(features)],
    ["__SPECULAR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "specularTexture",
      "u_useSpecularTexture ? texture(u_specularTexture, v_uv).a : 1.0",
      "1.0",
    )],
    ["__SPECULAR_COLOR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "specularColorTexture",
      "u_useSpecularColorTexture ? texture(u_specularColorTexture, v_uv).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__CLEARCOAT_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "clearcoatTexture",
      "u_useClearcoatTexture ? texture(u_clearcoatTexture, v_uv).r : 1.0",
      "1.0",
    )],
    ["__CLEARCOAT_ROUGHNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "clearcoatRoughnessTexture",
      "u_useClearcoatRoughnessTexture ? texture(u_clearcoatRoughnessTexture, v_uv).g : 1.0",
      "1.0",
    )],
    ["__SHEEN_COLOR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "sheenColorTexture",
      "u_useSheenColorTexture ? texture(u_sheenColorTexture, v_uv).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__SHEEN_ROUGHNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "sheenRoughnessTexture",
      "u_useSheenRoughnessTexture ? texture(u_sheenRoughnessTexture, v_uv).a : 1.0",
      "1.0",
    )],
    ["__IRIDESCENCE_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "iridescenceTexture",
      "u_useIridescenceTexture ? texture(u_iridescenceTexture, v_uv).r : 1.0",
      "1.0",
    )],
    ["__IRIDESCENCE_THICKNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "iridescenceThicknessTexture",
      "u_useIridescenceThicknessTexture ? texture(u_iridescenceThicknessTexture, v_uv).g : 1.0",
      "1.0",
    )],
    ["__MATERIAL_TRANSMISSION_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "materialTransmissionTexture",
      "u_useMaterialTransmissionTexture ? texture(u_materialTransmissionTexture, v_uv).r : 1.0",
      "1.0",
    )],
    ["__THICKNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "thicknessTexture",
      "u_useThicknessTexture ? texture(u_thicknessTexture, v_uv).g : 1.0",
      "1.0",
    )],
    ["__METALLIC_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "metallicRoughnessTexture",
      "u_useMetallicRoughnessTexture ? texture(u_metallicRoughnessTexture, v_uv).b : 1.0",
      "1.0",
    )],
    ["__ROUGHNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "metallicRoughnessTexture",
      "u_useMetallicRoughnessTexture ? texture(u_metallicRoughnessTexture, v_uv).g : 1.0",
      "1.0",
    )],
    ["__EMISSIVE_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "emissiveTexture",
      "u_useEmissiveTexture ? texture(u_emissiveTexture, v_emissive_uv).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__MATERIAL_OCCLUSION_BODY__", surfaceFeatureBlock(
      features,
      "occlusionTexture",
      `if (!u_useOcclusionTexture) {
  return 1.0;
}
float strength = clamp(u_occlusionSettings.x, 0.0, 1.0);
return mix(1.0, texture(u_occlusionTexture, v_uv).r, strength);`,
      "return 1.0;",
    )],
    ["__MATERIAL_NORMAL_BODY__", surfaceFeatureBlock(
      features,
      "normalTexture",
      `if (!u_useNormalTexture) {
  return geometricNormal;
}
vec3 textureNormal = texture(u_normalTexture, v_uv).xyz * 2.0 - 1.0;
textureNormal.xy *= u_normalTextureSettings.x;
vec3 normal = normalize(geometricNormal);
vec3 tangent = materialGeometryTangent(normal);
vec3 bitangent = normalize(cross(normal, tangent)) * (v_tangent.w < 0.0 ? -1.0 : 1.0);
return normalize(tangent * textureNormal.x + bitangent * textureNormal.y + normal * textureNormal.z);`,
      "return geometricNormal;",
    )],
    ["__MATERIAL_TRANSMISSION_SCREEN_BODY__", surfaceFeatureBlock(
      features,
      "transmissionScreenTexture",
      `vec2 screenUv = clamp(gl_FragCoord.xy / max(u_viewportSize, vec2(1.0)), vec2(0.0), vec2(1.0));
float dispersion = max(u_dispersionFactors.x, 0.0);
if (dispersion <= 0.0) {
  return texture(u_transmissionScreenTexture, screenUv).rgb * baseColor * materialVolumeAttenuation();
}
vec3 iors = materialDispersionIors(u_materialExtensionFactors.y, dispersion);
vec2 direction = materialDispersionDirection(normal, viewDirection);
float thickness = materialThicknessFactor();
float offsetScale = clamp(max(thickness, 0.0) * 0.25, 0.0, 0.08);
vec2 redUv = clamp(screenUv - direction * max(iors.g - iors.r, 0.0) * offsetScale, vec2(0.0), vec2(1.0));
vec2 blueUv = clamp(screenUv + direction * max(iors.b - iors.g, 0.0) * offsetScale, vec2(0.0), vec2(1.0));
vec3 transmitted = vec3(
  texture(u_transmissionScreenTexture, redUv).r,
  texture(u_transmissionScreenTexture, screenUv).g,
  texture(u_transmissionScreenTexture, blueUv).b
);
return transmitted * baseColor * materialVolumeAttenuation();`,
      "return baseColor * materialVolumeAttenuation();",
    )],
    ["__IBL_BRDF_LUT_BODY__", surfaceFeatureBlock(
      features,
      "iblBrdfLut",
      `if (u_useIblBrdfLut) {
  return texture(u_iblBrdfLut, vec2(NdotV, roughness)).rg;
}`,
      "",
    )],
    ["__IBL_SPECULAR_RADIANCE_BODY__", surfaceFeatureBlock(
      features,
      "iblSpecularCube",
      `if (!u_useIblSpecular) {
  return vec3(0.0);
}
vec3 reflection = normalize(reflect(-viewDirection, normal));
vec3 direction = normalize((u_iblWorldToIbl * vec4(reflection, 0.0)).xyz);
float mipCount = max(u_iblSpecularSettings.z, 1.0);
float roughness = materialRoughnessFactor();
float lod = roughness * max(mipCount - 1.0, 0.0);
float NdotV = max(dot(normal, viewDirection), 0.0);
vec3 radiance = iblDecodeSpecularRadiance(textureLod(u_iblSpecularCube, direction, lod));
return radiance * iblSpecularBrdf(baseColor, roughness, NdotV) * u_iblSpecularSettings.y;`,
      "return vec3(0.0);",
    )],
    ["__BASE_COLOR_EXPR__", surfaceBaseColorExpression(features)],
  ])));
