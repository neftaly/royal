attribute vec3 a_normal;
attribute vec3 a_position;

uniform vec3 u_boxSize;
uniform mat4 u_model;
uniform mat4 u_viewProjection;

varying vec3 v_normal;
varying vec2 v_texCoord;

vec2 boxTexCoord(vec3 position, vec3 normal) {
  vec3 axis = abs(normal);
  vec3 size = max(u_boxSize, vec3(0.000001));

  if (axis.z >= axis.x && axis.z >= axis.y) {
    return position.xy / size.xy + 0.5;
  }

  if (axis.y >= axis.x) {
    return position.xz / size.xz + 0.5;
  }

  return position.zy / size.zy + 0.5;
}

void main() {
  v_normal = mat3(u_model) * a_normal;
  v_texCoord = boxTexCoord(a_position, a_normal);
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
