attribute vec3 a_position;
attribute vec2 a_glyphCoord;

uniform mat4 u_viewProjection;

varying vec2 v_glyphCoord;

void main() {
  v_glyphCoord = a_glyphCoord;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
