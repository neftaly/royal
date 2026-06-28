precision mediump float;

uniform vec4 u_color;

varying vec2 v_glyphCoord;

void main() {
  float inside =
    step(0.0, v_glyphCoord.x) *
    step(0.0, v_glyphCoord.y) *
    step(v_glyphCoord.x, 1.0) *
    step(v_glyphCoord.y, 1.0);
  gl_FragColor = vec4(u_color.rgb * u_color.a, u_color.a) * inside;
}
