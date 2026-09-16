/** Lazily reachable VT2 fragment sampling body shared by unlit and standard materials. */
export const VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS = String.raw`
uniform sampler2D baseColorTexture;
uniform sampler2D virtualPageTable;
uniform sampler2D virtualCompressedAtlas;
uniform vec4 virtualCompressedSettings;
uniform vec4 virtualSettings0;
uniform vec4 virtualSettings1;
uniform vec4 virtualSettings2;

float royalVirtualWrap(float coordinate, float mode) {
  if (mode < 0.5) return clamp(coordinate, 0.0, 0.99999994);
  if (mode < 1.5) return fract(coordinate);
  return min(0.99999994, 1.0 - abs(mod(coordinate, 2.0) - 1.0));
}

vec4 royalVirtualMip(vec2 virtualTexel, int desiredMip, float filterLod) {
  float pageSize = virtualSettings0.z;
  float desiredScale = exp2(float(desiredMip));
  vec2 desiredPage = floor((virtualTexel / desiredScale) / pageSize);
  vec4 entry = texelFetch(virtualPageTable, ivec2(desiredPage), desiredMip);
  // A fast zoom-out may request a mip that has never been loaded. The base
  // table still resolves the finest resident page at this pixel; prefer that
  // detail to a coarse placeholder until the requested mip arrives.
  if (desiredMip > 0 && (entry.a < 0.5 || entry.b * 255.0 > float(desiredMip) + 0.5)) {
    vec2 finePage = floor(virtualTexel / pageSize);
    vec4 fineEntry = texelFetch(virtualPageTable, ivec2(finePage), 0);
    if (fineEntry.a >= 0.5 && (entry.a < 0.5 || fineEntry.b < entry.b)) entry = fineEntry;
  }
  if (entry.a < 0.5) return vec4(0.214041, 0.214041, 0.214041, 1.0);
  vec3 decoded = floor(entry.rgb * 255.0 + 0.5);
  float residentScale = exp2(decoded.z);
  vec2 residentTexel = virtualTexel / residentScale;
  vec2 residentPage = floor(residentTexel / pageSize);
  vec2 localTexel = residentTexel - residentPage * pageSize;
  float storedPageSize = virtualSettings2.w;
  // UVs already address texel edges, just like an ordinary texture lookup.
  // Adding a half texel here shifts artwork by half a resident-mip texel,
  // making it move (and disagree across pages) as residency changes.
  vec2 atlasTexel = decoded.xy * storedPageSize
    + vec2(virtualSettings0.w)
    + localTexel;
  // Each directional tap resolves its own virtual page. Atlas derivatives
  // cannot describe neighbouring virtual texels across unrelated atlas slots.
  float atlasLod = filterLod - decoded.z;
  if (entry.a < 0.75) return textureLod(virtualCompressedAtlas, atlasTexel / virtualCompressedSettings.xy, atlasLod);
  return textureLod(baseColorTexture, atlasTexel / virtualSettings1.xy, atlasLod);
}

vec4 sampleVirtualBaseColor(vec2 authoredUv) {
  vec2 texelDx = dFdx(authoredUv) * virtualSettings0.xy;
  vec2 texelDy = dFdy(authoredUv) * virtualSettings0.xy;
  float footprintSquared = max(dot(texelDx, texelDx), dot(texelDy, texelDy));
  vec2 majorAxis = vec2(0.0);
  int taps = 1;
  float anisotropy = virtualSettings1.w;
  if (anisotropy > 1.0) {
    // Eigenvalues of J * transpose(J) give the squared ellipse axes.
    float a = texelDx.x * texelDx.x + texelDy.x * texelDy.x;
    float b = texelDx.x * texelDx.y + texelDy.x * texelDy.y;
    float c = texelDx.y * texelDx.y + texelDy.y * texelDy.y;
    float majorSquared = 0.5 * (a + c + sqrt((a - c) * (a - c) + 4.0 * b * b));
    float determinant = texelDx.x * texelDy.y - texelDy.x * texelDx.y;
    float minorSquared = majorSquared > 0.0 ? determinant * determinant / majorSquared : 0.0;
    footprintSquared = max(minorSquared, majorSquared / (anisotropy * anisotropy));
    taps = int(clamp(ceil(sqrt(majorSquared / max(1.0, footprintSquared))), 1.0, 16.0));
    if (taps > 1) {
      vec2 axis0 = vec2(majorSquared - c, b);
      vec2 axis1 = vec2(b, majorSquared - a);
      vec2 axis = dot(axis0, axis0) > dot(axis1, axis1) ? axis0 : axis1;
      // Equal axes need no directional integration (including roundoff).
      if (dot(axis, axis) > 0.0) majorAxis = normalize(axis) * sqrt(majorSquared);
      else taps = 1;
    }
  }
  float filterLod = 0.5 * log2(max(footprintSquared, 1e-16));
  float lod = clamp(filterLod, 0.0, virtualSettings2.x - 1.0);
  int mip = int(floor(lod));
  float blend = virtualSettings1.z < 0.5 ? 0.0 : fract(lod);
  vec4 result = vec4(0.0);
  for (int index = 0; index < taps; index++) {
    vec2 sampleUv = authoredUv + majorAxis / virtualSettings0.xy
      * ((float(index) + 0.5) / float(taps) - 0.5);
    vec2 uv = vec2(royalVirtualWrap(sampleUv.x, virtualSettings2.y), royalVirtualWrap(sampleUv.y, virtualSettings2.z));
    vec2 texel = uv * virtualSettings0.xy;
    vec4 lower = royalVirtualMip(texel, mip, filterLod);
    result += blend == 0.0 ? lower : mix(lower, royalVirtualMip(texel, mip + 1, filterLod), blend);
  }
  return result / float(taps);
}
`;
