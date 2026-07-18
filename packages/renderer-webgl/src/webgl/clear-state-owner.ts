import type { ClearFrameIntent } from "../frame/clear-frame";
import {
  commitAppliedClearState,
  createClearStateTransition,
  createUnknownClearState,
  planClearStateTransition,
} from "./clear-state-transition";

/** Sole writer for WebGL state needed by the clear-only frame path. */
export class ClearStateOwner {
  readonly #gl: WebGL2RenderingContext;
  readonly #state = createUnknownClearState();
  readonly #transition = createClearStateTransition();

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  invalidate(): void {
    this.#state.known = false;
  }

  clear(intent: ClearFrameIntent): void {
    const gl = this.#gl;
    const transition = this.#transition;
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
}
