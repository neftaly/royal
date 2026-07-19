import type { ClearFrameIntent } from "../frame/clear-frame";
import {
  commitAppliedClearState,
  createClearStateTransition,
  createUnknownClearState,
  planClearStateTransition,
} from "./clear-state-transition";
import {
  commitAppliedOpaqueDrawState,
  createOpaqueDrawStateTransition,
  planOpaqueDrawStateTransition,
  type AppliedOpaqueDrawState,
  type OpaqueDrawStateIntent,
} from "./draw-state-transition";

/** Sole root-local writer for WebGL pipeline state used by clear and opaque draws. */
export class WebGlStateOwner {
  readonly #clearTransition = createClearStateTransition();
  readonly #drawTransition = createOpaqueDrawStateTransition();
  readonly #gl: WebGL2RenderingContext;
  readonly #state: AppliedOpaqueDrawState = {
    ...createUnknownClearState(),
    cullBackFaces: null,
    fixedOpaquePipelineKnown: false,
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
    this.#state.fixedOpaquePipelineKnown = false;
    this.#state.cullBackFaces = null;
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

  applyOpaqueDraw(intent: OpaqueDrawStateIntent): void {
    const gl = this.#gl;
    const transition = this.#drawTransition;
    planOpaqueDrawStateTransition(this.#state, intent, transition);
    try {
      if (transition.framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, intent.framebuffer);
      if (transition.viewport) {
        gl.viewport(intent.viewport.x, intent.viewport.y, intent.viewport.width, intent.viewport.height);
      }
      if (transition.fixedPipeline) {
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
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
        gl.depthMask(true);
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
      commitAppliedOpaqueDrawState(this.#state, intent);
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }
}
