import { afterEach, describe, expect, it, vi } from "vitest";

import type { RendererWebGlContext } from "../src/gl";
import { TextureCache } from "../src/texture-cache";

type TexParameterCall = {
  readonly param: number;
  readonly pname: number;
  readonly target: number;
};

type TexImageUpload = {
  readonly border: number;
  readonly data: readonly number[];
  readonly format: number;
  readonly height: number;
  readonly internalFormat: number;
  readonly level: number;
  readonly target: number;
  readonly type: number;
  readonly width: number;
};

const fakeTextureGl = (): {
  readonly counts: { readonly createTexture: number };
  readonly gl: RendererWebGlContext;
  readonly mipmaps: number[];
  readonly texImageUploads: TexImageUpload[];
  readonly texParameters: TexParameterCall[];
} => {
  const counts = { createTexture: 0 };
  const mipmaps: number[] = [];
  const texImageUploads: TexImageUpload[] = [];
  const texParameters: TexParameterCall[] = [];

  return {
    counts,
    gl: {
      CLAMP_TO_EDGE: 0x812F,
      LINEAR: 0x2601,
      LINEAR_MIPMAP_LINEAR: 0x2703,
      LINEAR_MIPMAP_NEAREST: 0x2701,
      MIRRORED_REPEAT: 0x8370,
      NEAREST: 0x2600,
      NEAREST_MIPMAP_LINEAR: 0x2702,
      NEAREST_MIPMAP_NEAREST: 0x2700,
      REPEAT: 0x2901,
      RGBA: 0x1908,
      TEXTURE_2D: 0x0DE1,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      UNPACK_FLIP_Y_WEBGL: 0x9240,
      UNSIGNED_BYTE: 0x1401,
      bindTexture() {},
      createTexture: () => {
        counts.createTexture += 1;
        return { id: counts.createTexture } as WebGLTexture;
      },
      deleteTexture() {},
      generateMipmap(target: GLenum) {
        mipmaps.push(target);
      },
      pixelStorei() {},
      texImage2D(...args: unknown[]) {
        const [
          target,
          level,
          internalFormat,
          width,
          height,
          border,
          format,
          type,
          data,
        ] = args;
        if (
          typeof target === "number"
          && typeof level === "number"
          && typeof internalFormat === "number"
          && typeof width === "number"
          && typeof height === "number"
          && typeof border === "number"
          && typeof format === "number"
          && typeof type === "number"
          && data instanceof Uint8Array
        ) {
          texImageUploads.push({
            border,
            data: Array.from(data),
            format,
            height,
            internalFormat,
            level,
            target,
            type,
            width,
          });
        }
      },
      texParameteri(target: GLenum, pname: GLenum, param: GLint) {
        texParameters.push({ param, pname, target });
      },
    } as unknown as RendererWebGlContext,
    mipmaps,
    texImageUploads,
    texParameters,
  };
};

const installImage = (image: Pick<ImageBitmap, "height" | "width">): void => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new Blob(["image"])))));
  vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve(image as ImageBitmap)));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TextureCache", () => {
  it("uploads the shared fallback texture as 50% grey", () => {
    const { counts, gl, texImageUploads } = fakeTextureGl();
    const cache = new TextureCache(gl);

    const fallback = cache.getFallbackTexture();

    expect(cache.getFallbackTexture()).toBe(fallback);
    expect(counts.createTexture).toBe(1);
    expect(texImageUploads).toEqual([{
      border: 0,
      data: [128, 128, 128, 255],
      format: gl.RGBA,
      height: 1,
      internalFormat: gl.RGBA,
      level: 0,
      target: gl.TEXTURE_2D,
      type: gl.UNSIGNED_BYTE,
      width: 1,
    }]);
  });

  it("uses the default mipmapped sampler when a glTF sampler is absent", async () => {
    installImage({ height: 32, width: 64 });
    const { gl, mipmaps, texParameters } = fakeTextureGl();
    const cache = new TextureCache(gl);

    const texture = await cache.loadGltfBaseColorTexture({
      json: {
        images: [{ uri: "textures/base.png" }],
        textures: [{ source: 0 }],
      },
      src: "https://example.test/models/triangle.gltf",
      textureIndex: 0,
    });

    expect(fetch).toHaveBeenCalledWith("https://example.test/models/textures/base.png");
    expect(texture.source).toMatchObject({
      documentId: "https://example.test/models/triangle.gltf",
      id: "https://example.test/models/triangle.gltf\u00000",
      image: {
        index: 0,
        resolvedUri: "https://example.test/models/textures/base.png",
        uri: "textures/base.png",
      },
      src: "https://example.test/models/triangle.gltf",
      textureIndex: 0,
    });
    expect(texParameters).toEqual([
      { param: gl.LINEAR_MIPMAP_LINEAR, pname: gl.TEXTURE_MIN_FILTER, target: gl.TEXTURE_2D },
      { param: gl.LINEAR, pname: gl.TEXTURE_MAG_FILTER, target: gl.TEXTURE_2D },
      { param: gl.REPEAT, pname: gl.TEXTURE_WRAP_S, target: gl.TEXTURE_2D },
      { param: gl.REPEAT, pname: gl.TEXTURE_WRAP_T, target: gl.TEXTURE_2D },
    ]);
    expect(mipmaps).toEqual([gl.TEXTURE_2D]);
  });

  it("falls back to default sampler state when a sampler reference is missing", async () => {
    installImage({ height: 16, width: 16 });
    const { gl, mipmaps, texParameters } = fakeTextureGl();
    const cache = new TextureCache(gl);

    await cache.loadGltfBaseColorTexture({
      json: {
        images: [{ uri: "base.png" }],
        textures: [{ sampler: 4, source: 0 }],
      },
      src: "https://example.test/triangle.gltf",
      textureIndex: 0,
    });

    expect(texParameters).toContainEqual({
      param: gl.LINEAR_MIPMAP_LINEAR,
      pname: gl.TEXTURE_MIN_FILTER,
      target: gl.TEXTURE_2D,
    });
    expect(texParameters).toContainEqual({
      param: gl.REPEAT,
      pname: gl.TEXTURE_WRAP_S,
      target: gl.TEXTURE_2D,
    });
    expect(mipmaps).toEqual([gl.TEXTURE_2D]);
  });

  it("keeps NPOT sampler state and mipmaps under the WebGL2 policy", async () => {
    installImage({ height: 32, width: 63 });
    const { gl, mipmaps, texParameters } = fakeTextureGl();
    const cache = new TextureCache(gl);

    await cache.loadGltfBaseColorTexture({
      json: {
        images: [{ uri: "base.png" }],
        samplers: [{
          magFilter: gl.NEAREST,
          minFilter: gl.LINEAR_MIPMAP_LINEAR,
          wrapS: gl.REPEAT,
          wrapT: gl.MIRRORED_REPEAT,
        }],
        textures: [{ sampler: 0, source: 0 }],
      },
      src: "https://example.test/triangle.gltf",
      textureIndex: 0,
    });

    expect(texParameters).toEqual([
      { param: gl.LINEAR_MIPMAP_LINEAR, pname: gl.TEXTURE_MIN_FILTER, target: gl.TEXTURE_2D },
      { param: gl.NEAREST, pname: gl.TEXTURE_MAG_FILTER, target: gl.TEXTURE_2D },
      { param: gl.REPEAT, pname: gl.TEXTURE_WRAP_S, target: gl.TEXTURE_2D },
      { param: gl.MIRRORED_REPEAT, pname: gl.TEXTURE_WRAP_T, target: gl.TEXTURE_2D },
    ]);
    expect(mipmaps).toEqual([gl.TEXTURE_2D]);
  });
});
