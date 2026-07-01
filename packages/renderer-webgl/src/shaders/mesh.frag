#version 300 es
precision highp float;

uniform sampler2D u_baseColor;
uniform sampler2D u_virtualAtlas;
uniform sampler2D u_virtualPageTable;
uniform vec4 u_color;
uniform vec4 u_lightColor;
uniform vec3 u_lightDirection;
uniform vec2 u_virtualPageTableSize;
uniform vec2 u_virtualPhysicalAtlasSize;
uniform float u_virtualBorderTexels;
uniform float u_virtualMip;
uniform float u_virtualPaddedPageSize;
uniform float u_virtualPageSize;
uniform bool u_unlit;
uniform bool u_useBaseColorTexture;
uniform bool u_useVirtualTexture;

in vec3 v_normal;
in vec2 v_texCoord;

out vec4 outColor;

vec4 sampleVirtualTexture(vec2 texCoord) {
  vec2 uv = clamp(texCoord, vec2(0.0), vec2(0.999999));
  vec2 pageFloat = floor(uv * u_virtualPageTableSize);
  vec2 tableUv = (pageFloat + vec2(0.5)) / u_virtualPageTableSize;
  vec4 entry = textureLod(u_virtualPageTable, tableUv, u_virtualMip);
  float valid = step(0.5, entry.a * 255.0);
  if (valid < 0.5) return u_color;

  vec2 slot = floor(entry.rg * 255.0 + vec2(0.5));
  float mipDelta = floor(entry.b * 255.0 + 0.5);
  vec2 residentScale = exp2(vec2(mipDelta));
  vec2 local = fract((uv * u_virtualPageTableSize) / residentScale);
  vec2 atlasPixel = slot * u_virtualPaddedPageSize +
    vec2(u_virtualBorderTexels) +
    local * u_virtualPageSize +
    vec2(0.5);
  return texture(u_virtualAtlas, atlasPixel / u_virtualPhysicalAtlasSize);
}

void main() {
  vec4 baseColor = u_useVirtualTexture
    ? sampleVirtualTexture(v_texCoord)
    : (u_useBaseColorTexture ? texture(u_baseColor, v_texCoord) : u_color);

  if (u_unlit) {
    outColor = baseColor;
    return;
  }

  float light = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
  vec3 rgb = baseColor.rgb * (0.18 + light * u_lightColor.rgb);
  outColor = vec4(rgb, baseColor.a);
}
