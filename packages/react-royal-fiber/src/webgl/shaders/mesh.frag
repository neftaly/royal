precision mediump float;

uniform vec4 u_color;
uniform vec4 u_lightColor;
uniform vec3 u_lightDirection;
uniform bool u_unlit;

varying vec3 v_normal;

void main() {
  if (u_unlit) {
    gl_FragColor = u_color;
    return;
  }

  float light = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
  vec3 rgb = u_color.rgb * (0.18 + light * u_lightColor.rgb);
  gl_FragColor = vec4(rgb, u_color.a);
}
