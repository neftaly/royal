import type { MutableMat4 } from "../math/mat4";
import { identityMat4, multiplyMat4Into } from "../math/mat4";
import type { ResolvedCanvasSize } from "../frame/canvas-size";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type { OpaqueDrawStateIntent } from "../webgl/draw-state-transition";
import type { CanonicalSurface, CanonicalSurfaceScene } from "./scene-lowering";

type GpuGeometry = Readonly<{
  indexBuffer: WebGLBuffer;
  indexCount: number;
  key: string;
  vertexArray: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}>;

type GpuSurface = Readonly<{
  geometry: GpuGeometry;
  surface: CanonicalSurface;
}>;

type MutableOpaqueDrawIntent = {
  framebuffer: WebGLFramebuffer | null;
  program: WebGLProgram;
  vertexArray: WebGLVertexArrayObject;
  viewport: { height: number; width: number; x: number; y: number };
};

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 viewProjectionModel;
void main() { gl_Position = viewProjectionModel * vec4(position, 1.0); }
`;

const FRAGMENT_SHADER = `#version 300 es
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

const createProgram = (gl: WebGL2RenderingContext): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Royal could not allocate the surface program");
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

/** Owns direct-surface program and geometry allocations for one context generation. */
export class SurfaceGpuOwner {
  readonly #gl: WebGL2RenderingContext;
  readonly #viewProjectionModel: MutableMat4 = identityMat4();
  #colorLocation: WebGLUniformLocation | null = null;
  #dirty = false;
  #drawIntent: MutableOpaqueDrawIntent | null = null;
  #geometryResources: readonly GpuGeometry[] = [];
  #gpuSurfaces: readonly GpuSurface[] = [];
  #program: WebGLProgram | null = null;
  #scene: CanonicalSurfaceScene | null = null;
  #viewProjectionModelLocation: WebGLUniformLocation | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  dispose(): void {
    this.#deleteResources();
    if (this.#program !== null) this.#gl.deleteProgram(this.#program);
    this.#program = null;
    this.#drawIntent = null;
    this.#scene = null;
  }

  invalidate(): void {
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
    this.#program = null;
    this.#drawIntent = null;
    this.#colorLocation = null;
    this.#viewProjectionModelLocation = null;
    this.#dirty = this.#scene !== null;
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#scene === scene) return;
    this.#scene = scene;
    this.#dirty = true;
  }

  draw(
    viewProjection: MutableMat4,
    size: ResolvedCanvasSize,
    state: WebGlStateOwner,
  ): void {
    if (this.#dirty) {
      this.#reconcile();
      state.invalidateVertexArray();
    }
    const program = this.#program;
    const colorLocation = this.#colorLocation;
    const matrixLocation = this.#viewProjectionModelLocation;
    const drawIntent = this.#drawIntent;
    if (
      program === null
      || colorLocation === null
      || matrixLocation === null
      || drawIntent === null
    ) return;
    drawIntent.viewport.height = size.backingHeight;
    drawIntent.viewport.width = size.backingWidth;
    const gl = this.#gl;
    for (const resource of this.#gpuSurfaces) {
      drawIntent.vertexArray = resource.geometry.vertexArray;
      state.applyOpaqueDraw(drawIntent as OpaqueDrawStateIntent);
      multiplyMat4Into(this.#viewProjectionModel, viewProjection, resource.surface.model);
      gl.uniformMatrix4fv(matrixLocation, false, this.#viewProjectionModel);
      gl.uniform4fv(colorLocation, resource.surface.color);
      gl.drawElements(gl.TRIANGLES, resource.geometry.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  #deleteResources(): void {
    for (const resource of this.#geometryResources) {
      this.#gl.deleteBuffer(resource.indexBuffer);
      this.#gl.deleteBuffer(resource.vertexBuffer);
      this.#gl.deleteVertexArray(resource.vertexArray);
    }
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
  }

  #createGeometry(surface: CanonicalSurface): GpuGeometry {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (vertexArray === null || vertexBuffer === null || indexBuffer === null) {
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      throw new Error("Royal could not allocate direct-surface geometry");
    }
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, surface.geometry.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.geometry.indices, gl.STATIC_DRAW);
      return {
        indexBuffer,
        indexCount: surface.geometry.indices.length,
        key: surface.geometry.key,
        vertexArray,
        vertexBuffer,
      };
    } catch (error) {
      gl.deleteBuffer(indexBuffer);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  #reconcile(): void {
    this.#dirty = false;
    const scene = this.#scene;
    if (scene === null || scene.surfaces.length === 0) {
      this.#deleteResources();
      this.#drawIntent = null;
      return;
    }
    const gl = this.#gl;
    if (this.#program === null) {
      this.#program = createProgram(gl);
      this.#colorLocation = gl.getUniformLocation(this.#program, "linearColor");
      this.#viewProjectionModelLocation = gl.getUniformLocation(this.#program, "viewProjectionModel");
      if (this.#colorLocation === null || this.#viewProjectionModelLocation === null) {
        gl.deleteProgram(this.#program);
        this.#program = null;
        this.#colorLocation = null;
        this.#viewProjectionModelLocation = null;
        throw new Error("Royal surface program is missing a required uniform");
      }
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
        const key = surface.geometry.key;
        let geometry = nextByKey.get(key) ?? previousByKey.get(key);
        if (geometry === undefined) {
          geometry = this.#createGeometry(surface);
          created.push(geometry);
        }
        if (!nextByKey.has(key)) {
          nextByKey.set(key, geometry);
          nextGeometryResources.push(geometry);
        }
        nextSurfaces.push({ geometry, surface });
      }
    } catch (error) {
      for (const resource of created) {
        gl.deleteBuffer(resource.indexBuffer);
        gl.deleteBuffer(resource.vertexBuffer);
        gl.deleteVertexArray(resource.vertexArray);
      }
      throw error;
    }
    for (const resource of this.#geometryResources) {
      if (nextByKey.get(resource.key) === resource) continue;
      gl.deleteBuffer(resource.indexBuffer);
      gl.deleteBuffer(resource.vertexBuffer);
      gl.deleteVertexArray(resource.vertexArray);
    }
    this.#geometryResources = nextGeometryResources;
    this.#gpuSurfaces = nextSurfaces;
    this.#drawIntent = {
      framebuffer: null,
      program: this.#program,
      vertexArray: nextSurfaces[0]!.geometry.vertexArray,
      viewport: { height: 0, width: 0, x: 0, y: 0 },
    };
  }
}
