attribute vec3 a_normal;
attribute vec3 a_position;
attribute vec2 a_texCoord;

uniform mat4 u_model;
uniform mat4 u_viewProjection;

varying vec3 v_normal;
varying vec2 v_texCoord;

void main() {
  v_normal = mat3(u_model) * a_normal;
  v_texCoord = a_texCoord;
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
