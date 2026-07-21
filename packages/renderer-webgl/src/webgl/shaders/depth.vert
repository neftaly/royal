#version 300 es
layout(location = 0) in vec3 position;
#ifdef INSTANCED
layout(location = 3) in mat4 instanceModel;
#endif
uniform mat4 viewProjection;
uniform mat4 model;
void main() {
  vec4 localPosition = vec4(position, 1.0);
#ifdef INSTANCED
  localPosition = instanceModel * localPosition;
#endif
  vec4 world = model * localPosition;
  gl_Position = viewProjection * world;
}
