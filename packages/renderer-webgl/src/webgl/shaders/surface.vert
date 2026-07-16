#version 300 es

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_tangent;
layout(location = 10) in vec2 a_uv0;
layout(location = 11) in vec2 a_uv1;
layout(location = 12) in vec4 a_color;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform mat4 u_modelNormalTransform;

out vec3 v_normal;
out vec4 v_tangent;
out vec3 v_worldPosition;
out vec2 v_uv0;
out vec2 v_uv1;
out vec4 v_color;

vec3 orthogonalizeSurfaceTangent(vec3 tangent, vec3 normal) {
  float normalLengthSquared = dot(normal, normal);
  return normalLengthSquared > 0.00000001
    ? tangent - normal * (dot(normal, tangent) / normalLengthSquared)
    : tangent;
}

vec3 normalizeSurfaceDirection(vec3 direction) {
  float lengthSquared = dot(direction, direction);
  return lengthSquared > 0.0 ? direction * inversesqrt(lengthSquared) : vec3(0.0);
}

void main() {
  vec3 localPosition = a_position;
  vec3 localNormal = a_normal;
  vec3 localTangent = a_tangent.xyz;
  float localTangentHandedness = a_tangent.w;
  vec4 worldPosition = u_model * vec4(localPosition, 1.0);
  mat3 modelBasis = mat3(u_model);
  float modelHandedness = u_modelNormalTransform[3][3];

  vec3 worldNormal = normalizeSurfaceDirection(mat3(u_modelNormalTransform) * localNormal);
  vec3 worldTangent = normalizeSurfaceDirection(
    orthogonalizeSurfaceTangent(modelBasis * localTangent, worldNormal)
  );

  v_normal = worldNormal;
  v_tangent = vec4(
    worldTangent,
    localTangentHandedness * modelHandedness
  );
  v_worldPosition = worldPosition.xyz;
  v_uv0 = a_uv0;
  v_uv1 = a_uv1;
  v_color = a_color;

  gl_Position = u_projection * u_view * worldPosition;
}
