import { MAX_SURFACE_LIGHTS } from "./lights";

export type ProgramKind = "surface" | "surface-instanced" | "surface-vt-base-color" | "wireframe";

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

  if (kind === "surface-instanced") {
    return `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
layout(location = 3) in mat4 a_instanceModel;
uniform mat4 u_projection;
uniform mat4 u_view;
out vec3 v_normal;
out vec3 v_worldPosition;
out vec2 v_uv;
void main() {
vec4 worldPosition = a_instanceModel * vec4(a_position, 1.0);
v_normal = mat3(a_instanceModel) * a_normal;
v_worldPosition = worldPosition.xyz;
v_uv = a_uv;
gl_Position = u_projection * u_view * worldPosition;
}`;
  }

  return `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec3 v_normal;
out vec3 v_worldPosition;
out vec2 v_uv;
void main() {
vec4 worldPosition = u_model * vec4(a_position, 1.0);
v_normal = mat3(u_model) * a_normal;
v_worldPosition = worldPosition.xyz;
v_uv = a_uv;
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
in vec3 v_worldPosition;
in vec2 v_uv;
#define MAX_SURFACE_LIGHTS ${MAX_SURFACE_LIGHTS}
uniform highp mat4 u_view;
uniform bool u_useTexture;
uniform bool u_unlit;
uniform vec4 u_color;
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
uniform sampler2D u_transmissionScreenTexture;
uniform vec4 u_materialPbrFactors;
uniform vec4 u_specularColorFactor;
uniform vec4 u_materialExtensionFactors;
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
float materialIridescenceThickness() {
float minimumThickness = max(u_iridescenceFactors.z, 0.0);
float maximumThickness = max(u_iridescenceFactors.w, 0.0);
return mix(minimumThickness, maximumThickness, 1.0);
}
vec3 materialIridescenceTint(float cosTheta) {
float strength = clamp(u_iridescenceFactors.x, 0.0, 1.0);
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
return clamp(u_materialPbrFactors.x, 0.0, 1.0);
}
float materialRoughnessFactor() {
return clamp(u_materialPbrFactors.y, 0.04, 1.0);
}
vec3 materialDiffuseColor(vec3 baseColor) {
return baseColor * (1.0 - materialMetallicFactor());
}
vec3 materialDielectricF0() {
float specular = clamp(u_materialExtensionFactors.x, 0.0, 1.0);
vec3 specularColor = max(u_specularColorFactor.rgb, vec3(0.0));
return min(vec3(iorF0(u_materialExtensionFactors.y)) * specularColor, vec3(1.0)) * specular;
}
vec3 materialF0(vec3 baseColor) {
return mix(materialDielectricF0(), baseColor, materialMetallicFactor());
}
vec3 materialF90() {
float specular = clamp(u_materialExtensionFactors.x, 0.0, 1.0);
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
float materialSmithG1(float NdotX, float roughness) {
float k = pow(roughness + 1.0, 2.0) / 8.0;
return NdotX / max(NdotX * (1.0 - k) + k, 0.0001);
}
float materialSmithVisibility(float NdotL, float NdotV, float roughness) {
return materialSmithG1(NdotL, roughness) * materialSmithG1(NdotV, roughness);
}
float materialClearcoatFresnel(vec3 normal, vec3 viewDirection) {
float clearcoat = clamp(u_materialExtensionFactors.z, 0.0, 1.0);
float fresnel = 0.04 + 0.96 * fresnelPow(max(dot(normal, viewDirection), 0.0));
return clearcoat * fresnel;
}
float materialClearcoatShininess() {
float roughness = clamp(u_materialExtensionFactors.w, 0.0, 1.0);
return mix(96.0, 8.0, roughness);
}
float materialSheenDistribution(float NdotH) {
float roughness = clamp(u_sheenColorFactor.a, 0.0, 1.0);
float alphaG = max(roughness * roughness, 0.001);
float invR = 1.0 / alphaG;
float sin2h = max(1.0 - NdotH * NdotH, 0.0001);
return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
}
float materialSheenVisibility(float NdotL, float NdotV) {
return 1.0 / max(4.0 * (NdotL + NdotV - NdotL * NdotV), 0.001);
}
float materialSheenAlbedoScale(float NdotV) {
vec3 sheenColor = max(u_sheenColorFactor.rgb, vec3(0.0));
float sheenStrength = clamp(maxComponent(sheenColor), 0.0, 1.0);
float roughness = clamp(u_sheenColorFactor.a, 0.0, 1.0);
return clamp(1.0 - sheenStrength * mix(0.35, 0.65, roughness) * fresnelPow(NdotV), 0.0, 1.0);
}
vec3 materialSheenContribution(vec3 normal, vec3 viewDirection, vec3 lightVector, vec3 halfVector, float NdotL, vec3 lightColor) {
vec3 sheenColor = max(u_sheenColorFactor.rgb, vec3(0.0));
if (maxComponent(sheenColor) <= 0.0) {
  return vec3(0.0);
}
float NdotV = max(dot(normal, viewDirection), 0.0);
float NdotH = max(dot(normal, halfVector), 0.0);
float sheenShape = min(materialSheenDistribution(NdotH) * materialSheenVisibility(NdotL, NdotV) * NdotL, 2.0);
return sheenColor * sheenShape * lightColor;
}
vec3 materialVolumeAttenuation() {
float thickness = max(u_transmissionVolumeFactors.y, 0.0);
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
float thickness = max(u_transmissionVolumeFactors.y, 0.0);
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
vec3 iblDecodeRgbd(vec4 rgbd) {
return rgbd.rgb / max(rgbd.a, 0.00392156862);
}
vec3 iblSpecularRadiance(vec3 normal, vec3 viewDirection, vec3 baseColor) {
if (!u_useIblSpecular) {
  return vec3(0.0);
}
vec3 reflection = normalize(reflect(-viewDirection, normal));
vec3 direction = normalize((u_iblWorldToIbl * vec4(reflection, 0.0)).xyz);
float mipCount = max(u_iblSpecularSettings.z, 1.0);
float lod = materialRoughnessFactor() * max(mipCount - 1.0, 0.0);
float NdotV = max(dot(normal, viewDirection), 0.0);
vec3 fresnel = mix(materialF0(baseColor), materialF90(), fresnelPow(NdotV));
return iblDecodeRgbd(textureLod(u_iblSpecularCube, direction, lod)) * fresnel * u_iblSpecularSettings.y;
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
vec3 lightColor = u_surfaceLightColor[index].rgb * attenuation;
vec3 diffuse = materialDiffuseColor(baseColor) * lambert * lightColor;
if (lambert <= 0.0) {
  return diffuse;
}
vec3 halfInput = lightVector + viewDirection;
vec3 halfVector = length(halfInput) <= 0.0001 ? normal : normalize(halfInput);
float NdotV = max(dot(normal, viewDirection), 0.0);
float NdotH = max(dot(normal, halfVector), 0.0);
float roughness = materialRoughnessFactor();
vec3 fresnel = materialSpecularFresnel(baseColor, viewDirection, halfVector);
float distribution = materialGgxDistribution(NdotH, roughness);
float visibility = materialSmithVisibility(lambert, NdotV, roughness);
vec3 specular = fresnel * min(distribution * visibility * lambert, 4.0) * lightColor;
vec3 material = diffuse * (1.0 - clamp(maxComponent(fresnel), 0.0, 1.0)) + specular;
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
vec4 baseColor = u_useTexture ? texture(u_texture, v_uv) : u_color;
if (u_unlit) {
  outColor = baseColor;
  return;
}
vec3 normal = normalize(v_normal);
vec3 viewInput = cameraWorldPosition() - v_worldPosition;
vec3 viewDirection = length(viewInput) <= 0.0001 ? normal : normalize(viewInput);
float viewClearcoat = materialClearcoatFresnel(normal, viewDirection);
vec3 ambientIrradiance = iblDiffuseIrradiance(normal);
vec3 lit = materialDiffuseColor(baseColor.rgb) * ambientIrradiance * (1.0 - viewClearcoat) * materialSheenAlbedoScale(max(dot(normal, viewDirection), 0.0));
lit += iblSpecularRadiance(normal, viewDirection, baseColor.rgb) * (1.0 - viewClearcoat);
for (int index = 0; index < MAX_SURFACE_LIGHTS; index += 1) {
  if (index >= u_surfaceLightCount) {
    break;
  }
  lit += lightContribution(index, normal, viewDirection, v_worldPosition, baseColor.rgb);
}
lit += u_emissiveColor.rgb * (1.0 - viewClearcoat);
float transmission = clamp(u_transmissionVolumeFactors.x, 0.0, 1.0);
if (transmission > 0.0 && u_useTransmissionTexture) {
  vec3 transmitted = materialTransmissionScreenColor(baseColor.rgb, normal, viewDirection);
  lit = mix(lit, transmitted, transmission);
}
outColor = vec4(lit, baseColor.a);
}`;
};
