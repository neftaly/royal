#version 300 es

in vec3 a_position;
in vec3 a_normal;
in vec4 a_tangent;
in vec2 a_uv;
in vec2 a_emissive_uv;
in vec4 a_color;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_normal;
out vec4 v_tangent;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec2 v_emissive_uv;
out vec4 v_color;

void main() {
  vec4 worldPosition = u_model * vec4(a_position, 1.0);
  mat3 modelBasis = mat3(u_model);

  v_normal = modelBasis * a_normal;
  v_tangent = vec4(modelBasis * a_tangent.xyz, a_tangent.w);
  v_worldPosition = worldPosition.xyz;
  v_uv = a_uv;
  v_emissive_uv = a_emissive_uv;
  v_color = a_color;

  gl_Position = u_projection * u_view * worldPosition;
}
