#version 300 es
precision highp float;
__VIRTUAL_TEXTURE_DECLARATIONS__
uniform vec4 linearColor;
#ifdef VERTEX_COLOR
in vec4 surfaceVertexColor;
#endif
#ifdef ALPHA_MASK
uniform float alphaCutoff;
#endif
#if defined(BASE_COLOR_TEXTURED) || defined(VIRTUAL_BASE_COLOR_TEXTURED)
in vec2 surfaceBaseColorTextureCoordinate;
#endif
#ifdef BASE_COLOR_TEXTURED
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
#ifdef BASE_COLOR_TEXTURED
  color *= texture(baseColorTexture, surfaceBaseColorTextureCoordinate);
#elif defined(VIRTUAL_BASE_COLOR_TEXTURED)
  color *= sampleVirtualBaseColor(surfaceBaseColorTextureCoordinate);
#endif
#ifdef VERTEX_COLOR
  color *= surfaceVertexColor;
#endif
#ifdef ALPHA_MASK
  if (color.a < alphaCutoff) discard;
#endif
#ifdef LINEAR_OUTPUT
  outputColor = color;
#else
  outputColor = vec4(linearToSrgb(color.rgb), color.a);
#endif
}
