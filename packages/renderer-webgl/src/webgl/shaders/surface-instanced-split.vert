#version 300 es

in vec3 a_position;
in vec3 a_normal;
in vec4 a_tangent;
in vec2 a_uv;
in vec2 a_emissive_uv;
in vec4 a_color;

layout(location = 3) in mat4 a_instanceLocalModel;
layout(location = 7) in vec3 a_instancePosition;
layout(location = 8) in vec3 a_instanceRotation;
layout(location = 9) in vec3 a_instanceScale;

uniform mat4 u_projection;
uniform mat4 u_view;

out vec3 v_normal;
out vec4 v_tangent;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec2 v_emissive_uv;
out vec4 v_color;

vec3 rotateX(vec3 value, float radians) {
  float cosAngle = cos(radians);
  float sinAngle = sin(radians);

  return vec3(
    value.x,
    value.y * cosAngle - value.z * sinAngle,
    value.y * sinAngle + value.z * cosAngle
  );
}

vec3 rotateY(vec3 value, float radians) {
  float cosAngle = cos(radians);
  float sinAngle = sin(radians);

  return vec3(
    value.x * cosAngle + value.z * sinAngle,
    value.y,
    -value.x * sinAngle + value.z * cosAngle
  );
}

vec3 rotateZ(vec3 value, float radians) {
  float cosAngle = cos(radians);
  float sinAngle = sin(radians);

  return vec3(
    value.x * cosAngle - value.y * sinAngle,
    value.x * sinAngle + value.y * cosAngle,
    value.z
  );
}

vec3 transformRootPoint(vec3 value) {
  vec3 scaled = value * a_instanceScale;
  vec3 rotated = rotateZ(rotateY(rotateX(scaled, a_instanceRotation.x), a_instanceRotation.y), a_instanceRotation.z);

  return rotated + a_instancePosition;
}

vec3 transformRootVector(vec3 value) {
  vec3 scaled = value * a_instanceScale;

  return rotateZ(rotateY(rotateX(scaled, a_instanceRotation.x), a_instanceRotation.y), a_instanceRotation.z);
}

void main() {
  vec4 localPosition = a_instanceLocalModel * vec4(a_position, 1.0);
  mat3 localModelBasis = mat3(a_instanceLocalModel);
  vec3 worldPosition = transformRootPoint(localPosition.xyz);

  v_normal = transformRootVector(localModelBasis * a_normal);
  v_tangent = vec4(transformRootVector(localModelBasis * a_tangent.xyz), a_tangent.w);
  v_worldPosition = worldPosition;
  v_uv = a_uv;
  v_emissive_uv = a_emissive_uv;
  v_color = a_color;

  gl_Position = u_projection * u_view * vec4(worldPosition, localPosition.w);
}
