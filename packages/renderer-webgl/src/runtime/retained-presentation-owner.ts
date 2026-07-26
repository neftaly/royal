import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import { WebGlStateOwner } from "../webgl/state-owner";
import type {
  MutableSurfaceDrawFrame,
  SurfaceDrawPacket,
  TextureUnitBinding,
} from "../webgl/draw-state-transition";
import { compileWebGlShader, linkWebGlProgram } from "../webgl/program";

type RetainedPresentationResources = Readonly<{
  color: WebGLTexture;
  height: number;
  width: number;
}>;

const PRESENTATION_VERTEX_SHADER = `#version 300 es
const vec2 positions[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);
out vec2 textureCoordinate;
void main() {
  vec2 position = positions[gl_VertexID];
  textureCoordinate = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const PRESENTATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 textureCoordinate;
uniform sampler2D retainedColor;
out vec4 outputColor;
void main() {
  outputColor = texture(retainedColor, textureCoordinate);
}`;

const createProgram = (gl: WebGL2RenderingContext): WebGLProgram => {
  const vertex = compileWebGlShader(
    gl,
    gl.VERTEX_SHADER,
    PRESENTATION_VERTEX_SHADER,
    "retained presentation",
  );
  let fragment: WebGLShader;
  try {
    fragment = compileWebGlShader(
      gl,
      gl.FRAGMENT_SHADER,
      PRESENTATION_FRAGMENT_SHADER,
      "retained presentation",
    );
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  try {
    return linkWebGlProgram(gl, vertex, fragment, "retained presentation");
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
};

/**
 * Root-local copy of the completed default-framebuffer world presentation.
 *
 * The copy contains final canvas color rather than linear scene color, so restoring
 * it does not repeat tone mapping or color conversion. It deliberately has no depth
 * attachment: overlays render without depth testing or depth writes.
 */
export class RetainedPresentationOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  #deniedSize = "";
  readonly #gl: WebGL2RenderingContext;
  readonly #presentationBindings: TextureUnitBinding[] = [{
    sampler: null,
    target: "2d",
    texture: null,
  }];
  readonly #presentationFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #presentationPacket: SurfaceDrawPacket | null = null;
  #program: WebGLProgram | null = null;
  #resources: RetainedPresentationResources | null = null;
  #sampler: WebGLSampler | null = null;
  #valid = false;
  #vertexArray: WebGLVertexArrayObject | null = null;

  constructor(gl: WebGL2RenderingContext, budget: PersistentGpuBudgetOwner) {
    this.#budget = budget;
    this.#gl = gl;
  }

  capture(width: number, height: number, state: WebGlStateOwner): boolean {
    if (!this.#ensure(width, height, state)) return false;
    this.#ensurePresentationResources(state);
    const resources = this.#resources;
    if (resources === null) return false;
    const gl = this.#gl;
    this.#valid = false;
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resources.color);
      gl.copyTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        0,
        0,
        width,
        height,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.#valid = true;
      return true;
    } finally {
      state.invalidate();
    }
  }

  dispose(): void {
    this.#deleteResources();
    const gl = this.#gl;
    if (this.#program !== null) gl.deleteProgram(this.#program);
    if (this.#sampler !== null) gl.deleteSampler(this.#sampler);
    if (this.#vertexArray !== null) gl.deleteVertexArray(this.#vertexArray);
    this.#presentationBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#presentationPacket = null;
    this.#program = null;
    this.#sampler = null;
    this.#vertexArray = null;
    this.#deniedSize = "";
  }

  /** Drops handles invalidated by WebGL context loss without issuing delete calls. */
  abandon(): void {
    this.#resources = null;
    this.#presentationBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#presentationPacket = null;
    this.#program = null;
    this.#sampler = null;
    this.#valid = false;
    this.#vertexArray = null;
    this.#deniedSize = "";
    this.#budget.release(this.#claim);
  }

  invalidate(): void {
    this.#valid = false;
  }

  restore(width: number, height: number, state: WebGlStateOwner): boolean {
    const resources = this.#resources;
    if (
      !this.#valid
      || resources === null
      || resources.width !== width
      || resources.height !== height
    ) return false;
    const gl = this.#gl;
    this.#ensurePresentationResources(state);
    const packet = this.#presentationPacket;
    if (packet === null) throw new Error("Royal retained presentation packet is missing");
    this.#presentationFrame.viewport = { height, width, x: 0, y: 0 };
    state.applySurfaceDraw(this.#presentationFrame, packet);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  #allocate(width: number, height: number): boolean {
    const gl = this.#gl;
    const bytes = width * height * 4;
    if (!this.#budget.tryClaim(this.#claim, bytes)) return false;
    const color = gl.createTexture();
    if (color === null) {
      this.#budget.release(this.#claim);
      throw new Error("Royal could not allocate retained presentation resources");
    }
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    this.#resources = { color, height, width };
    if (this.#sampler !== null) {
      this.#presentationBindings[0] = {
        sampler: this.#sampler,
        target: "2d",
        texture: color,
      };
    }
    return true;
  }

  #deleteResources(): void {
    const resources = this.#resources;
    if (resources === null) return;
    const gl = this.#gl;
    gl.deleteTexture(resources.color);
    this.#resources = null;
    if (this.#sampler !== null) {
      this.#presentationBindings[0] = {
        sampler: this.#sampler,
        target: "2d",
        texture: null,
      };
    }
    this.#valid = false;
    this.#budget.release(this.#claim);
  }

  #ensure(width: number, height: number, state: WebGlStateOwner): boolean {
    if (
      this.#resources?.width === width
      && this.#resources.height === height
    ) return true;
    const sizeKey = `${width}x${height}`;
    if (this.#deniedSize === sizeKey) return false;
    try {
      this.#deleteResources();
      if (!this.#allocate(width, height)) {
        this.#deniedSize = sizeKey;
        return false;
      }
    } finally {
      state.invalidate();
    }
    this.#deniedSize = "";
    return true;
  }

  #ensurePresentationResources(state: WebGlStateOwner): void {
    if (
      this.#program !== null
      && this.#sampler !== null
      && this.#vertexArray !== null
      && this.#presentationPacket !== null
    ) return;
    const gl = this.#gl;
    const program = createProgram(gl);
    const sampler = gl.createSampler();
    const vertexArray = gl.createVertexArray();
    const resources = this.#resources;
    if (sampler === null || vertexArray === null || resources === null) {
      gl.deleteProgram(program);
      if (sampler !== null) gl.deleteSampler(sampler);
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      throw new Error("Royal could not allocate retained presentation pipeline");
    }
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(program);
    const retainedColor = gl.getUniformLocation(program, "retainedColor");
    if (retainedColor === null) {
      gl.deleteProgram(program);
      gl.deleteSampler(sampler);
      gl.deleteVertexArray(vertexArray);
      throw new Error("Royal retained presentation program is missing retainedColor");
    }
    gl.uniform1i(retainedColor, 0);
    this.#presentationBindings[0] = {
      sampler,
      target: "2d",
      texture: resources.color,
    };
    this.#presentationPacket = {
      alphaBlend: false,
      colorWrite: true,
      cullBackFaces: false,
      depthTest: false,
      depthWrite: false,
      frontFace: gl.CCW,
      program,
      textureBindings: this.#presentationBindings,
      textureUnits: 1,
      vertexArray,
    };
    this.#program = program;
    this.#sampler = sampler;
    this.#vertexArray = vertexArray;
    state.invalidate();
  }
}
