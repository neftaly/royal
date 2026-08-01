#version 300 es
precision highp float;
precision highp int;
__VIRTUAL_TEXTURE_DECLARATIONS__
uniform vec4 linearColor;
#ifdef SCREEN_SPACE_PARTITION
uniform vec2 partitionCellSize;
uniform int partitionCount;
uniform int partitionIndex;
uniform highp usampler2D partitionPattern;
uniform vec2 viewportOrigin;
#endif
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
#ifdef SCREEN_SPACE_PARTITION
  uvec2 cell = uvec2(floor((gl_FragCoord.xy - viewportOrigin) / partitionCellSize));
  uint bucket = texelFetch(
    partitionPattern,
    ivec2(cell & uvec2(__SCREEN_SPACE_PARTITION_MASK__u)),
    0
  ).r;
  if (
    (bucket * uint(partitionCount) >> __SCREEN_SPACE_PARTITION_BUCKET_BITS__u)
      != uint(partitionIndex)
  ) discard;
#endif
#ifdef ALPHA_BLEND
  float surfaceAlpha = color.a;
#else
  float surfaceAlpha = 1.0;
#endif
#ifdef LINEAR_OUTPUT
  outputColor = vec4(color.rgb, surfaceAlpha);
#else
  outputColor = vec4(linearToSrgb(color.rgb), surfaceAlpha);
#endif
}
