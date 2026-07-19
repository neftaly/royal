/** Lazily reachable VT2 fragment sampling body shared by unlit and standard materials. */
export const VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS = String.raw`
uniform sampler2D baseColorTexture;
uniform sampler2D virtualPageTable;
uniform vec4 virtualSettings0;
uniform vec4 virtualSettings1;
uniform vec4 virtualSettings2;
uniform float virtualMipOffsets[16];

float royalVirtualWrap(float coordinate, float mode) {
  if (mode < 0.5) return clamp(coordinate, 0.0, 0.99999994);
  if (mode < 1.5) return fract(coordinate);
  return min(0.99999994, 1.0 - abs(mod(coordinate, 2.0) - 1.0));
}

vec4 sampleVirtualBaseColor(vec2 authoredUv) {
  vec2 uv = vec2(
    royalVirtualWrap(authoredUv.x, virtualSettings2.y),
    royalVirtualWrap(authoredUv.y, virtualSettings2.z)
  );
  vec2 virtualSize = virtualSettings0.xy;
  float pageSize = virtualSettings0.z;
  vec2 texelDx = dFdx(authoredUv) * virtualSize;
  vec2 texelDy = dFdy(authoredUv) * virtualSize;
  float footprint = max(length(texelDx), length(texelDy));
  int desiredMip = int(clamp(
    floor(log2(max(footprint, 1.0))),
    0.0,
    virtualSettings2.x - 1.0
  ));
  float desiredScale = exp2(float(desiredMip));
  vec2 desiredPage = floor((uv * virtualSize / desiredScale) / pageSize);
  ivec2 tableCoordinate = ivec2(
    desiredPage.x,
    virtualMipOffsets[desiredMip] + desiredPage.y
  );
  vec4 entry = texelFetch(virtualPageTable, tableCoordinate, 0);
  if (entry.a < 0.5) return vec4(0.214041, 0.214041, 0.214041, 1.0);
  vec3 decoded = floor(entry.rgb * 255.0 + 0.5);
  float residentScale = exp2(decoded.z);
  vec2 residentTexel = uv * virtualSize / residentScale;
  vec2 localTexel = mod(residentTexel, pageSize);
  float storedPageSize = virtualSettings2.w;
  vec2 atlasTexel = decoded.xy * storedPageSize
    + vec2(virtualSettings0.w)
    + localTexel;
  return texture(baseColorTexture, atlasTexel / virtualSettings1.xy);
}
`;
