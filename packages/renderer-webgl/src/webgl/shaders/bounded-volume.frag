#version 300 es
precision highp float;
precision highp int;
in vec3 volumeLocalPosition;
uniform vec4 color;
uniform vec3 cameraWorldPosition;
uniform vec2 densityProfile[8];
uniform int densityProfileCount;
uniform sampler2D sceneDepth;
uniform float extinctionPerMetre;
uniform vec2 heightBounds;
uniform mat4 inverseModel;
uniform mat4 inverseViewProjection;
uniform mat4 model;
uniform vec3 noiseScale;
uniform float noiseStrength;
uniform vec4 planes[32];
uniform int planeCount;
uniform int perspectiveCamera;
uniform mat4 viewProjection;
out vec4 outputColor;

float profileDensity(float height) {
  vec2 previous = densityProfile[0];
  for (int index = 1; index < 8; index += 1) {
    if (index >= densityProfileCount) break;
    vec2 next = densityProfile[index];
    if (height <= next.x) {
      float interval = max(next.x - previous.x, 0.000001);
      return mix(previous.y, next.y, clamp((height - previous.x) / interval, 0.0, 1.0));
    }
    previous = next;
  }
  return previous.y;
}

float spatialNoise(vec3 position) {
  vec3 samplePosition = position * noiseScale;
  float first = sin(dot(samplePosition, vec3(1.73, 2.17, 2.83)));
  float second = sin(dot(samplePosition, vec3(-3.11, 1.37, 2.41)) * 1.91 + first);
  float third = sin(dot(samplePosition, vec3(2.53, -2.89, 1.19)) * 3.17 + second);
  return 0.5 + 0.5 * (first * 0.5 + second * 0.3 + third * 0.2);
}

void main() {
  if (gl_FrontFacing) discard;
  ivec2 depthSize = textureSize(sceneDepth, 0);
  vec2 screenUv = gl_FragCoord.xy / vec2(depthSize);
  vec2 ndc = screenUv * 2.0 - 1.0;
  vec4 nearWorldH = inverseViewProjection * vec4(ndc, -1.0, 1.0);
  vec3 nearWorld = nearWorldH.xyz / nearWorldH.w;
  vec3 rayOriginWorld = perspectiveCamera != 0 ? cameraWorldPosition : nearWorld;
  vec4 cameraLocalH = inverseModel * vec4(rayOriginWorld, 1.0);
  vec3 origin = cameraLocalH.xyz / cameraLocalH.w;
  vec3 rayVector = volumeLocalPosition - origin;
  float fragmentDistance = length(rayVector);
  if (!(fragmentDistance > 0.000001)) discard;
  vec3 rayDirection = rayVector / fragmentDistance;
  float nearDistance = 0.0;
  float farDistance = 1e20;
  for (int index = 0; index < 32; index += 1) {
    if (index >= planeCount) break;
    vec4 plane = planes[index];
    float originDistance = dot(plane.xyz, origin) + plane.w;
    float directionProjection = dot(plane.xyz, rayDirection);
    if (abs(directionProjection) < 0.000001) {
      if (originDistance > 0.00001) discard;
      continue;
    }
    float distance = -originDistance / directionProjection;
    if (directionProjection < 0.0) nearDistance = max(nearDistance, distance);
    else farDistance = min(farDistance, distance);
  }
  farDistance = min(farDistance, fragmentDistance);
  if (!(farDistance > nearDistance)) discard;

  vec3 localStart = origin + rayDirection * nearDistance;
  vec3 localEnd = origin + rayDirection * farDistance;
  vec3 localStep = (localEnd - localStart) / 12.0;
  float worldStepLength = length((model * vec4(localStep, 0.0)).xyz);
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float transmittance = 1.0;
  float localHeightSpan = heightBounds.y - heightBounds.x;
  float opaqueDepth = texture(sceneDepth, screenUv).r;
  for (int stepIndex = 0; stepIndex < 12; stepIndex += 1) {
    vec3 localSample = localStart + localStep * (float(stepIndex) + jitter);
    vec3 worldSample = (model * vec4(localSample, 1.0)).xyz;
    vec4 clip = viewProjection * vec4(worldSample, 1.0);
    float sampleDepth = clip.z / clip.w * 0.5 + 0.5;
    if (sampleDepth > opaqueDepth + 0.00001) break;
    float height = localHeightSpan > 0.0
      ? (localSample.y - heightBounds.x) / localHeightSpan
      : 0.5;
    float profile = profileDensity(clamp(height, 0.0, 1.0));
    float noise = mix(1.0, 0.55 + spatialNoise(localSample) * 0.9, noiseStrength);
    float sigma = extinctionPerMetre * profile * noise * clamp(color.a, 0.0, 1.0);
    transmittance *= exp(-sigma * worldStepLength);
  }
  float alpha = 1.0 - transmittance;
  if (alpha <= 0.0001) discard;
  outputColor = vec4(color.rgb, alpha);
}
