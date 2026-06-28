precision mediump float;

uniform sampler2D u_baseColor;
uniform vec4 u_lightColor;
uniform vec3 u_lightDirection;

varying vec3 v_normal;
varying vec2 v_texCoord;

void main() {
  float light = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
  vec4 baseColor = texture2D(u_baseColor, v_texCoord);
  vec3 rgb = baseColor.rgb * (0.18 + light * u_lightColor.rgb);
  gl_FragColor = vec4(rgb, baseColor.a);
}
