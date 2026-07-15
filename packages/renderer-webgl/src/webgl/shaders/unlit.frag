#version 300 es
precision highp float;

in vec2 v_uv0;
in vec2 v_uv1;
in vec4 v_color;

uniform vec4 u_color;
uniform vec4 u_alphaSettings;
__SURFACE_TEXTURE_COORDINATE_UNIFORMS__
uniform vec4 u_toneMappingSettings;

__SURFACE_SAMPLER_UNIFORMS__
__BASE_COLOR_VIRTUAL_TEXTURE_UNIFORMS__

out vec4 outColor;

vec2 materialTextureUv(int uvSet, vec4 row0, vec4 row1) {
  vec2 source = uvSet == 1 ? v_uv1 : v_uv0;
  vec3 homogeneous = vec3(source, 1.0);
  return vec2(dot(row0.xyz, homogeneous), dot(row1.xyz, homogeneous));
}

__BASE_COLOR_VIRTUAL_TEXTURE_FUNCTIONS__

vec3 linearToSrgb(vec3 color) {
  vec3 safeColor = clamp(color, vec3(0.0), vec3(1.0));
  vec3 linearSegment = safeColor * 12.92;
  vec3 powerSegment = 1.055 * pow(safeColor, vec3(1.0 / 2.4)) - 0.055;
  return mix(powerSegment, linearSegment, lessThanEqual(safeColor, vec3(0.0031308)));
}

void main() {
  vec4 baseColor = (__BASE_COLOR_EXPR__) * v_color;
  if (u_alphaSettings.x > 0.5 && u_alphaSettings.x < 1.5 && baseColor.a < u_alphaSettings.y) {
    discard;
  }
  if (u_alphaSettings.x < 1.5) baseColor.a = 1.0;

  outColor = u_toneMappingSettings.z > 0.5
    ? vec4(baseColor.rgb / max(u_toneMappingSettings.y, 0.000001), baseColor.a)
    : vec4(linearToSrgb(baseColor.rgb), baseColor.a);
}
