precision mediump float;

uniform sampler2D u_baseColor;
uniform vec4 u_color;
uniform vec4 u_lightColor;
uniform vec3 u_lightDirection;
uniform bool u_unlit;
uniform bool u_useBaseColorTexture;

varying vec3 v_normal;
varying vec2 v_texCoord;

void main() {
  vec4 baseColor = u_useBaseColorTexture ? texture2D(u_baseColor, v_texCoord) : u_color;

  if (u_unlit) {
    gl_FragColor = baseColor;
    return;
  }

  float light = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
  vec3 rgb = baseColor.rgb * (0.18 + light * u_lightColor.rgb);
  gl_FragColor = vec4(rgb, baseColor.a);
}
