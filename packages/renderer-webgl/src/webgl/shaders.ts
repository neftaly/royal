import { MAX_SURFACE_LIGHTS } from "./lights";

export type ProgramKind =
  | "surface"
  | "surface-instanced-split"
  | "surface-vt-base-color"
  | "wireframe";

export const vertexShaderSource = (kind: ProgramKind): string => {
  if (kind === "wireframe") {
    return `#version 300 es
in vec3 a_position;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
void main() {
gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`;
  }

  if (kind === "surface-vt-base-color") {
    return `#version 300 es
in vec3 a_position;
in vec2 a_uv;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec2 v_uv;
void main() {
v_uv = a_uv;
gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`;
  }

  if (kind === "surface-instanced-split") {
    return `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec4 a_tangent;
in vec2 a_uv;
in vec2 a_emissive_uv;
in vec4 a_color;
layout(location = 3) in mat4 a_instanceLocalModel;
layout(location = 7) in vec3 a_instancePosition;
layout(location = 8) in vec3 a_instanceRotation;
layout(location = 9) in vec3 a_instanceScale;
uniform mat4 u_projection;
uniform mat4 u_view;
out vec3 v_normal;
out vec4 v_tangent;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec2 v_emissive_uv;
out vec4 v_color;
vec3 rotateX(vec3 value, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return vec3(value.x, value.y * c - value.z * s, value.y * s + value.z * c);
}
vec3 rotateY(vec3 value, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return vec3(value.x * c + value.z * s, value.y, -value.x * s + value.z * c);
}
vec3 rotateZ(vec3 value, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return vec3(value.x * c - value.y * s, value.x * s + value.y * c, value.z);
}
vec3 transformRootPoint(vec3 value) {
  vec3 scaled = value * a_instanceScale;
  vec3 rotated = rotateZ(rotateY(rotateX(scaled, a_instanceRotation.x), a_instanceRotation.y), a_instanceRotation.z);
  return rotated + a_instancePosition;
}
vec3 transformRootVector(vec3 value) {
  vec3 scaled = value * a_instanceScale;
  return rotateZ(rotateY(rotateX(scaled, a_instanceRotation.x), a_instanceRotation.y), a_instanceRotation.z);
}
void main() {
vec4 localPosition = a_instanceLocalModel * vec4(a_position, 1.0);
vec3 worldPosition = transformRootPoint(localPosition.xyz);
v_normal = transformRootVector(mat3(a_instanceLocalModel) * a_normal);
v_tangent = vec4(transformRootVector(mat3(a_instanceLocalModel) * a_tangent.xyz), a_tangent.w);
v_worldPosition = worldPosition;
v_uv = a_uv;
v_emissive_uv = a_emissive_uv;
v_color = a_color;
gl_Position = u_projection * u_view * vec4(worldPosition, localPosition.w);
}`;
  }

  return `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec4 a_tangent;
in vec2 a_uv;
in vec2 a_emissive_uv;
in vec4 a_color;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec3 v_normal;
out vec4 v_tangent;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec2 v_emissive_uv;
out vec4 v_color;
void main() {
vec4 worldPosition = u_model * vec4(a_position, 1.0);
v_normal = mat3(u_model) * a_normal;
v_tangent = vec4(mat3(u_model) * a_tangent.xyz, a_tangent.w);
v_worldPosition = worldPosition.xyz;
v_uv = a_uv;
v_emissive_uv = a_emissive_uv;
v_color = a_color;
gl_Position = u_projection * u_view * worldPosition;
}`;
};


export const fragmentShaderSource = (kind: ProgramKind): string => {
  if (kind === "wireframe") {
    return `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
    outColor = u_color;
}`;
  }

  if (kind === "surface-vt-base-color") {
    return `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec4 u_color;
uniform sampler2D u_vtAtlas;
uniform sampler2D u_vtPageTable;
uniform vec2 u_vtAtlasGrid;
uniform vec2 u_vtPageTableSize;
uniform int u_vtWrapS;
uniform int u_vtWrapT;
out vec4 outColor;
float wrapVirtualTextureCoord(float coord, int mode) {
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
void main() {
vec2 uv = wrapVirtualTextureUv(v_uv);
vec2 page = floor(uv * u_vtPageTableSize);
vec4 tableEntry = texture(u_vtPageTable, (page + vec2(0.5)) / u_vtPageTableSize);
float encodedSlot = floor(tableEntry.r * 255.0 + 0.5)
  + floor(tableEntry.g * 255.0 + 0.5) * 256.0;
float fallbackMipOffset = floor(tableEntry.b * 255.0 + 0.5);
if (encodedSlot < 1.0) {
  outColor = u_color;
  return;
}
float slot = encodedSlot - 1.0;
vec2 slotCoord = vec2(mod(slot, u_vtAtlasGrid.x), floor(slot / u_vtAtlasGrid.x));
vec2 residentPageTableSize = max(vec2(1.0), floor(u_vtPageTableSize / exp2(fallbackMipOffset)));
vec2 localUv = fract(uv * residentPageTableSize);
vec2 atlasUv = (slotCoord + localUv) / u_vtAtlasGrid;
outColor = texture(u_vtAtlas, atlasUv) * u_color;
}`;
  }

  return `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec4 v_tangent;
in vec3 v_worldPosition;
in vec2 v_uv;
in vec2 v_emissive_uv;
in vec4 v_color;
#define MAX_SURFACE_LIGHTS ${MAX_SURFACE_LIGHTS}
uniform highp mat4 u_view;
uniform bool u_useTexture;
uniform bool u_useEmissiveTexture;
uniform bool u_useMetallicRoughnessTexture;
uniform bool u_useNormalTexture;
uniform bool u_useOcclusionTexture;
uniform bool u_useSpecularTexture;
uniform bool u_useSpecularColorTexture;
uniform bool u_useClearcoatTexture;
uniform bool u_useClearcoatRoughnessTexture;
uniform bool u_useSheenColorTexture;
uniform bool u_useSheenRoughnessTexture;
uniform bool u_useIridescenceTexture;
uniform bool u_useIridescenceThicknessTexture;
uniform bool u_useMaterialTransmissionTexture;
uniform bool u_useThicknessTexture;
uniform bool u_unlit;
uniform vec4 u_color;
uniform vec4 u_alphaSettings;
uniform vec4 u_emissiveColor;
uniform int u_surfaceLightCount;
uniform int u_surfaceLightKind[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightColor[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightDirection[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightPosition[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightCone[MAX_SURFACE_LIGHTS];
uniform bool u_useIblIrradiance;
uniform vec4 u_iblIrradianceCoefficients[9];
uniform vec4 u_iblIrradianceSettings;
uniform mat4 u_iblWorldToIbl;
uniform bool u_useIblSpecular;
uniform vec4 u_iblSpecularSettings;
uniform samplerCube u_iblSpecularCube;
uniform sampler2D u_texture;
uniform sampler2D u_emissiveTexture;
uniform sampler2D u_metallicRoughnessTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_occlusionTexture;
uniform sampler2D u_specularTexture;
uniform sampler2D u_specularColorTexture;
uniform sampler2D u_clearcoatTexture;
uniform sampler2D u_clearcoatRoughnessTexture;
uniform sampler2D u_sheenColorTexture;
uniform sampler2D u_sheenRoughnessTexture;
uniform sampler2D u_iridescenceTexture;
uniform sampler2D u_iridescenceThicknessTexture;
uniform sampler2D u_materialTransmissionTexture;
uniform sampler2D u_thicknessTexture;
uniform sampler2D u_transmissionScreenTexture;
uniform vec4 u_materialPbrFactors;
uniform vec4 u_normalTextureSettings;
uniform vec4 u_occlusionSettings;
uniform vec4 u_specularColorFactor;
uniform vec4 u_materialExtensionFactors;
uniform vec4 u_anisotropyFactors;
uniform vec4 u_diffuseTransmissionFactors;
uniform vec4 u_sheenColorFactor;
uniform vec4 u_iridescenceFactors;
uniform vec4 u_dispersionFactors;
uniform vec4 u_attenuationColorFactor;
uniform vec4 u_transmissionVolumeFactors;
uniform vec2 u_viewportSize;
uniform bool u_useTransmissionTexture;
out vec4 outColor;
const float PI = 3.141592653589793;
float maxComponent(vec3 value) {
return max(max(value.r, value.g), value.b);
}
float fresnelPow(float cosTheta) {
return pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
float iorF0(float ior) {
if (ior <= 0.0) {
  return 1.0;
}
float safeIor = max(ior, 1.0);
float reflectance = (safeIor - 1.0) / (safeIor + 1.0);
return reflectance * reflectance;
}
float materialSpecularFactor() {
float textureSpecular = u_useSpecularTexture ? texture(u_specularTexture, v_uv).a : 1.0;
return clamp(u_materialExtensionFactors.x * textureSpecular, 0.0, 1.0);
}
vec3 materialSpecularColorFactor() {
vec3 textureSpecularColor = u_useSpecularColorTexture ? texture(u_specularColorTexture, v_uv).rgb : vec3(1.0);
return max(u_specularColorFactor.rgb * textureSpecularColor, vec3(0.0));
}
float materialClearcoatFactor() {
float textureClearcoat = u_useClearcoatTexture ? texture(u_clearcoatTexture, v_uv).r : 1.0;
return clamp(u_materialExtensionFactors.z * textureClearcoat, 0.0, 1.0);
}
float materialClearcoatRoughnessFactor() {
float textureRoughness = u_useClearcoatRoughnessTexture ? texture(u_clearcoatRoughnessTexture, v_uv).g : 1.0;
return clamp(u_materialExtensionFactors.w * textureRoughness, 0.0, 1.0);
}
vec3 materialSheenColor() {
vec3 textureSheenColor = u_useSheenColorTexture ? texture(u_sheenColorTexture, v_uv).rgb : vec3(1.0);
return max(u_sheenColorFactor.rgb * textureSheenColor, vec3(0.0));
}
float materialSheenRoughness() {
float textureRoughness = u_useSheenRoughnessTexture ? texture(u_sheenRoughnessTexture, v_uv).a : 1.0;
return clamp(u_sheenColorFactor.a * textureRoughness, 0.0, 1.0);
}
float materialIridescenceFactor() {
float textureIridescence = u_useIridescenceTexture ? texture(u_iridescenceTexture, v_uv).r : 1.0;
return clamp(u_iridescenceFactors.x * textureIridescence, 0.0, 1.0);
}
float materialIridescenceThickness() {
float minimumThickness = max(u_iridescenceFactors.z, 0.0);
float maximumThickness = max(u_iridescenceFactors.w, 0.0);
float textureThickness = u_useIridescenceThicknessTexture ? texture(u_iridescenceThicknessTexture, v_uv).g : 1.0;
return mix(minimumThickness, maximumThickness, clamp(textureThickness, 0.0, 1.0));
}
float materialTransmissionFactor() {
float textureTransmission = u_useMaterialTransmissionTexture ? texture(u_materialTransmissionTexture, v_uv).r : 1.0;
return clamp(u_transmissionVolumeFactors.x * textureTransmission, 0.0, 1.0);
}
float materialThicknessFactor() {
float textureThickness = u_useThicknessTexture ? texture(u_thicknessTexture, v_uv).g : 1.0;
return max(u_transmissionVolumeFactors.y * textureThickness, 0.0);
}
vec3 materialIridescenceTint(float cosTheta) {
float strength = materialIridescenceFactor();
if (strength <= 0.0) {
  return vec3(1.0);
}
float filmIor = max(u_iridescenceFactors.y, 1.0);
float thickness = materialIridescenceThickness();
float phase = thickness * (0.015 + 0.012 * (filmIor - 1.0)) + (1.0 - cosTheta) * (2.0 + 2.0 * filmIor);
vec3 filmBands = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.09439510239, 4.18879020479));
float filmReflectance = clamp(iorF0(filmIor) * 8.0, 0.0, 1.0);
vec3 filmTint = mix(vec3(1.0), 0.35 + 1.15 * filmBands, filmReflectance);
return mix(vec3(1.0), filmTint, strength);
}
float materialMetallicFactor() {
float textureMetallic = u_useMetallicRoughnessTexture ? texture(u_metallicRoughnessTexture, v_uv).b : 1.0;
return clamp(u_materialPbrFactors.x * textureMetallic, 0.0, 1.0);
}
float materialRoughnessFactor() {
float textureRoughness = u_useMetallicRoughnessTexture ? texture(u_metallicRoughnessTexture, v_uv).g : 1.0;
return clamp(u_materialPbrFactors.y * textureRoughness, 0.04, 1.0);
}
vec3 materialDiffuseColor(vec3 baseColor) {
return baseColor * (1.0 - materialMetallicFactor());
}
vec3 materialDiffuseTransmissionColor(vec3 baseColor) {
float factor = clamp(u_diffuseTransmissionFactors.a, 0.0, 1.0);
vec3 colorFactor = clamp(u_diffuseTransmissionFactors.rgb, vec3(0.0), vec3(1.0));
return materialDiffuseColor(baseColor) * colorFactor * factor;
}
vec3 materialEmissiveColor() {
vec3 textureEmissive = u_useEmissiveTexture ? texture(u_emissiveTexture, v_emissive_uv).rgb : vec3(1.0);
return u_emissiveColor.rgb * textureEmissive;
}
float materialOcclusion() {
if (!u_useOcclusionTexture) {
  return 1.0;
}
float strength = clamp(u_occlusionSettings.x, 0.0, 1.0);
return mix(1.0, texture(u_occlusionTexture, v_uv).r, strength);
}
vec3 materialFallbackTangent(vec3 normal) {
if (dot(normal, normal) <= 0.0001) {
  return vec3(1.0, 0.0, 0.0);
}
vec3 dp1 = dFdx(v_worldPosition);
vec3 dp2 = dFdy(v_worldPosition);
vec2 duv1 = dFdx(v_uv);
vec2 duv2 = dFdy(v_uv);
float determinant = duv1.x * duv2.y - duv1.y * duv2.x;
if (abs(determinant) > 0.000001) {
  vec3 rawTangent = (dp1 * duv2.y - dp2 * duv1.y) / determinant;
  vec3 projectedTangent = rawTangent - normal * dot(normal, rawTangent);
  if (dot(projectedTangent, projectedTangent) > 0.0001) {
    return normalize(projectedTangent);
  }
}
vec3 axis = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
return normalize(cross(axis, normal));
}
vec3 materialGeometryTangent(vec3 normal) {
vec3 tangent = v_tangent.w == 0.0 ? vec3(0.0) : v_tangent.xyz;
if (dot(tangent, tangent) > 0.0001) {
  vec3 projectedTangent = tangent - normal * dot(normal, tangent);
  if (dot(projectedTangent, projectedTangent) > 0.0001) {
    return normalize(projectedTangent);
  }
}
return materialFallbackTangent(normal);
}
vec3 materialNormal(vec3 geometricNormal) {
if (!u_useNormalTexture) {
  return geometricNormal;
}
vec3 textureNormal = texture(u_normalTexture, v_uv).xyz * 2.0 - 1.0;
textureNormal.xy *= u_normalTextureSettings.x;
vec3 normal = normalize(geometricNormal);
vec3 tangent = materialGeometryTangent(normal);
vec3 bitangent = normalize(cross(normal, tangent)) * (v_tangent.w < 0.0 ? -1.0 : 1.0);
return normalize(tangent * textureNormal.x + bitangent * textureNormal.y + normal * textureNormal.z);
}
vec3 materialDielectricF0() {
float specular = materialSpecularFactor();
vec3 specularColor = materialSpecularColorFactor();
return min(vec3(iorF0(u_materialExtensionFactors.y)) * specularColor, vec3(1.0)) * specular;
}
vec3 materialF0(vec3 baseColor) {
return mix(materialDielectricF0(), baseColor, materialMetallicFactor());
}
vec3 materialF90() {
float specular = materialSpecularFactor();
return mix(vec3(specular), vec3(1.0), materialMetallicFactor());
}
vec3 materialSpecularFresnel(vec3 baseColor, vec3 viewDirection, vec3 halfVector) {
float VdotH = max(dot(viewDirection, halfVector), 0.0);
return mix(materialF0(baseColor), materialF90(), fresnelPow(VdotH)) * materialIridescenceTint(VdotH);
}
float materialGgxDistribution(float NdotH, float roughness) {
float alpha = max(roughness * roughness, 0.001);
float alpha2 = alpha * alpha;
float denom = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
return alpha2 / max(PI * denom * denom, 0.0001);
}
vec3 materialAnisotropyDirection(vec3 normal) {
vec3 tangent = materialGeometryTangent(normal);
vec3 bitangent = normalize(cross(normal, tangent)) * (v_tangent.w < 0.0 ? -1.0 : 1.0);
float rotation = u_anisotropyFactors.y;
return normalize(tangent * cos(rotation) + bitangent * sin(rotation));
}
float materialAnisotropicGgxDistribution(vec3 normal, vec3 halfVector, float roughness) {
float NdotH = max(dot(normal, halfVector), 0.0);
float strength = clamp(u_anisotropyFactors.x, 0.0, 1.0);
if (strength <= 0.0) {
  return materialGgxDistribution(NdotH, roughness);
}
// KHR_materials_anisotropy is approximated with an anisotropic GGX D term for direct lights.
vec3 tangent = materialAnisotropyDirection(normal);
vec3 bitangent = normalize(cross(normal, tangent));
float alpha = max(roughness * roughness, 0.001);
float anisotropy = strength * 0.95;
float alphaT = max(alpha * (1.0 + anisotropy), 0.001);
float alphaB = max(alpha * (1.0 - anisotropy), 0.001);
float TdotH = dot(tangent, halfVector);
float BdotH = dot(bitangent, halfVector);
float denom = TdotH * TdotH / (alphaT * alphaT)
  + BdotH * BdotH / (alphaB * alphaB)
  + NdotH * NdotH;
return 1.0 / max(PI * alphaT * alphaB * denom * denom, 0.0001);
}
float materialSmithG1(float NdotX, float roughness) {
float k = pow(roughness + 1.0, 2.0) / 8.0;
return NdotX / max(NdotX * (1.0 - k) + k, 0.0001);
}
float materialSmithVisibility(float NdotL, float NdotV, float roughness) {
return materialSmithG1(NdotL, roughness) * materialSmithG1(NdotV, roughness);
}
float materialClearcoatFresnel(vec3 normal, vec3 viewDirection) {
float clearcoat = materialClearcoatFactor();
float fresnel = 0.04 + 0.96 * fresnelPow(max(dot(normal, viewDirection), 0.0));
return clearcoat * fresnel;
}
float materialClearcoatShininess() {
float roughness = materialClearcoatRoughnessFactor();
return mix(96.0, 8.0, roughness);
}
float materialSheenDistribution(float NdotH) {
float roughness = materialSheenRoughness();
float alphaG = max(roughness * roughness, 0.001);
float invR = 1.0 / alphaG;
float sin2h = max(1.0 - NdotH * NdotH, 0.0001);
return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
}
float materialSheenVisibility(float NdotL, float NdotV) {
return 1.0 / max(4.0 * (NdotL + NdotV - NdotL * NdotV), 0.001);
}
float materialSheenAlbedoScale(float NdotV) {
vec3 sheenColor = materialSheenColor();
float sheenStrength = clamp(maxComponent(sheenColor), 0.0, 1.0);
float roughness = materialSheenRoughness();
return clamp(1.0 - sheenStrength * mix(0.35, 0.65, roughness) * fresnelPow(NdotV), 0.0, 1.0);
}
vec3 materialSheenContribution(vec3 normal, vec3 viewDirection, vec3 lightVector, vec3 halfVector, float NdotL, vec3 lightColor) {
vec3 sheenColor = materialSheenColor();
if (maxComponent(sheenColor) <= 0.0) {
  return vec3(0.0);
}
float NdotV = max(dot(normal, viewDirection), 0.0);
float NdotH = max(dot(normal, halfVector), 0.0);
float sheenShape = min(materialSheenDistribution(NdotH) * materialSheenVisibility(NdotL, NdotV) * NdotL, 2.0);
return sheenColor * sheenShape * lightColor;
}
vec3 materialVolumeAttenuation() {
float thickness = materialThicknessFactor();
float attenuationDistance = u_transmissionVolumeFactors.z;
bool hasFiniteAttenuationDistance = u_transmissionVolumeFactors.w > 0.5;
if (thickness <= 0.0 || !hasFiniteAttenuationDistance || attenuationDistance <= 0.0) {
  return vec3(1.0);
}
vec3 attenuationColor = clamp(u_attenuationColorFactor.rgb, vec3(0.0), vec3(1.0));
return pow(max(attenuationColor, vec3(0.0001)), vec3(thickness / attenuationDistance));
}
vec3 materialDispersionIors(float ior, float dispersion) {
float safeIor = max(ior, 1.0);
float halfSpread = (safeIor - 1.0) * 0.025 * max(dispersion, 0.0);
return max(vec3(safeIor - halfSpread, safeIor, safeIor + halfSpread), vec3(1.0));
}
vec2 materialDispersionDirection(vec3 normal, vec3 viewDirection) {
vec3 refracted = refract(-viewDirection, normal, 1.0 / max(u_materialExtensionFactors.y, 1.0));
vec2 direction = refracted.xy;
if (dot(direction, direction) <= 0.000001) {
  direction = normal.xy;
}
if (dot(direction, direction) <= 0.000001) {
  return vec2(0.0);
}
return normalize(direction);
}
vec3 materialTransmissionScreenColor(vec3 baseColor, vec3 normal, vec3 viewDirection) {
vec2 screenUv = clamp(gl_FragCoord.xy / max(u_viewportSize, vec2(1.0)), vec2(0.0), vec2(1.0));
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
return transmitted * baseColor * materialVolumeAttenuation();
}
vec3 cameraWorldPosition() {
return -transpose(mat3(u_view)) * u_view[3].xyz;
}
float rangeAttenuation(float distanceToLight, float range) {
if (range <= 0.0) {
  return 1.0 / max(distanceToLight * distanceToLight, 0.0001);
}
float normalizedDistance = distanceToLight / range;
float smoothCutoff = max(min(1.0 - normalizedDistance * normalizedDistance * normalizedDistance * normalizedDistance, 1.0), 0.0);
return smoothCutoff / max(distanceToLight * distanceToLight, 0.0001);
}
vec3 iblDiffuseIrradiance(vec3 normal) {
if (!u_useIblIrradiance) {
  return vec3(0.18);
}
vec3 n = normalize((u_iblWorldToIbl * vec4(normal, 0.0)).xyz);
vec3 irradiance = vec3(0.0);
irradiance += u_iblIrradianceCoefficients[0].rgb * 0.282095;
irradiance += u_iblIrradianceCoefficients[1].rgb * (0.488603 * n.y);
irradiance += u_iblIrradianceCoefficients[2].rgb * (0.488603 * n.z);
irradiance += u_iblIrradianceCoefficients[3].rgb * (0.488603 * n.x);
irradiance += u_iblIrradianceCoefficients[4].rgb * (1.092548 * n.x * n.y);
irradiance += u_iblIrradianceCoefficients[5].rgb * (1.092548 * n.y * n.z);
irradiance += u_iblIrradianceCoefficients[6].rgb * (0.315392 * (3.0 * n.z * n.z - 1.0));
irradiance += u_iblIrradianceCoefficients[7].rgb * (1.092548 * n.x * n.z);
irradiance += u_iblIrradianceCoefficients[8].rgb * (0.546274 * (n.x * n.x - n.y * n.y));
return max(irradiance * u_iblIrradianceSettings.y, vec3(0.0));
}
vec3 iblDecodeSpecularRadiance(vec4 sampleValue) {
if (u_iblSpecularSettings.w > 0.5) {
  return sampleValue.rgb / max(sampleValue.a, 0.00392156862);
}
return sampleValue.rgb;
}
vec2 iblEnvironmentBrdf(float roughness, float NdotV) {
vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
vec4 r = roughness * c0 + c1;
float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
return vec2(-1.04, 1.04) * a004 + r.zw;
}
vec3 iblSpecularBrdf(vec3 baseColor, float roughness, float NdotV) {
vec2 brdf = iblEnvironmentBrdf(roughness, NdotV);
return (materialF0(baseColor) * brdf.x + materialF90() * brdf.y) * materialIridescenceTint(NdotV);
}
vec3 iblSpecularRadiance(vec3 normal, vec3 viewDirection, vec3 baseColor) {
if (!u_useIblSpecular) {
  return vec3(0.0);
}
vec3 reflection = normalize(reflect(-viewDirection, normal));
vec3 direction = normalize((u_iblWorldToIbl * vec4(reflection, 0.0)).xyz);
float mipCount = max(u_iblSpecularSettings.z, 1.0);
float roughness = materialRoughnessFactor();
float lod = roughness * max(mipCount - 1.0, 0.0);
float NdotV = max(dot(normal, viewDirection), 0.0);
vec3 radiance = iblDecodeSpecularRadiance(textureLod(u_iblSpecularCube, direction, lod));
return radiance * iblSpecularBrdf(baseColor, roughness, NdotV) * u_iblSpecularSettings.y;
}
vec3 lightContribution(int index, vec3 normal, vec3 viewDirection, vec3 worldPosition, vec3 baseColor) {
int kind = u_surfaceLightKind[index];
vec3 lightVector;
float attenuation = 1.0;
if (kind == 0) {
  lightVector = normalize(-u_surfaceLightDirection[index].xyz);
} else {
  vec3 toLight = u_surfaceLightPosition[index].xyz - worldPosition;
  float distanceToLight = length(toLight);
  lightVector = distanceToLight <= 0.0001 ? vec3(0.0, 1.0, 0.0) : toLight / distanceToLight;
  attenuation = rangeAttenuation(distanceToLight, u_surfaceLightDirection[index].w);
  if (kind == 2) {
    float coneDot = dot(normalize(u_surfaceLightDirection[index].xyz), -lightVector);
    float cone = clamp((coneDot - u_surfaceLightCone[index].y) / max(u_surfaceLightCone[index].x - u_surfaceLightCone[index].y, 0.001), 0.0, 1.0);
    attenuation *= cone * cone;
  }
}
float lambert = max(dot(normal, lightVector), 0.0);
float diffuseTransmissionLambert = max(dot(-normal, lightVector), 0.0);
vec3 lightColor = u_surfaceLightColor[index].rgb * attenuation;
vec3 diffuse = materialDiffuseColor(baseColor) * lambert * lightColor;
vec3 diffuseTransmission = materialDiffuseTransmissionColor(baseColor) * diffuseTransmissionLambert * lightColor;
if (lambert <= 0.0) {
  return diffuse + diffuseTransmission;
}
vec3 halfInput = lightVector + viewDirection;
vec3 halfVector = length(halfInput) <= 0.0001 ? normal : normalize(halfInput);
float NdotV = max(dot(normal, viewDirection), 0.0);
float NdotH = max(dot(normal, halfVector), 0.0);
float roughness = materialRoughnessFactor();
vec3 fresnel = materialSpecularFresnel(baseColor, viewDirection, halfVector);
float distribution = materialAnisotropicGgxDistribution(normal, halfVector, roughness);
float visibility = materialSmithVisibility(lambert, NdotV, roughness);
vec3 specular = fresnel * min(distribution * visibility * lambert, 4.0) * lightColor;
vec3 material = diffuse * (1.0 - clamp(maxComponent(fresnel), 0.0, 1.0)) + specular + diffuseTransmission;
material *= materialSheenAlbedoScale(NdotV);
material += materialSheenContribution(normal, viewDirection, lightVector, halfVector, lambert, lightColor);
float clearcoat = materialClearcoatFresnel(normal, viewDirection);
if (clearcoat <= 0.0) {
  return material;
}
float clearcoatShape = pow(NdotH, materialClearcoatShininess()) * lambert;
return mix(material, vec3(clearcoatShape) * lightColor, clearcoat);
}
void main() {
vec4 baseColor = (u_useTexture ? texture(u_texture, v_uv) : u_color) * v_color;
if (u_alphaSettings.x > 0.5 && u_alphaSettings.x < 1.5 && baseColor.a < u_alphaSettings.y) {
  discard;
}
if (u_alphaSettings.x < 1.5) {
  baseColor.a = 1.0;
}
if (u_unlit) {
  outColor = baseColor;
  return;
}
vec3 normal = materialNormal(normalize(v_normal));
vec3 viewInput = cameraWorldPosition() - v_worldPosition;
vec3 viewDirection = length(viewInput) <= 0.0001 ? normal : normalize(viewInput);
float viewClearcoat = materialClearcoatFresnel(normal, viewDirection);
float occlusion = materialOcclusion();
vec3 ambientIrradiance = iblDiffuseIrradiance(normal);
vec3 lit = materialDiffuseColor(baseColor.rgb) * ambientIrradiance * occlusion * (1.0 - viewClearcoat) * materialSheenAlbedoScale(max(dot(normal, viewDirection), 0.0));
lit += iblSpecularRadiance(normal, viewDirection, baseColor.rgb) * occlusion * (1.0 - viewClearcoat);
for (int index = 0; index < MAX_SURFACE_LIGHTS; index += 1) {
  if (index >= u_surfaceLightCount) {
    break;
  }
  lit += lightContribution(index, normal, viewDirection, v_worldPosition, baseColor.rgb);
}
lit += materialEmissiveColor() * (1.0 - viewClearcoat);
float transmission = materialTransmissionFactor();
if (transmission > 0.0 && u_useTransmissionTexture) {
  vec3 transmitted = materialTransmissionScreenColor(baseColor.rgb, normal, viewDirection);
  lit = mix(lit, transmitted, transmission);
}
outColor = vec4(lit, baseColor.a);
}`;
};
