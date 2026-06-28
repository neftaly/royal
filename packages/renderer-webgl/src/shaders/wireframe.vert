#version 300 es

in vec3 a_barycentric;
in vec3 a_position;

uniform mat4 u_model;
uniform mat4 u_viewProjection;

out vec3 v_barycentric;

void main() {
  v_barycentric = a_barycentric;
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
