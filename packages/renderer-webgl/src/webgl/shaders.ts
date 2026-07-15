import { MAX_SURFACE_LIGHTS } from "./lights";
import surfaceFragmentTemplate from "./shaders/surface.frag";
import unlitFragmentTemplate from "./shaders/unlit.frag";
import surfaceVertexShaderSource from "./shaders/surface.vert";
import surfaceInstancedSplitVertexShaderSource from "./shaders/surface-instanced-split.vert";
import unlitVertexShaderSource from "./shaders/unlit.vert";
import unlitInstancedSplitVertexShaderSource from "./shaders/unlit-instanced-split.vert";
import wireframeFragmentShaderSource from "./shaders/wireframe.frag";
import wireframeVertexShaderSource from "./shaders/wireframe.vert";
import postprocessFragmentShaderSource from "./shaders/postprocess.frag";
import postprocessVertexShaderSource from "./shaders/postprocess.vert";

export type ProgramKind =
  | "surface"
  | "postprocess"
  | "surface-instanced-split"
  | "unlit"
  | "unlit-instanced-split"
  | "wireframe";

export const SURFACE_SHADER_TEXTURE_FEATURES = [
  "baseColorTexture",
  "baseColorVirtualTextureAtlas",
  "baseColorVirtualTexturePageTable",
  "emissiveTexture",
  "metallicRoughnessTexture",
  "normalTexture",
  "occlusionTexture",
  "anisotropyTexture",
  "specularTexture",
  "specularColorTexture",
  "clearcoatTexture",
  "clearcoatRoughnessTexture",
  "clearcoatNormalTexture",
  "diffuseTransmissionTexture",
  "diffuseTransmissionColorTexture",
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

export const surfaceShaderFeatureKey = (features: SurfaceShaderFeatures): string => {
  let key = "";
  for (const feature of SURFACE_SHADER_TEXTURE_FEATURES) {
    if (!hasSurfaceShaderFeature(features, feature)) continue;
    key += key === "" ? feature : `,${feature}`;
  }
  return key;
};

/** Allocation-free identity for the fixed surface sampler feature universe. */
export const surfaceShaderFeatureMask = (features: SurfaceShaderFeatures): number => {
  let mask = 0;
  for (let index = 0; index < SURFACE_SHADER_TEXTURE_FEATURES.length; index += 1) {
    if (features.has(SURFACE_SHADER_TEXTURE_FEATURES[index]!)) mask |= 1 << index;
  }
  return mask >>> 0;
};

const surfaceSamplerUniformDeclarations = (features: SurfaceShaderFeatures): string =>
  [
    hasSurfaceShaderFeature(features, "iblSpecularCube") ? "uniform samplerCube u_iblSpecularCube;" : "",
    hasSurfaceShaderFeature(features, "iblBrdfLut") ? "uniform sampler2D u_iblBrdfLut;" : "",
    hasSurfaceShaderFeature(features, "baseColorTexture") ? "uniform sampler2D u_texture;" : "",
    hasSurfaceShaderFeature(features, "baseColorVirtualTextureAtlas") ? "uniform sampler2D u_vtAtlas;" : "",
    hasSurfaceShaderFeature(features, "baseColorVirtualTexturePageTable") ? "uniform highp usampler2D u_vtPageTable;" : "",
    hasSurfaceShaderFeature(features, "emissiveTexture") ? "uniform sampler2D u_emissiveTexture;" : "",
    hasSurfaceShaderFeature(features, "metallicRoughnessTexture")
      ? "uniform sampler2D u_metallicRoughnessTexture;"
      : "",
    hasSurfaceShaderFeature(features, "normalTexture") ? "uniform sampler2D u_normalTexture;" : "",
    hasSurfaceShaderFeature(features, "occlusionTexture") ? "uniform sampler2D u_occlusionTexture;" : "",
    hasSurfaceShaderFeature(features, "anisotropyTexture") ? "uniform sampler2D u_anisotropyTexture;" : "",
    hasSurfaceShaderFeature(features, "specularTexture") ? "uniform sampler2D u_specularTexture;" : "",
    hasSurfaceShaderFeature(features, "specularColorTexture")
      ? "uniform sampler2D u_specularColorTexture;"
      : "",
    hasSurfaceShaderFeature(features, "clearcoatTexture") ? "uniform sampler2D u_clearcoatTexture;" : "",
    hasSurfaceShaderFeature(features, "clearcoatRoughnessTexture")
      ? "uniform sampler2D u_clearcoatRoughnessTexture;"
      : "",
    hasSurfaceShaderFeature(features, "clearcoatNormalTexture")
      ? "uniform sampler2D u_clearcoatNormalTexture;"
      : "",
    hasSurfaceShaderFeature(features, "diffuseTransmissionTexture")
      ? "uniform sampler2D u_diffuseTransmissionTexture;"
      : "",
    hasSurfaceShaderFeature(features, "diffuseTransmissionColorTexture")
      ? "uniform sampler2D u_diffuseTransmissionColorTexture;"
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
uniform vec2 u_vtAtlasPageUvSize;
uniform vec2 u_vtPageTableSize;
uniform float u_vtBorderPageRatio;
uniform vec2 u_vtVirtualPageScale;
uniform vec2 u_vtVirtualSize;
uniform int u_vtWrapS;
uniform int u_vtWrapT;`
    : "";

const surfaceBaseColorVirtualTextureFunctions = (features: SurfaceShaderFeatures): string =>
  hasSurfaceShaderVirtualBaseColor(features)
    ? `float wrapVirtualTextureCoord(float coord, int mode, float dimension) {
  if (mode == 1) {
    return fract(coord);
  }

  float halfTexel = 0.5 / max(dimension, 1.0);
  float edgeMaximum = max(halfTexel, 1.0 - halfTexel);
  if (mode == 2) {
    float mirrored = mod(coord, 2.0);
    if (mirrored < 0.0) {
      mirrored += 2.0;
    }

    float reflected = mirrored <= 1.0 ? mirrored : 2.0 - mirrored;
    return clamp(reflected, halfTexel, edgeMaximum);
  }

  return clamp(coord, halfTexel, edgeMaximum);
}

vec2 wrapVirtualTextureUv(vec2 uv) {
  return vec2(
    wrapVirtualTextureCoord(uv.x, u_vtWrapS, u_vtVirtualSize.x),
    wrapVirtualTextureCoord(uv.y, u_vtWrapT, u_vtVirtualSize.y)
  );
}

vec4 sampleVirtualBaseColor(vec2 uv) {
  vec2 wrappedUv = wrapVirtualTextureUv(uv);
  vec2 sourcePage = wrappedUv * u_vtVirtualPageScale;
  ivec2 pageCoord = min(
    ivec2(floor(sourcePage)),
    ivec2(u_vtPageTableSize) - ivec2(1)
  );
  uvec4 tableEntry = texelFetch(u_vtPageTable, pageCoord, 0);
  float residentMip = float(tableEntry.b);

  if (tableEntry.a == 0u) {
    return u_color;
  }

  vec2 atlasSlotCoord = vec2(tableEntry.rg);
  float residentCoverage = exp2(residentMip);
  vec2 residentLocalPageUv = fract(sourcePage / residentCoverage);
  float atlasCellPages = 1.0 + 2.0 * u_vtBorderPageRatio;
  vec2 atlasPageUv = atlasSlotCoord * atlasCellPages
    + vec2(u_vtBorderPageRatio)
    + residentLocalPageUv;
  vec2 atlasLocalUv = atlasPageUv * u_vtAtlasPageUvSize;

  return texture(u_vtAtlas, atlasLocalUv) * u_color;
}`
    : "";

const surfaceBaseColorExpression = (features: SurfaceShaderFeatures): string => {
  const fallback = "u_color";
  const ordinary = surfaceTextureExpression(
    features,
    "baseColorTexture",
    "texture(u_texture, materialTextureUv(u_baseColorUvSet, u_baseColorUvRow0, u_baseColorUvRow1))",
    fallback,
  );

  return hasSurfaceShaderVirtualBaseColor(features)
    ? "sampleVirtualBaseColor(materialTextureUv(u_baseColorUvSet, u_baseColorUvRow0, u_baseColorUvRow1))"
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
  if (kind === "postprocess") return postprocessVertexShaderSource;
  switch (kind) {
    case "wireframe":
      return wireframeVertexShaderSource;
    case "surface-instanced-split":
      return surfaceInstancedSplitVertexShaderSource;
    case "unlit-instanced-split":
      return unlitInstancedSplitVertexShaderSource;
    case "unlit":
      return unlitVertexShaderSource;
    case "surface":
      return surfaceVertexShaderSource;
  }
};

export const fragmentShaderSource = (
  kind: ProgramKind,
  surfaceFeatures: SurfaceShaderFeatures = ALL_SURFACE_SHADER_TEXTURE_FEATURES,
  clusteredLights = false,
): string => {
  if (kind === "postprocess") return postprocessFragmentShaderSource;
  switch (kind) {
    case "wireframe":
      return wireframeFragmentShaderSource;
    case "surface":
    case "surface-instanced-split":
      return surfaceFragmentShaderSource(surfaceFeatures, clusteredLights);
    case "unlit":
    case "unlit-instanced-split":
      return unlitFragmentShaderSource(surfaceFeatures);
  }
};

const unlitFragmentShaderSource = (features: SurfaceShaderFeatures): string =>
  assertNoShaderTokens(replaceShaderTokens(unlitFragmentTemplate, new Map([
    ["__SURFACE_SAMPLER_UNIFORMS__", surfaceSamplerUniformDeclarations(features)],
    ["__BASE_COLOR_VIRTUAL_TEXTURE_UNIFORMS__", surfaceBaseColorVirtualTextureUniforms(features)],
    ["__BASE_COLOR_VIRTUAL_TEXTURE_FUNCTIONS__", surfaceBaseColorVirtualTextureFunctions(features)],
    ["__BASE_COLOR_EXPR__", surfaceBaseColorExpression(features)],
  ])));

const clusteredLightUniforms = `uniform highp usampler2D u_clusterGrid;
uniform highp usampler2D u_clusterLightIndices;
uniform highp sampler2D u_clusterLightData;
uniform vec4 u_clusterDimensions;
uniform vec4 u_clusterDepth;
uniform vec2 u_clusterProjection;
uniform vec2 u_clusterViewportOrigin;`;

const clusteredLightFunctions = `uint clusteredLightIndex(uint linearIndex) {
  uint width = uint(max(u_clusterProjection.y, 1.0));
  return texelFetch(
    u_clusterLightIndices,
    ivec2(int(linearIndex % width), int(linearIndex / width)),
    0
  ).r;
}

vec3 clusteredLightContribution(vec3 normal, vec3 clearcoatNormal, vec3 viewDirection, vec3 worldPosition, vec3 baseColor) {
  ivec2 tile = ivec2(floor((gl_FragCoord.xy - u_clusterViewportOrigin) / max(u_clusterDimensions.w, 1.0)));
  tile = clamp(tile, ivec2(0), ivec2(u_clusterDimensions.xy) - ivec2(1));
  float viewDepth = max(-(u_view * vec4(worldPosition, 1.0)).z, u_clusterDepth.z);
  float depthCoordinate = u_clusterProjection.x > 0.5 ? viewDepth : log2(viewDepth);
  int zSlice = int(clamp(floor(depthCoordinate * u_clusterDepth.x + u_clusterDepth.y), 0.0, u_clusterDimensions.z - 1.0));
  int gridX = tile.x + tile.y * int(u_clusterDimensions.x);
  uvec2 offsetAndCount = texelFetch(u_clusterGrid, ivec2(gridX, zSlice), 0).rg;
  vec3 result = vec3(0.0);
  for (uint entry = 0u; entry < offsetAndCount.y; entry += 1u) {
    int lightIndex = int(clusteredLightIndex(offsetAndCount.x + entry));
    vec4 colorAndKind = texelFetch(u_clusterLightData, ivec2(0, lightIndex), 0);
    vec4 positionAndRange = texelFetch(u_clusterLightData, ivec2(1, lightIndex), 0);
    vec4 directionAndInner = texelFetch(u_clusterLightData, ivec2(2, lightIndex), 0);
    vec4 outer = texelFetch(u_clusterLightData, ivec2(3, lightIndex), 0);
    result += lightContributionData(
      int(colorAndKind.w + 0.5), colorAndKind.rgb, directionAndInner.xyz,
      positionAndRange.xyz, positionAndRange.w, directionAndInner.w, outer.x,
      normal, clearcoatNormal, viewDirection, worldPosition, baseColor
    );
  }
  return result;
}`;

const surfaceFragmentShaderSource = (features: SurfaceShaderFeatures, clusteredLights: boolean): string =>
  assertNoShaderTokens(replaceShaderTokens(surfaceFragmentTemplate, new Map([
    ["__MAX_SURFACE_LIGHTS__", String(MAX_SURFACE_LIGHTS)],
    ["__SURFACE_SAMPLER_UNIFORMS__", surfaceSamplerUniformDeclarations(features)],
    ["__CLUSTERED_LIGHT_UNIFORMS__", clusteredLights ? clusteredLightUniforms : ""],
    ["__CLUSTERED_LIGHT_FUNCTIONS__", clusteredLights
      ? clusteredLightFunctions
      : "vec3 clusteredLightContribution(vec3 normal, vec3 clearcoatNormal, vec3 viewDirection, vec3 worldPosition, vec3 baseColor) { return vec3(0.0); }"],
    ["__BASE_COLOR_VIRTUAL_TEXTURE_UNIFORMS__", surfaceBaseColorVirtualTextureUniforms(features)],
    ["__BASE_COLOR_VIRTUAL_TEXTURE_FUNCTIONS__", surfaceBaseColorVirtualTextureFunctions(features)],
    ["__ANISOTROPY_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "anisotropyTexture",
      "u_useAnisotropyTexture ? texture(u_anisotropyTexture, materialTextureUv(u_anisotropyUvSet, u_anisotropyUvRow0, u_anisotropyUvRow1)).rgb : vec3(1.0, 0.5, 1.0)",
      "vec3(1.0, 0.5, 1.0)",
    )],
    ["__ANISOTROPY_UV_EXPR__", surfaceTextureExpression(
      features,
      "anisotropyTexture",
      "materialTextureUv(u_anisotropyUvSet, u_anisotropyUvRow0, u_anisotropyUvRow1)",
      "v_uv0",
    )],
    ["__SPECULAR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "specularTexture",
      "u_useSpecularTexture ? texture(u_specularTexture, materialTextureUv(u_specularUvSet, u_specularUvRow0, u_specularUvRow1)).a : 1.0",
      "1.0",
    )],
    ["__SPECULAR_COLOR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "specularColorTexture",
      "u_useSpecularColorTexture ? texture(u_specularColorTexture, materialTextureUv(u_specularColorUvSet, u_specularColorUvRow0, u_specularColorUvRow1)).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__CLEARCOAT_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "clearcoatTexture",
      "u_useClearcoatTexture ? texture(u_clearcoatTexture, materialTextureUv(u_clearcoatUvSet, u_clearcoatUvRow0, u_clearcoatUvRow1)).r : 1.0",
      "1.0",
    )],
    ["__CLEARCOAT_ROUGHNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "clearcoatRoughnessTexture",
      "u_useClearcoatRoughnessTexture ? texture(u_clearcoatRoughnessTexture, materialTextureUv(u_clearcoatRoughnessUvSet, u_clearcoatRoughnessUvRow0, u_clearcoatRoughnessUvRow1)).g : 1.0",
      "1.0",
    )],
    ["__MATERIAL_CLEARCOAT_NORMAL_BODY__", surfaceFeatureBlock(
      features,
      "clearcoatNormalTexture",
      `if (!u_useClearcoatNormalTexture) {
  return geometricNormal;
}
vec2 normalUv = materialTextureUv(u_clearcoatNormalUvSet, u_clearcoatNormalUvRow0, u_clearcoatNormalUvRow1);
vec3 textureNormal = texture(u_clearcoatNormalTexture, normalUv).xyz * 2.0 - 1.0;
textureNormal.xy *= u_normalTextureSettings.y;
return materialTangentNormal(geometricNormal, textureNormal, normalUv);`,
      "return geometricNormal;",
    )],
    ["__DIFFUSE_TRANSMISSION_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "diffuseTransmissionTexture",
      "u_useDiffuseTransmissionTexture ? texture(u_diffuseTransmissionTexture, materialTextureUv(u_diffuseTransmissionUvSet, u_diffuseTransmissionUvRow0, u_diffuseTransmissionUvRow1)).a : 1.0",
      "1.0",
    )],
    ["__DIFFUSE_TRANSMISSION_COLOR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "diffuseTransmissionColorTexture",
      "u_useDiffuseTransmissionColorTexture ? texture(u_diffuseTransmissionColorTexture, materialTextureUv(u_diffuseTransmissionColorUvSet, u_diffuseTransmissionColorUvRow0, u_diffuseTransmissionColorUvRow1)).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__SHEEN_COLOR_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "sheenColorTexture",
      "u_useSheenColorTexture ? texture(u_sheenColorTexture, materialTextureUv(u_sheenColorUvSet, u_sheenColorUvRow0, u_sheenColorUvRow1)).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__SHEEN_ROUGHNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "sheenRoughnessTexture",
      "u_useSheenRoughnessTexture ? texture(u_sheenRoughnessTexture, materialTextureUv(u_sheenRoughnessUvSet, u_sheenRoughnessUvRow0, u_sheenRoughnessUvRow1)).a : 1.0",
      "1.0",
    )],
    ["__IRIDESCENCE_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "iridescenceTexture",
      "u_useIridescenceTexture ? texture(u_iridescenceTexture, materialTextureUv(u_iridescenceUvSet, u_iridescenceUvRow0, u_iridescenceUvRow1)).r : 1.0",
      "1.0",
    )],
    ["__IRIDESCENCE_THICKNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "iridescenceThicknessTexture",
      "u_useIridescenceThicknessTexture ? texture(u_iridescenceThicknessTexture, materialTextureUv(u_iridescenceThicknessUvSet, u_iridescenceThicknessUvRow0, u_iridescenceThicknessUvRow1)).g : 1.0",
      "1.0",
    )],
    ["__MATERIAL_TRANSMISSION_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "materialTransmissionTexture",
      "u_useMaterialTransmissionTexture ? texture(u_materialTransmissionTexture, materialTextureUv(u_materialTransmissionUvSet, u_materialTransmissionUvRow0, u_materialTransmissionUvRow1)).r : 1.0",
      "1.0",
    )],
    ["__THICKNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "thicknessTexture",
      "u_useThicknessTexture ? texture(u_thicknessTexture, materialTextureUv(u_thicknessUvSet, u_thicknessUvRow0, u_thicknessUvRow1)).g : 1.0",
      "1.0",
    )],
    ["__METALLIC_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "metallicRoughnessTexture",
      "u_useMetallicRoughnessTexture ? texture(u_metallicRoughnessTexture, materialTextureUv(u_metallicRoughnessUvSet, u_metallicRoughnessUvRow0, u_metallicRoughnessUvRow1)).b : 1.0",
      "1.0",
    )],
    ["__ROUGHNESS_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "metallicRoughnessTexture",
      "u_useMetallicRoughnessTexture ? texture(u_metallicRoughnessTexture, materialTextureUv(u_metallicRoughnessUvSet, u_metallicRoughnessUvRow0, u_metallicRoughnessUvRow1)).g : 1.0",
      "1.0",
    )],
    ["__EMISSIVE_TEXTURE_EXPR__", surfaceTextureExpression(
      features,
      "emissiveTexture",
      "u_useEmissiveTexture ? texture(u_emissiveTexture, materialTextureUv(u_emissiveUvSet, u_emissiveUvRow0, u_emissiveUvRow1)).rgb : vec3(1.0)",
      "vec3(1.0)",
    )],
    ["__MATERIAL_OCCLUSION_BODY__", surfaceFeatureBlock(
      features,
      "occlusionTexture",
      `if (!u_useOcclusionTexture) {
  return 1.0;
}
float strength = clamp(u_occlusionSettings.x, 0.0, 1.0);
return mix(1.0, texture(u_occlusionTexture, materialTextureUv(u_occlusionUvSet, u_occlusionUvRow0, u_occlusionUvRow1)).r, strength);`,
      "return 1.0;",
    )],
    ["__MATERIAL_NORMAL_BODY__", surfaceFeatureBlock(
      features,
      "normalTexture",
      `if (!u_useNormalTexture) {
  return geometricNormal;
}
vec2 normalUv = materialTextureUv(u_normalUvSet, u_normalUvRow0, u_normalUvRow1);
vec3 textureNormal = texture(u_normalTexture, normalUv).xyz * 2.0 - 1.0;
textureNormal.xy *= u_normalTextureSettings.x;
return materialTangentNormal(geometricNormal, textureNormal, normalUv);`,
      "return geometricNormal;",
    )],
    ["__MATERIAL_TRANSMISSION_SCREEN_BODY__", surfaceFeatureBlock(
      features,
      "transmissionScreenTexture",
      `vec2 screenUv = clamp((gl_FragCoord.xy - u_viewportOrigin) / max(u_viewportSize, vec2(1.0)), vec2(0.0), vec2(1.0));
vec4 screenSample = texture(u_transmissionScreenTexture, screenUv);
vec3 environmentFallback = iblDiffuseIrradiance(-normal) / PI;
vec3 screenRadiance = mix(environmentFallback, screenSample.rgb, screenSample.a);
float dispersion = max(u_dispersionFactors.x, 0.0);
if (dispersion <= 0.0) {
  return screenRadiance * baseColor * materialVolumeAttenuation();
}
vec3 iors = materialDispersionIors(u_materialExtensionFactors.y, dispersion);
vec2 direction = materialDispersionDirection(normal, viewDirection);
float thickness = materialThicknessFactor();
float offsetScale = clamp(max(thickness, 0.0) * 0.25, 0.0, 0.08);
vec2 redUv = clamp(screenUv - direction * max(iors.g - iors.r, 0.0) * offsetScale, vec2(0.0), vec2(1.0));
vec2 blueUv = clamp(screenUv + direction * max(iors.b - iors.g, 0.0) * offsetScale, vec2(0.0), vec2(1.0));
vec3 transmitted = vec3(
  texture(u_transmissionScreenTexture, redUv).r,
  screenRadiance.g,
  texture(u_transmissionScreenTexture, blueUv).b
);
transmitted = mix(environmentFallback, transmitted, screenSample.a);
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
float lod = roughness * max(mipCount - 1.0, 0.0);
vec3 radiance = iblDecodeSpecularRadiance(textureLod(u_iblSpecularCube, direction, lod));
return radiance * u_iblSpecularSettings.y;`,
      "return vec3(0.0);",
    )],
    ["__BASE_COLOR_EXPR__", surfaceBaseColorExpression(features)],
  ])));
