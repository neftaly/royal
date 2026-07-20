#version 300 es
precision highp float;
__VIRTUAL_TEXTURE_DECLARATIONS__
#define MAX_DIRECTIONAL_LIGHTS __MAX_DIRECTIONAL_LIGHTS__
#define MAX_PUNCTUAL_LIGHTS __MAX_PUNCTUAL_LIGHTS__
in vec3 worldNormal;
in vec3 worldPosition;
#ifdef VERTEX_COLOR
in vec4 surfaceVertexColor;
#endif
#ifdef BASE_COLOR_TEXTURED
in vec2 surfaceBaseColorTextureCoordinate;
uniform sampler2D baseColorTexture;
#elif defined(VIRTUAL_BASE_COLOR_TEXTURED)
in vec2 surfaceBaseColorTextureCoordinate;
#endif
#ifdef METALLIC_ROUGHNESS_TEXTURED
in vec2 surfaceMetallicRoughnessTextureCoordinate;
uniform sampler2D metallicRoughnessTexture;
#endif
#ifdef NORMAL_TEXTURED
in vec2 surfaceNormalTextureCoordinate;
uniform sampler2D normalTexture;
#ifdef TANGENT
in vec3 worldBitangent;
in vec3 worldTangent;
#endif
#endif
#ifdef EMISSIVE_TEXTURED
in vec2 surfaceEmissiveTextureCoordinate;
uniform sampler2D emissiveTexture;
#endif
#ifdef OCCLUSION_TEXTURED
in vec2 surfaceOcclusionTextureCoordinate;
uniform sampler2D occlusionTexture;
uniform float occlusionStrength;
#endif
#ifdef SPECULAR_TEXTURED
in vec2 surfaceSpecularTextureCoordinate;
uniform sampler2D specularTexture;
#endif
#ifdef SPECULAR_COLOR_TEXTURED
in vec2 surfaceSpecularColorTextureCoordinate;
uniform sampler2D specularColorTexture;
#endif
__TRANSMISSION_DECLARATIONS__
#if defined(STUDIO_ENVIRONMENT) || defined(PREFILTERED_ENVIRONMENT)
uniform mat4 environmentRotation;
uniform vec4 environmentSettings;
#endif
#ifdef PREFILTERED_ENVIRONMENT
uniform vec4 environmentCoefficients[9];
uniform samplerCube environmentSpecularTexture;
#endif
uniform vec4 baseColor;
uniform vec4 cameraWorldPosition;
uniform vec4 directionalLightColors[MAX_DIRECTIONAL_LIGHTS];
uniform int directionalLightCount;
uniform vec4 directionalLightDirections[MAX_DIRECTIONAL_LIGHTS];
uniform vec4 emissiveFactor;
uniform vec4 materialFactors;
uniform vec4 presentation;
#ifdef SPECULAR_MATERIAL
uniform vec4 specularFactors;
#endif
#ifdef PUNCTUAL_LIGHTS
uniform vec4 punctualLightColors[MAX_PUNCTUAL_LIGHTS];
uniform int punctualLightCount;
uniform vec4 punctualLightDirections[MAX_PUNCTUAL_LIGHTS];
uniform vec4 punctualLightPositions[MAX_PUNCTUAL_LIGHTS];
uniform vec4 punctualLightSpotCones[MAX_PUNCTUAL_LIGHTS];
#endif
out vec4 outputColor;
const float PI = 3.141592653589793;
float fresnelPower(float cosine) {
  float value = clamp(1.0 - cosine, 0.0, 1.0);
  float squared = value * value;
  return squared * squared * value;
}
float ggxDistribution(float normalHalf, float alphaSquared) {
  float denominator = normalHalf * normalHalf * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / max(PI * denominator * denominator, 0.0001);
}
float smithVisibility(float normalLight, float normalView, float alphaSquared) {
  float lambdaView = normalLight * sqrt(max(
    normalView * normalView * (1.0 - alphaSquared) + alphaSquared,
    0.0
  ));
  float lambdaLight = normalView * sqrt(max(
    normalLight * normalLight * (1.0 - alphaSquared) + alphaSquared,
    0.0
  ));
  return 0.5 / max(lambdaView + lambdaLight, 0.0001);
}
vec3 brdfContribution(
  vec3 normal,
  vec3 lightDirection,
  vec3 viewDirection,
  vec3 f0,
  vec3 f90,
  vec3 diffuseColor,
  float normalView,
  float alphaSquared
) {
  float normalLight = max(dot(normal, lightDirection), 0.0);
  if (normalLight <= 0.0) return vec3(0.0);
  vec3 halfwayInput = lightDirection + viewDirection;
  vec3 halfway = dot(halfwayInput, halfwayInput) <= 0.00000001
    ? normal
    : normalize(halfwayInput);
  float normalHalf = max(dot(normal, halfway), 0.0);
  float viewHalf = max(dot(viewDirection, halfway), 0.0);
  vec3 fresnel = mix(f0, f90, fresnelPower(viewHalf));
  vec3 diffuse = diffuseColor * (1.0 - max(max(fresnel.r, fresnel.g), fresnel.b)) / PI;
  vec3 specular = fresnel
    * ggxDistribution(normalHalf, alphaSquared)
    * smithVisibility(normalLight, normalView, alphaSquared);
  return (diffuse + specular) * normalLight;
}
__PRESENTATION_FUNCTIONS__
void main() {
  vec4 surfaceBaseColor = baseColor;
#ifdef BASE_COLOR_TEXTURED
  surfaceBaseColor *= texture(baseColorTexture, surfaceBaseColorTextureCoordinate);
#elif defined(VIRTUAL_BASE_COLOR_TEXTURED)
  surfaceBaseColor *= sampleVirtualBaseColor(surfaceBaseColorTextureCoordinate);
#endif
#ifdef VERTEX_COLOR
  surfaceBaseColor *= surfaceVertexColor;
#endif
#ifdef ALPHA_MASK
  if (surfaceBaseColor.a < materialFactors.z) discard;
#endif
  vec3 normal = worldNormal;
  if (dot(normal, normal) <= 0.00000001) {
    normal = cross(dFdx(worldPosition), dFdy(worldPosition));
  }
  normal = normalize(normal);
#ifdef NORMAL_TEXTURED
  vec3 mappedNormal = texture(normalTexture, surfaceNormalTextureCoordinate).xyz * 2.0 - 1.0;
  mappedNormal.xy *= materialFactors.w;
#ifdef TANGENT
  normal = normalize(
    worldTangent * mappedNormal.x
    + worldBitangent * mappedNormal.y
    + normal * mappedNormal.z
  );
#else
  vec3 positionDx = dFdx(worldPosition);
  vec3 positionDy = dFdy(worldPosition);
  vec2 uvDx = dFdx(surfaceNormalTextureCoordinate);
  vec2 uvDy = dFdy(surfaceNormalTextureCoordinate);
  vec3 positionDyPerpendicular = cross(positionDy, normal);
  vec3 positionDxPerpendicular = cross(normal, positionDx);
  vec3 tangent = positionDyPerpendicular * uvDx.x
    + positionDxPerpendicular * uvDy.x;
  // glTF images grow downward in V while OpenGL normal maps encode +Y upward.
  vec3 bitangent = -(positionDyPerpendicular * uvDx.y
    + positionDxPerpendicular * uvDy.y);
  float tangentLengthSquared = max(dot(tangent, tangent), dot(bitangent, bitangent));
  float tangentScale = tangentLengthSquared > 0.0
    ? inversesqrt(tangentLengthSquared)
    : 0.0;
  tangent *= tangentScale;
  bitangent *= tangentScale;
  normal = normalize(mat3(tangent, bitangent, normal) * mappedNormal);
#endif
#endif
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) normal = -normal;
#endif
  vec3 viewVector = cameraWorldPosition.xyz - worldPosition;
  vec3 viewDirection = dot(viewVector, viewVector) <= 0.00000001
    ? normal
    : normalize(viewVector);
  float metallic = materialFactors.x;
  float roughness = materialFactors.y;
#ifdef METALLIC_ROUGHNESS_TEXTURED
  vec4 metallicRoughnessSample = texture(
    metallicRoughnessTexture,
    surfaceMetallicRoughnessTextureCoordinate
  );
  metallic *= metallicRoughnessSample.b;
  roughness *= metallicRoughnessSample.g;
#endif
  roughness = clamp(roughness, 0.04, 1.0);
  float alpha = max(roughness * roughness, 0.001);
  float alphaSquared = alpha * alpha;
  vec3 dielectric = vec3(emissiveFactor.w);
  float specularWeight = 1.0;
#ifdef SPECULAR_MATERIAL
  vec3 specularColor = specularFactors.rgb;
  specularWeight = specularFactors.a;
#ifdef SPECULAR_TEXTURED
  specularWeight *= texture(specularTexture, surfaceSpecularTextureCoordinate).a;
#endif
#ifdef SPECULAR_COLOR_TEXTURED
  specularColor *= texture(specularColorTexture, surfaceSpecularColorTextureCoordinate).rgb;
#endif
  dielectric = min(dielectric * specularColor, vec3(1.0));
#endif
  vec3 f0 = mix(dielectric * specularWeight, surfaceBaseColor.rgb, metallic);
  vec3 f90 = vec3(mix(specularWeight, 1.0, metallic));
  vec3 diffuseColor = surfaceBaseColor.rgb * (1.0 - metallic);
  float normalView = max(dot(normal, viewDirection), 0.0);
  vec3 lit = vec3(0.0);
  for (int index = 0; index < MAX_DIRECTIONAL_LIGHTS; index += 1) {
    if (index >= directionalLightCount) break;
    vec3 lightDirection = -directionalLightDirections[index].xyz;
    lit += brdfContribution(
      normal,
      lightDirection,
      viewDirection,
      f0,
      f90,
      diffuseColor,
      normalView,
      alphaSquared
    ) * directionalLightColors[index].rgb;
  }
#ifdef PUNCTUAL_LIGHTS
  for (int index = 0; index < MAX_PUNCTUAL_LIGHTS; index += 1) {
    if (index >= punctualLightCount) break;
    vec3 toLight = punctualLightPositions[index].xyz - worldPosition;
    float distanceSquared = max(dot(toLight, toLight), 0.000001);
    vec3 lightDirection = toLight * inversesqrt(distanceSquared);
    float attenuation = 1.0 / distanceSquared;
    float range = punctualLightPositions[index].w;
    if (range > 0.0) {
      float ratioSquared = distanceSquared / (range * range);
      float rangeAttenuation = max(1.0 - ratioSquared * ratioSquared, 0.0);
      attenuation *= rangeAttenuation * rangeAttenuation;
    }
    if (punctualLightDirections[index].w > 0.5) {
      float angleCosine = dot(-lightDirection, punctualLightDirections[index].xyz);
      attenuation *= smoothstep(
        punctualLightSpotCones[index].y,
        punctualLightSpotCones[index].x,
        angleCosine
      );
    }
    lit += brdfContribution(
      normal,
      lightDirection,
      viewDirection,
      f0,
      f90,
      diffuseColor,
      normalView,
      alphaSquared
    ) * punctualLightColors[index].rgb * attenuation;
  }
#endif
#if defined(STUDIO_ENVIRONMENT) || defined(PREFILTERED_ENVIRONMENT)
  float occlusion = 1.0;
#ifdef OCCLUSION_TEXTURED
  occlusion = mix(
    1.0,
    texture(occlusionTexture, surfaceOcclusionTextureCoordinate).r,
    occlusionStrength
  );
#endif
  vec3 environmentNormal = mat3(environmentRotation) * normal;
  vec3 environmentReflection = mat3(environmentRotation) * reflect(-viewDirection, normal);
#ifdef PREFILTERED_ENVIRONMENT
  vec3 diffuseRadiance = environmentCoefficients[0].rgb * 0.282095;
  diffuseRadiance += environmentCoefficients[1].rgb * (0.488603 * environmentNormal.y);
  diffuseRadiance += environmentCoefficients[2].rgb * (0.488603 * environmentNormal.z);
  diffuseRadiance += environmentCoefficients[3].rgb * (0.488603 * environmentNormal.x);
  diffuseRadiance += environmentCoefficients[4].rgb * (
    1.092548 * environmentNormal.x * environmentNormal.y
  );
  diffuseRadiance += environmentCoefficients[5].rgb * (
    1.092548 * environmentNormal.y * environmentNormal.z
  );
  diffuseRadiance += environmentCoefficients[6].rgb * (
    0.315392 * (3.0 * environmentNormal.z * environmentNormal.z - 1.0)
  );
  diffuseRadiance += environmentCoefficients[7].rgb * (
    1.092548 * environmentNormal.x * environmentNormal.z
  );
  diffuseRadiance += environmentCoefficients[8].rgb * (
    0.546274 * (
      environmentNormal.x * environmentNormal.x
      - environmentNormal.y * environmentNormal.y
    )
  );
  diffuseRadiance = max(diffuseRadiance, vec3(0.0));
  vec3 specularRadiance = textureLod(
    environmentSpecularTexture,
    environmentReflection,
    roughness * environmentSettings.y
  ).rgb;
  vec4 brdf0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 brdf1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 brdfFactors = roughness * brdf0 + brdf1;
  float brdfA004 = min(
    brdfFactors.x * brdfFactors.x,
    exp2(-9.28 * normalView)
  ) * brdfFactors.x + brdfFactors.y;
  vec2 environmentBrdf = vec2(-1.04, 1.04) * brdfA004 + brdfFactors.zw;
  vec3 specularResponse = f0 * environmentBrdf.x + f90 * environmentBrdf.y;
#else
  float diffuseHeight = environmentNormal.y * 0.5 + 0.5;
  float reflectionHeight = environmentReflection.y * 0.5 + 0.5;
  vec3 diffuseRadiance = mix(
    vec3(0.055, 0.065, 0.08),
    vec3(0.52, 0.63, 0.82),
    diffuseHeight
  );
  vec3 specularRadiance = mix(
    vec3(0.08, 0.075, 0.07),
    vec3(0.8, 0.88, 1.0),
    reflectionHeight
  );
  vec3 environmentFresnel = mix(f0, f90, fresnelPower(normalView));
  float specularFocus = mix(1.0, 0.18, roughness);
  vec3 specularResponse = environmentFresnel * specularFocus;
#endif
  vec3 environment = (
    diffuseRadiance * diffuseColor * occlusion / PI
    + specularRadiance * specularResponse * occlusion
  ) * environmentSettings.x;
  lit += environment;
#endif
  vec3 emissive = emissiveFactor.rgb;
#ifdef EMISSIVE_TEXTURED
  emissive *= texture(emissiveTexture, surfaceEmissiveTextureCoordinate).rgb;
#endif
  vec3 linear = lit + emissive;
__TRANSMISSION_BODY__
#ifdef LINEAR_OUTPUT
  outputColor = vec4(linear, surfaceBaseColor.a);
#else
  vec3 exposed = linear * max(presentation.x, 0.0);
  vec3 mapped = presentation.y > 0.5 ? pbrNeutral(exposed) : clamp(exposed, 0.0, 1.0);
  outputColor = vec4(linearToSrgb(mapped), surfaceBaseColor.a);
#endif
}
