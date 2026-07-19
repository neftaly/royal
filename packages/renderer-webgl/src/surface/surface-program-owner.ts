import { MAX_CANONICAL_DIRECTIONAL_LIGHTS } from "./scene-lowering";

export type UnlitProgram = Readonly<{
  alphaCutoff: WebGLUniformLocation | null;
  color: WebGLUniformLocation;
  kind: "unlit";
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  viewProjectionModel: WebGLUniformLocation;
}>;

export type StandardProgram = Readonly<{
  alphaMasked: boolean;
  baseColor: WebGLUniformLocation;
  cameraWorldPosition: WebGLUniformLocation;
  directionalLightColors: WebGLUniformLocation;
  directionalLightCount: WebGLUniformLocation;
  directionalLightDirections: WebGLUniformLocation;
  emissive: WebGLUniformLocation | null;
  emissiveFactor: WebGLUniformLocation;
  kind: "standard";
  materialFactors: WebGLUniformLocation;
  metallicRoughness: WebGLUniformLocation | null;
  model: WebGLUniformLocation;
  normalTransform: WebGLUniformLocation;
  normalTexture: WebGLUniformLocation | null;
  program: WebGLProgram;
  presentation: WebGLUniformLocation;
  texture: WebGLUniformLocation | null;
  viewProjection: WebGLUniformLocation;
}>;

export const surfaceProgramVariantKey = (
  kind: "standard" | "unlit",
  features: number,
  instanced: boolean,
  alphaMasked: boolean,
  doubleSided: boolean,
): string => `${kind}:${features}:${instanced ? 1 : 0}:${alphaMasked ? 1 : 0}:${kind === "standard" && doubleSided ? 1 : 0}`;

const UNLIT_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
#ifdef INSTANCED
layout(location = 3) in mat4 instanceModel;
#endif
#ifdef TEXTURED
layout(location = 2) in vec2 textureCoordinate0;
out vec2 surfaceTextureCoordinate0;
#endif
uniform mat4 viewProjectionModel;
void main() {
#ifdef TEXTURED
  surfaceTextureCoordinate0 = textureCoordinate0;
#endif
  vec4 localPosition = vec4(position, 1.0);
#ifdef INSTANCED
  localPosition = instanceModel * localPosition;
#endif
  gl_Position = viewProjectionModel * localPosition;
}
`;

const UNLIT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec4 linearColor;
#ifdef ALPHA_MASK
uniform float alphaCutoff;
#endif
#ifdef TEXTURED
in vec2 surfaceTextureCoordinate0;
uniform sampler2D baseColorTexture;
#endif
out vec4 outputColor;
vec3 linearToSrgb(vec3 value) {
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  vec3 lower = value * 12.92;
  vec3 upper = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, low);
}
void main() {
  vec4 color = linearColor;
#ifdef TEXTURED
  color *= texture(baseColorTexture, surfaceTextureCoordinate0);
#endif
#ifdef ALPHA_MASK
  if (color.a < alphaCutoff) discard;
#endif
  outputColor = vec4(linearToSrgb(color.rgb), 1.0);
}
`;

const STANDARD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
#ifdef TANGENT
layout(location = 10) in vec4 tangent;
out vec4 worldTangent;
#endif
#ifdef INSTANCED
layout(location = 3) in mat4 instanceModel;
layout(location = 7) in vec3 instanceNormal0;
layout(location = 8) in vec3 instanceNormal1;
layout(location = 9) in vec4 instanceNormal2;
#endif
#ifdef TEXTURED
layout(location = 2) in vec2 textureCoordinate0;
out vec2 surfaceTextureCoordinate0;
#endif
uniform mat4 viewProjection;
uniform mat4 model;
uniform mat4 normalTransform;
out vec3 worldNormal;
out vec3 worldPosition;
void main() {
#ifdef TEXTURED
  surfaceTextureCoordinate0 = textureCoordinate0;
#endif
  vec4 localPosition = vec4(position, 1.0);
#ifdef INSTANCED
  localPosition = instanceModel * localPosition;
#endif
  vec4 world = model * localPosition;
  worldPosition = world.xyz;
#ifdef INSTANCED
  mat3 instanceNormal = mat3(instanceNormal0, instanceNormal1, instanceNormal2.xyz);
  worldNormal = mat3(normalTransform) * instanceNormal * normal;
#else
  worldNormal = mat3(normalTransform) * normal;
#endif
#ifdef TANGENT
  vec3 localTangent = tangent.xyz;
  float tangentHandedness = tangent.w;
#ifdef INSTANCED
  localTangent = mat3(instanceModel) * localTangent;
  tangentHandedness *= instanceNormal2.w;
#endif
  worldTangent = vec4(
    normalize(mat3(model) * localTangent),
    tangentHandedness * normalTransform[3][3]
  );
#endif
  gl_Position = viewProjection * world;
}
`;

const STANDARD_FRAGMENT_SHADER = `#version 300 es
precision highp float;
#define MAX_DIRECTIONAL_LIGHTS ${MAX_CANONICAL_DIRECTIONAL_LIGHTS}
in vec3 worldNormal;
in vec3 worldPosition;
#ifdef TEXTURED
in vec2 surfaceTextureCoordinate0;
#endif
#ifdef BASE_COLOR_TEXTURED
uniform sampler2D baseColorTexture;
#endif
#ifdef METALLIC_ROUGHNESS_TEXTURED
uniform sampler2D metallicRoughnessTexture;
#endif
#ifdef NORMAL_TEXTURED
uniform sampler2D normalTexture;
#ifdef TANGENT
in vec4 worldTangent;
#endif
#endif
#ifdef EMISSIVE_TEXTURED
uniform sampler2D emissiveTexture;
#endif
uniform vec4 baseColor;
uniform vec4 cameraWorldPosition;
uniform vec4 directionalLightColors[MAX_DIRECTIONAL_LIGHTS];
uniform int directionalLightCount;
uniform vec4 directionalLightDirections[MAX_DIRECTIONAL_LIGHTS];
uniform vec4 emissiveFactor;
uniform vec4 materialFactors;
uniform vec4 presentation;
out vec4 outputColor;
const float PI = 3.141592653589793;
float fresnelPower(float cosine) {
  return pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}
float ggxDistribution(float normalHalf, float roughness) {
  float alpha = max(roughness * roughness, 0.001);
  float alphaSquared = alpha * alpha;
  float denominator = normalHalf * normalHalf * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / max(PI * denominator * denominator, 0.0001);
}
float smithVisibility(float normalLight, float normalView, float roughness) {
  float alpha = max(roughness * roughness, 0.001);
  float alphaSquared = alpha * alpha;
  float lambdaView = normalLight * sqrt(max(
    normalView * normalView * (1.0 - alphaSquared) + alphaSquared,
    0.0
  ));
  float lambdaLight = normalView * sqrt(max(
    normalLight * normalLight * (1.0 - alphaSquared) + alphaSquared,
    0.0
  ));
  return 0.5 / max(lambdaView + lambdaLight, 0.0001);
}
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float minimum = min(color.r, min(color.g, color.b));
  float offset = minimum < 0.08 ? minimum - 6.25 * minimum * minimum : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return max(color, vec3(0.0));
  float distance = 1.0 - startCompression;
  float compressed = 1.0 - distance * distance / (peak + distance - startCompression);
  color *= compressed / peak;
  float blend = 1.0 - 1.0 / (desaturation * (peak - compressed) + 1.0);
  return mix(color, vec3(compressed), blend);
}
vec3 linearToSrgb(vec3 value) {
  value = clamp(value, vec3(0.0), vec3(1.0));
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  vec3 lower = value * 12.92;
  vec3 upper = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, low);
}
void main() {
  vec4 surfaceBaseColor = baseColor;
#ifdef BASE_COLOR_TEXTURED
  surfaceBaseColor *= texture(baseColorTexture, surfaceTextureCoordinate0);
#endif
#ifdef ALPHA_MASK
  if (surfaceBaseColor.a < materialFactors.z) discard;
#endif
  vec3 normal = worldNormal;
  if (dot(normal, normal) <= 0.00000001) {
    normal = cross(dFdx(worldPosition), dFdy(worldPosition));
  }
  normal = normalize(normal);
#ifdef NORMAL_TEXTURED
  vec3 mappedNormal = texture(normalTexture, surfaceTextureCoordinate0).xyz * 2.0 - 1.0;
  mappedNormal.xy *= materialFactors.w;
#ifdef TANGENT
  vec3 tangent = normalize(worldTangent.xyz - normal * dot(normal, worldTangent.xyz));
  vec3 bitangent = cross(normal, tangent) * worldTangent.w;
#else
  vec3 positionDx = dFdx(worldPosition);
  vec3 positionDy = dFdy(worldPosition);
  vec2 uvDx = dFdx(surfaceTextureCoordinate0);
  vec2 uvDy = dFdy(surfaceTextureCoordinate0);
  vec3 tangent = normalize(positionDx * uvDy.y - positionDy * uvDx.y);
  vec3 bitangent = normalize(-positionDx * uvDy.x + positionDy * uvDx.x);
#endif
  normal = normalize(mat3(tangent, bitangent, normal) * mappedNormal);
#endif
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) normal = -normal;
#endif
  vec3 viewVector = cameraWorldPosition.xyz - worldPosition;
  vec3 viewDirection = dot(viewVector, viewVector) <= 0.00000001
    ? normal
    : normalize(viewVector);
  float metallic = materialFactors.x;
  float roughness = materialFactors.y;
#ifdef METALLIC_ROUGHNESS_TEXTURED
  vec4 metallicRoughnessSample = texture(
    metallicRoughnessTexture,
    surfaceTextureCoordinate0
  );
  metallic *= metallicRoughnessSample.b;
  roughness *= metallicRoughnessSample.g;
#endif
  roughness = clamp(roughness, 0.04, 1.0);
  vec3 dielectric = vec3(0.04);
  vec3 f0 = mix(dielectric, surfaceBaseColor.rgb, metallic);
  vec3 diffuseColor = surfaceBaseColor.rgb * (1.0 - metallic);
  vec3 lit = vec3(0.0);
  for (int index = 0; index < MAX_DIRECTIONAL_LIGHTS; index += 1) {
    if (index >= directionalLightCount) break;
    vec3 lightDirection = normalize(-directionalLightDirections[index].xyz);
    float normalLight = max(dot(normal, lightDirection), 0.0);
    if (normalLight <= 0.0) continue;
    vec3 halfwayInput = lightDirection + viewDirection;
    vec3 halfway = dot(halfwayInput, halfwayInput) <= 0.00000001
      ? normal
      : normalize(halfwayInput);
    float normalView = max(dot(normal, viewDirection), 0.0);
    float normalHalf = max(dot(normal, halfway), 0.0);
    float viewHalf = max(dot(viewDirection, halfway), 0.0);
    vec3 fresnel = mix(f0, vec3(1.0), fresnelPower(viewHalf));
    vec3 diffuse = diffuseColor * (1.0 - max(max(fresnel.r, fresnel.g), fresnel.b)) / PI;
    vec3 specular = fresnel
      * ggxDistribution(normalHalf, roughness)
      * smithVisibility(normalLight, normalView, roughness);
    lit += (diffuse + specular) * directionalLightColors[index].rgb * normalLight;
  }
  vec3 emissive = emissiveFactor.rgb;
#ifdef EMISSIVE_TEXTURED
  emissive *= texture(emissiveTexture, surfaceTextureCoordinate0).rgb;
#endif
  vec3 exposed = (lit + emissive) * max(presentation.x, 0.0);
  vec3 mapped = presentation.y > 0.5 ? pbrNeutral(exposed) : clamp(exposed, 0.0, 1.0);
  outputColor = vec4(linearToSrgb(mapped), 1.0);
}
`;

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Royal could not allocate a surface shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const detail = gl.getShaderInfoLog(shader) ?? "unknown compiler failure";
    gl.deleteShader(shader);
    throw new Error(`Royal surface shader compilation failed: ${detail}`);
  }
  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Royal could not allocate a surface program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const detail = gl.getProgramInfoLog(program) ?? "unknown linker failure";
    gl.deleteProgram(program);
    throw new Error(`Royal surface program link failed: ${detail}`);
  }
  return program;
};

const shaderVariant = (
  source: string,
  features: number,
  instanced: boolean,
  alphaMasked: boolean,
  doubleSided: boolean,
): string => source.replace(
  "\n",
  `\n${features === 0 ? "" : "#define TEXTURED\n"}${features & 1 ? "#define BASE_COLOR_TEXTURED\n" : ""}${features & 2 ? "#define METALLIC_ROUGHNESS_TEXTURED\n" : ""}${features & 4 ? "#define NORMAL_TEXTURED\n" : ""}${features & 8 ? "#define EMISSIVE_TEXTURED\n" : ""}${features & 16 ? "#define TANGENT\n" : ""}${instanced ? "#define INSTANCED\n" : ""}${alphaMasked ? "#define ALPHA_MASK\n" : ""}${doubleSided ? "#define DOUBLE_SIDED\n" : ""}`,
);

const uniform = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    gl.deleteProgram(program);
    throw new Error(`Royal surface program is missing ${name}`);
  }
  return location;
};

const createUnlitProgram = (
  gl: WebGL2RenderingContext,
  features: number,
  instanced: boolean,
  alphaMasked: boolean,
  doubleSided: boolean,
): UnlitProgram => {
  const program = createProgram(
    gl,
    shaderVariant(UNLIT_VERTEX_SHADER, features, instanced, alphaMasked, doubleSided),
    shaderVariant(UNLIT_FRAGMENT_SHADER, features, instanced, alphaMasked, doubleSided),
  );
  return {
    alphaCutoff: alphaMasked ? uniform(gl, program, "alphaCutoff") : null,
    color: uniform(gl, program, "linearColor"),
    kind: "unlit",
    program,
    texture: features & 1 ? uniform(gl, program, "baseColorTexture") : null,
    viewProjectionModel: uniform(gl, program, "viewProjectionModel"),
  };
};

const createStandardProgram = (
  gl: WebGL2RenderingContext,
  features: number,
  instanced: boolean,
  alphaMasked: boolean,
  doubleSided: boolean,
): StandardProgram => {
  const program = createProgram(
    gl,
    shaderVariant(STANDARD_VERTEX_SHADER, features, instanced, alphaMasked, doubleSided),
    shaderVariant(STANDARD_FRAGMENT_SHADER, features, instanced, alphaMasked, doubleSided),
  );
  return {
    alphaMasked,
    baseColor: uniform(gl, program, "baseColor"),
    cameraWorldPosition: uniform(gl, program, "cameraWorldPosition"),
    directionalLightColors: uniform(gl, program, "directionalLightColors"),
    directionalLightCount: uniform(gl, program, "directionalLightCount"),
    directionalLightDirections: uniform(gl, program, "directionalLightDirections"),
    emissive: features & 8 ? uniform(gl, program, "emissiveTexture") : null,
    emissiveFactor: uniform(gl, program, "emissiveFactor"),
    kind: "standard",
    materialFactors: uniform(gl, program, "materialFactors"),
    metallicRoughness: features & 2
      ? uniform(gl, program, "metallicRoughnessTexture")
      : null,
    model: uniform(gl, program, "model"),
    normalTransform: uniform(gl, program, "normalTransform"),
    normalTexture: features & 4 ? uniform(gl, program, "normalTexture") : null,
    presentation: uniform(gl, program, "presentation"),
    program,
    texture: features & 1 ? uniform(gl, program, "baseColorTexture") : null,
    viewProjection: uniform(gl, program, "viewProjection"),
  };
};

export class SurfaceProgramOwner {
  readonly #gl: WebGL2RenderingContext;
  readonly #programs = new Map<string, StandardProgram | UnlitProgram>();

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  dispose(): void {
    for (const retained of this.#programs.values()) {
      this.#gl.deleteProgram(retained.program);
    }
    this.#programs.clear();
  }

  get(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
    alphaMasked: boolean,
    doubleSided: boolean,
  ): StandardProgram | UnlitProgram {
    const twoSided = kind === "standard" && doubleSided;
    const key = surfaceProgramVariantKey(
      kind,
      features,
      instanced,
      alphaMasked,
      doubleSided,
    );
    const retained = this.#programs.get(key);
    if (retained !== undefined) return retained;
    const created = kind === "unlit"
      ? createUnlitProgram(this.#gl, features, instanced, alphaMasked, false)
      : createStandardProgram(this.#gl, features, instanced, alphaMasked, twoSided);
    this.#programs.set(key, created);
    return created;
  }

  invalidate(): void {
    this.#programs.clear();
  }
}
