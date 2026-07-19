#version 300 es
layout(location = 0) in vec3 position;
#ifdef INSTANCED
layout(location = 3) in mat4 instanceModel;
#endif
#ifdef TEXTURED
layout(location = 2) in vec2 textureCoordinate0;
layout(location = 11) in vec2 textureCoordinate1;
uniform vec4 baseColorTextureCoordinates0;
uniform vec4 baseColorTextureCoordinates1;
out vec2 surfaceBaseColorTextureCoordinate;
vec2 transformedTextureCoordinate(vec4 row0, vec4 row1) {
  vec2 uv = mix(textureCoordinate0, textureCoordinate1, row0.w);
  vec3 source = vec3(uv, 1.0);
  return vec2(dot(row0.xyz, source), dot(row1.xyz, source));
}
#endif
uniform mat4 viewProjectionModel;
void main() {
#ifdef TEXTURED
  surfaceBaseColorTextureCoordinate = transformedTextureCoordinate(
    baseColorTextureCoordinates0,
    baseColorTextureCoordinates1
  );
#endif
  vec4 localPosition = vec4(position, 1.0);
#ifdef INSTANCED
  localPosition = instanceModel * localPosition;
#endif
  gl_Position = viewProjectionModel * localPosition;
}
