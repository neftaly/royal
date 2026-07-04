#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec4 u_color;
uniform sampler2D u_vtAtlas;
uniform sampler2D u_vtPageTable;
uniform vec2 u_vtAtlasGrid;
uniform vec2 u_vtPageTableSize;
uniform int u_vtWrapS;
uniform int u_vtWrapT;
out vec4 outColor;
float wrapVirtualTextureCoord(float coord, int mode) {
if (mode == 1) {
  return fract(coord);
}
if (mode == 2) {
  float mirrored = mod(coord, 2.0);
  if (mirrored < 0.0) {
    mirrored += 2.0;
  }
  return min(mirrored <= 1.0 ? mirrored : 2.0 - mirrored, 0.999999);
}
return clamp(coord, 0.0, 0.999999);
}
vec2 wrapVirtualTextureUv(vec2 uv) {
return vec2(
  wrapVirtualTextureCoord(uv.x, u_vtWrapS),
  wrapVirtualTextureCoord(uv.y, u_vtWrapT)
);
}
void main() {
vec2 uv = wrapVirtualTextureUv(v_uv);
vec2 page = floor(uv * u_vtPageTableSize);
vec4 tableEntry = texture(u_vtPageTable, (page + vec2(0.5)) / u_vtPageTableSize);
float encodedSlot = floor(tableEntry.r * 255.0 + 0.5)
  + floor(tableEntry.g * 255.0 + 0.5) * 256.0;
float fallbackMipOffset = floor(tableEntry.b * 255.0 + 0.5);
if (encodedSlot < 1.0) {
  outColor = u_color;
  return;
}
float slot = encodedSlot - 1.0;
vec2 slotCoord = vec2(mod(slot, u_vtAtlasGrid.x), floor(slot / u_vtAtlasGrid.x));
vec2 residentPageTableSize = max(vec2(1.0), floor(u_vtPageTableSize / exp2(fallbackMipOffset)));
vec2 localUv = fract(uv * residentPageTableSize);
vec2 atlasUv = (slotCoord + localUv) / u_vtAtlasGrid;
outColor = texture(u_vtAtlas, atlasUv) * u_color;
}
