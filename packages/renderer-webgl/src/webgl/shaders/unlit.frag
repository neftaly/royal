#version 300 es
precision highp float;
uniform vec4 linearColor;
#ifdef ALPHA_MASK
uniform float alphaCutoff;
#endif
#ifdef TEXTURED
in vec2 surfaceBaseColorTextureCoordinate;
uniform sampler2D baseColorTexture;
#endif
out vec4 outputColor;
vec3 linearToSrgb(vec3 value) {
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  vec3 lower = value * 12.92;
  vec3 upper = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, low);
}
void main() {
  vec4 color = linearColor;
#ifdef TEXTURED
  color *= texture(baseColorTexture, surfaceBaseColorTextureCoordinate);
#endif
#ifdef ALPHA_MASK
  if (color.a < alphaCutoff) discard;
#endif
  outputColor = vec4(linearToSrgb(color.rgb), 1.0);
}
