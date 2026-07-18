import type { CanonicalTextureBinding } from "../surface/canonical-material";

type GpuTexture = { key: string; mipmapped: boolean; texture: WebGLTexture };
type GpuSampler = Readonly<{ key: string; sampler: WebGLSampler }>;

export type GpuTextureBinding = Readonly<{
  sampler: WebGLSampler | null;
  texture: WebGLTexture | null;
}>;

const EMPTY_BINDING: GpuTextureBinding = { sampler: null, texture: null };

const samplerFilter = (gl: WebGL2RenderingContext, filter: string): number => {
  switch (filter) {
    case "linear": return gl.LINEAR;
    case "linear-mipmap-linear": return gl.LINEAR_MIPMAP_LINEAR;
    case "linear-mipmap-nearest": return gl.LINEAR_MIPMAP_NEAREST;
    case "nearest": return gl.NEAREST;
    case "nearest-mipmap-linear": return gl.NEAREST_MIPMAP_LINEAR;
    case "nearest-mipmap-nearest": return gl.NEAREST_MIPMAP_NEAREST;
    default: throw new Error(`Royal received unsupported texture filter ${filter}`);
  }
};

const samplerWrap = (gl: WebGL2RenderingContext, wrap: string): number => {
  switch (wrap) {
    case "clamp-to-edge": return gl.CLAMP_TO_EDGE;
    case "mirrored-repeat": return gl.MIRRORED_REPEAT;
    case "repeat": return gl.REPEAT;
    default: throw new Error(`Royal received unsupported texture wrap ${wrap}`);
  }
};

const usesMipmaps = (filter: string): boolean => filter.includes("mipmap");

/** Owns ordinary texture storage and sampler resources for one context generation. */
export class TextureGpuOwner {
  readonly #gl: WebGL2RenderingContext;
  #samplers: readonly GpuSampler[] = [];
  #textures: readonly GpuTexture[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  dispose(): void {
    for (const resource of this.#samplers) this.#gl.deleteSampler(resource.sampler);
    for (const resource of this.#textures) this.#gl.deleteTexture(resource.texture);
    this.#samplers = [];
    this.#textures = [];
  }

  /** Context loss invalidates handles without issuing deletion calls against the lost generation. */
  invalidate(): void {
    this.#samplers = [];
    this.#textures = [];
  }

  reconcile(
    bindings: readonly (CanonicalTextureBinding | undefined)[],
  ): readonly GpuTextureBinding[] {
    const previousTextures = new Map(this.#textures.map((value) => [value.key, value] as const));
    const previousSamplers = new Map(this.#samplers.map((value) => [value.key, value] as const));
    const nextTextures = new Map<string, GpuTexture>();
    const nextSamplers = new Map<string, GpuSampler>();
    const textureResources: GpuTexture[] = [];
    const samplerResources: GpuSampler[] = [];
    const result: GpuTextureBinding[] = [];
    const createdTextures: GpuTexture[] = [];
    const createdSamplers: GpuSampler[] = [];
    try {
      for (const binding of bindings) {
        if (binding === undefined) {
          result.push(EMPTY_BINDING);
          continue;
        }
        let texture = nextTextures.get(binding.storageKey)
          ?? previousTextures.get(binding.storageKey);
        if (texture === undefined) {
          texture = this.#createTexture(binding);
          createdTextures.push(texture);
        }
        if (usesMipmaps(binding.sampler.minFilter)) this.#ensureMipmaps(texture);
        if (!nextTextures.has(binding.storageKey)) {
          nextTextures.set(binding.storageKey, texture);
          textureResources.push(texture);
        }
        let sampler = nextSamplers.get(binding.samplerKey)
          ?? previousSamplers.get(binding.samplerKey);
        if (sampler === undefined) {
          sampler = this.#createSampler(binding);
          createdSamplers.push(sampler);
        }
        if (!nextSamplers.has(binding.samplerKey)) {
          nextSamplers.set(binding.samplerKey, sampler);
          samplerResources.push(sampler);
        }
        result.push({ sampler: sampler.sampler, texture: texture.texture });
      }
    } catch (error) {
      for (const resource of createdSamplers) this.#gl.deleteSampler(resource.sampler);
      for (const resource of createdTextures) this.#gl.deleteTexture(resource.texture);
      throw error;
    }
    for (const resource of this.#samplers) {
      if (nextSamplers.get(resource.key) !== resource) this.#gl.deleteSampler(resource.sampler);
    }
    for (const resource of this.#textures) {
      if (nextTextures.get(resource.key) !== resource) this.#gl.deleteTexture(resource.texture);
    }
    this.#samplers = samplerResources;
    this.#textures = textureResources;
    return result;
  }

  #createSampler(binding: CanonicalTextureBinding): GpuSampler {
    const gl = this.#gl;
    const sampler = gl.createSampler();
    if (sampler === null) throw new Error("Royal could not allocate a texture sampler");
    try {
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, samplerFilter(gl, binding.sampler.magFilter));
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, samplerFilter(gl, binding.sampler.minFilter));
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, samplerWrap(gl, binding.sampler.wrapS));
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, samplerWrap(gl, binding.sampler.wrapT));
      return { key: binding.samplerKey, sampler };
    } catch (error) {
      gl.deleteSampler(sampler);
      throw error;
    }
  }

  #createTexture(binding: CanonicalTextureBinding): GpuTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    if (texture === null) throw new Error("Royal could not allocate an ordinary texture");
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        binding.colorSpace === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        binding.decoded.source,
      );
      const mipmapped = usesMipmaps(binding.sampler.minFilter);
      if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D);
      return { key: binding.storageKey, mipmapped, texture };
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    }
  }

  #ensureMipmaps(resource: GpuTexture): void {
    if (resource.mipmapped) return;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    resource.mipmapped = true;
  }
}
