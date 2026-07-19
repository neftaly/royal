import type { CanonicalTextureBinding } from "../surface/canonical-material";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";

type GpuTexture = {
  readonly bindings: WeakMap<WebGLSampler, GpuTextureBinding>;
  mipmapped: boolean;
  readonly texture: WebGLTexture;
};
type GpuSampler = Readonly<{ sampler: WebGLSampler }>;

export type GpuTextureBinding = TextureUnitBinding;

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
  readonly #samplers = new Map<string, GpuSampler>();
  readonly #textures = new Map<string, GpuTexture>();
  #unpackStateKnown = false;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  dispose(): void {
    for (const resource of this.#samplers.values()) this.#gl.deleteSampler(resource.sampler);
    for (const resource of this.#textures.values()) this.#gl.deleteTexture(resource.texture);
    this.#samplers.clear();
    this.#textures.clear();
  }

  /** Context loss invalidates handles without issuing deletion calls against the lost generation. */
  invalidate(): void {
    this.#samplers.clear();
    this.#textures.clear();
    this.#unpackStateKnown = false;
  }

  reconcile(
    bindings: readonly (CanonicalTextureBinding | undefined)[],
  ): readonly GpuTextureBinding[] {
    const claimedTextures = new Set<string>();
    const claimedSamplers = new Set<string>();
    const result: GpuTextureBinding[] = [];
    const createdTextures = new Map<string, GpuTexture>();
    const createdSamplers = new Map<string, GpuSampler>();
    const insertedBindings: [GpuTexture, WebGLSampler][] = [];
    try {
      for (const binding of bindings) {
        if (binding === undefined) {
          result.push(EMPTY_BINDING);
          continue;
        }
        let texture = createdTextures.get(binding.storageKey)
          ?? this.#textures.get(binding.storageKey);
        if (texture === undefined) {
          texture = this.#createTexture(binding);
          createdTextures.set(binding.storageKey, texture);
        }
        if (usesMipmaps(binding.sampler.minFilter)) this.#ensureMipmaps(texture);
        claimedTextures.add(binding.storageKey);
        let sampler = createdSamplers.get(binding.samplerKey)
          ?? this.#samplers.get(binding.samplerKey);
        if (sampler === undefined) {
          sampler = this.#createSampler(binding);
          createdSamplers.set(binding.samplerKey, sampler);
        }
        claimedSamplers.add(binding.samplerKey);
        let resolved = texture.bindings.get(sampler.sampler);
        if (resolved === undefined) {
          resolved = { sampler: sampler.sampler, texture: texture.texture };
          texture.bindings.set(sampler.sampler, resolved);
          insertedBindings.push([texture, sampler.sampler]);
        }
        result.push(resolved);
      }
    } catch (error) {
      for (const [texture, sampler] of insertedBindings) texture.bindings.delete(sampler);
      for (const resource of createdSamplers.values()) this.#gl.deleteSampler(resource.sampler);
      for (const resource of createdTextures.values()) this.#gl.deleteTexture(resource.texture);
      throw error;
    }
    for (const [key, resource] of this.#samplers) {
      if (claimedSamplers.has(key)) continue;
      this.#gl.deleteSampler(resource.sampler);
      this.#samplers.delete(key);
    }
    for (const [key, resource] of this.#textures) {
      if (claimedTextures.has(key)) continue;
      this.#gl.deleteTexture(resource.texture);
      this.#textures.delete(key);
    }
    for (const [key, resource] of createdSamplers) this.#samplers.set(key, resource);
    for (const [key, resource] of createdTextures) this.#textures.set(key, resource);
    return result;
  }

  /** Retains one newly published binding without releasing unrelated scene claims. */
  retain(binding: CanonicalTextureBinding | undefined): GpuTextureBinding {
    if (binding === undefined) return EMPTY_BINDING;
    let texture = this.#textures.get(binding.storageKey);
    let sampler = this.#samplers.get(binding.samplerKey);
    const createdTexture = texture === undefined;
    const createdSampler = sampler === undefined;
    try {
      texture ??= this.#createTexture(binding);
      if (usesMipmaps(binding.sampler.minFilter)) this.#ensureMipmaps(texture);
      sampler ??= this.#createSampler(binding);
      let resolved = texture.bindings.get(sampler.sampler);
      if (resolved === undefined) {
        resolved = { sampler: sampler.sampler, texture: texture.texture };
        texture.bindings.set(sampler.sampler, resolved);
      }
      if (createdTexture) this.#textures.set(binding.storageKey, texture);
      if (createdSampler) this.#samplers.set(binding.samplerKey, sampler);
      return resolved;
    } catch (error) {
      if (createdSampler && sampler !== undefined) this.#gl.deleteSampler(sampler.sampler);
      if (createdTexture && texture !== undefined) this.#gl.deleteTexture(texture.texture);
      throw error;
    }
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
      return { sampler };
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
      this.#applyUnpackState();
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
      return {
        bindings: new WeakMap<WebGLSampler, GpuTextureBinding>(),
        mipmapped,
        texture,
      };
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    }
  }

  #applyUnpackState(): void {
    if (this.#unpackStateKnown) return;
    const gl = this.#gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.#unpackStateKnown = true;
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
