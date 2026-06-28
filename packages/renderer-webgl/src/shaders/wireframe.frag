#version 300 es

precision highp float;

in vec3 v_barycentric;

uniform vec4 u_color;
uniform float u_width;

out vec4 fragColor;

void main() {
  vec3 width = fwidth(v_barycentric) * u_width;
  vec3 edgeBlend = smoothstep(vec3(0.0), width, v_barycentric);
  float edge = 1.0 - min(min(edgeBlend.x, edgeBlend.y), edgeBlend.z);

  if (edge <= 0.0) discard;

  fragColor = vec4(u_color.rgb, u_color.a * edge);
}
