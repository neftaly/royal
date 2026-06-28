import { markGltf, measureGltf } from "./performance";

type GltfImage = {
  readonly uri?: string;
};

type GltfTexture = {
  readonly source?: number;
};

type GltfTextureDocument = {
  readonly images?: readonly GltfImage[];
  readonly textures?: readonly GltfTexture[];
};

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Unsupported glTF: missing ${label}`);
  return value;
};

const resolveUri = (base: string, uri: string): string =>
  new URL(uri, new URL(base, globalThis.location?.href ?? "http://localhost/")).href;

const loadImage = async (src: string, uri: string): Promise<ImageBitmap> => {
  const response = await fetch(resolveUri(src, uri));
  if (!response.ok) throw new Error(`Failed to load glTF image: ${uri}`);
  return await createImageBitmap(await response.blob());
};

const createTexture = (
  gl: WebGLRenderingContext,
  image: ImageBitmap,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create WebGL texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
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

  dispose(): void {
    this.#disposed = true;
    for (const texture of this.#textures) {
      this.#gl.deleteTexture(texture);
    }
    this.#textures.clear();
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
      await loadImage(options.src, required(image.uri, `image ${imageIndex} uri`)),
    ));
    markGltf(`texture:${options.textureIndex}:end`);
    measureGltf(
      `texture:${options.textureIndex}`,
      `texture:${options.textureIndex}:start`,
      `texture:${options.textureIndex}:end`,
    );
    return loadedTexture;
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
