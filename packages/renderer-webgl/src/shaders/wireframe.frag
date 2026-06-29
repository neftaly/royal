#version 300 es

precision highp float;

in vec3 v_barycentric;

uniform vec4 u_color;
uniform float u_width;

out vec4 fragColor;

void main() {
  if (u_width <= 0.0 || u_color.a <= 0.0) discard;
  if (length(v_barycentric) < 0.0) discard;

  fragColor = u_color;
}
