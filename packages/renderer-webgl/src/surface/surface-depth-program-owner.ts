import depthVertexShader from "../webgl/shaders/depth.vert";
import depthFragmentShader from "../webgl/shaders/depth.frag";
import {
  compileWebGlShader,
  linkWebGlProgram,
  requiredWebGlUniform,
} from "../webgl/program";

export type SurfaceDepthProgram = Readonly<{
  model: WebGLUniformLocation;
  program: WebGLProgram;
  viewProjection: WebGLUniformLocation;
}>;

/** Owns the at-most-two position-only programs used by an opaque depth pass. */
export class SurfaceDepthProgramOwner {
  readonly #gl: WebGL2RenderingContext;
  #instanced: SurfaceDepthProgram | null = null;
  #ordinary: SurfaceDepthProgram | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
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
