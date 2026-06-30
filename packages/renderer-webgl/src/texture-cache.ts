import {
  defaultTextureFallbackColor,
  type TextureAssetRef,
  type TextureColorSpace,
  type TextureSampler as CoreTextureSampler,
} from "@royal/renderer-core";
import type { RendererWebGlContext } from "./gl";
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

export type WebGlTextureSampler = {
  readonly magFilter: number;
  readonly minFilter: number;
  readonly wrapS: number;
  readonly wrapT: number;
};

export type GltfBaseColorTextureSource = {
  readonly documentId: string;
  readonly id: string;
  readonly image: {
    readonly index: number;
    readonly resolvedUri: string;
    readonly uri: string;
  };
  readonly sampler: WebGlTextureSampler;
  readonly samplerIndex?: number;
  readonly src: string;
  readonly textureIndex: number;
};

export type GltfBaseColorTexture = {
  readonly source: GltfBaseColorTextureSource;
  readonly texture: WebGLTexture;
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

type TextureUploadPolicy = {
  readonly colorSpace?: TextureColorSpace;
  readonly flipY: boolean;
};

const gltfBaseColorUploadPolicy = {
  colorSpace: "srgb",
  flipY: true,
} satisfies TextureUploadPolicy;

const textureAssetUploadPolicy = (asset: TextureAssetRef): TextureUploadPolicy => ({
  ...(asset.colorSpace === undefined ? {} : { colorSpace: asset.colorSpace }),
  flipY: true,
});

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Unsupported glTF: missing ${label}`);
  return value;
};

const resolveUri = (base: string, uri: string): string =>
  new URL(uri, new URL(base, globalThis.location?.href ?? "http://localhost/")).href;

type TextureImageSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

const makeRasterCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
  if (globalThis.document !== undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  throw new Error("Canvas is unavailable for texture image rasterization");
};

const loadHtmlImageCanvas = async (blob: Blob): Promise<HTMLCanvasElement | OffscreenCanvas> => {
  if (typeof Image === "undefined") {
    throw new Error("HTMLImageElement is unavailable for texture loading");
  }

  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode texture image"));
      image.src = url;
    });
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const canvas = makeRasterCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Expected 2D canvas context for texture image rasterization");
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const decodeTextureImage = async (blob: Blob): Promise<TextureImageSource> => {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some browsers reject SVG blobs here even though an HTMLImageElement can
      // decode and WebGL can upload them.
    }
  }

  return await loadHtmlImageCanvas(blob);
};

const loadImage = async (src: string, uri: string, label: string): Promise<TextureImageSource> => {
  const response = await fetch(resolveUri(src, uri));
  if (!response.ok) throw new Error(`Failed to load ${label}: ${uri}`);
  return await decodeTextureImage(await response.blob());
};

const usesMipmaps = (gl: RendererWebGlContext, filter: number): boolean =>
  filter === gl.NEAREST_MIPMAP_NEAREST ||
  filter === gl.LINEAR_MIPMAP_NEAREST ||
  filter === gl.NEAREST_MIPMAP_LINEAR ||
  filter === gl.LINEAR_MIPMAP_LINEAR;

const validMinFilter = (gl: RendererWebGlContext, filter: number | undefined): number => {
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

const validMagFilter = (gl: RendererWebGlContext, filter: number | undefined): number => {
  switch (filter) {
    case gl.NEAREST:
    case gl.LINEAR:
      return filter;
    default:
      return gl.LINEAR;
  }
};

const validWrapMode = (gl: RendererWebGlContext, mode: number | undefined): number => {
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
  gl: RendererWebGlContext,
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
  gl: RendererWebGlContext,
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
  gl: RendererWebGlContext,
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
  gl: RendererWebGlContext,
  sampler: CoreTextureSampler | undefined,
): WebGlTextureSampler => ({
  magFilter: validMagFilter(gl, textureSamplerFilter(gl, sampler?.magFilter)),
  minFilter: validMinFilter(gl, textureSamplerFilter(gl, sampler?.minFilter)),
  wrapS: validWrapMode(gl, textureSamplerWrap(gl, sampler?.wrapS)),
  wrapT: validWrapMode(gl, textureSamplerWrap(gl, sampler?.wrapT)),
});

const createTexture = (
  gl: RendererWebGlContext,
  image: TextureImageSource,
  uploadPolicy: TextureUploadPolicy,
  sampler: WebGlTextureSampler,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create WebGL texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, uploadPolicy.flipY);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampler.minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampler.magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, sampler.wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, sampler.wrapT);
  if (usesMipmaps(gl, sampler.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
};

const defaultFallbackTextureData = new Uint8Array([
  Math.round(defaultTextureFallbackColor[0] * 255),
  Math.round(defaultTextureFallbackColor[1] * 255),
  Math.round(defaultTextureFallbackColor[2] * 255),
  Math.round(defaultTextureFallbackColor[3] * 255),
]);

const createFallbackTexture = (gl: RendererWebGlContext): WebGLTexture => {
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
    defaultFallbackTextureData,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
};

export class TextureCache {
  readonly #gl: RendererWebGlContext;
  readonly #assetTextureLoads = new Map<string, TextureAssetLoad>();
  readonly #textures = new Set<WebGLTexture>();
  readonly #textureLoads = new Map<string, Promise<GltfBaseColorTexture>>();
  #disposed = false;
  #fallbackTexture: WebGLTexture | undefined;

  constructor(gl: RendererWebGlContext) {
    this.#gl = gl;
  }

  getFallbackTexture(): WebGLTexture {
    this.#fallbackTexture ??= this.#track(createFallbackTexture(this.#gl));
    return this.#fallbackTexture;
  }

  loadGltfBaseColorTexture(options: {
    readonly documentId?: string;
    readonly json: GltfTextureDocument;
    readonly src: string;
    readonly textureIndex: number;
  }): Promise<GltfBaseColorTexture> {
    const source = this.getGltfBaseColorTextureSource(options);
    const cacheKey = gltfTextureUploadCacheKey(source);
    const existing = this.#textureLoads.get(cacheKey);
    if (existing !== undefined) return existing;

    const promise = this.#loadGltfBaseColorTexture(source);
    this.#textureLoads.set(cacheKey, promise);
    return promise;
  }

  getGltfBaseColorTextureSource(options: {
    readonly documentId?: string;
    readonly json: GltfTextureDocument;
    readonly src: string;
    readonly textureIndex: number;
  }): GltfBaseColorTextureSource {
    const texture = required(options.json.textures?.[options.textureIndex], `texture ${options.textureIndex}`);
    const imageIndex = required(texture.source, `texture ${options.textureIndex} source`);
    const image = required(options.json.images?.[imageIndex], `image ${imageIndex}`);
    const uri = required(image.uri, `image ${imageIndex} uri`);
    const documentId = options.documentId ?? options.src;
    return {
      documentId,
      id: gltfTextureCacheKey(documentId, options.textureIndex),
      image: {
        index: imageIndex,
        resolvedUri: resolveUri(options.src, uri),
        uri,
      },
      sampler: textureSampler(this.#gl, options.json, texture),
      ...(texture.sampler === undefined ? {} : { samplerIndex: texture.sampler }),
      src: options.src,
      textureIndex: options.textureIndex,
    };
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

  async #loadGltfBaseColorTexture(source: GltfBaseColorTextureSource): Promise<GltfBaseColorTexture> {
    markGltf(`texture:${source.textureIndex}:start`);
    const loadedTexture = this.#track(createTexture(
      this.#gl,
      await loadImage(source.src, source.image.uri, "glTF image"),
      gltfBaseColorUploadPolicy,
      source.sampler,
    ));
    markGltf(`texture:${source.textureIndex}:end`);
    measureGltf(
      `texture:${source.textureIndex}`,
      `texture:${source.textureIndex}:start`,
      `texture:${source.textureIndex}:end`,
    );
    return { source, texture: loadedTexture };
  }

  async #loadTextureAssetBaseColor(asset: TextureAssetRef): Promise<WebGLTexture> {
    const base = globalThis.location?.href ?? "http://localhost/";
    return this.#track(createTexture(
      this.#gl,
      await loadImage(base, asset.uri, "texture asset"),
      textureAssetUploadPolicy(asset),
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

const textureAssetSamplerCacheKey = (sampler: CoreTextureSampler | undefined): string =>
  sampler === undefined
    ? ""
    : [
        sampler.magFilter ?? "",
        sampler.minFilter ?? "",
        sampler.wrapS ?? "",
        sampler.wrapT ?? "",
      ].join("\u0000");

const textureUploadPolicyCacheKey = (policy: TextureUploadPolicy): string =>
  [
    policy.colorSpace ?? "",
    policy.flipY ? "flip-y" : "source-y",
  ].join("\u0000");

const textureAssetCacheKey = (asset: TextureAssetRef): string =>
  [
    asset.id,
    asset.revision ?? "",
    asset.uri,
    textureUploadPolicyCacheKey(textureAssetUploadPolicy(asset)),
    textureAssetSamplerCacheKey(asset.sampler),
  ].join("\u0000");

const gltfTextureCacheKey = (src: string, textureIndex: number): string =>
  `${src}\u0000${textureIndex}`;

const gltfTextureUploadCacheKey = (source: GltfBaseColorTextureSource): string =>
  [
    source.id,
    textureUploadPolicyCacheKey(gltfBaseColorUploadPolicy),
  ].join("\u0000");

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
