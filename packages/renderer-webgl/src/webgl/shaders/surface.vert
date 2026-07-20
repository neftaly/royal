#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
#ifdef VERTEX_COLOR
layout(location = 12) in vec4 color;
out vec4 surfaceVertexColor;
#endif
#ifdef TANGENT
layout(location = 10) in vec4 tangent;
out vec4 worldTangent;
#endif
#ifdef INSTANCED
layout(location = 3) in mat4 instanceModel;
layout(location = 7) in vec3 instanceNormal0;
layout(location = 8) in vec3 instanceNormal1;
layout(location = 9) in vec4 instanceNormal2;
#endif
#ifdef TEXTURED
layout(location = 2) in vec2 textureCoordinate0;
layout(location = 11) in vec2 textureCoordinate1;
vec2 transformedTextureCoordinate(vec4 row0, vec4 row1) {
  vec2 uv = mix(textureCoordinate0, textureCoordinate1, row0.w);
  vec3 source = vec3(uv, 1.0);
  return vec2(dot(row0.xyz, source), dot(row1.xyz, source));
}
#endif
#ifdef BASE_COLOR_TEXTURED
uniform vec4 baseColorTextureCoordinates0;
uniform vec4 baseColorTextureCoordinates1;
out vec2 surfaceBaseColorTextureCoordinate;
#endif
#ifdef METALLIC_ROUGHNESS_TEXTURED
uniform vec4 metallicRoughnessTextureCoordinates0;
uniform vec4 metallicRoughnessTextureCoordinates1;
out vec2 surfaceMetallicRoughnessTextureCoordinate;
#endif
#ifdef NORMAL_TEXTURED
uniform vec4 normalTextureCoordinates0;
uniform vec4 normalTextureCoordinates1;
out vec2 surfaceNormalTextureCoordinate;
#endif
#ifdef EMISSIVE_TEXTURED
uniform vec4 emissiveTextureCoordinates0;
uniform vec4 emissiveTextureCoordinates1;
out vec2 surfaceEmissiveTextureCoordinate;
#endif
#ifdef OCCLUSION_TEXTURED
uniform vec4 occlusionTextureCoordinates0;
uniform vec4 occlusionTextureCoordinates1;
out vec2 surfaceOcclusionTextureCoordinate;
#endif
#ifdef SPECULAR_TEXTURED
uniform vec4 specularTextureCoordinates0;
uniform vec4 specularTextureCoordinates1;
out vec2 surfaceSpecularTextureCoordinate;
#endif
#ifdef SPECULAR_COLOR_TEXTURED
uniform vec4 specularColorTextureCoordinates0;
uniform vec4 specularColorTextureCoordinates1;
out vec2 surfaceSpecularColorTextureCoordinate;
#endif
__TRANSMISSION_VERTEX_DECLARATIONS__
uniform mat4 viewProjection;
uniform mat4 model;
uniform mat4 normalTransform;
out vec3 worldNormal;
out vec3 worldPosition;
void main() {
#ifdef VERTEX_COLOR
  surfaceVertexColor = color;
#endif
#ifdef TEXTURED
#ifdef BASE_COLOR_TEXTURED
  surfaceBaseColorTextureCoordinate = transformedTextureCoordinate(
    baseColorTextureCoordinates0,
    baseColorTextureCoordinates1
  );
#endif
#ifdef METALLIC_ROUGHNESS_TEXTURED
  surfaceMetallicRoughnessTextureCoordinate = transformedTextureCoordinate(
    metallicRoughnessTextureCoordinates0,
    metallicRoughnessTextureCoordinates1
  );
#endif
#ifdef NORMAL_TEXTURED
  surfaceNormalTextureCoordinate = transformedTextureCoordinate(
    normalTextureCoordinates0,
    normalTextureCoordinates1
  );
#endif
#ifdef EMISSIVE_TEXTURED
  surfaceEmissiveTextureCoordinate = transformedTextureCoordinate(
    emissiveTextureCoordinates0,
    emissiveTextureCoordinates1
  );
#endif
#ifdef OCCLUSION_TEXTURED
  surfaceOcclusionTextureCoordinate = transformedTextureCoordinate(
    occlusionTextureCoordinates0,
    occlusionTextureCoordinates1
  );
#endif
#ifdef SPECULAR_TEXTURED
  surfaceSpecularTextureCoordinate = transformedTextureCoordinate(
    specularTextureCoordinates0,
    specularTextureCoordinates1
  );
#endif
#ifdef SPECULAR_COLOR_TEXTURED
  surfaceSpecularColorTextureCoordinate = transformedTextureCoordinate(
    specularColorTextureCoordinates0,
    specularColorTextureCoordinates1
  );
#endif
__TRANSMISSION_VERTEX_BODY__
#endif
  vec4 localPosition = vec4(position, 1.0);
#ifdef INSTANCED
  localPosition = instanceModel * localPosition;
#endif
  vec4 world = model * localPosition;
  worldPosition = world.xyz;
#ifdef INSTANCED
  mat3 instanceNormal = mat3(instanceNormal0, instanceNormal1, instanceNormal2.xyz);
  worldNormal = mat3(normalTransform) * instanceNormal * normal;
#else
  worldNormal = mat3(normalTransform) * normal;
#endif
#ifdef TANGENT
  vec3 localTangent = tangent.xyz;
  float tangentHandedness = tangent.w;
#ifdef INSTANCED
  localTangent = mat3(instanceModel) * localTangent;
  tangentHandedness *= instanceNormal2.w;
#endif
  worldTangent = vec4(
    normalize(mat3(model) * localTangent),
    tangentHandedness * normalTransform[3][3]
  );
#endif
  gl_Position = viewProjection * world;
}
