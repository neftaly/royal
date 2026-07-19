import type { ClearFrameIntent } from "../frame/clear-frame";
import {
  commitAppliedClearState,
  createClearStateTransition,
  createUnknownClearState,
  planClearStateTransition,
} from "./clear-state-transition";
import {
  commitAppliedSurfaceDrawState,
  createSurfaceDrawStateTransition,
  planSurfaceDrawStateTransition,
  type AppliedSurfaceDrawState,
  type SurfaceDrawStateIntent,
} from "./draw-state-transition";

/** Sole root-local writer for WebGL pipeline state used by clears and surface draws. */
export class WebGlStateOwner {
  readonly #clearTransition = createClearStateTransition();
  readonly #drawTransition = createSurfaceDrawStateTransition();
  readonly #gl: WebGL2RenderingContext;
  readonly #state: AppliedSurfaceDrawState = {
    ...createUnknownClearState(),
    alphaBlend: null,
    cullBackFaces: null,
    depthTest: null,
    depthWrite: null,
    fixedPipelineKnown: false,
    frontFace: null,
    program: null,
    textureBindings: [],
    textureBindingsKnown: false,
    vertexArray: null,
  };

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  invalidate(): void {
    this.#state.known = false;
    this.#state.fixedPipelineKnown = false;
    this.#state.alphaBlend = null;
    this.#state.cullBackFaces = null;
    this.#state.depthTest = null;
    this.#state.depthWrite = null;
    this.#state.frontFace = null;
    this.#state.program = null;
    this.#state.textureBindings.length = 0;
    this.#state.textureBindingsKnown = false;
    this.#state.vertexArray = null;
  }

  /** Resource preparation binds VAOs without disturbing the remaining pipeline shadow. */
  invalidateVertexArray(): void {
    this.#state.vertexArray = null;
  }

  /** Resource preparation may bind texture unit zero without owning draw state. */
  invalidateTextureBindings(): void {
    this.#state.textureBindingsKnown = false;
  }

  /** Detaches a private sampled texture before its storage becomes a render target. */
  unbindTextureUnit(unit: number): void {
    this.#gl.activeTexture(this.#gl.TEXTURE0 + unit);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, null);
    this.#gl.bindSampler(unit, null);
    this.#state.textureBindings[unit] = undefined;
  }

  clear(intent: ClearFrameIntent): void {
    const gl = this.#gl;
    const transition = this.#clearTransition;
    planClearStateTransition(this.#state, intent, transition);
    try {
      if (transition.framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, intent.framebuffer);
      if (transition.viewport) {
        gl.viewport(intent.viewport.x, intent.viewport.y, intent.viewport.width, intent.viewport.height);
      }
      if (transition.scissorMode) {
        if (intent.scissor === null) gl.disable(gl.SCISSOR_TEST);
        else gl.enable(gl.SCISSOR_TEST);
      }
      if (transition.scissorRectangle && intent.scissor !== null) {
        gl.scissor(intent.scissor.x, intent.scissor.y, intent.scissor.width, intent.scissor.height);
      }
      if (transition.clearColor) gl.clearColor(...intent.clearColor);
      if (transition.clearDepth) gl.clearDepth(intent.clearDepth);
      if (transition.clearStencil) gl.clearStencil(intent.clearStencil);
      if (transition.writeMasks) {
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.stencilMask(0xff_ff_ff_ff);
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      commitAppliedClearState(this.#state, intent);
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  applySurfaceDraw(intent: SurfaceDrawStateIntent): void {
    const gl = this.#gl;
    const transition = this.#drawTransition;
    planSurfaceDrawStateTransition(this.#state, intent, transition);
    try {
      if (transition.framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, intent.framebuffer);
      if (transition.viewport) {
        gl.viewport(intent.viewport.x, intent.viewport.y, intent.viewport.width, intent.viewport.height);
      }
      if (transition.fixedPipeline) {
        if (intent.alphaBlend) {
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA,
          );
        } else gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        if (intent.depthTest) {
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
        } else gl.disable(gl.DEPTH_TEST);
      }
      if (transition.cullMode) {
        if (intent.cullBackFaces) {
          gl.enable(gl.CULL_FACE);
          gl.cullFace(gl.BACK);
        } else {
          gl.disable(gl.CULL_FACE);
        }
      }
      if (transition.frontFace) gl.frontFace(intent.frontFace);
      if (transition.writeMasks) {
        gl.colorMask(true, true, true, true);
        gl.depthMask(intent.depthWrite);
        gl.stencilMask(0xff_ff_ff_ff);
      }
      if (transition.program) gl.useProgram(intent.program);
      let changedTextureUnits = transition.textureUnits;
      for (let unit = 0; changedTextureUnits !== 0; unit += 1, changedTextureUnits >>>= 1) {
        if ((changedTextureUnits & 1) === 0) continue;
        const binding = intent.textureBindings[unit];
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, binding?.texture ?? null);
        gl.bindSampler(unit, binding?.sampler ?? null);
      }
      if (transition.vertexArray) gl.bindVertexArray(intent.vertexArray);
      commitAppliedSurfaceDrawState(this.#state, intent);
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }
}
