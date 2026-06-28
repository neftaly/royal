import { afterEach, describe, expect, it, vi } from "vitest";

import { TextureCache } from "../src/texture-cache";

type TexParameterCall = {
  readonly param: number;
  readonly pname: number;
  readonly target: number;
};

const fakeTextureGl = (): {
  readonly counts: { readonly createTexture: number };
  readonly gl: WebGLRenderingContext;
  readonly mipmaps: number[];
  readonly texParameters: TexParameterCall[];
} => {
  const counts = { createTexture: 0 };
  const mipmaps: number[] = [];
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
      generateMipmap(target) {
        mipmaps.push(target);
      },
      pixelStorei() {},
      texImage2D() {},
      texParameteri(target, pname, param) {
        texParameters.push({ param, pname, target });
      },
    } as unknown as WebGLRenderingContext,
    mipmaps,
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
  it("uses the default mipmapped sampler when a glTF sampler is absent", async () => {
    installImage({ height: 32, width: 64 });
    const { gl, mipmaps, texParameters } = fakeTextureGl();
    const cache = new TextureCache(gl);

    await cache.loadGltfBaseColorTexture({
      json: {
        images: [{ uri: "textures/base.png" }],
        textures: [{ source: 0 }],
      },
      src: "https://example.test/models/triangle.gltf",
      textureIndex: 0,
    });

    expect(fetch).toHaveBeenCalledWith("https://example.test/models/textures/base.png");
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

  it("clamps NPOT textures and disables mipmaps even when the sampler asks for them", async () => {
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
      { param: gl.LINEAR, pname: gl.TEXTURE_MIN_FILTER, target: gl.TEXTURE_2D },
      { param: gl.NEAREST, pname: gl.TEXTURE_MAG_FILTER, target: gl.TEXTURE_2D },
      { param: gl.CLAMP_TO_EDGE, pname: gl.TEXTURE_WRAP_S, target: gl.TEXTURE_2D },
      { param: gl.CLAMP_TO_EDGE, pname: gl.TEXTURE_WRAP_T, target: gl.TEXTURE_2D },
    ]);
    expect(mipmaps).toEqual([]);
  });
});
