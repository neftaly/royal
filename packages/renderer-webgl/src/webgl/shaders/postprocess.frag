#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_hdrColor;
uniform vec2 u_displayTransform;
out vec4 outColor;

vec3 toneMapAcesFitted(vec3 color) {
  vec3 safeColor = max(color, vec3(0.0));
  return clamp(
    (safeColor * (2.51 * safeColor + 0.03)) / (safeColor * (2.43 * safeColor + 0.59) + 0.14),
    vec3(0.0),
    vec3(1.0)
  );
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

void main() {
  vec4 scene = texture(u_hdrColor, v_uv);
  vec3 straightColor = scene.a > 0.000001 ? scene.rgb / scene.a : scene.rgb;
  vec3 exposed = straightColor * max(u_displayTransform.y, 0.0);
  vec3 mapped = u_displayTransform.x > 1.5
    ? toneMapPbrNeutral(exposed)
    : u_displayTransform.x > 0.5
      ? toneMapAcesFitted(exposed)
      : clamp(exposed, vec3(0.0), vec3(1.0));
  outColor = vec4(linearToSrgb(mapped) * scene.a, scene.a);
}
