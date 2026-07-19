import {
  MAX_CANONICAL_DIRECTIONAL_LIGHTS,
  MAX_CANONICAL_PUNCTUAL_LIGHTS,
} from "./scene-lowering";
import unlitVertexShader from "../webgl/shaders/unlit.vert";
import unlitFragmentShader from "../webgl/shaders/unlit.frag";
import standardVertexShader from "../webgl/shaders/surface.vert";
import standardFragmentShader from "../webgl/shaders/surface.frag";

export type TextureCoordinatesProgram = Readonly<{
  row0: WebGLUniformLocation;
  row1: WebGLUniformLocation;
}>;

export const SURFACE_FEATURE_BASE_COLOR_TEXTURE = 1;
export const SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE = 2;
export const SURFACE_FEATURE_NORMAL_TEXTURE = 4;
export const SURFACE_FEATURE_EMISSIVE_TEXTURE = 8;
export const SURFACE_FEATURE_TANGENT = 16;
export const SURFACE_FEATURE_OCCLUSION_TEXTURE = 32;
export const SURFACE_FEATURE_STUDIO_ENVIRONMENT = 64;
export const SURFACE_FEATURE_PUNCTUAL_LIGHTS = 128;
export const SURFACE_TEXTURE_FEATURES = 0b11_1111;

export type UnlitProgram = Readonly<{
  alphaCutoff: WebGLUniformLocation | null;
  color: WebGLUniformLocation;
  kind: "unlit";
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  textureCoordinates: TextureCoordinatesProgram | null;
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
  emissiveCoordinates: TextureCoordinatesProgram | null;
  emissiveFactor: WebGLUniformLocation;
  environmentRotation: WebGLUniformLocation | null;
  environmentSettings: WebGLUniformLocation | null;
  kind: "standard";
  materialFactors: WebGLUniformLocation;
  metallicRoughness: WebGLUniformLocation | null;
  metallicRoughnessCoordinates: TextureCoordinatesProgram | null;
  model: WebGLUniformLocation;
  normalTransform: WebGLUniformLocation;
  normalTexture: WebGLUniformLocation | null;
  normalTextureCoordinates: TextureCoordinatesProgram | null;
  occlusion: WebGLUniformLocation | null;
  occlusionCoordinates: TextureCoordinatesProgram | null;
  occlusionStrength: WebGLUniformLocation | null;
  program: WebGLProgram;
  presentation: WebGLUniformLocation;
  texture: WebGLUniformLocation | null;
  textureCoordinates: TextureCoordinatesProgram | null;
  punctualLightColors: WebGLUniformLocation | null;
  punctualLightCount: WebGLUniformLocation | null;
  punctualLightDirections: WebGLUniformLocation | null;
  punctualLightPositions: WebGLUniformLocation | null;
  punctualLightSpotCones: WebGLUniformLocation | null;
  viewProjection: WebGLUniformLocation;
}>;

export const surfaceProgramVariantKey = (
  kind: "standard" | "unlit",
  features: number,
  instanced: boolean,
  alphaMasked: boolean,
  doubleSided: boolean,
): string => `${kind}:${features}:${instanced ? 1 : 0}:${alphaMasked ? 1 : 0}:${kind === "standard" && doubleSided ? 1 : 0}`;

const UNLIT_VERTEX_SHADER = unlitVertexShader;
const UNLIT_FRAGMENT_SHADER = unlitFragmentShader;
const STANDARD_VERTEX_SHADER = standardVertexShader;
const STANDARD_FRAGMENT_SHADER = standardFragmentShader
  .replace("__MAX_DIRECTIONAL_LIGHTS__", String(MAX_CANONICAL_DIRECTIONAL_LIGHTS))
  .replace("__MAX_PUNCTUAL_LIGHTS__", String(MAX_CANONICAL_PUNCTUAL_LIGHTS));

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
  `\n${features & SURFACE_TEXTURE_FEATURES ? "#define TEXTURED\n" : ""}${features & SURFACE_FEATURE_BASE_COLOR_TEXTURE ? "#define BASE_COLOR_TEXTURED\n" : ""}${features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE ? "#define METALLIC_ROUGHNESS_TEXTURED\n" : ""}${features & SURFACE_FEATURE_NORMAL_TEXTURE ? "#define NORMAL_TEXTURED\n" : ""}${features & SURFACE_FEATURE_EMISSIVE_TEXTURE ? "#define EMISSIVE_TEXTURED\n" : ""}${features & SURFACE_FEATURE_TANGENT ? "#define TANGENT\n" : ""}${features & SURFACE_FEATURE_OCCLUSION_TEXTURE ? "#define OCCLUSION_TEXTURED\n" : ""}${features & SURFACE_FEATURE_STUDIO_ENVIRONMENT ? "#define STUDIO_ENVIRONMENT\n" : ""}${features & SURFACE_FEATURE_PUNCTUAL_LIGHTS ? "#define PUNCTUAL_LIGHTS\n" : ""}${instanced ? "#define INSTANCED\n" : ""}${alphaMasked ? "#define ALPHA_MASK\n" : ""}${doubleSided ? "#define DOUBLE_SIDED\n" : ""}`,
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

const textureCoordinatesProgram = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  prefix: string,
): TextureCoordinatesProgram => ({
  row0: uniform(gl, program, `${prefix}TextureCoordinates0`),
  row1: uniform(gl, program, `${prefix}TextureCoordinates1`),
});

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
    textureCoordinates: features & 1
      ? textureCoordinatesProgram(gl, program, "baseColor")
      : null,
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
    emissive: features & SURFACE_FEATURE_EMISSIVE_TEXTURE
      ? uniform(gl, program, "emissiveTexture")
      : null,
    emissiveCoordinates: features & SURFACE_FEATURE_EMISSIVE_TEXTURE
      ? textureCoordinatesProgram(gl, program, "emissive")
      : null,
    emissiveFactor: uniform(gl, program, "emissiveFactor"),
    environmentRotation: features & SURFACE_FEATURE_STUDIO_ENVIRONMENT
      ? uniform(gl, program, "environmentRotation")
      : null,
    environmentSettings: features & SURFACE_FEATURE_STUDIO_ENVIRONMENT
      ? uniform(gl, program, "environmentSettings")
      : null,
    kind: "standard",
    materialFactors: uniform(gl, program, "materialFactors"),
    metallicRoughness: features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE
      ? uniform(gl, program, "metallicRoughnessTexture")
      : null,
    metallicRoughnessCoordinates: features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE
      ? textureCoordinatesProgram(gl, program, "metallicRoughness")
      : null,
    model: uniform(gl, program, "model"),
    normalTransform: uniform(gl, program, "normalTransform"),
    normalTexture: features & SURFACE_FEATURE_NORMAL_TEXTURE
      ? uniform(gl, program, "normalTexture")
      : null,
    normalTextureCoordinates: features & SURFACE_FEATURE_NORMAL_TEXTURE
      ? textureCoordinatesProgram(gl, program, "normal")
      : null,
    occlusion: features & SURFACE_FEATURE_OCCLUSION_TEXTURE
      ? uniform(gl, program, "occlusionTexture")
      : null,
    occlusionCoordinates: features & SURFACE_FEATURE_OCCLUSION_TEXTURE
      ? textureCoordinatesProgram(gl, program, "occlusion")
      : null,
    occlusionStrength: features & SURFACE_FEATURE_OCCLUSION_TEXTURE
      ? uniform(gl, program, "occlusionStrength")
      : null,
    presentation: uniform(gl, program, "presentation"),
    program,
    punctualLightColors: features & SURFACE_FEATURE_PUNCTUAL_LIGHTS
      ? uniform(gl, program, "punctualLightColors")
      : null,
    punctualLightCount: features & SURFACE_FEATURE_PUNCTUAL_LIGHTS
      ? uniform(gl, program, "punctualLightCount")
      : null,
    punctualLightDirections: features & SURFACE_FEATURE_PUNCTUAL_LIGHTS
      ? uniform(gl, program, "punctualLightDirections")
      : null,
    punctualLightPositions: features & SURFACE_FEATURE_PUNCTUAL_LIGHTS
      ? uniform(gl, program, "punctualLightPositions")
      : null,
    punctualLightSpotCones: features & SURFACE_FEATURE_PUNCTUAL_LIGHTS
      ? uniform(gl, program, "punctualLightSpotCones")
      : null,
    texture: features & 1 ? uniform(gl, program, "baseColorTexture") : null,
    textureCoordinates: features & 1
      ? textureCoordinatesProgram(gl, program, "baseColor")
      : null,
    viewProjection: uniform(gl, program, "viewProjection"),
  };
};

export class SurfaceProgramOwner {
  readonly #gl: WebGL2RenderingContext;
  #initializedSamplers = new WeakSet<WebGLProgram>();
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

  initializeSamplers(program: StandardProgram | UnlitProgram): void {
    if (this.#initializedSamplers.has(program.program)) return;
    if (program.texture !== null) this.#gl.uniform1i(program.texture, 0);
    if (program.kind === "standard") {
      if (program.metallicRoughness !== null) this.#gl.uniform1i(program.metallicRoughness, 1);
      if (program.normalTexture !== null) this.#gl.uniform1i(program.normalTexture, 2);
      if (program.emissive !== null) this.#gl.uniform1i(program.emissive, 3);
      if (program.occlusion !== null) this.#gl.uniform1i(program.occlusion, 4);
    }
    this.#initializedSamplers.add(program.program);
  }

  invalidate(): void {
    this.#programs.clear();
    this.#initializedSamplers = new WeakSet<WebGLProgram>();
  }
}
