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
import {
  MAX_CANONICAL_DIRECTIONAL_LIGHTS,
  type CanonicalDrawSurface,
  type CanonicalSurfaceScene,
} from "./scene-lowering";

type GpuGeometry = Readonly<{
  indexBuffer: WebGLBuffer;
  indexCount: number;
  indexType: number;
  key: string;
  normalBuffer: WebGLBuffer | null;
  vertexArray: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}>;

type GpuSurface = Readonly<{
  geometry: GpuGeometry;
  surface: CanonicalDrawSurface;
}>;

type MutableOpaqueDrawIntent = {
  framebuffer: WebGLFramebuffer | null;
  frontFace: number;
  program: WebGLProgram;
  vertexArray: WebGLVertexArrayObject;
  viewport: { height: number; width: number; x: number; y: number };
};

type UnlitProgram = Readonly<{
  color: WebGLUniformLocation;
  kind: "unlit";
  program: WebGLProgram;
  viewProjectionModel: WebGLUniformLocation;
}>;

type StandardProgram = Readonly<{
  baseColor: WebGLUniformLocation;
  cameraWorldPosition: WebGLUniformLocation;
  directionalLightColors: WebGLUniformLocation;
  directionalLightCount: WebGLUniformLocation;
  directionalLightDirections: WebGLUniformLocation;
  kind: "standard";
  materialFactors: WebGLUniformLocation;
  model: WebGLUniformLocation;
  normalTransform: WebGLUniformLocation;
  program: WebGLProgram;
  presentation: WebGLUniformLocation;
  viewProjection: WebGLUniformLocation;
}>;

const UNLIT_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 viewProjectionModel;
void main() { gl_Position = viewProjectionModel * vec4(position, 1.0); }
`;

const UNLIT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec4 linearColor;
out vec4 outputColor;
vec3 linearToSrgb(vec3 value) {
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  vec3 lower = value * 12.92;
  vec3 upper = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, low);
}
void main() { outputColor = vec4(linearToSrgb(linearColor.rgb), linearColor.a); }
`;

const STANDARD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
uniform mat4 viewProjection;
uniform mat4 model;
uniform mat4 normalTransform;
out vec3 worldNormal;
out vec3 worldPosition;
void main() {
  vec4 world = model * vec4(position, 1.0);
  worldPosition = world.xyz;
  worldNormal = mat3(normalTransform) * normal;
  gl_Position = viewProjection * world;
}
`;

const STANDARD_FRAGMENT_SHADER = `#version 300 es
precision highp float;
#define MAX_DIRECTIONAL_LIGHTS ${MAX_CANONICAL_DIRECTIONAL_LIGHTS}
in vec3 worldNormal;
in vec3 worldPosition;
uniform vec4 baseColor;
uniform vec4 cameraWorldPosition;
uniform vec4 directionalLightColors[MAX_DIRECTIONAL_LIGHTS];
uniform int directionalLightCount;
uniform vec4 directionalLightDirections[MAX_DIRECTIONAL_LIGHTS];
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
  vec3 normal = worldNormal;
  if (dot(normal, normal) <= 0.00000001) {
    normal = cross(dFdx(worldPosition), dFdy(worldPosition));
  }
  normal = normalize(normal);
  vec3 viewVector = cameraWorldPosition.xyz - worldPosition;
  vec3 viewDirection = dot(viewVector, viewVector) <= 0.00000001
    ? normal
    : normalize(viewVector);
  float metallic = materialFactors.x;
  float roughness = clamp(materialFactors.y, 0.04, 1.0);
  vec3 dielectric = vec3(0.04);
  vec3 f0 = mix(dielectric, baseColor.rgb, metallic);
  vec3 diffuseColor = baseColor.rgb * (1.0 - metallic);
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
  vec3 exposed = lit * max(presentation.x, 0.0);
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

const createUnlitProgram = (gl: WebGL2RenderingContext): UnlitProgram => {
  const program = createProgram(gl, UNLIT_VERTEX_SHADER, UNLIT_FRAGMENT_SHADER);
  return {
    color: uniform(gl, program, "linearColor"),
    kind: "unlit",
    program,
    viewProjectionModel: uniform(gl, program, "viewProjectionModel"),
  };
};

const createStandardProgram = (gl: WebGL2RenderingContext): StandardProgram => {
  const program = createProgram(gl, STANDARD_VERTEX_SHADER, STANDARD_FRAGMENT_SHADER);
  return {
    baseColor: uniform(gl, program, "baseColor"),
    cameraWorldPosition: uniform(gl, program, "cameraWorldPosition"),
    directionalLightColors: uniform(gl, program, "directionalLightColors"),
    directionalLightCount: uniform(gl, program, "directionalLightCount"),
    directionalLightDirections: uniform(gl, program, "directionalLightDirections"),
    kind: "standard",
    materialFactors: uniform(gl, program, "materialFactors"),
    model: uniform(gl, program, "model"),
    normalTransform: uniform(gl, program, "normalTransform"),
    presentation: uniform(gl, program, "presentation"),
    program,
    viewProjection: uniform(gl, program, "viewProjection"),
  };
};

const indexType = (
  gl: WebGL2RenderingContext,
  indices: Uint8Array | Uint16Array | Uint32Array,
): number => indices instanceof Uint32Array
  ? gl.UNSIGNED_INT
  : indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;

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
  readonly #materialFactors = new Float32Array(4);
  readonly #normalTransform: MutableMat4 = identityMat4();
  #scene: CanonicalSurfaceScene | null = null;
  #standardProgram: StandardProgram | null = null;
  #unlitProgram: UnlitProgram | null = null;
  readonly #viewProjectionModel: MutableMat4 = identityMat4();

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  dispose(): void {
    this.#deleteResources();
    if (this.#standardProgram !== null) this.#gl.deleteProgram(this.#standardProgram.program);
    if (this.#unlitProgram !== null) this.#gl.deleteProgram(this.#unlitProgram.program);
    this.#standardProgram = null;
    this.#unlitProgram = null;
    this.#drawIntent = null;
    this.#scene = null;
  }

  invalidate(): void {
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
    this.#standardProgram = null;
    this.#unlitProgram = null;
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
      this.#reconcile();
      state.invalidateVertexArray();
    }
    const scene = this.#scene;
    if (scene === null || this.#gpuSurfaces.length === 0) return;
    let drawIntent = this.#drawIntent;
    if (drawIntent === null) {
      const first = this.#programFor(this.#gpuSurfaces[0]!.surface.material.kind);
      drawIntent = {
        framebuffer: null,
        frontFace: this.#gl.CCW,
        program: first.program,
        vertexArray: this.#gpuSurfaces[0]!.geometry.vertexArray,
        viewport: { height: 0, width: 0, x: 0, y: 0 },
      };
      this.#drawIntent = drawIntent;
    }
    drawIntent.viewport.height = size.backingHeight;
    drawIntent.viewport.width = size.backingWidth;
    cameraWorldPositionFromViewInto(this.#cameraPosition, view);
    this.#cameraPosition[3] = 1;
    let standardGlobalsBound = false;
    const gl = this.#gl;
    for (const resource of this.#gpuSurfaces) {
      const surface = resource.surface;
      const program = this.#programFor(surface.material.kind);
      drawIntent.frontFace = surface.modelHandedness < 0 ? gl.CW : gl.CCW;
      drawIntent.program = program.program;
      drawIntent.vertexArray = resource.geometry.vertexArray;
      state.applyOpaqueDraw(drawIntent as OpaqueDrawStateIntent);
      if (program.kind === "unlit") {
        multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
        gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        gl.uniform4fv(program.color, surface.material.baseColor);
      } else {
        const material = surface.material;
        if (material.kind !== "standard") {
          throw new Error("Royal standard surface program received a non-standard material");
        }
        if (!standardGlobalsBound) {
          gl.uniformMatrix4fv(program.viewProjection, false, viewProjection);
          gl.uniform4fv(program.cameraWorldPosition, this.#cameraPosition);
          gl.uniform1i(program.directionalLightCount, this.#directionalLightCount);
          gl.uniform4fv(program.directionalLightColors, this.#directionalLightColors);
          gl.uniform4fv(program.directionalLightDirections, this.#directionalLightDirections);
          this.#materialFactors[2] = scene.exposure;
          this.#materialFactors[3] = scene.toneMapping === "pbr-neutral" ? 1 : 0;
          gl.uniform4fv(program.presentation, this.#materialFactors);
          standardGlobalsBound = true;
        }
        gl.uniformMatrix4fv(program.model, false, surface.model);
        affineSurfaceNormalTransformInto(this.#normalTransform, surface.model);
        gl.uniformMatrix4fv(program.normalTransform, false, this.#normalTransform);
        gl.uniform4fv(program.baseColor, material.baseColor);
        this.#materialFactors[0] = material.metallicFactor;
        this.#materialFactors[1] = material.roughnessFactor;
        this.#materialFactors[2] = 0;
        this.#materialFactors[3] = 0;
        gl.uniform4fv(program.materialFactors, this.#materialFactors);
      }
      gl.drawElements(
        gl.TRIANGLES,
        resource.geometry.indexCount,
        resource.geometry.indexType,
        0,
      );
    }
  }

  #deleteGeometry(resource: GpuGeometry): void {
    this.#gl.deleteBuffer(resource.indexBuffer);
    if (resource.normalBuffer !== null) this.#gl.deleteBuffer(resource.normalBuffer);
    this.#gl.deleteBuffer(resource.vertexBuffer);
    this.#gl.deleteVertexArray(resource.vertexArray);
  }

  #deleteResources(): void {
    for (const resource of this.#geometryResources) this.#deleteGeometry(resource);
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
  }

  #createGeometry(surface: CanonicalDrawSurface, key: string): GpuGeometry {
    const gl = this.#gl;
    const normals = surface.material.kind === "standard" ? surface.geometry.normals : undefined;
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const normalBuffer = normals === undefined ? null : gl.createBuffer();
    if (
      vertexArray === null
      || vertexBuffer === null
      || indexBuffer === null
      || (normals !== undefined && normalBuffer === null)
    ) {
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
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
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.geometry.indices, gl.STATIC_DRAW);
      return {
        indexBuffer,
        indexCount: surface.geometry.indices.length,
        indexType: indexType(gl, surface.geometry.indices),
        key,
        normalBuffer,
        vertexArray,
        vertexBuffer,
      };
    } catch (error) {
      gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  #programFor(kind: "standard" | "unlit"): StandardProgram | UnlitProgram {
    if (kind === "unlit") {
      this.#unlitProgram ??= createUnlitProgram(this.#gl);
      return this.#unlitProgram;
    }
    this.#standardProgram ??= createStandardProgram(this.#gl);
    return this.#standardProgram;
  }

  #reconcile(): void {
    this.#dirty = false;
    const scene = this.#scene;
    if (scene === null || scene.surfaces.length === 0) {
      this.#deleteResources();
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
    const nextByKey = new Map<string, GpuGeometry>();
    const nextGeometryResources: GpuGeometry[] = [];
    const nextSurfaces: GpuSurface[] = [];
    const created: GpuGeometry[] = [];
    try {
      for (const surface of scene.surfaces) {
        const key = surface.material.kind === "standard" && surface.geometry.normals !== undefined
          ? `${surface.geometry.key}:normal`
          : `${surface.geometry.key}:position`;
        let geometry = nextByKey.get(key) ?? previousByKey.get(key);
        if (geometry === undefined) {
          geometry = this.#createGeometry(surface, key);
          created.push(geometry);
        }
        if (!nextByKey.has(key)) {
          nextByKey.set(key, geometry);
          nextGeometryResources.push(geometry);
        }
        nextSurfaces.push({ geometry, surface });
      }
    } catch (error) {
      for (const resource of created) this.#deleteGeometry(resource);
      throw error;
    }
    for (const resource of this.#geometryResources) {
      if (nextByKey.get(resource.key) !== resource) this.#deleteGeometry(resource);
    }
    this.#geometryResources = nextGeometryResources;
    this.#gpuSurfaces = nextSurfaces;
    this.#drawIntent = null;
  }
}
