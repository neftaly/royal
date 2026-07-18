import {
  affineSurfaceNormalTransformInto,
  cameraWorldPositionFromViewInto,
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { ResolvedCanvasSize } from "../frame/canvas-size";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type { OpaqueDrawStateIntent } from "../webgl/draw-state-transition";
import { TextureGpuOwner, type GpuTextureBinding } from "../texture/gpu-owner";
import {
  MAX_CANONICAL_DIRECTIONAL_LIGHTS,
  type CanonicalDrawSurface,
  type CanonicalSurfaceScene,
} from "./scene-lowering";
import type { CanonicalTextureBinding } from "./canonical-material";

type GpuGeometry = Readonly<{
  indexBuffer: WebGLBuffer;
  indexCount: number;
  indexType: number;
  key: string;
  normalBuffer: WebGLBuffer | null;
  tangentBuffer: WebGLBuffer | null;
  textureCoordinateBuffer: WebGLBuffer | null;
  vertexArray: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}>;

type GpuSurface = Readonly<{
  bindings: readonly GpuTextureBinding[];
  geometry: GpuGeometry;
  instanceCount: number;
  surface: CanonicalDrawSurface;
  vertexArray: WebGLVertexArrayObject;
}>;

type GpuInstanceData = Readonly<{
  buffer: WebGLBuffer;
  count: number;
  key: string;
}>;

type GpuInstanceVertexArray = Readonly<{
  key: string;
  vertexArray: WebGLVertexArrayObject;
}>;

type MutableOpaqueDrawIntent = {
  cullBackFaces: boolean;
  framebuffer: WebGLFramebuffer | null;
  frontFace: number;
  program: WebGLProgram;
  samplers: (WebGLSampler | null)[];
  textures: (WebGLTexture | null)[];
  vertexArray: WebGLVertexArrayObject;
  viewport: { height: number; width: number; x: number; y: number };
};

type UnlitProgram = Readonly<{
  alphaCutoff: WebGLUniformLocation | null;
  color: WebGLUniformLocation;
  kind: "unlit";
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  viewProjectionModel: WebGLUniformLocation;
}>;

type StandardProgram = Readonly<{
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

const indexType = (
  gl: WebGL2RenderingContext,
  indices: Uint8Array | Uint16Array | Uint32Array,
): number => indices instanceof Uint32Array
  ? gl.UNSIGNED_INT
  : indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;

const MATERIAL_TEXTURE_UNITS = 5;

const materialTextureFeatures = (surface: GpuSurface): number => {
  let features = surface.bindings[0]!.texture === null ? 0 : 1;
  if (surface.surface.material.kind !== "standard") return features;
  if (surface.bindings[1]!.texture !== null) features |= 2;
  if (surface.bindings[2]!.texture !== null) features |= 4;
  if ((features & 4) !== 0 && surface.geometry.tangentBuffer !== null) features |= 16;
  if (surface.bindings[4]!.texture !== null) features |= 8;
  return features;
};

/** Owns surface programs and geometry allocations for one context generation. */
export class SurfaceGpuOwner {
  readonly #cameraPosition = new Float32Array(4);
  readonly #directionalLightColors = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  readonly #directionalLightDirections = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  #directionalLightCount = 0;
  #dirty = false;
  #drawIntent: MutableOpaqueDrawIntent | null = null;
  readonly #gl: WebGL2RenderingContext;
  #geometryResources: readonly GpuGeometry[] = [];
  #gpuSurfaces: readonly GpuSurface[] = [];
  #instanceResources: readonly GpuInstanceData[] = [];
  #instanceVertexArrays: readonly GpuInstanceVertexArray[] = [];
  readonly #materialFactors = new Float32Array(4);
  readonly #emissiveFactor = new Float32Array(4);
  readonly #normalTransform: MutableMat4 = identityMat4();
  readonly #programs = new Map<string, StandardProgram | UnlitProgram>();
  #scene: CanonicalSurfaceScene | null = null;
  readonly #textureGpu: TextureGpuOwner;
  readonly #viewProjectionModel: MutableMat4 = identityMat4();

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#textureGpu = new TextureGpuOwner(gl);
  }

  dispose(): void {
    this.#deleteResources();
    this.#textureGpu.dispose();
    this.#deletePrograms();
    this.#drawIntent = null;
    this.#scene = null;
  }

  invalidate(): void {
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
    this.#textureGpu.invalidate();
    this.#programs.clear();
    this.#drawIntent = null;
    this.#dirty = this.#scene !== null;
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#scene === scene) return;
    this.#scene = scene;
    this.#dirty = true;
  }

  draw(
    viewProjection: Mat4,
    view: Mat4,
    size: ResolvedCanvasSize,
    state: WebGlStateOwner,
  ): void {
    if (this.#dirty) {
      try {
        this.#reconcile();
      } finally {
        state.invalidateVertexArray();
        state.invalidateTextureBindings();
      }
    }
    const scene = this.#scene;
    if (scene === null || this.#gpuSurfaces.length === 0) return;
    let drawIntent = this.#drawIntent;
    if (drawIntent === null) {
      const firstSurface = this.#gpuSurfaces[0]!;
      const first = this.#programFor(
        firstSurface.surface.material.kind,
        materialTextureFeatures(firstSurface),
        firstSurface.instanceCount > 0,
        firstSurface.surface.material.alphaCutoff !== undefined,
        firstSurface.surface.material.doubleSided === true,
      );
      drawIntent = {
        cullBackFaces: firstSurface.surface.material.doubleSided !== true,
        framebuffer: null,
        frontFace: this.#gl.CCW,
        program: first.program,
        samplers: [null, null, null, null, null],
        textures: [null, null, null, null, null],
        vertexArray: firstSurface.vertexArray,
        viewport: { height: 0, width: 0, x: 0, y: 0 },
      };
      this.#drawIntent = drawIntent;
    }
    drawIntent.viewport.height = size.backingHeight;
    drawIntent.viewport.width = size.backingWidth;
    cameraWorldPositionFromViewInto(this.#cameraPosition, view);
    this.#cameraPosition[3] = 1;
    let standardGlobalsProgram: WebGLProgram | null = null;
    const gl = this.#gl;
    for (const resource of this.#gpuSurfaces) {
      const surface = resource.surface;
      const program = this.#programFor(
        surface.material.kind,
        materialTextureFeatures(resource),
        resource.instanceCount > 0,
        surface.material.alphaCutoff !== undefined,
        surface.material.doubleSided === true,
      );
      drawIntent.cullBackFaces = surface.material.doubleSided !== true;
      drawIntent.frontFace = surface.modelHandedness < 0 ? gl.CW : gl.CCW;
      drawIntent.program = program.program;
      for (let unit = 0; unit < MATERIAL_TEXTURE_UNITS; unit += 1) {
        const binding = resource.bindings[unit]!;
        drawIntent.samplers[unit] = binding.sampler;
        drawIntent.textures[unit] = binding.texture;
      }
      drawIntent.vertexArray = resource.vertexArray;
      state.applyOpaqueDraw(drawIntent as OpaqueDrawStateIntent);
      if (program.kind === "unlit") {
        multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
        gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        gl.uniform4fv(program.color, surface.material.baseColor);
        if (program.alphaCutoff !== null) {
          gl.uniform1f(program.alphaCutoff, surface.material.alphaCutoff ?? 0.5);
        }
        if (program.texture !== null) gl.uniform1i(program.texture, 0);
      } else {
        const material = surface.material;
        if (material.kind !== "standard") {
          throw new Error("Royal standard surface program received a non-standard material");
        }
        if (standardGlobalsProgram !== program.program) {
          gl.uniformMatrix4fv(program.viewProjection, false, viewProjection);
          gl.uniform4fv(program.cameraWorldPosition, this.#cameraPosition);
          gl.uniform1i(program.directionalLightCount, this.#directionalLightCount);
          gl.uniform4fv(program.directionalLightColors, this.#directionalLightColors);
          gl.uniform4fv(program.directionalLightDirections, this.#directionalLightDirections);
          this.#materialFactors[2] = scene.exposure;
          this.#materialFactors[3] = scene.toneMapping === "pbr-neutral" ? 1 : 0;
          gl.uniform4fv(program.presentation, this.#materialFactors);
          standardGlobalsProgram = program.program;
        }
        gl.uniformMatrix4fv(program.model, false, surface.model);
        affineSurfaceNormalTransformInto(this.#normalTransform, surface.model);
        gl.uniformMatrix4fv(program.normalTransform, false, this.#normalTransform);
        gl.uniform4fv(program.baseColor, material.baseColor);
        if (program.texture !== null) gl.uniform1i(program.texture, 0);
        if (program.metallicRoughness !== null) gl.uniform1i(program.metallicRoughness, 1);
        if (program.normalTexture !== null) gl.uniform1i(program.normalTexture, 2);
        if (program.emissive !== null) gl.uniform1i(program.emissive, 4);
        this.#emissiveFactor[0] = material.emissiveFactor[0];
        this.#emissiveFactor[1] = material.emissiveFactor[1];
        this.#emissiveFactor[2] = material.emissiveFactor[2];
        this.#emissiveFactor[3] = 0;
        gl.uniform4fv(program.emissiveFactor, this.#emissiveFactor);
        this.#materialFactors[0] = material.metallicFactor;
        this.#materialFactors[1] = material.roughnessFactor;
        this.#materialFactors[2] = program.alphaMasked ? material.alphaCutoff ?? 0.5 : 0;
        this.#materialFactors[3] = material.normalScale;
        gl.uniform4fv(program.materialFactors, this.#materialFactors);
      }
      if (resource.instanceCount > 0) {
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          0,
          resource.instanceCount,
        );
      } else {
        gl.drawElements(
          gl.TRIANGLES,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          0,
        );
      }
    }
  }

  #deleteGeometry(resource: GpuGeometry): void {
    this.#gl.deleteBuffer(resource.indexBuffer);
    if (resource.normalBuffer !== null) this.#gl.deleteBuffer(resource.normalBuffer);
    if (resource.tangentBuffer !== null) this.#gl.deleteBuffer(resource.tangentBuffer);
    if (resource.textureCoordinateBuffer !== null) {
      this.#gl.deleteBuffer(resource.textureCoordinateBuffer);
    }
    this.#gl.deleteBuffer(resource.vertexBuffer);
    this.#gl.deleteVertexArray(resource.vertexArray);
  }

  #deleteResources(): void {
    for (const resource of this.#instanceVertexArrays) {
      this.#gl.deleteVertexArray(resource.vertexArray);
    }
    for (const resource of this.#instanceResources) this.#gl.deleteBuffer(resource.buffer);
    for (const resource of this.#geometryResources) this.#deleteGeometry(resource);
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
  }

  #deletePrograms(): void {
    for (const program of this.#programs.values()) this.#gl.deleteProgram(program.program);
    this.#programs.clear();
  }

  #createGeometry(surface: CanonicalDrawSurface, key: string): GpuGeometry {
    const gl = this.#gl;
    const normals = surface.material.kind === "standard" ? surface.geometry.normals : undefined;
    const tangents = surface.material.kind === "standard"
      && surface.material.normalAsset !== undefined
      ? surface.geometry.tangents
      : undefined;
    const textureCoordinates = surface.material.requiresTextureCoordinates
      ? surface.geometry.textureCoordinates0
      : undefined;
    if (surface.material.requiresTextureCoordinates && textureCoordinates === undefined) {
      throw new Error("Royal textured surface requires TEXCOORD_0 geometry");
    }
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const normalBuffer = normals === undefined ? null : gl.createBuffer();
    const tangentBuffer = tangents === undefined ? null : gl.createBuffer();
    const textureCoordinateBuffer = textureCoordinates === undefined ? null : gl.createBuffer();
    if (
      vertexArray === null
      || vertexBuffer === null
      || indexBuffer === null
      || (normals !== undefined && normalBuffer === null)
      || (tangents !== undefined && tangentBuffer === null)
      || (textureCoordinates !== undefined && textureCoordinateBuffer === null)
    ) {
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      if (tangentBuffer !== null) gl.deleteBuffer(tangentBuffer);
      if (textureCoordinateBuffer !== null) gl.deleteBuffer(textureCoordinateBuffer);
      throw new Error("Royal could not allocate surface geometry");
    }
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, surface.geometry.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (normals === undefined) {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 0);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      }
      if (textureCoordinates === undefined) {
        gl.disableVertexAttribArray(2);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordinateBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, textureCoordinates, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      }
      if (tangents === undefined) {
        gl.disableVertexAttribArray(10);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, tangents, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(10);
        gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.geometry.indices, gl.STATIC_DRAW);
      return {
        indexBuffer,
        indexCount: surface.geometry.indices.length,
        indexType: indexType(gl, surface.geometry.indices),
        key,
        normalBuffer,
        tangentBuffer,
        textureCoordinateBuffer,
        vertexArray,
        vertexBuffer,
      };
    } catch (error) {
      gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      if (tangentBuffer !== null) gl.deleteBuffer(tangentBuffer);
      if (textureCoordinateBuffer !== null) gl.deleteBuffer(textureCoordinateBuffer);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  #createInstanceData(surface: CanonicalDrawSurface): GpuInstanceData {
    const instances = surface.instances;
    if (
      instances === undefined
      || !Number.isSafeInteger(instances.count)
      || instances.count < 1
      || instances.localModels.length !== instances.count * 16
    ) throw new Error("Royal instanced surface has invalid matrix storage");
    const values = new Float32Array(instances.count * 28);
    const model = identityMat4();
    const normal = identityMat4();
    for (let instance = 0; instance < instances.count; instance += 1) {
      const sourceOffset = instance * 16;
      const targetOffset = instance * 28;
      for (let component = 0; component < 16; component += 1) {
        const value = instances.localModels[sourceOffset + component];
        if (value === undefined || !Number.isFinite(value)) {
          throw new Error(`Royal instance ${instance} matrix is not finite`);
        }
        model[component] = value;
        values[targetOffset + component] = value;
      }
      affineSurfaceNormalTransformInto(normal, model);
      for (let column = 0; column < 3; column += 1) {
        const normalSource = column * 4;
        const normalTarget = targetOffset + 16 + column * 4;
        values[normalTarget] = normal[normalSource]!;
        values[normalTarget + 1] = normal[normalSource + 1]!;
        values[normalTarget + 2] = normal[normalSource + 2]!;
        values[normalTarget + 3] = column === 2 ? normal[15] : 0;
      }
    }
    const buffer = this.#gl.createBuffer();
    if (buffer === null) throw new Error("Royal could not allocate instance transforms");
    try {
      this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, buffer);
      this.#gl.bufferData(this.#gl.ARRAY_BUFFER, values, this.#gl.STATIC_DRAW);
      return { buffer, count: instances.count, key: instances.key };
    } catch (error) {
      this.#gl.deleteBuffer(buffer);
      throw error;
    }
  }

  #createInstanceVertexArray(
    geometry: GpuGeometry,
    instances: GpuInstanceData,
    key: string,
  ): GpuInstanceVertexArray {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) throw new Error("Royal could not allocate an instanced vertex array");
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (geometry.normalBuffer === null) {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 0);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      }
      if (geometry.textureCoordinateBuffer === null) {
        gl.disableVertexAttribArray(2);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.textureCoordinateBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      }
      if (geometry.tangentBuffer === null) {
        gl.disableVertexAttribArray(10);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.tangentBuffer);
        gl.enableVertexAttribArray(10);
        gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instances.buffer);
      const stride = 28 * 4;
      for (let column = 0; column < 4; column += 1) {
        const location = 3 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, column * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      for (let column = 0; column < 3; column += 1) {
        const location = 7 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          column === 2 ? 4 : 3,
          gl.FLOAT,
          false,
          stride,
          64 + column * 16,
        );
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      return { key, vertexArray };
    } catch (error) {
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  #programFor(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
    alphaMasked: boolean,
    doubleSided: boolean,
  ): StandardProgram | UnlitProgram {
    const twoSided = kind === "standard" && doubleSided;
    const key = `${kind}:${features}:${instanced ? "instances" : "single"}:${alphaMasked ? "mask" : "opaque"}:${twoSided ? "two-sided" : "one-sided"}`;
    const retained = this.#programs.get(key);
    if (retained !== undefined) return retained;
    const created = kind === "unlit"
      ? createUnlitProgram(this.#gl, features, instanced, alphaMasked, false)
      : createStandardProgram(this.#gl, features, instanced, alphaMasked, twoSided);
    this.#programs.set(key, created);
    return created;
  }

  #reconcile(): void {
    this.#dirty = false;
    const scene = this.#scene;
    if (scene === null || scene.surfaces.length === 0) {
      this.#deleteResources();
      this.#textureGpu.reconcile([]);
      this.#drawIntent = null;
      return;
    }
    this.#directionalLightColors.fill(0);
    this.#directionalLightDirections.fill(0);
    this.#directionalLightCount = scene.directionalLights.length;
    for (let index = 0; index < scene.directionalLights.length; index += 1) {
      const light = scene.directionalLights[index]!;
      const offset = index * 4;
      this.#directionalLightColors.set(light.color, offset);
      this.#directionalLightDirections.set(light.direction, offset);
    }
    const previousByKey = new Map(
      this.#geometryResources.map((resource) => [resource.key, resource] as const),
    );
    const previousInstancesByKey = new Map(
      this.#instanceResources.map((resource) => [resource.key, resource] as const),
    );
    const previousInstanceVaosByKey = new Map(
      this.#instanceVertexArrays.map((resource) => [resource.key, resource] as const),
    );
    const nextByKey = new Map<string, GpuGeometry>();
    const nextInstancesByKey = new Map<string, GpuInstanceData>();
    const nextInstanceVaosByKey = new Map<string, GpuInstanceVertexArray>();
    const nextGeometryResources: GpuGeometry[] = [];
    const nextInstanceResources: GpuInstanceData[] = [];
    const nextInstanceVertexArrays: GpuInstanceVertexArray[] = [];
    const pendingSurfaces: Array<Readonly<{
      geometry: GpuGeometry;
      instanceCount: number;
      surface: CanonicalDrawSurface;
      textureOffset: number;
      vertexArray: WebGLVertexArrayObject;
    }>> = [];
    const textureInputs: Array<CanonicalTextureBinding | undefined> = [];
    const nextSurfaces: GpuSurface[] = [];
    const createdGeometry: GpuGeometry[] = [];
    const createdInstances: GpuInstanceData[] = [];
    const createdInstanceVaos: GpuInstanceVertexArray[] = [];
    let textureBindings: readonly GpuTextureBinding[];
    try {
      for (const surface of scene.surfaces) {
        const geometryBaseKey = surface.material.kind === "standard"
          && surface.geometry.normals !== undefined
          ? `${surface.geometry.key}:normal`
          : `${surface.geometry.key}:position`;
        const tangentKey = surface.material.kind === "standard"
          && surface.material.normalAsset !== undefined
          && surface.geometry.tangents !== undefined
          ? "tangent"
          : "no-tangent";
        const key = `${geometryBaseKey}:${surface.material.requiresTextureCoordinates ? "uv0" : "no-uv"}:${tangentKey}`;
        let geometry = nextByKey.get(key) ?? previousByKey.get(key);
        if (geometry === undefined) {
          geometry = this.#createGeometry(surface, key);
          createdGeometry.push(geometry);
        }
        if (!nextByKey.has(key)) {
          nextByKey.set(key, geometry);
          nextGeometryResources.push(geometry);
        }
        let instanceCount = 0;
        let vertexArray = geometry.vertexArray;
        const instances = surface.instances;
        if (instances !== undefined) {
          let instanceData = nextInstancesByKey.get(instances.key)
            ?? previousInstancesByKey.get(instances.key);
          if (instanceData === undefined) {
            instanceData = this.#createInstanceData(surface);
            createdInstances.push(instanceData);
          }
          if (!nextInstancesByKey.has(instances.key)) {
            nextInstancesByKey.set(instances.key, instanceData);
            nextInstanceResources.push(instanceData);
          }
          const vaoKey = JSON.stringify([key, instances.key]);
          let instanceVao = nextInstanceVaosByKey.get(vaoKey)
            ?? previousInstanceVaosByKey.get(vaoKey);
          if (instanceVao === undefined) {
            instanceVao = this.#createInstanceVertexArray(geometry, instanceData, vaoKey);
            createdInstanceVaos.push(instanceVao);
          }
          if (!nextInstanceVaosByKey.has(vaoKey)) {
            nextInstanceVaosByKey.set(vaoKey, instanceVao);
            nextInstanceVertexArrays.push(instanceVao);
          }
          instanceCount = instanceData.count;
          vertexArray = instanceVao.vertexArray;
        }
        const material = surface.material;
        const textureOffset = textureInputs.length;
        textureInputs.push(
          material.baseColorTexture,
          material.kind === "standard" ? material.metallicRoughnessTexture : undefined,
          material.kind === "standard" ? material.normalTexture : undefined,
          material.kind === "standard" ? material.occlusionTexture : undefined,
          material.kind === "standard" ? material.emissiveTexture : undefined,
        );
        pendingSurfaces.push({
          geometry,
          instanceCount,
          surface,
          textureOffset,
          vertexArray,
        });
      }
      textureBindings = this.#textureGpu.reconcile(textureInputs);
    } catch (error) {
      for (const resource of createdInstanceVaos) this.#gl.deleteVertexArray(resource.vertexArray);
      for (const resource of createdInstances) this.#gl.deleteBuffer(resource.buffer);
      for (const resource of createdGeometry) this.#deleteGeometry(resource);
      throw error;
    }
    for (let index = 0; index < pendingSurfaces.length; index += 1) {
      const pending = pendingSurfaces[index]!;
      const offset = pending.textureOffset;
      nextSurfaces.push({
        bindings: [
          textureBindings[offset]!,
          textureBindings[offset + 1]!,
          textureBindings[offset + 2]!,
          textureBindings[offset + 3]!,
          textureBindings[offset + 4]!,
        ],
        geometry: pending.geometry,
        instanceCount: pending.instanceCount,
        surface: pending.surface,
        vertexArray: pending.vertexArray,
      });
    }
    for (const resource of this.#instanceVertexArrays) {
      if (nextInstanceVaosByKey.get(resource.key) !== resource) {
        this.#gl.deleteVertexArray(resource.vertexArray);
      }
    }
    for (const resource of this.#instanceResources) {
      if (nextInstancesByKey.get(resource.key) !== resource) this.#gl.deleteBuffer(resource.buffer);
    }
    for (const resource of this.#geometryResources) {
      if (nextByKey.get(resource.key) !== resource) this.#deleteGeometry(resource);
    }
    this.#geometryResources = nextGeometryResources;
    this.#gpuSurfaces = nextSurfaces;
    this.#instanceResources = nextInstanceResources;
    this.#instanceVertexArrays = nextInstanceVertexArrays;
    this.#drawIntent = null;
  }
}
