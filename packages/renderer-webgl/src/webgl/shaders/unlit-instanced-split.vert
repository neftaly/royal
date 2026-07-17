#version 300 es

layout(location = 0) in vec3 a_position;
layout(location = 7) in vec2 a_uv0;
layout(location = 8) in vec2 a_uv1;
layout(location = 9) in vec4 a_color;

layout(location = 3) in mat4 a_instanceModel;

uniform mat4 u_projection;
uniform mat4 u_view;

out vec2 v_uv0;
out vec2 v_uv1;
out vec4 v_color;

void main() {
  vec4 worldPosition = a_instanceModel * vec4(a_position, 1.0);
  v_uv0 = a_uv0;
  v_uv1 = a_uv1;
  v_color = a_color;
  gl_Position = u_projection * u_view * worldPosition;
}
