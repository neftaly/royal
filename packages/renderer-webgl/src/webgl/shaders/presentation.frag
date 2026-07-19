#version 300 es
precision highp float;
in vec2 textureCoordinate;
uniform sampler2D sceneColor;
uniform vec4 presentation;
out vec4 outputColor;
__PRESENTATION_FUNCTIONS__
void main() {
  vec4 source = texture(sceneColor, textureCoordinate * presentation.zw);
  vec3 exposed = source.rgb * max(presentation.x, 0.0);
  vec3 mapped = presentation.y > 0.5 ? pbrNeutral(exposed) : clamp(exposed, 0.0, 1.0);
  outputColor = vec4(linearToSrgb(mapped), source.a);
}
