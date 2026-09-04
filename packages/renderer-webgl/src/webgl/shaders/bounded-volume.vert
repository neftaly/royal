#version 300 es
invariant gl_Position;
layout(location = 0) in vec3 position;
uniform mat4 model;
uniform mat4 viewProjection;
out vec3 volumeLocalPosition;
void main() {
  volumeLocalPosition = position;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
