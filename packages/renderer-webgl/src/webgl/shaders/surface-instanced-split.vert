#version 300 es

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_tangent;
layout(location = 10) in vec2 a_uv0;
layout(location = 11) in vec2 a_uv1;
layout(location = 12) in vec4 a_color;

layout(location = 3) in mat4 a_instanceLocalModel;
layout(location = 7) in vec3 a_instancePosition;
layout(location = 8) in vec3 a_instanceRotation;
layout(location = 9) in vec3 a_instanceScale;

uniform mat4 u_projection;
uniform mat4 u_view;

out vec3 v_normal;
out vec4 v_tangent;
out vec3 v_worldPosition;
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

vec3 transformRootVector(vec3 localVector) {
  vec3 scaled = localVector * a_instanceScale;

  return rotateZ(
    rotateY(rotateX(scaled, a_instanceRotation.x), a_instanceRotation.y),
    a_instanceRotation.z
  );
}

float basisHandedness(mat3 basis) {
  return determinant(basis) < 0.0 ? -1.0 : 1.0;
}

vec3 transformSurfaceNormal(mat3 basis, vec3 normal, float handedness) {
  return handedness * (
    cross(basis[1], basis[2]) * normal.x
    + cross(basis[2], basis[0]) * normal.y
    + cross(basis[0], basis[1]) * normal.z
  );
}

vec3 transformRootNormal(vec3 localNormal, float rootHandedness) {
  vec3 cofactorNormal = rootHandedness * vec3(
    a_instanceScale.y * a_instanceScale.z * localNormal.x,
    a_instanceScale.z * a_instanceScale.x * localNormal.y,
    a_instanceScale.x * a_instanceScale.y * localNormal.z
  );

  return rotateZ(
    rotateY(rotateX(cofactorNormal, a_instanceRotation.x), a_instanceRotation.y),
    a_instanceRotation.z
  );
}

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
  vec4 assetPosition = a_instanceLocalModel * vec4(localPosition, 1.0);
  mat3 localModelBasis = mat3(a_instanceLocalModel);
  vec3 worldPosition = transformRootPoint(assetPosition.xyz);
  float localModelHandedness = basisHandedness(localModelBasis);
  float rootHandedness = a_instanceScale.x * a_instanceScale.y * a_instanceScale.z < 0.0
    ? -1.0
    : 1.0;

  vec3 worldNormal = normalizeSurfaceDirection(
    transformRootNormal(
      transformSurfaceNormal(localModelBasis, localNormal, localModelHandedness),
      rootHandedness
    )
  );
  vec3 worldTangent = normalizeSurfaceDirection(
    orthogonalizeSurfaceTangent(
      transformRootVector(localModelBasis * localTangent),
      worldNormal
    )
  );
  v_normal = worldNormal;
  v_tangent = vec4(
    worldTangent,
    localTangentHandedness * localModelHandedness * rootHandedness
  );
  v_worldPosition = worldPosition;
  v_uv0 = a_uv0;
  v_uv1 = a_uv1;
  v_color = a_color;

  gl_Position = u_projection * u_view * vec4(worldPosition, assetPosition.w);
}
