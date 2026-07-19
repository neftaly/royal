#version 300 es
precision highp float;
__VIRTUAL_TEXTURE_DECLARATIONS__
#define MAX_DIRECTIONAL_LIGHTS __MAX_DIRECTIONAL_LIGHTS__
#define MAX_PUNCTUAL_LIGHTS __MAX_PUNCTUAL_LIGHTS__
in vec3 worldNormal;
in vec3 worldPosition;
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
in vec4 worldTangent;
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
#ifdef STUDIO_ENVIRONMENT
uniform mat4 environmentRotation;
uniform vec4 environmentSettings;
#endif
uniform vec4 baseColor;
uniform vec4 cameraWorldPosition;
uniform vec4 directionalLightColors[MAX_DIRECTIONAL_LIGHTS];
uniform int directionalLightCount;
uniform vec4 directionalLightDirections[MAX_DIRECTIONAL_LIGHTS];
uniform vec4 emissiveFactor;
uniform vec4 materialFactors;
uniform vec4 presentation;
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
  vec3 fresnel = mix(f0, vec3(1.0), fresnelPower(viewHalf));
  vec3 diffuse = diffuseColor * (1.0 - max(max(fresnel.r, fresnel.g), fresnel.b)) / PI;
  vec3 specular = fresnel
    * ggxDistribution(normalHalf, alphaSquared)
    * smithVisibility(normalLight, normalView, alphaSquared);
  return (diffuse + specular) * normalLight;
}
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float minimum = min(color.r, min(color.g, color.b));
  float offset = minimum < 0.08 ? minimum - 6.25 * minimum * minimum : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return max(color, vec3(0.0));
  float distance = 1.0 - startCompression;
  float compressed = 1.0 - distance * distance / (peak + distance - startCompression);
  color *= compressed / peak;
  float blend = 1.0 - 1.0 / (desaturation * (peak - compressed) + 1.0);
  return mix(color, vec3(compressed), blend);
}
vec3 linearToSrgb(vec3 value) {
  value = clamp(value, vec3(0.0), vec3(1.0));
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  vec3 lower = value * 12.92;
  vec3 upper = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, low);
}
void main() {
  vec4 surfaceBaseColor = baseColor;
#ifdef BASE_COLOR_TEXTURED
  surfaceBaseColor *= texture(baseColorTexture, surfaceBaseColorTextureCoordinate);
#elif defined(VIRTUAL_BASE_COLOR_TEXTURED)
  surfaceBaseColor *= sampleVirtualBaseColor(surfaceBaseColorTextureCoordinate);
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
  vec3 tangent = normalize(worldTangent.xyz - normal * dot(normal, worldTangent.xyz));
  vec3 bitangent = cross(normal, tangent) * worldTangent.w;
#else
  vec3 positionDx = dFdx(worldPosition);
  vec3 positionDy = dFdy(worldPosition);
  vec2 uvDx = dFdx(surfaceNormalTextureCoordinate);
  vec2 uvDy = dFdy(surfaceNormalTextureCoordinate);
  vec3 tangent = normalize(positionDx * uvDy.y - positionDy * uvDx.y);
  vec3 bitangent = normalize(-positionDx * uvDy.x + positionDy * uvDx.x);
#endif
  normal = normalize(mat3(tangent, bitangent, normal) * mappedNormal);
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
  vec3 f0 = mix(dielectric, surfaceBaseColor.rgb, metallic);
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
      diffuseColor,
      normalView,
      alphaSquared
    ) * punctualLightColors[index].rgb * attenuation;
  }
#endif
#ifdef STUDIO_ENVIRONMENT
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
  vec3 environmentFresnel = mix(f0, vec3(1.0), fresnelPower(normalView));
  float specularFocus = mix(1.0, 0.18, roughness);
  vec3 environment = (
    diffuseRadiance * diffuseColor * occlusion / PI
    + specularRadiance * environmentFresnel * specularFocus
  ) * environmentSettings.x;
  lit += environment;
#endif
  vec3 emissive = emissiveFactor.rgb;
#ifdef EMISSIVE_TEXTURED
  emissive *= texture(emissiveTexture, surfaceEmissiveTextureCoordinate).rgb;
#endif
  vec3 exposed = (lit + emissive) * max(presentation.x, 0.0);
  vec3 mapped = presentation.y > 0.5 ? pbrNeutral(exposed) : clamp(exposed, 0.0, 1.0);
  outputColor = vec4(linearToSrgb(mapped), surfaceBaseColor.a);
}
