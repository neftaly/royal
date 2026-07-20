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
  type SurfaceDrawFrame,
  type SurfaceDrawPacket,
} from "./draw-state-transition";

/** Sole root-local writer for WebGL pipeline state used by clears and surface draws. */
export class WebGlStateOwner {
  readonly #clearTransition = createClearStateTransition();
  readonly #drawTransition = createSurfaceDrawStateTransition();
  readonly #gl: WebGL2RenderingContext;
  readonly #state: AppliedSurfaceDrawState = {
    ...createUnknownClearState(),
    alphaBlend: null,
    blendFunctionKnown: false,
    cullFaceKnown: false,
    cullBackFaces: null,
    depthFunctionKnown: false,
    depthTest: null,
    depthWrite: null,
    frontFace: null,
    program: null,
    rasterDefaultsKnown: false,
    textureBindings: [],
    vertexArray: null,
  };

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  invalidate(): void {
    this.#state.known = false;
    // Unknown scalar state is ignored by every transition. Texture bindings
    // use absent entries as their per-unit unknown state.
    this.#state.textureBindings.length = 0;
  }

  /** Resource preparation binds VAOs without disturbing the remaining pipeline shadow. */
  invalidateVertexArray(): void {
    this.#state.vertexArray = null;
  }

  invalidateTextureUnit(unit: number): void {
    this.#state.textureBindings[unit] = undefined;
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
        gl.stencilMask(0xff_ff_ff_ff);
      }
      if (transition.writeMasks || this.#state.depthWrite !== true) gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      commitAppliedClearState(this.#state, intent);
      this.#state.depthWrite = true;
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  applySurfaceDraw(frame: SurfaceDrawFrame, packet: SurfaceDrawPacket): void {
    const gl = this.#gl;
    const transition = this.#drawTransition;
    planSurfaceDrawStateTransition(this.#state, frame, packet, transition);
    try {
      if (transition.framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, frame.framebuffer);
      if (transition.viewport) {
        gl.viewport(frame.viewport.x, frame.viewport.y, frame.viewport.width, frame.viewport.height);
      }
      if (transition.rasterDefaults) {
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
      }
      if (transition.blendMode) {
        if (packet.alphaBlend) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
      }
      if (transition.blendFunction) {
        gl.blendFuncSeparate(
          gl.SRC_ALPHA,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      }
      if (transition.depthMode) {
        if (packet.depthTest) gl.enable(gl.DEPTH_TEST);
        else gl.disable(gl.DEPTH_TEST);
      }
      if (transition.depthFunction) gl.depthFunc(gl.LEQUAL);
      if (transition.cullMode) {
        if (packet.cullBackFaces) gl.enable(gl.CULL_FACE);
        else gl.disable(gl.CULL_FACE);
      }
      if (transition.cullFace) gl.cullFace(gl.BACK);
      if (transition.frontFace) gl.frontFace(packet.frontFace);
      if (transition.writeMasks) {
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0xff_ff_ff_ff);
      }
      if (transition.depthWrite) gl.depthMask(packet.depthWrite);
      if (transition.program) gl.useProgram(packet.program);
      let changedTextureUnits = transition.textureUnits;
      for (let unit = 0; changedTextureUnits !== 0; unit += 1, changedTextureUnits >>>= 1) {
        if ((changedTextureUnits & 1) === 0) continue;
        const binding = packet.textureBindings[unit];
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(
          binding?.target === "cube" ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D,
          binding?.texture ?? null,
        );
        gl.bindSampler(unit, binding?.sampler ?? null);
      }
      if (transition.vertexArray) gl.bindVertexArray(packet.vertexArray);
      commitAppliedSurfaceDrawState(this.#state, frame, packet);
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }
}
