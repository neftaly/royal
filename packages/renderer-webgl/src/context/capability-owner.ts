import type { WebGlRootOptions } from "../root-types";
import type { ParallelShaderCompileExtension } from "../webgl/program-arena";

export interface WebGlContextCapabilities {
  readonly hdrColorBuffer: boolean;
  readonly maxTextureImageUnits: number;
  readonly maxTextureSize: number;
  readonly parallelShaderCompile: ParallelShaderCompileExtension | undefined;
}

export interface WebGlContextAttributes {
  readonly alpha: boolean;
  readonly antialias: boolean;
}

const EMPTY_CAPABILITIES: WebGlContextCapabilities = Object.freeze({
  hdrColorBuffer: false,
  maxTextureImageUnits: 0,
  maxTextureSize: 0,
  parallelShaderCompile: undefined,
});

/** Owns negotiated WebGL context attributes and the current capability snapshot. */
export class WebGlContextCapabilityOwner {
  #capabilities = EMPTY_CAPABILITIES;
  readonly #gl: WebGL2RenderingContext;
  readonly #initialAttributes: WebGlContextAttributes;
  readonly #requestedAlpha: boolean | undefined;
  readonly #requestedAntialias: boolean | undefined;

  constructor(gl: WebGL2RenderingContext, requested: WebGlRootOptions = {}) {
    this.#gl = gl;
    this.#requestedAlpha = requested.alpha;
    this.#requestedAntialias = requested.antialias;
    this.#initialAttributes = this.#readAttributes();
  }

  get attributes(): WebGlContextAttributes {
    return this.#initialAttributes;
  }

  get capabilities(): WebGlContextCapabilities {
    return this.#capabilities;
  }

  probe(): WebGlContextCapabilities {
    const gl = this.#gl;
    const parallelShaderCompile = gl.getExtension("KHR_parallel_shader_compile") ?? undefined;
    const hdrColorBuffer = gl.getExtension("EXT_color_buffer_float") !== null;
    const maxTextureImageUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.#capabilities = Object.freeze({
      hdrColorBuffer,
      maxTextureImageUnits: Number.isFinite(maxTextureImageUnits) ? maxTextureImageUnits : 0,
      maxTextureSize: Number.isFinite(maxTextureSize) ? maxTextureSize : 0,
      parallelShaderCompile,
    });
    return this.#capabilities;
  }

  validateRestoreAndProbe(): WebGlContextCapabilities {
    const restored = this.#readAttributes();
    if (
      restored.alpha !== this.#initialAttributes.alpha
      || restored.antialias !== this.#initialAttributes.antialias
    ) {
      throw new Error("Royal WebGL context restoration changed renderer context attributes");
    }
    return this.probe();
  }

  #readAttributes(): WebGlContextAttributes {
    const attributes = this.#gl.getContextAttributes();
    if (
      attributes === null
      || typeof attributes.alpha !== "boolean"
      || typeof attributes.antialias !== "boolean"
    ) {
      throw new Error("Royal WebGL context attributes are unavailable");
    }
    const { alpha, antialias } = attributes;
    if (this.#requestedAlpha !== undefined && alpha !== this.#requestedAlpha) {
      throw new Error(
        `Royal WebGL context requested alpha=${this.#requestedAlpha} but received alpha=${alpha}`,
      );
    }
    if (this.#requestedAntialias !== undefined && antialias !== this.#requestedAntialias) {
      throw new Error(
        `Royal WebGL context requested antialias=${this.#requestedAntialias} but received antialias=${antialias}`,
      );
    }
    return Object.freeze({ alpha, antialias });
  }
}
