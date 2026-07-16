#version 300 es
precision highp float;

in vec3 v_normal;
in vec4 v_tangent;
in vec3 v_worldPosition;
in vec2 v_uv0;
in vec2 v_uv1;
in vec4 v_color;

#define MAX_SURFACE_LIGHTS __MAX_SURFACE_LIGHTS__
#define MATERIAL_EXTENDED __MATERIAL_EXTENDED__

uniform highp mat4 u_view;
uniform highp vec4 u_cameraWorldPosition;

// Each admitted material sampler selects a retained raw UV set and applies its
// KHR_texture_transform affine rows. Unused slots are absent from the variant.
__SURFACE_TEXTURE_COORDINATE_UNIFORMS__

// Material state.
uniform vec4 u_color;
uniform vec4 u_alphaSettings;
uniform vec4 u_emissiveColor;

// Direct lights.
uniform int u_surfaceLightCount;
uniform vec4 u_surfaceLightColor[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightDirection[MAX_SURFACE_LIGHTS];
__CLUSTERED_LIGHT_UNIFORMS__

// Image-based lighting.
uniform vec4 u_iblIrradianceCoefficients[9];
uniform vec4 u_iblIrradianceSettings;
uniform mat4 u_iblWorldToIbl;
uniform bool u_useIblSpecular;
uniform bool u_useIblBrdfLut;
uniform vec4 u_iblSpecularSettings;

__SURFACE_SAMPLER_UNIFORMS__
__BASE_COLOR_VIRTUAL_TEXTURE_UNIFORMS__

// PBR and glTF extension factors.
uniform vec4 u_materialPbrFactors;
uniform vec4 u_toneMappingSettings;
uniform vec4 u_normalTextureSettings;
uniform vec4 u_occlusionSettings;
#if MATERIAL_EXTENDED
uniform vec4 u_specularColorFactor;
uniform vec4 u_materialExtensionFactors;
uniform vec4 u_anisotropyFactors;
uniform vec4 u_diffuseTransmissionFactors;
uniform vec4 u_sheenColorFactor;
uniform vec4 u_iridescenceFactors;
uniform vec4 u_dispersionFactors;
uniform vec4 u_attenuationColorFactor;
uniform vec4 u_transmissionVolumeFactors;
#endif
uniform vec2 u_viewportOrigin;
uniform vec2 u_viewportSize;

out vec4 outColor;

const float PI = 3.141592653589793;
// glTF emissive factors are relative. Anchor 1.0 to diffuse display white when
// the pass is scene-referred so exposure does not turn authored emission black.
const float GLTF_EMISSIVE_REFERENCE_NITS = 100.0;

vec2 materialTextureUv(int uvSet, vec4 row0, vec4 row1) {
  vec2 source = uvSet == 1 ? v_uv1 : v_uv0;
  vec3 homogeneous = vec3(source, 1.0);
  return vec2(dot(row0.xyz, homogeneous), dot(row1.xyz, homogeneous));
}

__BASE_COLOR_VIRTUAL_TEXTURE_FUNCTIONS__

float maxComponent(vec3 value) {
  return max(max(value.r, value.g), value.b);
}

vec3 toneMapPbrNeutral(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float minimum = min(color.r, min(color.g, color.b));
  float offset = minimum < 0.08 ? minimum - 6.25 * minimum * minimum : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return max(color, vec3(0.0));
  float distance = 1.0 - startCompression;
  float compressedPeak = 1.0 - distance * distance / (peak + distance - startCompression);
  color *= compressedPeak / peak;
  float blend = 1.0 - 1.0 / (desaturation * (peak - compressedPeak) + 1.0);
  return mix(color, vec3(compressedPeak), blend);
}

vec3 linearToSrgb(vec3 color) {
  vec3 safeColor = clamp(color, vec3(0.0), vec3(1.0));
  vec3 linearSegment = safeColor * 12.92;
  vec3 powerSegment = 1.055 * pow(safeColor, vec3(1.0 / 2.4)) - 0.055;

  return mix(powerSegment, linearSegment, lessThanEqual(safeColor, vec3(0.0031308)));
}

vec4 outputLinearColor(vec3 color, float alpha) {
  return vec4(linearToSrgb(color), alpha);
}

vec4 outputMappedColor(vec3 color, float alpha) {
  vec3 exposed = color * max(u_toneMappingSettings.y, 0.0);
  vec3 mapped = u_toneMappingSettings.x > 0.5
    ? toneMapPbrNeutral(exposed)
    : clamp(exposed, vec3(0.0), vec3(1.0));

  return vec4(linearToSrgb(mapped), alpha);
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
#if MATERIAL_EXTENDED
  float textureSpecular = __SPECULAR_TEXTURE_EXPR__;

  return clamp(u_materialExtensionFactors.x * textureSpecular, 0.0, 1.0);
#else
  return 1.0;
#endif
}

vec3 materialSpecularColorFactor() {
#if MATERIAL_EXTENDED
  vec3 textureSpecularColor = __SPECULAR_COLOR_TEXTURE_EXPR__;

  return max(u_specularColorFactor.rgb * textureSpecularColor, vec3(0.0));
#else
  return vec3(1.0);
#endif
}

float materialClearcoatFactor() {
#if MATERIAL_EXTENDED
  float textureClearcoat = __CLEARCOAT_TEXTURE_EXPR__;

  return clamp(u_materialExtensionFactors.z * textureClearcoat, 0.0, 1.0);
#else
  return 0.0;
#endif
}

float materialClearcoatRoughnessFactor() {
#if MATERIAL_EXTENDED
  float textureRoughness = __CLEARCOAT_ROUGHNESS_TEXTURE_EXPR__;

  return clamp(u_materialExtensionFactors.w * textureRoughness, 0.0, 1.0);
#else
  return 0.0;
#endif
}

float materialDiffuseTransmissionFactor() {
#if MATERIAL_EXTENDED
  float textureTransmission = __DIFFUSE_TRANSMISSION_TEXTURE_EXPR__;

  return clamp(u_diffuseTransmissionFactors.a * textureTransmission, 0.0, 1.0);
#else
  return 0.0;
#endif
}

vec3 materialDiffuseTransmissionColor() {
#if MATERIAL_EXTENDED
  vec3 textureColor = __DIFFUSE_TRANSMISSION_COLOR_TEXTURE_EXPR__;

  return clamp(u_diffuseTransmissionFactors.rgb * textureColor, vec3(0.0), vec3(1.0));
#else
  return vec3(1.0);
#endif
}

vec3 materialSheenColor() {
#if MATERIAL_EXTENDED
  vec3 textureSheenColor = __SHEEN_COLOR_TEXTURE_EXPR__;

  return max(u_sheenColorFactor.rgb * textureSheenColor, vec3(0.0));
#else
  return vec3(0.0);
#endif
}

float materialSheenRoughness() {
#if MATERIAL_EXTENDED
  float textureRoughness = __SHEEN_ROUGHNESS_TEXTURE_EXPR__;

  return clamp(u_sheenColorFactor.a * textureRoughness, 0.0, 1.0);
#else
  return 0.0;
#endif
}

float materialIridescenceFactor() {
#if MATERIAL_EXTENDED
  float textureIridescence = __IRIDESCENCE_TEXTURE_EXPR__;

  return clamp(u_iridescenceFactors.x * textureIridescence, 0.0, 1.0);
#else
  return 0.0;
#endif
}

float materialIridescenceThickness() {
#if MATERIAL_EXTENDED
  float minimumThickness = max(u_iridescenceFactors.z, 0.0);
  float maximumThickness = max(u_iridescenceFactors.w, 0.0);
  float textureThickness = __IRIDESCENCE_THICKNESS_TEXTURE_EXPR__;

  return mix(minimumThickness, maximumThickness, clamp(textureThickness, 0.0, 1.0));
#else
  return 0.0;
#endif
}

float materialTransmissionFactor() {
#if MATERIAL_EXTENDED
  float textureTransmission = __MATERIAL_TRANSMISSION_TEXTURE_EXPR__;

  return clamp(u_transmissionVolumeFactors.x * textureTransmission, 0.0, 1.0);
#else
  return 0.0;
#endif
}

float materialThicknessFactor() {
#if MATERIAL_EXTENDED
  float textureThickness = __THICKNESS_TEXTURE_EXPR__;

  return max(u_transmissionVolumeFactors.y * textureThickness, 0.0);
#else
  return 0.0;
#endif
}

vec3 materialIridescenceTint(float cosTheta) {
#if MATERIAL_EXTENDED
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
#else
  return vec3(1.0);
#endif
}

float materialIor() {
#if MATERIAL_EXTENDED
  return u_materialExtensionFactors.y;
#else
  return 1.5;
#endif
}

vec2 materialMetallicRoughness() {
  vec2 textureMetallicRoughness = __METALLIC_ROUGHNESS_TEXTURE_EXPR__;

  return vec2(
    clamp(u_materialPbrFactors.x * textureMetallicRoughness.x, 0.0, 1.0),
    clamp(u_materialPbrFactors.y * textureMetallicRoughness.y, 0.04, 1.0)
  );
}

vec3 materialEmissiveColor() {
  vec3 textureEmissive = __EMISSIVE_TEXTURE_EXPR__;

  return u_emissiveColor.rgb * textureEmissive;
}

float materialOcclusion() {
  __MATERIAL_OCCLUSION_BODY__
}

mat3 materialFallbackCotangentFrame(vec3 normal, vec2 normalUv) {
  vec3 positionDx = dFdx(v_worldPosition);
  vec3 positionDy = dFdy(v_worldPosition);
  vec2 uvDx = dFdx(normalUv);
  vec2 uvDy = dFdy(normalUv);
  vec3 positionDyPerpendicular = cross(positionDy, normal);
  vec3 positionDxPerpendicular = cross(normal, positionDx);
  vec3 tangent = positionDyPerpendicular * uvDx.x + positionDxPerpendicular * uvDy.x;
  vec3 bitangent = positionDyPerpendicular * uvDx.y + positionDxPerpendicular * uvDy.y;
  float maximumLengthSquared = max(dot(tangent, tangent), dot(bitangent, bitangent));

  if (maximumLengthSquared > 0.000001) {
    float inverseMaximumLength = inversesqrt(maximumLengthSquared);
    return mat3(tangent * inverseMaximumLength, bitangent * inverseMaximumLength, normal);
  }

  vec3 orthogonalAxis = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 fallbackTangent = normalize(cross(orthogonalAxis, normal));

  return mat3(fallbackTangent, normalize(cross(normal, fallbackTangent)), normal);
}

float materialFaceSign() {
  return gl_FrontFacing ? 1.0 : -1.0;
}

vec3 materialGeometricNormal() {
  vec3 normal = v_normal;
  if (dot(normal, normal) <= 0.00000001) {
    // glTF primitives without NORMAL are flat shaded. Deriving the face normal
    // here preserves shared indexed vertices instead of inventing smooth
    // vertex normals and retaining another CPU/GPU float3 buffer.
    normal = cross(dFdx(v_worldPosition), dFdy(v_worldPosition));
  }
  float lengthSquared = dot(normal, normal);
  vec3 normalized = lengthSquared <= 0.00000001
    ? vec3(0.0, 0.0, 1.0)
    : normal * inversesqrt(lengthSquared);
  return normalized * materialFaceSign();
}

vec3 materialGeometryTangent(vec3 normal) {
  float faceSign = materialFaceSign();
  vec3 tangent = v_tangent.w == 0.0 ? vec3(0.0) : v_tangent.xyz * faceSign;
  if (dot(tangent, tangent) > 0.0001) {
    vec3 projectedTangent = tangent - normal * dot(normal, tangent);
    if (dot(projectedTangent, projectedTangent) > 0.0001) {
      return normalize(projectedTangent);
    }
  }

  return materialFallbackCotangentFrame(normal, v_uv0)[0];
}

vec3 materialTangentNormal(vec3 geometricNormal, vec3 textureNormal, vec2 normalUv) {
  vec3 normal = normalize(geometricNormal);
  if (v_tangent.w == 0.0) {
    return normalize(materialFallbackCotangentFrame(normal, normalUv) * textureNormal);
  }
  vec3 tangent = materialGeometryTangent(normal);
  vec3 bitangent = normalize(cross(normal, tangent))
    * (v_tangent.w < 0.0 ? -1.0 : 1.0)
    * materialFaceSign();

  return normalize(tangent * textureNormal.x + bitangent * textureNormal.y + normal * textureNormal.z);
}

vec3 materialNormal(vec3 geometricNormal) {
  __MATERIAL_NORMAL_BODY__
}

vec3 materialClearcoatNormal(vec3 geometricNormal) {
  __MATERIAL_CLEARCOAT_NORMAL_BODY__
}

float materialGgxDistribution(float NdotH, float roughness) {
  float alpha = max(roughness * roughness, 0.001);
  float alphaSquared = alpha * alpha;
  float denominator = NdotH * NdotH * (alphaSquared - 1.0) + 1.0;

  return alphaSquared / max(PI * denominator * denominator, 0.0001);
}

vec3 materialAnisotropy() {
#if MATERIAL_EXTENDED
  vec3 textureAnisotropy = __ANISOTROPY_TEXTURE_EXPR__;
  vec2 textureDirection = textureAnisotropy.rg * 2.0 - vec2(1.0);
  vec2 direction = dot(textureDirection, textureDirection) > 0.000001
    ? normalize(textureDirection)
    : vec2(1.0, 0.0);
  float rotation = u_anisotropyFactors.y;
  vec2 rotatedDirection = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * direction;

  return vec3(rotatedDirection, clamp(u_anisotropyFactors.x * textureAnisotropy.b, 0.0, 1.0));
#else
  return vec3(1.0, 0.0, 0.0);
#endif
}

vec2 materialAnisotropyUv() {
  return __ANISOTROPY_UV_EXPR__;
}

vec3 materialAnisotropyDirection(vec3 normal, vec2 direction) {
  if (v_tangent.w == 0.0) {
    mat3 tangentFrame = materialFallbackCotangentFrame(normal, materialAnisotropyUv());
    return normalize(tangentFrame[0] * direction.x + tangentFrame[1] * direction.y);
  }
  vec3 tangent = materialGeometryTangent(normal);
  vec3 bitangent = normalize(cross(normal, tangent))
    * (v_tangent.w < 0.0 ? -1.0 : 1.0)
    * materialFaceSign();

  return normalize(tangent * direction.x + bitangent * direction.y);
}

float materialSmithVisibility(float NdotL, float NdotV, float roughness);

vec2 materialGgxTerms(
  vec3 normal,
  vec3 halfVector,
  vec3 lightVector,
  vec3 viewDirection,
  float roughness
) {
  float NdotH = max(dot(normal, halfVector), 0.0);
  float NdotL = max(dot(normal, lightVector), 0.0);
  float NdotV = max(dot(normal, viewDirection), 0.0);
  vec3 anisotropy = materialAnisotropy();
  float strength = anisotropy.z;
  if (strength <= 0.0) {
    return vec2(
      materialGgxDistribution(NdotH, roughness),
      materialSmithVisibility(NdotL, NdotV, roughness)
    );
  }

  vec3 tangent = materialAnisotropyDirection(normal, anisotropy.xy);
  vec3 bitangent = normalize(cross(normal, tangent));
  float alpha = max(roughness * roughness, 0.001);
  float alphaT = mix(alpha, 1.0, strength * strength);
  float alphaB = alpha;
  float TdotH = dot(tangent, halfVector);
  float BdotH = dot(bitangent, halfVector);
  float distributionDenominator = TdotH * TdotH / (alphaT * alphaT)
    + BdotH * BdotH / (alphaB * alphaB)
    + NdotH * NdotH;
  float distribution = 1.0 / max(
    PI * alphaT * alphaB * distributionDenominator * distributionDenominator,
    0.0001
  );
  float TdotV = dot(tangent, viewDirection);
  float BdotV = dot(bitangent, viewDirection);
  float TdotL = dot(tangent, lightVector);
  float BdotL = dot(bitangent, lightVector);
  float visibilityV = NdotL * length(vec3(alphaT * TdotV, alphaB * BdotV, NdotV));
  float visibilityL = NdotV * length(vec3(alphaT * TdotL, alphaB * BdotL, NdotL));
  float visibility = 0.5 / max(visibilityV + visibilityL, 0.0001);

  return vec2(distribution, clamp(visibility, 0.0, 1.0));
}

float materialSmithVisibility(float NdotL, float NdotV, float roughness) {
  float alpha = max(roughness * roughness, 0.001);
  float alphaSquared = alpha * alpha;
  float lambdaV = NdotL * sqrt(max(NdotV * NdotV * (1.0 - alphaSquared) + alphaSquared, 0.0));
  float lambdaL = NdotV * sqrt(max(NdotL * NdotL * (1.0 - alphaSquared) + alphaSquared, 0.0));

  return 0.5 / max(lambdaV + lambdaL, 0.0001);
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
  float sheenRoughnessSquared = max(roughness * roughness, 0.001);
  float inverseRoughness = 1.0 / sheenRoughnessSquared;
  float sinThetaHSquared = max(1.0 - NdotH * NdotH, 0.0001);

  return (2.0 + inverseRoughness) * pow(sinThetaHSquared, inverseRoughness * 0.5) / (2.0 * PI);
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

vec3 materialSheenContribution(
  vec3 normal,
  vec3 viewDirection,
  vec3 lightVector,
  vec3 halfVector,
  float NdotL,
  vec3 lightColor
) {
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
#if MATERIAL_EXTENDED
  float thickness = materialThicknessFactor();
  float attenuationDistance = u_transmissionVolumeFactors.z;
  bool hasFiniteAttenuationDistance = u_transmissionVolumeFactors.w > 0.5;
  if (thickness <= 0.0 || !hasFiniteAttenuationDistance || attenuationDistance <= 0.0) {
    return vec3(1.0);
  }

  vec3 attenuationColor = clamp(u_attenuationColorFactor.rgb, vec3(0.0), vec3(1.0));

  return pow(max(attenuationColor, vec3(0.0001)), vec3(thickness / attenuationDistance));
#else
  return vec3(1.0);
#endif
}

vec3 materialDispersionIors(float ior, float dispersion) {
  float safeIor = max(ior, 1.0);
  float halfSpread = (safeIor - 1.0) * 0.025 * max(dispersion, 0.0);

  return max(vec3(safeIor - halfSpread, safeIor, safeIor + halfSpread), vec3(1.0));
}

vec2 materialDispersionDirection(vec3 normal, vec3 viewDirection) {
  vec3 refracted = refract(-viewDirection, normal, 1.0 / max(materialIor(), 1.0));
  vec2 direction = refracted.xy;
  if (dot(direction, direction) <= 0.000001) {
    direction = normal.xy;
  }

  if (dot(direction, direction) <= 0.000001) {
    return vec2(0.0);
  }

  return normalize(direction);
}

vec3 iblDiffuseIrradiance(vec3 normal);

vec3 materialTransmissionScreenColor(vec3 baseColor, vec3 normal, vec3 viewDirection) {
  __MATERIAL_TRANSMISSION_SCREEN_BODY__
}

float rangeAttenuation(float distanceToLight, float range) {
  if (range <= 0.0) {
    return 1.0 / max(distanceToLight * distanceToLight, 0.0001);
  }

  float normalizedDistance = distanceToLight / range;
  float smoothCutoff = max(
    min(1.0 - normalizedDistance * normalizedDistance * normalizedDistance * normalizedDistance, 1.0),
    0.0
  );

  return smoothCutoff / max(distanceToLight * distanceToLight, 0.0001);
}

vec3 iblDiffuseIrradiance(vec3 normal) {
  if (u_iblIrradianceSettings.x < 0.5) return vec3(0.0);

  vec3 iblNormal = normalize((u_iblWorldToIbl * vec4(normal, 0.0)).xyz);
  vec3 irradiance = vec3(0.0);

  irradiance += u_iblIrradianceCoefficients[0].rgb * 0.282095;
  irradiance += u_iblIrradianceCoefficients[1].rgb * (0.488603 * iblNormal.y);
  irradiance += u_iblIrradianceCoefficients[2].rgb * (0.488603 * iblNormal.z);
  irradiance += u_iblIrradianceCoefficients[3].rgb * (0.488603 * iblNormal.x);
  irradiance += u_iblIrradianceCoefficients[4].rgb * (1.092548 * iblNormal.x * iblNormal.y);
  irradiance += u_iblIrradianceCoefficients[5].rgb * (1.092548 * iblNormal.y * iblNormal.z);
  irradiance += u_iblIrradianceCoefficients[6].rgb * (0.315392 * (3.0 * iblNormal.z * iblNormal.z - 1.0));
  irradiance += u_iblIrradianceCoefficients[7].rgb * (1.092548 * iblNormal.x * iblNormal.z);
  irradiance += u_iblIrradianceCoefficients[8].rgb * (
    0.546274 * (iblNormal.x * iblNormal.x - iblNormal.y * iblNormal.y)
  );

  return max(irradiance * u_iblIrradianceSettings.y, vec3(0.0));
}

vec3 iblDecodeSpecularRadiance(vec4 sampleValue) {
  if (u_iblSpecularSettings.w > 0.5) {
    return sampleValue.rgb / max(sampleValue.a, 0.00392156862);
  }

  return sampleValue.rgb;
}

vec2 iblEnvironmentBrdf(float roughness, float NdotV) {
  __IBL_BRDF_LUT_BODY__
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;

  return vec2(-1.04, 1.04) * a004 + r.zw;
}

float iblSpecularOcclusion(float NdotV, float ambientOcclusion, float roughness) {
  float exponent = exp2(-16.0 * roughness - 1.0);

  return clamp(
    pow(max(NdotV + ambientOcclusion, 0.0), exponent) - 1.0 + ambientOcclusion,
    0.0,
    1.0
  );
}

struct IblGgxScattering {
  vec3 single;
  vec3 multi;
};

IblGgxScattering iblGgxScattering(vec3 f0, vec3 f90, vec2 brdf, float NdotV) {
  vec3 single = (f0 * brdf.x + f90 * brdf.y) * materialIridescenceTint(NdotV);
  float singleEnergy = clamp(brdf.x + brdf.y, 0.0, 1.0);
  float missingEnergy = 1.0 - singleEnergy;
  vec3 averageFresnel = f0 + (vec3(1.0) - f0) * (1.0 / 21.0);
  vec3 multiFresnel = single * averageFresnel
    / max(vec3(1.0) - missingEnergy * averageFresnel, vec3(0.0001));

  return IblGgxScattering(single, multiFresnel * missingEnergy);
}

vec3 iblSpecularSample(vec3 normal, vec3 viewDirection, float roughness) {
  __IBL_SPECULAR_RADIANCE_BODY__
}

vec3 iblClearcoatRadiance(vec3 normal, vec3 viewDirection) {
  float clearcoat = materialClearcoatFactor();
  if (clearcoat <= 0.0) {
    return vec3(0.0);
  }

  float roughness = materialClearcoatRoughnessFactor();
  float NdotV = max(dot(normal, viewDirection), 0.0);
  vec2 brdf = iblEnvironmentBrdf(roughness, NdotV);
  vec3 coatBrdf = vec3(0.04) * brdf.x + vec3(1.0) * brdf.y;

  return iblSpecularSample(normal, viewDirection, roughness) * coatBrdf * clearcoat;
}

vec3 lightContributionData(
  int lightKind,
  vec3 sourceColor,
  vec3 sourceDirection,
  vec3 sourcePosition,
  float sourceRange,
  float innerConeCosine,
  float outerConeCosine,
  vec3 normal,
  vec3 clearcoatNormal,
  vec3 viewDirection,
  vec3 worldPosition,
  vec3 baseColor,
  float metallic,
  float roughness,
  vec3 f0,
  vec3 f90
) {
  vec3 lightVector;
  float attenuation = 1.0;

  if (lightKind == 0) {
    lightVector = normalize(-sourceDirection);
  } else {
    vec3 lightOffset = sourcePosition - worldPosition;
    float distanceToLight = length(lightOffset);
    lightVector = distanceToLight <= 0.0001 ? vec3(0.0, 1.0, 0.0) : lightOffset / distanceToLight;
    attenuation = rangeAttenuation(distanceToLight, sourceRange);

    if (lightKind == 2) {
      float spotCosine = dot(normalize(sourceDirection), -lightVector);
      float spotAttenuation = clamp(
        (spotCosine - outerConeCosine)
          / max(innerConeCosine - outerConeCosine, 0.001),
        0.0,
        1.0
      );
      attenuation *= spotAttenuation * spotAttenuation;
    }
  }

  float lambert = max(dot(normal, lightVector), 0.0);
  float diffuseTransmissionLambert = max(dot(-normal, lightVector), 0.0);
  vec3 lightColor = sourceColor * attenuation;
  vec3 diffuseColor = baseColor * (1.0 - metallic);
  float diffuseTransmissionFactor = materialDiffuseTransmissionFactor();
  vec3 diffuseTransmissionColor = materialDiffuseTransmissionColor();
  vec3 diffuse = diffuseColor * (1.0 - diffuseTransmissionFactor) * (lambert / PI) * lightColor;
  vec3 diffuseTransmission =
    diffuseTransmissionColor
    * (1.0 - metallic)
    * diffuseTransmissionFactor
    * (diffuseTransmissionLambert / PI)
    * lightColor;

  if (lambert <= 0.0) {
    return diffuse + diffuseTransmission;
  }

  vec3 halfVectorInput = lightVector + viewDirection;
  vec3 halfVector = length(halfVectorInput) <= 0.0001 ? normal : normalize(halfVectorInput);
  float NdotV = max(dot(normal, viewDirection), 0.0);
  float VdotH = max(dot(viewDirection, halfVector), 0.0);
  vec3 fresnel = mix(f0, f90, fresnelPow(VdotH)) * materialIridescenceTint(VdotH);
  vec2 ggxTerms = materialGgxTerms(normal, halfVector, lightVector, viewDirection, roughness);
  float distribution = ggxTerms.x;
  float visibility = ggxTerms.y;
  vec3 specular = fresnel * min(distribution * visibility * lambert, 4.0) * lightColor;
  vec3 lighting = diffuse * (1.0 - clamp(maxComponent(fresnel), 0.0, 1.0)) + specular + diffuseTransmission;

  lighting *= materialSheenAlbedoScale(NdotV);
  lighting += materialSheenContribution(normal, viewDirection, lightVector, halfVector, lambert, lightColor);

  float clearcoat = materialClearcoatFresnel(clearcoatNormal, viewDirection);
  if (clearcoat <= 0.0) {
    return lighting;
  }

  float clearcoatNdotH = max(dot(clearcoatNormal, halfVector), 0.0);
  float clearcoatNdotL = max(dot(clearcoatNormal, lightVector), 0.0);
  float clearcoatShape = pow(clearcoatNdotH, materialClearcoatShininess()) * clearcoatNdotL;

  return mix(lighting, vec3(clearcoatShape) * lightColor, clearcoat);
}

vec3 directionalLightContribution(
  int index,
  vec3 normal,
  vec3 clearcoatNormal,
  vec3 viewDirection,
  vec3 baseColor,
  float metallic,
  float roughness,
  vec3 f0,
  vec3 f90
) {
  return lightContributionData(
    0,
    u_surfaceLightColor[index].rgb,
    u_surfaceLightDirection[index].xyz,
    vec3(0.0),
    0.0,
    1.0,
    0.0,
    normal,
    clearcoatNormal,
    viewDirection,
    vec3(0.0),
    baseColor,
    metallic,
    roughness,
    f0,
    f90
  );
}

__CLUSTERED_LIGHT_FUNCTIONS__

void main() {
  vec4 baseColor = (__BASE_COLOR_EXPR__) * v_color;
  if (u_alphaSettings.x > 0.5 && u_alphaSettings.x < 1.5 && baseColor.a < u_alphaSettings.y) {
    discard;
  }

  if (u_alphaSettings.x < 1.5) {
    baseColor.a = 1.0;
  }

  // glTF double-sided surfaces keep their material response on the visible
  // side. Single-sided batches cull back faces, so this is branch-free in
  // effect for them and corrects dark back faces for double-sided materials.
  vec3 geometricNormal = materialGeometricNormal();
  vec3 normal = materialNormal(geometricNormal);
  vec3 clearcoatNormal = materialClearcoatNormal(geometricNormal);
  vec3 viewVector = u_cameraWorldPosition.xyz - v_worldPosition;
  vec3 viewDirection = length(viewVector) <= 0.0001 ? normal : normalize(viewVector);
  vec2 metallicRoughness = materialMetallicRoughness();
  float metallic = metallicRoughness.x;
  float roughness = metallicRoughness.y;
  float specularFactor = materialSpecularFactor();
  vec3 dielectricF0 = min(
    vec3(iorF0(materialIor())) * materialSpecularColorFactor(),
    vec3(1.0)
  ) * specularFactor;
  vec3 f0 = mix(dielectricF0, baseColor.rgb, metallic);
  vec3 f90 = mix(vec3(specularFactor), vec3(1.0), metallic);
  float occlusion = materialOcclusion();
  float viewClearcoat = materialClearcoatFresnel(clearcoatNormal, viewDirection);
  vec3 ambientIrradiance = iblDiffuseIrradiance(normal);
  vec3 cosineWeightedIrradiance = ambientIrradiance / PI;
  float diffuseTransmission = materialDiffuseTransmissionFactor();
  vec3 diffuseTransmissionColor = materialDiffuseTransmissionColor();
  vec3 transmittedIrradiance = iblDiffuseIrradiance(-normal) / PI;
  float NdotV = max(dot(normal, viewDirection), 0.0);
  vec2 environmentBrdf = iblEnvironmentBrdf(roughness, NdotV);
  IblGgxScattering scattering = iblGgxScattering(f0, f90, environmentBrdf, NdotV);
  vec3 totalScattering = scattering.single + scattering.multi;
  float diffuseEnergy = 1.0 - clamp(maxComponent(totalScattering), 0.0, 1.0);
  vec3 lit = baseColor.rgb * (1.0 - metallic) * cosineWeightedIrradiance
    * (1.0 - diffuseTransmission)
    * diffuseEnergy
    * occlusion
    * (1.0 - viewClearcoat);
  lit += diffuseTransmissionColor
    * (1.0 - metallic)
    * transmittedIrradiance
    * diffuseTransmission
    * diffuseEnergy
    * occlusion
    * (1.0 - viewClearcoat);

  vec3 baseSpecular = iblSpecularSample(normal, viewDirection, roughness) * scattering.single
    + cosineWeightedIrradiance * scattering.multi;
  lit += baseSpecular
    * iblSpecularOcclusion(NdotV, occlusion, roughness)
    * (1.0 - viewClearcoat);
  lit += iblClearcoatRadiance(clearcoatNormal, viewDirection) * occlusion;

  for (int index = 0; index < MAX_SURFACE_LIGHTS; index += 1) {
    if (index >= u_surfaceLightCount) {
      break;
    }

    lit += directionalLightContribution(
      index,
      normal,
      clearcoatNormal,
      viewDirection,
      baseColor.rgb,
      metallic,
      roughness,
      f0,
      f90
    );
  }
  lit += clusteredLightContribution(
    normal,
    clearcoatNormal,
    viewDirection,
    v_worldPosition,
    baseColor.rgb,
    metallic,
    roughness,
    f0,
    f90
  );

  // Keep glTF's relative emissive scale anchored to the same scene-referred
  // display white in both paths. The HDR path is mapped by the presentation
  // pass; the direct SDR path is mapped by outputMappedColor below.
  lit += materialEmissiveColor() * GLTF_EMISSIVE_REFERENCE_NITS;

  float transmission = materialTransmissionFactor();
  if (__MATERIAL_TRANSMISSION_SCREEN_CONDITION__) {
    vec3 transmitted = materialTransmissionScreenColor(baseColor.rgb, normal, viewDirection);
    float NdotV = max(dot(normal, viewDirection), 0.0);
    vec3 fresnel = mix(f0, f90, fresnelPow(NdotV));
    // Transmission replaces the diffuse/body response, not the reflected lobe.
    // Retaining a Fresnel-weighted share also avoids black glass when a
    // transparent framebuffer has no backdrop to refract.
    lit = mix(lit, transmitted + lit * fresnel, transmission);
  }

  outColor = u_toneMappingSettings.z > 0.5
    ? vec4(lit, baseColor.a)
    : outputMappedColor(lit, baseColor.a);
}
