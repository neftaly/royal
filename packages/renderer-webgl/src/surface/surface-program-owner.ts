import unlitVertexShader from "../webgl/shaders/unlit.vert";
import unlitFragmentShader from "../webgl/shaders/unlit.frag";
import standardVertexShader from "../webgl/shaders/surface.vert";
import standardFragmentShader from "../webgl/shaders/surface.frag";
import { PRESENTATION_GLSL } from "../webgl/shaders/presentation-functions";
import {
  SCREEN_SPACE_PARTITION_BUCKET_BITS,
  SCREEN_SPACE_PARTITION_PATTERN_SIZE,
  SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT,
} from "./screen-space-partition-pattern";
import {
  beginWebGlProgramLink,
  compileWebGlShader,
  linkWebGlProgram,
  requiredWebGlUniform,
} from "../webgl/program";
import {
  SURFACE_FEATURE_ALPHA_BLEND,
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_EMISSIVE_TEXTURE,
  SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
  SURFACE_FEATURE_LINEAR_OUTPUT,
  SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_OCCLUSION_TEXTURE,
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
  SURFACE_FEATURE_ROTATED_ENVIRONMENT,
  SURFACE_FEATURE_SCREEN_SPACE_PARTITION,
  SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE,
  SURFACE_FEATURE_SPECULAR_MATERIAL,
  SURFACE_FEATURE_SPECULAR_TEXTURE,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
  SURFACE_FEATURE_TANGENT,
  SURFACE_FEATURE_THICKNESS_TEXTURE,
  SURFACE_FEATURE_TRANSMISSION_MATERIAL,
  SURFACE_FEATURE_TRANSMISSION_TEXTURE,
  SURFACE_FEATURE_VERTEX_COLOR,
  SURFACE_FEATURE_VERTEX_NORMAL,
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_VOLUME_MATERIAL,
  SURFACE_TEXTURE_FEATURES,
  surfaceDirectionalLightCount,
  surfacePunctualLightCount,
} from "./surface-program-features";

export type TextureCoordinatesProgram = Readonly<{
  row0: WebGLUniformLocation;
  row1: WebGLUniformLocation;
}>;

export type SurfaceTransmissionShaderSource = Readonly<{
  fragmentBody: string;
  fragmentDeclarations: string;
  vertexBody: string;
  vertexDeclarations: string;
}>;

const EMPTY_TRANSMISSION_SHADER_SOURCE: SurfaceTransmissionShaderSource = {
  fragmentBody: "",
  fragmentDeclarations: "",
  vertexBody: "",
  vertexDeclarations: "",
};

export type UnlitProgram = Readonly<{
  alphaCutoff: WebGLUniformLocation | null;
  color: WebGLUniformLocation;
  kind: "unlit";
  partition: Readonly<{
    cellSize: WebGLUniformLocation;
    count: WebGLUniformLocation;
    index: WebGLUniformLocation;
    pattern: WebGLUniformLocation;
    viewportOrigin: WebGLUniformLocation;
  }> | null;
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  textureCoordinates: TextureCoordinatesProgram | null;
  virtualPageTable: WebGLUniformLocation | null;
  virtualSettings0: WebGLUniformLocation | null;
  virtualSettings1: WebGLUniformLocation | null;
  virtualSettings2: WebGLUniformLocation | null;
  viewProjectionModel: WebGLUniformLocation;
}>;

export type StandardProgram = Readonly<{
  alphaMasked: boolean;
  baseColor: WebGLUniformLocation;
  attenuationColor: WebGLUniformLocation | null;
  cameraWorldPosition: WebGLUniformLocation;
  directionalLightColors: WebGLUniformLocation | null;
  directionalLightDirections: WebGLUniformLocation | null;
  emissive: WebGLUniformLocation | null;
  emissiveCoordinates: TextureCoordinatesProgram | null;
  emissiveFactor: WebGLUniformLocation;
  environmentCoefficients: WebGLUniformLocation | null;
  environmentRotation: WebGLUniformLocation | null;
  environmentSettings: WebGLUniformLocation | null;
  environmentSpecular: WebGLUniformLocation | null;
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
  presentation: WebGLUniformLocation | null;
  texture: WebGLUniformLocation | null;
  textureCoordinates: TextureCoordinatesProgram | null;
  virtualPageTable: WebGLUniformLocation | null;
  virtualSettings0: WebGLUniformLocation | null;
  virtualSettings1: WebGLUniformLocation | null;
  virtualSettings2: WebGLUniformLocation | null;
  punctualLightColors: WebGLUniformLocation | null;
  punctualLightDirections: WebGLUniformLocation | null;
  punctualLightPositions: WebGLUniformLocation | null;
  punctualLightSpotCones: WebGLUniformLocation | null;
  specular: WebGLUniformLocation | null;
  specularColor: WebGLUniformLocation | null;
  specularColorCoordinates: TextureCoordinatesProgram | null;
  specularCoordinates: TextureCoordinatesProgram | null;
  specularFactors: WebGLUniformLocation | null;
  sceneColor: WebGLUniformLocation | null;
  thickness: WebGLUniformLocation | null;
  thicknessCoordinates: TextureCoordinatesProgram | null;
  transmission: WebGLUniformLocation | null;
  transmissionCoordinates: TextureCoordinatesProgram | null;
  transmissionFactors: WebGLUniformLocation | null;
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
const UNLIT_FRAGMENT_SHADER = unlitFragmentShader
  .replace(
    "__SCREEN_SPACE_PARTITION_MASK__",
    String(SCREEN_SPACE_PARTITION_PATTERN_SIZE - 1),
  )
  .replace(
    "__SCREEN_SPACE_PARTITION_BUCKET_BITS__",
    String(SCREEN_SPACE_PARTITION_BUCKET_BITS),
  );
const STANDARD_VERTEX_SHADER = standardVertexShader;
const STANDARD_FRAGMENT_SHADER = standardFragmentShader
  .replace("__PRESENTATION_FUNCTIONS__", PRESENTATION_GLSL);

const STANDARD_VERTEX_FEATURES = SURFACE_TEXTURE_FEATURES
  | SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES
  | SURFACE_FEATURE_TANGENT
  | SURFACE_FEATURE_TRANSMISSION_MATERIAL
  | SURFACE_FEATURE_VERTEX_COLOR;

const UNLIT_VERTEX_FEATURES = SURFACE_FEATURE_BASE_COLOR_TEXTURE
  | SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES
  | SURFACE_FEATURE_VERTEX_COLOR
  | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE;

const SEMANTIC_TEXTURE_COORDINATE = /surface(?:BaseColor|MetallicRoughness|Normal|Emissive|Occlusion|Specular(?:Color)?|Transmission|Thickness)TextureCoordinate/g;

/** Pure projection from material features to the subset that changes vertex code. */
export const surfaceVertexFeatures = (
  kind: "standard" | "unlit",
  features: number,
): number => features & (kind === "standard" ? STANDARD_VERTEX_FEATURES : UNLIT_VERTEX_FEATURES);

const createSurfaceProgram = (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragmentSource: string,
  validation: "deferred" | "synchronous",
): WebGLProgram => {
  const fragment = compileWebGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource, "surface");
  try {
    return validation === "deferred"
      ? beginWebGlProgramLink(gl, vertex, fragment, "surface")
      : linkWebGlProgram(gl, vertex, fragment, "surface");
  } finally {
    gl.deleteShader(fragment);
  }
};

const shaderVariant = (
  source: string,
  features: number,
  instanced: boolean,
  alphaMasked: boolean,
  doubleSided: boolean,
  virtualDeclarations: string,
  transmissionSource: SurfaceTransmissionShaderSource,
): string => {
  const directionalLightCount = surfaceDirectionalLightCount(features);
  const punctualLightCount = surfacePunctualLightCount(features);
  const variant = source.replace(
    "__MAX_DIRECTIONAL_LIGHTS__",
    String(Math.max(1, directionalLightCount)),
  ).replace(
    "__MAX_PUNCTUAL_LIGHTS__",
    String(Math.max(1, punctualLightCount)),
  ).replace(
    "__VIRTUAL_TEXTURE_DECLARATIONS__",
    features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE ? virtualDeclarations : "",
  ).replace(
    "__TRANSMISSION_DECLARATIONS__",
    features & SURFACE_FEATURE_TRANSMISSION_MATERIAL
      ? transmissionSource.fragmentDeclarations : "",
  ).replace(
    "__TRANSMISSION_BODY__",
    features & SURFACE_FEATURE_TRANSMISSION_MATERIAL
      ? transmissionSource.fragmentBody : "",
  ).replace(
    "__TRANSMISSION_VERTEX_DECLARATIONS__",
    features & SURFACE_FEATURE_TRANSMISSION_MATERIAL
      ? transmissionSource.vertexDeclarations : "",
  ).replace(
    "__TRANSMISSION_VERTEX_BODY__",
    features & SURFACE_FEATURE_TRANSMISSION_MATERIAL
      ? transmissionSource.vertexBody : "",
  ).replace(
    "\n",
    `\n${features & SURFACE_FEATURE_VERTEX_NORMAL ? "#define VERTEX_NORMAL\n" : ""}${features & SURFACE_TEXTURE_FEATURES ? "#define TEXTURED\n" : ""}${features & SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES ? "#define IDENTITY_TEXTURE_COORDINATES\n" : ""}${features & SURFACE_FEATURE_ROTATED_ENVIRONMENT ? "#define ROTATED_ENVIRONMENT\n" : ""}${features & SURFACE_FEATURE_SCREEN_SPACE_PARTITION ? "#define SCREEN_SPACE_PARTITION\n" : ""}${features & SURFACE_FEATURE_BASE_COLOR_TEXTURE ? "#define BASE_COLOR_TEXTURED\n" : ""}${features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE ? "#define VIRTUAL_BASE_COLOR_TEXTURED\n" : ""}${features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE ? "#define METALLIC_ROUGHNESS_TEXTURED\n" : ""}${features & SURFACE_FEATURE_NORMAL_TEXTURE ? "#define NORMAL_TEXTURED\n" : ""}${features & SURFACE_FEATURE_EMISSIVE_TEXTURE ? "#define EMISSIVE_TEXTURED\n" : ""}${features & SURFACE_FEATURE_TANGENT ? "#define TANGENT\n" : ""}${features & SURFACE_FEATURE_OCCLUSION_TEXTURE ? "#define OCCLUSION_TEXTURED\n" : ""}${features & SURFACE_FEATURE_SPECULAR_TEXTURE ? "#define SPECULAR_TEXTURED\n" : ""}${features & SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE ? "#define SPECULAR_COLOR_TEXTURED\n" : ""}${features & SURFACE_FEATURE_SPECULAR_MATERIAL ? "#define SPECULAR_MATERIAL\n" : ""}${features & SURFACE_FEATURE_LINEAR_OUTPUT ? "#define LINEAR_OUTPUT\n" : ""}${features & SURFACE_FEATURE_TRANSMISSION_MATERIAL ? "#define TRANSMISSION_MATERIAL\n" : ""}${features & SURFACE_FEATURE_VOLUME_MATERIAL ? "#define VOLUME_MATERIAL\n" : ""}${features & SURFACE_FEATURE_TRANSMISSION_TEXTURE ? "#define TRANSMISSION_TEXTURED\n" : ""}${features & SURFACE_FEATURE_THICKNESS_TEXTURE ? "#define THICKNESS_TEXTURED\n" : ""}${features & SURFACE_FEATURE_STUDIO_ENVIRONMENT ? "#define STUDIO_ENVIRONMENT\n" : ""}${features & SURFACE_FEATURE_PREFILTERED_ENVIRONMENT ? "#define PREFILTERED_ENVIRONMENT\n" : ""}${directionalLightCount > 0 ? "#define DIRECTIONAL_LIGHTS\n" : ""}${punctualLightCount > 0 ? "#define PUNCTUAL_LIGHTS\n" : ""}${features & SURFACE_FEATURE_VERTEX_COLOR ? "#define VERTEX_COLOR\n" : ""}${features & SURFACE_FEATURE_ALPHA_BLEND ? "#define ALPHA_BLEND\n" : ""}${instanced ? "#define INSTANCED\n" : ""}${alphaMasked ? "#define ALPHA_MASK\n" : ""}${doubleSided ? "#define DOUBLE_SIDED\n" : ""}`,
  );
  return features & SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES
    ? variant.replace(SEMANTIC_TEXTURE_COORDINATE, "surfaceTextureCoordinate")
    : variant;
};

const uniform = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation => {
  return requiredWebGlUniform(gl, program, name, "surface");
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
  program: WebGLProgram,
  features: number,
  alphaMasked: boolean,
): UnlitProgram => {
  const transformedCoordinates = (features & SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES) === 0;
  return {
    alphaCutoff: alphaMasked ? uniform(gl, program, "alphaCutoff") : null,
    color: uniform(gl, program, "linearColor"),
    kind: "unlit",
    partition: features & SURFACE_FEATURE_SCREEN_SPACE_PARTITION
      ? {
          cellSize: uniform(gl, program, "partitionCellSize"),
          count: uniform(gl, program, "partitionCount"),
          index: uniform(gl, program, "partitionIndex"),
          pattern: uniform(gl, program, "partitionPattern"),
          viewportOrigin: uniform(gl, program, "viewportOrigin"),
        }
      : null,
    program,
    texture: features & (SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE)
      ? uniform(gl, program, "baseColorTexture")
      : null,
    textureCoordinates: transformedCoordinates
      && features & (SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE)
      ? textureCoordinatesProgram(gl, program, "baseColor")
      : null,
    virtualPageTable: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualPageTable") : null,
    virtualSettings0: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualSettings0") : null,
    virtualSettings1: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualSettings1") : null,
    virtualSettings2: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualSettings2") : null,
    viewProjectionModel: uniform(gl, program, "viewProjectionModel"),
  };
};

const createStandardProgram = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  features: number,
  alphaMasked: boolean,
): StandardProgram => {
  const transformedCoordinates = (features & SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES) === 0;
  return {
    alphaMasked,
    attenuationColor: features & SURFACE_FEATURE_VOLUME_MATERIAL
      ? uniform(gl, program, "attenuationColor")
      : null,
    baseColor: uniform(gl, program, "baseColor"),
    cameraWorldPosition: uniform(gl, program, "cameraWorldPosition"),
    directionalLightColors: surfaceDirectionalLightCount(features) > 0
      ? uniform(gl, program, "directionalLightColors") : null,
    directionalLightDirections: surfaceDirectionalLightCount(features) > 0
      ? uniform(gl, program, "directionalLightDirections") : null,
    emissive: features & SURFACE_FEATURE_EMISSIVE_TEXTURE
      ? uniform(gl, program, "emissiveTexture")
      : null,
    emissiveCoordinates: transformedCoordinates && features & SURFACE_FEATURE_EMISSIVE_TEXTURE
      ? textureCoordinatesProgram(gl, program, "emissive")
      : null,
    emissiveFactor: uniform(gl, program, "emissiveFactor"),
    environmentCoefficients: features & SURFACE_FEATURE_PREFILTERED_ENVIRONMENT
      ? uniform(gl, program, "environmentCoefficients[0]")
      : null,
    environmentRotation: features & SURFACE_FEATURE_ROTATED_ENVIRONMENT
      ? uniform(gl, program, "environmentRotation")
      : null,
    environmentSettings: features & (
      SURFACE_FEATURE_STUDIO_ENVIRONMENT | SURFACE_FEATURE_PREFILTERED_ENVIRONMENT
    )
      ? uniform(gl, program, "environmentSettings")
      : null,
    environmentSpecular: features & SURFACE_FEATURE_PREFILTERED_ENVIRONMENT
      ? uniform(gl, program, "environmentSpecularTexture")
      : null,
    kind: "standard",
    materialFactors: uniform(gl, program, "materialFactors"),
    metallicRoughness: features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE
      ? uniform(gl, program, "metallicRoughnessTexture")
      : null,
    metallicRoughnessCoordinates: transformedCoordinates
      && features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE
      ? textureCoordinatesProgram(gl, program, "metallicRoughness")
      : null,
    model: uniform(gl, program, "model"),
    normalTransform: uniform(gl, program, "normalTransform"),
    normalTexture: features & SURFACE_FEATURE_NORMAL_TEXTURE
      ? uniform(gl, program, "normalTexture")
      : null,
    normalTextureCoordinates: transformedCoordinates && features & SURFACE_FEATURE_NORMAL_TEXTURE
      ? textureCoordinatesProgram(gl, program, "normal")
      : null,
    occlusion: features & SURFACE_FEATURE_OCCLUSION_TEXTURE
      ? uniform(gl, program, "occlusionTexture")
      : null,
    occlusionCoordinates: transformedCoordinates && features & SURFACE_FEATURE_OCCLUSION_TEXTURE
      ? textureCoordinatesProgram(gl, program, "occlusion")
      : null,
    occlusionStrength: features & SURFACE_FEATURE_OCCLUSION_TEXTURE
      ? uniform(gl, program, "occlusionStrength")
      : null,
    presentation: features & SURFACE_FEATURE_LINEAR_OUTPUT
      ? null
      : uniform(gl, program, "presentation"),
    program,
    punctualLightColors: surfacePunctualLightCount(features) > 0
      ? uniform(gl, program, "punctualLightColors")
      : null,
    punctualLightDirections: surfacePunctualLightCount(features) > 0
      ? uniform(gl, program, "punctualLightDirections")
      : null,
    punctualLightPositions: surfacePunctualLightCount(features) > 0
      ? uniform(gl, program, "punctualLightPositions")
      : null,
    punctualLightSpotCones: surfacePunctualLightCount(features) > 0
      ? uniform(gl, program, "punctualLightSpotCones")
      : null,
    specular: features & SURFACE_FEATURE_SPECULAR_TEXTURE
      ? uniform(gl, program, "specularTexture")
      : null,
    specularColor: features & SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE
      ? uniform(gl, program, "specularColorTexture")
      : null,
    specularColorCoordinates: transformedCoordinates
      && features & SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE
      ? textureCoordinatesProgram(gl, program, "specularColor")
      : null,
    specularCoordinates: transformedCoordinates && features & SURFACE_FEATURE_SPECULAR_TEXTURE
      ? textureCoordinatesProgram(gl, program, "specular")
      : null,
    specularFactors: features & SURFACE_FEATURE_SPECULAR_MATERIAL
      ? uniform(gl, program, "specularFactors")
      : null,
    sceneColor: features & SURFACE_FEATURE_TRANSMISSION_MATERIAL
      ? uniform(gl, program, "sceneColor")
      : null,
    thickness: features & SURFACE_FEATURE_THICKNESS_TEXTURE
      ? uniform(gl, program, "thicknessTexture")
      : null,
    thicknessCoordinates: transformedCoordinates && features & SURFACE_FEATURE_THICKNESS_TEXTURE
      ? textureCoordinatesProgram(gl, program, "thickness")
      : null,
    transmission: features & SURFACE_FEATURE_TRANSMISSION_TEXTURE
      ? uniform(gl, program, "transmissionTexture")
      : null,
    transmissionCoordinates: transformedCoordinates && features & SURFACE_FEATURE_TRANSMISSION_TEXTURE
      ? textureCoordinatesProgram(gl, program, "transmission")
      : null,
    transmissionFactors: features & SURFACE_FEATURE_TRANSMISSION_MATERIAL
      ? uniform(gl, program, "transmissionFactors")
      : null,
    texture: features & (SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE)
      ? uniform(gl, program, "baseColorTexture")
      : null,
    textureCoordinates: transformedCoordinates
      && features & (SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE)
      ? textureCoordinatesProgram(gl, program, "baseColor")
      : null,
    virtualPageTable: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualPageTable") : null,
    virtualSettings0: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualSettings0") : null,
    virtualSettings1: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualSettings1") : null,
    virtualSettings2: features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      ? uniform(gl, program, "virtualSettings2") : null,
    viewProjection: uniform(gl, program, "viewProjection"),
  };
};

type PendingSurfaceProgram = Readonly<{
  pending: true;
  program: WebGLProgram;
}>;

export class SurfaceProgramOwner {
  readonly #gl: WebGL2RenderingContext;
  readonly #initializedSamplers = new Set<WebGLProgram>();
  #parallelCompile: boolean;
  readonly #programs = new Map<
    string,
    PendingSurfaceProgram | StandardProgram | UnlitProgram
  >();
  readonly #vertexShaders = new Map<string, WebGLShader>();
  #transmissionSource = EMPTY_TRANSMISSION_SHADER_SOURCE;
  #virtualDeclarations = "";

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#parallelCompile = gl.getExtension("KHR_parallel_shader_compile") !== null;
  }

  dispose(): void {
    for (const retained of this.#programs.values()) this.#gl.deleteProgram(retained.program);
    this.#programs.clear();
    this.#deleteVertexShaders();
    this.#initializedSamplers.clear();
  }

  get(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
    alphaMasked: boolean,
    doubleSided: boolean,
  ): StandardProgram | UnlitProgram {
    const key = surfaceProgramVariantKey(
      kind,
      features,
      instanced,
      alphaMasked,
      doubleSided,
    );
    const retained = this.#programs.get(key);
    if (retained !== undefined && !("pending" in retained)) return retained;
    const program = retained?.program
      ?? this.#begin(kind, features, instanced, alphaMasked, doubleSided, "synchronous");
    if (retained !== undefined) {
      const gl = this.#gl;
      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        const detail = gl.getProgramInfoLog(program) || "unknown linker failure";
        gl.deleteProgram(program);
        this.#programs.delete(key);
        throw new Error(`Royal surface program link failed: ${detail}`);
      }
    }
    this.#programs.delete(key);
    const created = kind === "unlit"
      ? createUnlitProgram(this.#gl, program, features, alphaMasked)
      : createStandardProgram(this.#gl, program, features, alphaMasked);
    this.#programs.set(key, created);
    return created;
  }

  /** Starts one likely future variant while the caller continues other preparation. */
  prewarm(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
    alphaMasked: boolean,
    doubleSided: boolean,
  ): void {
    if (
      !this.#parallelCompile
      || features & (
        SURFACE_FEATURE_TRANSMISSION_MATERIAL
        | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
      )
    ) return;
    const key = surfaceProgramVariantKey(
      kind,
      features,
      instanced,
      alphaMasked,
      doubleSided,
    );
    if (this.#programs.has(key)) return;
    this.#programs.set(key, {
      pending: true,
      program: this.#begin(kind, features, instanced, alphaMasked, doubleSided, "deferred"),
    });
  }

  initializeSamplers(program: StandardProgram | UnlitProgram): void {
    if (this.#initializedSamplers.has(program.program)) return;
    if (program.texture !== null) this.#gl.uniform1i(program.texture, 0);
    if (program.kind === "standard") {
      if (program.metallicRoughness !== null) this.#gl.uniform1i(program.metallicRoughness, 1);
      if (program.normalTexture !== null) this.#gl.uniform1i(program.normalTexture, 2);
      if (program.emissive !== null) this.#gl.uniform1i(program.emissive, 3);
      if (program.occlusion !== null) this.#gl.uniform1i(program.occlusion, 4);
      if (program.specular !== null) this.#gl.uniform1i(program.specular, 5);
      if (program.specularColor !== null) this.#gl.uniform1i(program.specularColor, 6);
      if (program.transmission !== null) this.#gl.uniform1i(program.transmission, 8);
      if (program.thickness !== null) this.#gl.uniform1i(program.thickness, 9);
      if (program.sceneColor !== null) this.#gl.uniform1i(program.sceneColor, 10);
      if (program.environmentSpecular !== null) this.#gl.uniform1i(program.environmentSpecular, 11);
    }
    if (program.virtualPageTable !== null) this.#gl.uniform1i(program.virtualPageTable, 7);
    if (program.kind === "unlit" && program.partition !== null) {
      this.#gl.uniform1i(
        program.partition.pattern,
        SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT,
      );
    }
    this.#initializedSamplers.add(program.program);
  }

  invalidate(): void {
    this.#programs.clear();
    this.#vertexShaders.clear();
    this.#initializedSamplers.clear();
    this.#parallelCompile = this.#gl.getExtension("KHR_parallel_shader_compile") !== null;
  }

  setVirtualTextureDeclarations(declarations: string): void {
    if (this.#virtualDeclarations === declarations) return;
    for (const [key, retained] of this.#programs) {
      if ("pending" in retained) continue;
      if (retained.virtualPageTable === null) continue;
      this.#gl.deleteProgram(retained.program);
      this.#programs.delete(key);
      this.#initializedSamplers.delete(retained.program);
    }
    this.#virtualDeclarations = declarations;
  }

  setTransmissionShaderSource(source: SurfaceTransmissionShaderSource): void {
    if (this.#transmissionSource === source) return;
    for (const [key, retained] of this.#programs) {
      if ("pending" in retained) continue;
      if (retained.kind !== "standard" || retained.sceneColor === null) continue;
      this.#gl.deleteProgram(retained.program);
      this.#programs.delete(key);
      this.#initializedSamplers.delete(retained.program);
    }
    for (const [vertexSource, shader] of this.#vertexShaders) {
      if (!vertexSource.includes("#define TRANSMISSION_MATERIAL\n")) continue;
      this.#gl.deleteShader(shader);
      this.#vertexShaders.delete(vertexSource);
    }
    this.#transmissionSource = source;
  }

  #begin(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
    alphaMasked: boolean,
    doubleSided: boolean,
    validation: "deferred" | "synchronous",
  ): WebGLProgram {
    const vertex = this.#vertexShader(kind, features, instanced);
    const source = shaderVariant(
      kind === "standard" ? STANDARD_FRAGMENT_SHADER : UNLIT_FRAGMENT_SHADER,
      features,
      false,
      alphaMasked,
      kind === "standard" && doubleSided,
      this.#virtualDeclarations,
      this.#transmissionSource,
    );
    return createSurfaceProgram(this.#gl, vertex, source, validation);
  }

  #deleteVertexShaders(): void {
    for (const shader of this.#vertexShaders.values()) this.#gl.deleteShader(shader);
    this.#vertexShaders.clear();
  }

  #vertexShader(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
  ): WebGLShader {
    const source = shaderVariant(
      kind === "standard" ? STANDARD_VERTEX_SHADER : UNLIT_VERTEX_SHADER,
      surfaceVertexFeatures(kind, features),
      instanced,
      false,
      false,
      "",
      this.#transmissionSource,
    );
    const retained = this.#vertexShaders.get(source);
    if (retained !== undefined) return retained;
    const shader = compileWebGlShader(this.#gl, this.#gl.VERTEX_SHADER, source, "surface");
    this.#vertexShaders.set(source, shader);
    return shader;
  }
}
