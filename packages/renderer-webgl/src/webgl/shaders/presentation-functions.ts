/** Shared scene-linear to sRGB encoding used by every direct presentation lane. */
export const LINEAR_TO_SRGB_GLSL = `
vec3 linearToSrgb(vec3 value) {
  value = clamp(value, vec3(0.0), vec3(1.0));
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  vec3 lower = value * 12.92;
  vec3 upper = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, low);
}`;

/** Shared terminal color transform used by direct and retained-HDR presentation. */
export const PRESENTATION_GLSL = `
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
${LINEAR_TO_SRGB_GLSL}
`;
