import depthVertexShader from "../webgl/shaders/depth.vert";
import depthFragmentShader from "../webgl/shaders/depth.frag";
import {
  compileWebGlShader,
  linkWebGlProgram,
  requiredWebGlUniform,
} from "../webgl/program";
import { mat4ValuesEqual, type Mat4 } from "../math/mat4";
import type {
  SurfaceDrawFrame,
  SurfaceDrawPacket,
} from "../webgl/draw-state-transition";
import type { WebGlStateOwner } from "../webgl/state-owner";
import {
  lodMembershipsSelected,
  type LodGroupId,
  type LodMembership,
} from "./lod-selection";
import type { WebGlMultiDraw } from "./surface-multi-draw";
import { worldBoundsVisible, type WorldBounds } from "./surface-visibility";

export type SurfaceDepthProgram = Readonly<{
  model: WebGLUniformLocation;
  program: WebGLProgram;
  viewProjection: WebGLUniformLocation;
}>;

export type SurfaceDepthPrepassResource = Readonly<{
  depthPacket: SurfaceDrawPacket | null;
  depthProgram: SurfaceDepthProgram | null;
  geometry: Readonly<{
    indexCount: number;
    indexOffset: number;
    indexType: number;
  }>;
  instanceCount: number;
  mode: number;
  surface: Readonly<{
    lods?: readonly LodMembership[];
    model: Mat4;
    worldBounds: WorldBounds;
  }>;
}>;

/** Owns every program, scratch allocation, and GL effect of one optional depth pass. */
export class SurfaceDepthPrepassOwner {
  #counts = new Int32Array(0);
  readonly #gl: WebGL2RenderingContext;
  #instanced: SurfaceDepthProgram | null = null;
  readonly #multiDraw: WebGlMultiDraw;
  #offsets = new Int32Array(0);
  #ordinary: SurfaceDepthProgram | null = null;

  constructor(gl: WebGL2RenderingContext, multiDraw: WebGlMultiDraw) {
    this.#gl = gl;
    this.#multiDraw = multiDraw;
  }

  dispose(): void {
    if (this.#ordinary !== null) this.#gl.deleteProgram(this.#ordinary.program);
    if (this.#instanced !== null) this.#gl.deleteProgram(this.#instanced.program);
    this.#ordinary = null;
    this.#instanced = null;
  }

  get(instanced: boolean): SurfaceDepthProgram {
    const retained = instanced ? this.#instanced : this.#ordinary;
    if (retained !== null) return retained;
    const created = this.#create(instanced);
    if (instanced) this.#instanced = created;
    else this.#ordinary = created;
    return created;
  }

  invalidate(): void {
    this.#ordinary = null;
    this.#instanced = null;
  }

  draw(
    frame: SurfaceDrawFrame,
    viewProjection: Mat4,
    surfaces: readonly SurfaceDepthPrepassResource[],
    runEnds: Uint32Array<ArrayBufferLike>,
    lodSelections: ReadonlyMap<LodGroupId, number>,
    frustumPlanes: Float32Array<ArrayBufferLike>,
    state: WebGlStateOwner,
  ): void {
    if (this.#counts.length < surfaces.length) {
      this.#counts = new Int32Array(surfaces.length);
      this.#offsets = new Int32Array(surfaces.length);
    }
    const gl = this.#gl;
    let activeProgram: WebGLProgram | null = null;
    let activeModel: Mat4 | null = null;
    for (let index = 0; index < surfaces.length; index += 1) {
      const resource = surfaces[index]!;
      const packet = resource.depthPacket;
      const program = resource.depthProgram;
      if (
        packet === null
        || program === null
        || !lodMembershipsSelected(resource.surface.lods, lodSelections)
        || !worldBoundsVisible(resource.surface.worldBounds, frustumPlanes)
      ) continue;
      state.applySurfaceDraw(frame, packet);
      if (activeProgram !== program.program) {
        gl.uniformMatrix4fv(program.viewProjection, false, viewProjection);
        activeProgram = program.program;
        activeModel = null;
      }
      if (
        activeModel === null
        || (
          activeModel !== resource.surface.model
          && !mat4ValuesEqual(activeModel, resource.surface.model)
        )
      ) {
        gl.uniformMatrix4fv(program.model, false, resource.surface.model);
        activeModel = resource.surface.model;
      }
      if (resource.instanceCount === 0 && resource.geometry.indexOffset <= 0x7fff_ffff) {
        this.#counts[0] = resource.geometry.indexCount;
        this.#offsets[0] = resource.geometry.indexOffset;
        const runEnd = runEnds[index] ?? index + 1;
        let drawCount = 1;
        let nextIndex = index + 1;
        for (; nextIndex < runEnd; nextIndex += 1) {
          const next = surfaces[nextIndex]!;
          if (next.geometry.indexOffset > 0x7fff_ffff) break;
          if (
            lodMembershipsSelected(next.surface.lods, lodSelections)
            && worldBoundsVisible(next.surface.worldBounds, frustumPlanes)
          ) {
            this.#counts[drawCount] = next.geometry.indexCount;
            this.#offsets[drawCount] = next.geometry.indexOffset;
            drawCount += 1;
          }
        }
        if (drawCount > 1) {
          this.#multiDraw.multiDrawElementsWEBGL(
            resource.mode,
            this.#counts,
            0,
            resource.geometry.indexType,
            this.#offsets,
            0,
            drawCount,
          );
          index = nextIndex - 1;
          continue;
        }
      }
      if (resource.instanceCount > 0) {
        gl.drawElementsInstanced(
          resource.mode,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          resource.geometry.indexOffset,
          resource.instanceCount,
        );
      } else {
        gl.drawElements(
          resource.mode,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          resource.geometry.indexOffset,
        );
      }
    }
  }

  #create(instanced: boolean): SurfaceDepthProgram {
    const gl = this.#gl;
    const vertex = compileWebGlShader(
      gl,
      gl.VERTEX_SHADER,
      depthVertexShader.replace("\n", `\n${instanced ? "#define INSTANCED\n" : ""}`),
      "depth",
    );
    let fragment: WebGLShader;
    try {
      fragment = compileWebGlShader(gl, gl.FRAGMENT_SHADER, depthFragmentShader, "depth");
    } catch (error) {
      gl.deleteShader(vertex);
      throw error;
    }
    let program: WebGLProgram;
    try {
      program = linkWebGlProgram(gl, vertex, fragment, "depth");
    } finally {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    }
    return {
      model: requiredWebGlUniform(gl, program, "model", "depth"),
      program,
      viewProjection: requiredWebGlUniform(gl, program, "viewProjection", "depth"),
    };
  }
}
