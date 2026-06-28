attribute vec3 a_normal;
attribute vec3 a_position;

uniform mat4 u_model;
uniform mat4 u_viewProjection;

varying vec3 v_normal;

void main() {
  v_normal = mat3(u_model) * a_normal;
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
