import type { CanonicalTextureSampler } from "./sampler";

export const DEFAULT_TEXTURE_ANISOTROPY = 16;

/** Root-local capability, queried once per context generation, outside draws. */
export class TextureAnisotropy {
  readonly #gl: WebGL2RenderingContext;
  readonly #requested: number;
  #extension: EXT_texture_filter_anisotropic | null | undefined;
  #maximum = 1;

  constructor(gl: WebGL2RenderingContext, requested = DEFAULT_TEXTURE_ANISOTROPY) {
    this.#gl = gl;
    this.#requested = requested;
  }

  invalidate(): void {
    this.#extension = undefined;
    this.#maximum = 1;
  }

  forSampler(sampler: CanonicalTextureSampler): number {
    if (this.#requested === 1 || sampler.magFilter !== "linear" || !sampler.minFilter.startsWith("linear")) return 1;
    if (this.#extension === undefined) {
      this.#extension = this.#gl.getExtension("EXT_texture_filter_anisotropic");
      if (this.#extension !== null) {
        const limit = Number(this.#gl.getParameter(this.#extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
        if (Number.isFinite(limit)) this.#maximum = Math.max(1, Math.min(this.#requested, limit));
      }
    }
    return this.#maximum;
  }

  apply(sampler: WebGLSampler, recipe: CanonicalTextureSampler): void {
    const maximum = this.forSampler(recipe);
    if (maximum > 1 && this.#extension != null) {
      this.#gl.samplerParameterf(sampler, this.#extension.TEXTURE_MAX_ANISOTROPY_EXT, maximum);
    }
  }
}
