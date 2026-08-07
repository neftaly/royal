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

// WebGL's conventional depth mapping treats negative polygon offset as nearer.
// One slope-scaled step plus one implementation depth unit is the fixed
// backend representation of public `surfaceDepth: "contact"` intent.
const CONTACT_DEPTH_BIAS_FACTOR = -1;
const CONTACT_DEPTH_BIAS_UNITS = -1;

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
    depthBias: null,
    depthFunctionKnown: false,
    depthTest: null,
    depthWrite: null,
    frontFace: null,
    program: null,
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

  /** Restricts draws after their ordinary state has been applied. */
  applyDrawScissor(scissor: Readonly<{
    height: number;
    width: number;
    x: number;
    y: number;
  }>): void {
    const gl = this.#gl;
    try {
      if (!this.#state.scissorEnabled) gl.enable(gl.SCISSOR_TEST);
      if (
        !this.#state.scissorEnabled
        || this.#state.scissorX !== scissor.x
        || this.#state.scissorY !== scissor.y
        || this.#state.scissorWidth !== scissor.width
        || this.#state.scissorHeight !== scissor.height
      ) gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);
      this.#state.scissorEnabled = true;
      this.#state.scissorX = scissor.x;
      this.#state.scissorY = scissor.y;
      this.#state.scissorWidth = scissor.width;
      this.#state.scissorHeight = scissor.height;
    } catch (error) {
      this.invalidate();
      throw error;
    }
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
      if (transition.clearColor) {
        gl.clearColor(
          intent.clearColor[0],
          intent.clearColor[1],
          intent.clearColor[2],
          intent.clearColor[3],
        );
      }
      if (transition.clearDepth) gl.clearDepth(intent.clearDepth);
      if (transition.colorMask) gl.colorMask(true, true, true, true);
      if (transition.colorMask || this.#state.depthWrite !== true) gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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
      if (transition.scissorReset) gl.disable(gl.SCISSOR_TEST);
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
      if (transition.depthBias) {
        if (packet.depthBias) {
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(CONTACT_DEPTH_BIAS_FACTOR, CONTACT_DEPTH_BIAS_UNITS);
        } else gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      if (transition.depthFunction) gl.depthFunc(gl.LEQUAL);
      if (transition.cullMode) {
        if (packet.cullBackFaces) gl.enable(gl.CULL_FACE);
        else gl.disable(gl.CULL_FACE);
      }
      if (transition.cullFace) gl.cullFace(gl.BACK);
      if (transition.frontFace) gl.frontFace(packet.frontFace);
      if (transition.colorMask) {
        gl.colorMask(packet.colorWrite, packet.colorWrite, packet.colorWrite, packet.colorWrite);
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
