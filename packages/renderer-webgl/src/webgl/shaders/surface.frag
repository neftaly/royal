#version 300 es
precision mediump float;

in vec3 v_normal;
in vec4 v_tangent;
in vec3 v_worldPosition;
in vec2 v_uv;
in vec2 v_emissive_uv;
in vec4 v_color;

#define MAX_SURFACE_LIGHTS __MAX_SURFACE_LIGHTS__

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

// Material state.
uniform vec4 u_color;
uniform vec4 u_alphaSettings;
uniform vec4 u_emissiveColor;

// Direct lights.
uniform int u_surfaceLightCount;
uniform int u_surfaceLightKind[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightColor[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightDirection[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightPosition[MAX_SURFACE_LIGHTS];
uniform vec4 u_surfaceLightCone[MAX_SURFACE_LIGHTS];

// Image-based lighting.
uniform bool u_useIblIrradiance;
uniform vec4 u_iblIrradianceCoefficients[9];
uniform vec4 u_iblIrradianceSettings;
uniform mat4 u_iblWorldToIbl;
uniform bool u_useIblSpecular;
uniform bool u_useIblBrdfLut;
uniform vec4 u_iblSpecularSettings;

__SURFACE_SAMPLER_UNIFORMS__

// PBR and glTF extension factors.
uniform vec4 u_materialPbrFactors;
uniform vec4 u_toneMappingSettings;
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

vec3 toneMapAces(vec3 color) {
  vec3 safeColor = max(color, vec3(0.0));

  return clamp(
    (safeColor * (2.51 * safeColor + 0.03)) / (safeColor * (2.43 * safeColor + 0.59) + 0.14),
    vec3(0.0),
    vec3(1.0)
  );
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
    ? toneMapAces(exposed)
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
  float textureSpecular = __SPECULAR_TEXTURE_EXPR__;

  return clamp(u_materialExtensionFactors.x * textureSpecular, 0.0, 1.0);
}

vec3 materialSpecularColorFactor() {
  vec3 textureSpecularColor = __SPECULAR_COLOR_TEXTURE_EXPR__;

  return max(u_specularColorFactor.rgb * textureSpecularColor, vec3(0.0));
}

float materialClearcoatFactor() {
  float textureClearcoat = __CLEARCOAT_TEXTURE_EXPR__;

  return clamp(u_materialExtensionFactors.z * textureClearcoat, 0.0, 1.0);
}

float materialClearcoatRoughnessFactor() {
  float textureRoughness = __CLEARCOAT_ROUGHNESS_TEXTURE_EXPR__;

  return clamp(u_materialExtensionFactors.w * textureRoughness, 0.0, 1.0);
}

vec3 materialSheenColor() {
  vec3 textureSheenColor = __SHEEN_COLOR_TEXTURE_EXPR__;

  return max(u_sheenColorFactor.rgb * textureSheenColor, vec3(0.0));
}

float materialSheenRoughness() {
  float textureRoughness = __SHEEN_ROUGHNESS_TEXTURE_EXPR__;

  return clamp(u_sheenColorFactor.a * textureRoughness, 0.0, 1.0);
}

float materialIridescenceFactor() {
  float textureIridescence = __IRIDESCENCE_TEXTURE_EXPR__;

  return clamp(u_iridescenceFactors.x * textureIridescence, 0.0, 1.0);
}

float materialIridescenceThickness() {
  float minimumThickness = max(u_iridescenceFactors.z, 0.0);
  float maximumThickness = max(u_iridescenceFactors.w, 0.0);
  float textureThickness = __IRIDESCENCE_THICKNESS_TEXTURE_EXPR__;

  return mix(minimumThickness, maximumThickness, clamp(textureThickness, 0.0, 1.0));
}

float materialTransmissionFactor() {
  float textureTransmission = __MATERIAL_TRANSMISSION_TEXTURE_EXPR__;

  return clamp(u_transmissionVolumeFactors.x * textureTransmission, 0.0, 1.0);
}

float materialThicknessFactor() {
  float textureThickness = __THICKNESS_TEXTURE_EXPR__;

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
  float textureMetallic = __METALLIC_TEXTURE_EXPR__;

  return clamp(u_materialPbrFactors.x * textureMetallic, 0.0, 1.0);
}

float materialRoughnessFactor() {
  float textureRoughness = __ROUGHNESS_TEXTURE_EXPR__;

  return clamp(u_materialPbrFactors.y * textureRoughness, 0.04, 1.0);
}

vec3 materialDiffuseColor(vec3 baseColor) {
  return baseColor * (1.0 - materialMetallicFactor());
}

vec3 materialEmissiveColor() {
  vec3 textureEmissive = __EMISSIVE_TEXTURE_EXPR__;

  return u_emissiveColor.rgb * textureEmissive;
}

float materialOcclusion() {
  __MATERIAL_OCCLUSION_BODY__
}

vec3 materialFallbackTangent(vec3 normal) {
  if (dot(normal, normal) <= 0.0001) {
    return vec3(1.0, 0.0, 0.0);
  }

  vec3 positionDx = dFdx(v_worldPosition);
  vec3 positionDy = dFdy(v_worldPosition);
  vec2 uvDx = dFdx(v_uv);
  vec2 uvDy = dFdy(v_uv);
  float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;

  if (abs(determinant) > 0.000001) {
    vec3 rawTangent = (positionDx * uvDy.y - positionDy * uvDx.y) / determinant;
    vec3 projectedTangent = rawTangent - normal * dot(normal, rawTangent);
    if (dot(projectedTangent, projectedTangent) > 0.0001) {
      return normalize(projectedTangent);
    }
  }

  vec3 orthogonalAxis = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);

  return normalize(cross(orthogonalAxis, normal));
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
  __MATERIAL_NORMAL_BODY__
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

float materialGgxDistribution(float NdotH, float roughness) {
  float alpha = max(roughness * roughness, 0.001);
  float alphaSquared = alpha * alpha;
  float denominator = NdotH * NdotH * (alphaSquared - 1.0) + 1.0;

  return alphaSquared / max(PI * denominator * denominator, 0.0001);
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
  float denominator = TdotH * TdotH / (alphaT * alphaT)
    + BdotH * BdotH / (alphaB * alphaB)
    + NdotH * NdotH;

  return 1.0 / max(PI * alphaT * alphaB * denominator * denominator, 0.0001);
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
  __MATERIAL_TRANSMISSION_SCREEN_BODY__
}

vec3 cameraWorldPosition() {
  return -transpose(mat3(u_view)) * u_view[3].xyz;
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
  if (!u_useIblIrradiance) {
    return vec3(0.0);
  }

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

vec3 iblSpecularBrdf(vec3 baseColor, float roughness, float NdotV) {
  vec2 brdf = iblEnvironmentBrdf(roughness, NdotV);

  return (materialF0(baseColor) * brdf.x + materialF90() * brdf.y) * materialIridescenceTint(NdotV);
}

vec3 iblSpecularRadiance(vec3 normal, vec3 viewDirection, vec3 baseColor) {
  __IBL_SPECULAR_RADIANCE_BODY__
}

vec3 lightContribution(int index, vec3 normal, vec3 viewDirection, vec3 worldPosition, vec3 baseColor) {
  int lightKind = u_surfaceLightKind[index];
  vec3 lightVector;
  float attenuation = 1.0;

  if (lightKind == 0) {
    lightVector = normalize(-u_surfaceLightDirection[index].xyz);
  } else {
    vec3 lightOffset = u_surfaceLightPosition[index].xyz - worldPosition;
    float distanceToLight = length(lightOffset);
    lightVector = distanceToLight <= 0.0001 ? vec3(0.0, 1.0, 0.0) : lightOffset / distanceToLight;
    attenuation = rangeAttenuation(distanceToLight, u_surfaceLightDirection[index].w);

    if (lightKind == 2) {
      float spotCosine = dot(normalize(u_surfaceLightDirection[index].xyz), -lightVector);
      float spotAttenuation = clamp(
        (spotCosine - u_surfaceLightCone[index].y)
          / max(u_surfaceLightCone[index].x - u_surfaceLightCone[index].y, 0.001),
        0.0,
        1.0
      );
      attenuation *= spotAttenuation * spotAttenuation;
    }
  }

  float lambert = max(dot(normal, lightVector), 0.0);
  float diffuseTransmissionLambert = max(dot(-normal, lightVector), 0.0);
  vec3 lightColor = u_surfaceLightColor[index].rgb * attenuation;
  float metallic = materialMetallicFactor();
  vec3 diffuseColor = baseColor * (1.0 - metallic);
  float diffuseTransmissionFactor = clamp(u_diffuseTransmissionFactors.a, 0.0, 1.0);
  vec3 diffuseTransmissionColorFactor = clamp(u_diffuseTransmissionFactors.rgb, vec3(0.0), vec3(1.0));
  vec3 diffuse = diffuseColor * (lambert / PI) * lightColor;
  vec3 diffuseTransmission =
    diffuseColor
    * diffuseTransmissionColorFactor
    * diffuseTransmissionFactor
    * (diffuseTransmissionLambert / PI)
    * lightColor;

  if (lambert <= 0.0) {
    return diffuse + diffuseTransmission;
  }

  vec3 halfVectorInput = lightVector + viewDirection;
  vec3 halfVector = length(halfVectorInput) <= 0.0001 ? normal : normalize(halfVectorInput);
  float NdotV = max(dot(normal, viewDirection), 0.0);
  float NdotH = max(dot(normal, halfVector), 0.0);
  float roughness = materialRoughnessFactor();
  float VdotH = max(dot(viewDirection, halfVector), 0.0);
  float specularFactor = materialSpecularFactor();
  vec3 specularColorFactor = materialSpecularColorFactor();
  vec3 dielectricF0 = min(vec3(iorF0(u_materialExtensionFactors.y)) * specularColorFactor, vec3(1.0)) * specularFactor;
  vec3 f0 = mix(dielectricF0, baseColor, metallic);
  vec3 f90 = mix(vec3(specularFactor), vec3(1.0), metallic);
  vec3 fresnel = mix(f0, f90, fresnelPow(VdotH)) * materialIridescenceTint(VdotH);
  float distribution = materialAnisotropicGgxDistribution(normal, halfVector, roughness);
  float visibility = materialSmithVisibility(lambert, NdotV, roughness);
  vec3 specular = fresnel * min(distribution * visibility * lambert, 4.0) * lightColor;
  vec3 lighting = diffuse * (1.0 - clamp(maxComponent(fresnel), 0.0, 1.0)) + specular + diffuseTransmission;

  lighting *= materialSheenAlbedoScale(NdotV);
  lighting += materialSheenContribution(normal, viewDirection, lightVector, halfVector, lambert, lightColor);

  float clearcoat = materialClearcoatFresnel(normal, viewDirection);
  if (clearcoat <= 0.0) {
    return lighting;
  }

  float clearcoatShape = pow(NdotH, materialClearcoatShininess()) * lambert;

  return mix(lighting, vec3(clearcoatShape) * lightColor, clearcoat);
}

void main() {
  vec4 baseColor = (__BASE_COLOR_EXPR__) * v_color;
  if (u_alphaSettings.x > 0.5 && u_alphaSettings.x < 1.5 && baseColor.a < u_alphaSettings.y) {
    discard;
  }

  if (u_alphaSettings.x < 1.5) {
    baseColor.a = 1.0;
  }

  if (u_unlit) {
    outColor = outputLinearColor(baseColor.rgb, baseColor.a);
    return;
  }

  vec3 normal = materialNormal(normalize(v_normal));
  vec3 viewVector = cameraWorldPosition() - v_worldPosition;
  vec3 viewDirection = length(viewVector) <= 0.0001 ? normal : normalize(viewVector);
  float viewClearcoat = materialClearcoatFresnel(normal, viewDirection);
  float occlusion = materialOcclusion();
  vec3 ambientIrradiance = iblDiffuseIrradiance(normal);
  vec3 lit = materialDiffuseColor(baseColor.rgb) * ambientIrradiance
    * occlusion
    * (1.0 - viewClearcoat)
    * materialSheenAlbedoScale(max(dot(normal, viewDirection), 0.0));

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

  outColor = outputMappedColor(lit, baseColor.a);
}
