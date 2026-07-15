#version 300 es

layout(location = 0) in vec3 a_position;
layout(location = 10) in vec2 a_uv0;
layout(location = 11) in vec2 a_uv1;
layout(location = 12) in vec4 a_color;

layout(location = 3) in mat4 a_instanceLocalModel;
layout(location = 7) in vec3 a_instancePosition;
layout(location = 8) in vec3 a_instanceRotation;
layout(location = 9) in vec3 a_instanceScale;

uniform mat4 u_projection;
uniform mat4 u_view;

out vec2 v_uv0;
out vec2 v_uv1;
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

vec3 transformRootPoint(vec3 localPoint) {
  vec3 scaled = localPoint * a_instanceScale;
  vec3 rotated = rotateZ(
    rotateY(rotateX(scaled, a_instanceRotation.x), a_instanceRotation.y),
    a_instanceRotation.z
  );
  return rotated + a_instancePosition;
}

void main() {
  vec4 assetPosition = a_instanceLocalModel * vec4(a_position, 1.0);
  vec3 worldPosition = transformRootPoint(assetPosition.xyz);
  v_uv0 = a_uv0;
  v_uv1 = a_uv1;
  v_color = a_color;
  gl_Position = u_projection * u_view * vec4(worldPosition, assetPosition.w);
}
