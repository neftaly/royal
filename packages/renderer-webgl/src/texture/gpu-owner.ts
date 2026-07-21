import type { CanonicalTextureBinding } from "../surface/canonical-material";

const EMPTY_STORAGE_KEYS: readonly string[] = [];
import type { TextureUnitBinding } from "../webgl/draw-state-transition";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import { FrameUploadBudgetOwner } from "../resource/frame-upload-budget";
import {
  completeKtx2MipLevelCount,
  etc2RgbaWebGlFormat,
  ktx2Etc2StorageBytes,
} from "./etc2-storage";
import { ordinaryTextureStorageBytes } from "./storage";

export { ordinaryTextureStorageBytes } from "./storage";

type GpuTexture = {
  readonly bindings: WeakMap<WebGLSampler, GpuTextureBinding>;
  readonly budgetIdentity: object;
  byteLength: number;
  readonly compressed: boolean;
  readonly fitted: boolean;
  readonly height: number;
  mipmapped: boolean;
  readonly texture: WebGLTexture;
  readonly width: number;
};
type GpuSampler = Readonly<{ sampler: WebGLSampler }>;

export type GpuTextureBinding = TextureUnitBinding;
export type OrdinaryTextureGpuSnapshot = Readonly<{
  /** Bytes retained by GPU-native compressed ordinary texture storage. */
  compressedBytes: number;
  /** Resident ordinary textures using GPU-native compressed storage. */
  compressedTextures: number;
  /** Resident textures decoded below their encoded source dimensions. */
  fittedTextures: number;
  /** Exact bytes retained by all ordinary texture storage objects. */
  residentBytes: number;
  /** Unique ordinary texture storage objects resident in the current context. */
  residentTextures: number;
}>;

const EMPTY_BINDING: GpuTextureBinding = { sampler: null, target: "2d", texture: null };

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
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #deniedStorageKeys = new Set<string>();
  readonly #deferredStorageKeys = new Set<string>();
  readonly #gl: WebGL2RenderingContext;
  readonly #samplers = new Map<string, GpuSampler>();
  readonly #textures = new Map<string, GpuTexture>();
  readonly #uploadedStorageKeys = new Set<string>();
  readonly #uploadBudget: FrameUploadBudgetOwner;
  #unpackStateKnown = false;

  constructor(
    gl: WebGL2RenderingContext,
    budget = new PersistentGpuBudgetOwner(),
    uploadBudget = new FrameUploadBudgetOwner(),
  ) {
    this.#gl = gl;
    this.#budget = budget;
    this.#uploadBudget = uploadBudget;
  }

  dispose(): void {
    for (const resource of this.#samplers.values()) this.#gl.deleteSampler(resource.sampler);
    for (const resource of this.#textures.values()) {
      this.#gl.deleteTexture(resource.texture);
      this.#budget.release(resource.budgetIdentity);
    }
    this.#samplers.clear();
    this.#textures.clear();
    this.#deniedStorageKeys.clear();
    this.#deferredStorageKeys.clear();
    this.#uploadedStorageKeys.clear();
  }

  /** Context loss invalidates handles without issuing deletion calls against the lost generation. */
  invalidate(): void {
    this.#samplers.clear();
    for (const resource of this.#textures.values()) this.#budget.release(resource.budgetIdentity);
    this.#textures.clear();
    this.#deniedStorageKeys.clear();
    this.#deferredStorageKeys.clear();
    this.#uploadedStorageKeys.clear();
    this.#unpackStateKnown = false;
  }

  beginFrame(): void {
    this.#deferredStorageKeys.clear();
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
          if (texture === undefined) {
            result.push(EMPTY_BINDING);
            continue;
          }
          createdTextures.set(binding.storageKey, texture);
        }
        if (
          usesMipmaps(binding.sampler.minFilter)
          && !this.#ensureMipmaps(texture, binding.storageKey)
        ) {
          result.push(EMPTY_BINDING);
          continue;
        }
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
          resolved = { sampler: sampler.sampler, target: "2d", texture: texture.texture };
          texture.bindings.set(sampler.sampler, resolved);
          insertedBindings.push([texture, sampler.sampler]);
        }
        result.push(resolved);
      }
    } catch (error) {
      for (const [texture, sampler] of insertedBindings) texture.bindings.delete(sampler);
      for (const resource of createdSamplers.values()) this.#gl.deleteSampler(resource.sampler);
      for (const resource of createdTextures.values()) {
        this.#gl.deleteTexture(resource.texture);
        this.#budget.release(resource.budgetIdentity);
      }
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
      this.#budget.release(resource.budgetIdentity);
      this.#textures.delete(key);
    }
    for (const [key, resource] of createdSamplers) this.#samplers.set(key, resource);
    for (const [key, resource] of createdTextures) {
      this.#textures.set(key, resource);
      this.#uploadedStorageKeys.add(key);
    }
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
      if (texture === undefined) return EMPTY_BINDING;
      if (
        usesMipmaps(binding.sampler.minFilter)
        && !this.#ensureMipmaps(texture, binding.storageKey)
      ) {
        if (createdTexture) {
          this.#gl.deleteTexture(texture.texture);
          this.#budget.release(texture.budgetIdentity);
        }
        return EMPTY_BINDING;
      }
      sampler ??= this.#createSampler(binding);
      let resolved = texture.bindings.get(sampler.sampler);
      if (resolved === undefined) {
        resolved = { sampler: sampler.sampler, target: "2d", texture: texture.texture };
        texture.bindings.set(sampler.sampler, resolved);
      }
      if (createdTexture) {
        this.#textures.set(binding.storageKey, texture);
        this.#uploadedStorageKeys.add(binding.storageKey);
      }
      if (createdSampler) this.#samplers.set(binding.samplerKey, sampler);
      return resolved;
    } catch (error) {
      if (createdSampler && sampler !== undefined) this.#gl.deleteSampler(sampler.sampler);
      if (createdTexture && texture !== undefined) {
        this.#gl.deleteTexture(texture.texture);
        this.#budget.release(texture.budgetIdentity);
      }
      throw error;
    }
  }

  takeUploadedStorageKeys(): readonly string[] {
    if (this.#uploadedStorageKeys.size === 0) return EMPTY_STORAGE_KEYS;
    const keys = [...this.#uploadedStorageKeys];
    this.#uploadedStorageKeys.clear();
    return keys;
  }

  takeDeniedStorageKeys(): readonly string[] {
    if (this.#deniedStorageKeys.size === 0) return EMPTY_STORAGE_KEYS;
    const keys = [...this.#deniedStorageKeys];
    this.#deniedStorageKeys.clear();
    return keys;
  }

  snapshot(): OrdinaryTextureGpuSnapshot {
    let compressedBytes = 0;
    let compressedTextures = 0;
    let fittedTextures = 0;
    let residentBytes = 0;
    for (const texture of this.#textures.values()) {
      residentBytes += texture.byteLength;
      if (texture.compressed) {
        compressedBytes += texture.byteLength;
        compressedTextures += 1;
      }
      if (texture.fitted) fittedTextures += 1;
    }
    return {
      compressedBytes,
      compressedTextures,
      fittedTextures,
      residentBytes,
      residentTextures: this.#textures.size,
    };
  }

  isUploadDeferred(storageKey: string): boolean {
    return this.#deferredStorageKeys.has(storageKey);
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

  #createTexture(binding: CanonicalTextureBinding): GpuTexture | undefined {
    if (this.#deferredStorageKeys.has(binding.storageKey)) return undefined;
    const gl = this.#gl;
    const decoded = binding.decoded;
    const compressed = decoded.kind === "ktx2-etc2";
    const mipmapsRequired = usesMipmaps(binding.sampler.minFilter);
    const mipmapped = compressed
      ? decoded.levels.length === completeKtx2MipLevelCount(decoded.width, decoded.height)
      : mipmapsRequired;
    if (compressed && mipmapsRequired && !mipmapped) {
      throw new TypeError(
        "Royal ETC2 KTX2 textures require a complete offline mip pyramid for mipmapped sampling",
      );
    }
    const byteLength = compressed
      ? ktx2Etc2StorageBytes(decoded)
      : ordinaryTextureStorageBytes(decoded.width, decoded.height, mipmapped);
    const budgetIdentity = {};
    if (!this.#budget.tryClaim(budgetIdentity, byteLength)) {
      this.#deniedStorageKeys.add(binding.storageKey);
      return undefined;
    }
    const uploadBytes = compressed
      ? decoded.levels.reduce((total, level) => total + level.blocks.byteLength, 0)
      : decoded.width * decoded.height * 4;
    if (!Number.isSafeInteger(uploadBytes)) {
      this.#budget.release(budgetIdentity);
      throw new RangeError("Royal ordinary texture upload exceeds safe integer range");
    }
    if (!this.#uploadBudget.tryAdmit(uploadBytes)) {
      this.#budget.release(budgetIdentity);
      this.#deferredStorageKeys.add(binding.storageKey);
      return undefined;
    }
    this.#deferredStorageKeys.delete(binding.storageKey);
    this.#deniedStorageKeys.delete(binding.storageKey);
    const texture = gl.createTexture();
    if (texture === null) {
      this.#budget.release(budgetIdentity);
      throw new Error("Royal could not allocate an ordinary texture");
    }
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (compressed) {
        if (decoded.colorSpace !== binding.colorSpace) {
          throw new TypeError("Royal ETC2 KTX2 storage color space does not match its binding");
        }
        const format = etc2RgbaWebGlFormat(binding.colorSpace);
        for (let levelIndex = 0; levelIndex < decoded.levels.length; levelIndex += 1) {
          const level = decoded.levels[levelIndex]!;
          gl.compressedTexImage2D(
            gl.TEXTURE_2D,
            levelIndex,
            format,
            level.width,
            level.height,
            0,
            level.blocks,
          );
        }
      } else {
        this.#applyUnpackState();
        const internalFormat = binding.colorSpace === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8;
        if (mipmapped) {
          gl.texStorage2D(
            gl.TEXTURE_2D,
            completeKtx2MipLevelCount(decoded.width, decoded.height),
            internalFormat,
            decoded.width,
            decoded.height,
          );
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            decoded.source,
          );
          gl.generateMipmap(gl.TEXTURE_2D);
        } else {
          // Mutable base-only storage can still be promoted if a later sampler needs mipmaps.
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            internalFormat,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            decoded.source,
          );
        }
      }
      return {
        bindings: new WeakMap<WebGLSampler, GpuTextureBinding>(),
        budgetIdentity,
        byteLength,
        compressed,
        fitted: decoded.sourceWidth !== undefined,
        height: decoded.height,
        mipmapped,
        texture,
        width: decoded.width,
      };
    } catch (error) {
      gl.deleteTexture(texture);
      this.#budget.release(budgetIdentity);
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

  #ensureMipmaps(resource: GpuTexture, storageKey: string): boolean {
    if (resource.mipmapped) return true;
    if (resource.compressed) {
      throw new TypeError(
        "Royal ETC2 KTX2 textures require a complete offline mip pyramid for mipmapped sampling",
      );
    }
    const byteLength = ordinaryTextureStorageBytes(resource.width, resource.height, true);
    if (!this.#budget.tryClaim(resource.budgetIdentity, byteLength)) {
      this.#deniedStorageKeys.add(storageKey);
      return false;
    }
    this.#deniedStorageKeys.delete(storageKey);
    const gl = this.#gl;
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resource.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
      resource.byteLength = byteLength;
      resource.mipmapped = true;
      return true;
    } catch (error) {
      this.#budget.tryClaim(resource.budgetIdentity, resource.byteLength);
      throw error;
    }
  }
}
