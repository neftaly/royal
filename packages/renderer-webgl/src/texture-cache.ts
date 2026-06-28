import type { TextureAssetRef, TextureSampler as CoreTextureSampler } from "@royal/renderer-core";
import { markGltf, measureGltf } from "./performance";

type GltfImage = {
  readonly uri?: string;
};

type GltfSampler = {
  readonly magFilter?: number;
  readonly minFilter?: number;
  readonly wrapS?: number;
  readonly wrapT?: number;
};

type GltfTexture = {
  readonly sampler?: number;
  readonly source?: number;
};

type GltfTextureDocument = {
  readonly images?: readonly GltfImage[];
  readonly samplers?: readonly GltfSampler[];
  readonly textures?: readonly GltfTexture[];
};

type WebGlTextureSampler = {
  readonly magFilter: number;
  readonly minFilter: number;
  readonly wrapS: number;
  readonly wrapT: number;
};

export type TextureAssetLoadResult =
  | {
    readonly kind: "error";
    readonly error: unknown;
  }
  | {
    readonly kind: "loading";
  }
  | {
    readonly kind: "ready";
    readonly texture: WebGLTexture;
  };

type TextureAssetLoad = TextureAssetLoadResult | {
  readonly kind: "loading";
  readonly promise: Promise<WebGLTexture>;
};

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Unsupported glTF: missing ${label}`);
  return value;
};

const resolveUri = (base: string, uri: string): string =>
  new URL(uri, new URL(base, globalThis.location?.href ?? "http://localhost/")).href;

const loadImage = async (src: string, uri: string, label: string): Promise<ImageBitmap> => {
  const response = await fetch(resolveUri(src, uri));
  if (!response.ok) throw new Error(`Failed to load ${label}: ${uri}`);
  return await createImageBitmap(await response.blob());
};

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;

const usesMipmaps = (gl: WebGLRenderingContext, filter: number): boolean =>
  filter === gl.NEAREST_MIPMAP_NEAREST ||
  filter === gl.LINEAR_MIPMAP_NEAREST ||
  filter === gl.NEAREST_MIPMAP_LINEAR ||
  filter === gl.LINEAR_MIPMAP_LINEAR;

const mipmapFallback = (gl: WebGLRenderingContext, filter: number): number =>
  filter === gl.NEAREST_MIPMAP_NEAREST || filter === gl.NEAREST_MIPMAP_LINEAR
    ? gl.NEAREST
    : gl.LINEAR;

const validMinFilter = (gl: WebGLRenderingContext, filter: number | undefined): number => {
  switch (filter) {
    case gl.NEAREST:
    case gl.LINEAR:
    case gl.NEAREST_MIPMAP_NEAREST:
    case gl.LINEAR_MIPMAP_NEAREST:
    case gl.NEAREST_MIPMAP_LINEAR:
    case gl.LINEAR_MIPMAP_LINEAR:
      return filter;
    default:
      return gl.LINEAR_MIPMAP_LINEAR;
  }
};

const validMagFilter = (gl: WebGLRenderingContext, filter: number | undefined): number => {
  switch (filter) {
    case gl.NEAREST:
    case gl.LINEAR:
      return filter;
    default:
      return gl.LINEAR;
  }
};

const validWrapMode = (gl: WebGLRenderingContext, mode: number | undefined): number => {
  switch (mode) {
    case gl.CLAMP_TO_EDGE:
    case gl.MIRRORED_REPEAT:
    case gl.REPEAT:
      return mode;
    default:
      return gl.REPEAT;
  }
};

const textureSampler = (
  gl: WebGLRenderingContext,
  json: GltfTextureDocument,
  texture: GltfTexture,
): WebGlTextureSampler => {
  const sampler = texture.sampler === undefined ? undefined : json.samplers?.[texture.sampler];
  return {
    magFilter: validMagFilter(gl, sampler?.magFilter),
    minFilter: validMinFilter(gl, sampler?.minFilter),
    wrapS: validWrapMode(gl, sampler?.wrapS),
    wrapT: validWrapMode(gl, sampler?.wrapT),
  };
};

const textureSamplerFilter = (
  gl: WebGLRenderingContext,
  filter: CoreTextureSampler["minFilter"] | CoreTextureSampler["magFilter"] | undefined,
): number | undefined => {
  switch (filter) {
    case "linear":
      return gl.LINEAR;
    case "linear-mipmap-linear":
      return gl.LINEAR_MIPMAP_LINEAR;
    case "linear-mipmap-nearest":
      return gl.LINEAR_MIPMAP_NEAREST;
    case "nearest":
      return gl.NEAREST;
    case "nearest-mipmap-linear":
      return gl.NEAREST_MIPMAP_LINEAR;
    case "nearest-mipmap-nearest":
      return gl.NEAREST_MIPMAP_NEAREST;
    default:
      return undefined;
  }
};

const textureSamplerWrap = (
  gl: WebGLRenderingContext,
  wrap: CoreTextureSampler["wrapS"] | undefined,
): number | undefined => {
  switch (wrap) {
    case "clamp-to-edge":
      return gl.CLAMP_TO_EDGE;
    case "mirrored-repeat":
      return gl.MIRRORED_REPEAT;
    case "repeat":
      return gl.REPEAT;
    default:
      return undefined;
  }
};

const textureAssetSampler = (
  gl: WebGLRenderingContext,
  sampler: CoreTextureSampler | undefined,
): WebGlTextureSampler => ({
  magFilter: validMagFilter(gl, textureSamplerFilter(gl, sampler?.magFilter)),
  minFilter: validMinFilter(gl, textureSamplerFilter(gl, sampler?.minFilter)),
  wrapS: validWrapMode(gl, textureSamplerWrap(gl, sampler?.wrapS)),
  wrapT: validWrapMode(gl, textureSamplerWrap(gl, sampler?.wrapT)),
});

const createTexture = (
  gl: WebGLRenderingContext,
  image: ImageBitmap,
  sampler: WebGlTextureSampler,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create WebGL texture");

  const canMipmap = isPowerOfTwo(image.width) && isPowerOfTwo(image.height);
  const minFilter = canMipmap || !usesMipmaps(gl, sampler.minFilter)
    ? sampler.minFilter
    : mipmapFallback(gl, sampler.minFilter);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampler.magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, canMipmap ? sampler.wrapS : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, canMipmap ? sampler.wrapT : gl.CLAMP_TO_EDGE);
  if (canMipmap && usesMipmaps(gl, minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
};

const createFallbackTexture = (gl: WebGLRenderingContext): WebGLTexture => {
  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create WebGL texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
};

export class TextureCache {
  readonly #gl: WebGLRenderingContext;
  readonly #assetTextureLoads = new Map<string, TextureAssetLoad>();
  readonly #textures = new Set<WebGLTexture>();
  readonly #textureLoads = new Map<string, Promise<WebGLTexture>>();
  #disposed = false;
  #fallbackTexture: WebGLTexture | undefined;

  constructor(gl: WebGLRenderingContext) {
    this.#gl = gl;
  }

  getFallbackTexture(): WebGLTexture {
    this.#fallbackTexture ??= this.#track(createFallbackTexture(this.#gl));
    return this.#fallbackTexture;
  }

  loadGltfBaseColorTexture(options: {
    readonly json: GltfTextureDocument;
    readonly src: string;
    readonly textureIndex: number;
  }): Promise<WebGLTexture> {
    const cacheKey = `${options.src}\u0000${options.textureIndex}`;
    const existing = this.#textureLoads.get(cacheKey);
    if (existing !== undefined) return existing;

    const promise = this.#loadGltfBaseColorTexture(options);
    this.#textureLoads.set(cacheKey, promise);
    return promise;
  }

  loadTextureAssetBaseColor(
    asset: TextureAssetRef,
    onSettled?: () => void,
  ): TextureAssetLoadResult {
    const cacheKey = textureAssetCacheKey(asset);
    const existing = this.#assetTextureLoads.get(cacheKey);
    if (existing !== undefined) return textureAssetResult(existing);

    const promise = this.#loadTextureAssetBaseColor(asset);
    const load = { kind: "loading", promise } satisfies TextureAssetLoad;
    this.#assetTextureLoads.set(cacheKey, load);

    void promise.then(
      (texture) => {
        if (this.#assetTextureLoads.get(cacheKey) !== load) return;
        this.#assetTextureLoads.set(cacheKey, { kind: "ready", texture });
        onSettled?.();
      },
      (error: unknown) => {
        if (this.#assetTextureLoads.get(cacheKey) !== load) return;
        this.#assetTextureLoads.set(cacheKey, { kind: "error", error });
        onSettled?.();
      },
    );

    return { kind: "loading" };
  }

  dispose(): void {
    this.#disposed = true;
    for (const texture of this.#textures) {
      this.#gl.deleteTexture(texture);
    }
    this.#textures.clear();
    this.#assetTextureLoads.clear();
    this.#textureLoads.clear();
  }

  async #loadGltfBaseColorTexture(options: {
    readonly json: GltfTextureDocument;
    readonly src: string;
    readonly textureIndex: number;
  }): Promise<WebGLTexture> {
    markGltf(`texture:${options.textureIndex}:start`);
    const texture = required(options.json.textures?.[options.textureIndex], `texture ${options.textureIndex}`);
    const imageIndex = required(texture.source, `texture ${options.textureIndex} source`);
    const image = required(options.json.images?.[imageIndex], `image ${imageIndex}`);
    const loadedTexture = this.#track(createTexture(
      this.#gl,
      await loadImage(options.src, required(image.uri, `image ${imageIndex} uri`), "glTF image"),
      textureSampler(this.#gl, options.json, texture),
    ));
    markGltf(`texture:${options.textureIndex}:end`);
    measureGltf(
      `texture:${options.textureIndex}`,
      `texture:${options.textureIndex}:start`,
      `texture:${options.textureIndex}:end`,
    );
    return loadedTexture;
  }

  async #loadTextureAssetBaseColor(asset: TextureAssetRef): Promise<WebGLTexture> {
    const base = globalThis.location?.href ?? "http://localhost/";
    return this.#track(createTexture(
      this.#gl,
      await loadImage(base, asset.uri, "texture asset"),
      textureAssetSampler(this.#gl, asset.sampler),
    ));
  }

  #track(texture: WebGLTexture): WebGLTexture {
    if (this.#disposed) {
      this.#gl.deleteTexture(texture);
      return texture;
    }

    this.#textures.add(texture);
    return texture;
  }
}

const textureAssetCacheKey = (asset: TextureAssetRef): string =>
  `${asset.id}\u0000${asset.revision ?? ""}\u0000${asset.uri}`;

const textureAssetResult = (load: TextureAssetLoad): TextureAssetLoadResult => {
  switch (load.kind) {
    case "error":
      return { kind: "error", error: load.error };
    case "loading":
      return { kind: "loading" };
    case "ready":
      return { kind: "ready", texture: load.texture };
  }
};
