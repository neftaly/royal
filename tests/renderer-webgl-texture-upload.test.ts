import { describe, expect, it } from "vitest";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import type { TextureAssetUploadRef } from "../packages/renderer-webgl/src/webgl/materials";
import {
  samplerConstant,
  textureUploadInternalFormat,
  uploadTexture,
  usesMipmaps,
} from "../packages/renderer-webgl/src/webgl/texture-upload";

type Call = { readonly args: readonly unknown[]; readonly name: string };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly LINEAR = 0x2601;
  readonly LINEAR_MIPMAP_LINEAR = 0x2703;
  readonly LINEAR_MIPMAP_NEAREST = 0x2701;
  readonly MIRRORED_REPEAT = 0x8370;
  readonly NEAREST = 0x2600;
  readonly NEAREST_MIPMAP_LINEAR = 0x2702;
  readonly NEAREST_MIPMAP_NEAREST = 0x2700;
  readonly REPEAT = 0x2901;
  readonly RGBA = 0x1908;
  readonly SRGB8_ALPHA8 = 0x8c43;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly UNPACK_ALIGNMENT = 0x0cf5;
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly UNPACK_IMAGE_HEIGHT = 0x806e;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
  readonly UNPACK_ROW_LENGTH = 0x0cf2;
  readonly UNPACK_SKIP_IMAGES = 0x806d;
  readonly UNPACK_SKIP_PIXELS = 0x0cf4;
  readonly UNPACK_SKIP_ROWS = 0x0cf3;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly calls: Call[] = [];
  failTexImage = false;

  #record(name: string, ...args: readonly unknown[]): void {
    this.calls.push({ args, name });
  }

  activeTexture = (...args: readonly unknown[]): void => this.#record("activeTexture", ...args);
  bindTexture = (...args: readonly unknown[]): void => this.#record("bindTexture", ...args);
  compressedTexImage2D = (...args: readonly unknown[]): void => this.#record("compressedTexImage2D", ...args);
  generateMipmap = (...args: readonly unknown[]): void => this.#record("generateMipmap", ...args);
  pixelStorei = (...args: readonly unknown[]): void => this.#record("pixelStorei", ...args);
  texImage2D = (...args: readonly unknown[]): void => {
    this.#record("texImage2D", ...args);
    if (this.failTexImage) throw new Error("texImage failure");
  };
  texParameteri = (...args: readonly unknown[]): void => this.#record("texParameteri", ...args);
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const handle = {} as WebGLTexture;
const texture = (input: Partial<TextureAssetUploadRef> = {}): TextureAssetUploadRef => ({
  colorSpace: "linear",
  kind: "asset",
  uri: "texture.png",
  ...input,
});
const decoded = (): Extract<LoadedTextureSource, { readonly kind: "rgba-texture" }> => ({
  data: new Uint8Array(4 * 2 * 4),
  height: 2,
  kind: "rgba-texture",
  width: 4,
});

describe("texture upload kernel", () => {
  it("maps every authored sampler constant and mipmap filter", () => {
    const gl = new FakeGl();
    const values = [
      ["clamp-to-edge", gl.CLAMP_TO_EDGE],
      ["linear", gl.LINEAR],
      ["linear-mipmap-linear", gl.LINEAR_MIPMAP_LINEAR],
      ["linear-mipmap-nearest", gl.LINEAR_MIPMAP_NEAREST],
      ["mirrored-repeat", gl.MIRRORED_REPEAT],
      ["nearest", gl.NEAREST],
      ["nearest-mipmap-linear", gl.NEAREST_MIPMAP_LINEAR],
      ["nearest-mipmap-nearest", gl.NEAREST_MIPMAP_NEAREST],
      ["repeat", gl.REPEAT],
    ] as const;
    for (const [value, expected] of values) {
      expect(samplerConstant(context(gl), value, -1)).toBe(expected);
    }
    expect(samplerConstant(context(gl), undefined, 77)).toBe(77);
    expect(values.filter(([value]) => usesMipmaps(value)).map(([value]) => value)).toEqual([
      "linear-mipmap-linear",
      "linear-mipmap-nearest",
      "nearest-mipmap-linear",
      "nearest-mipmap-nearest",
    ]);
    expect(usesMipmaps(undefined)).toBe(false);
  });

  it("uploads decoded sRGB bytes with the canonical upper-left origin and sampler state", () => {
    const gl = new FakeGl();
    const source = decoded();
    uploadTexture(context(gl), handle, source, texture({ colorSpace: "srgb" }));

    expect(gl.calls[0]).toEqual({ args: [gl.TEXTURE0], name: "activeTexture" });
    expect(gl.calls.filter(({ name }) => name === "pixelStorei")).toHaveLength(9);
    expect(gl.calls.find(({ name, args }) => name === "pixelStorei" && args[0] === gl.UNPACK_FLIP_Y_WEBGL))
      .toEqual({ args: [gl.UNPACK_FLIP_Y_WEBGL, false], name: "pixelStorei" });
    expect(gl.calls.find(({ name }) => name === "bindTexture")).toEqual({
      args: [gl.TEXTURE_2D, handle],
      name: "bindTexture",
    });
    expect(gl.calls.find(({ name }) => name === "texImage2D")?.args).toEqual([
      gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 4, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data,
    ]);
    expect(gl.calls.filter(({ name }) => name === "texParameteri").map(({ args }) => args)).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(gl.calls.some(({ name }) => name === "generateMipmap")).toBe(false);
  });

  it("uploads a complete authored RGBA mip chain without regenerating it", () => {
    const gl = new FakeGl();
    const source = decoded();
    const mip1 = new Uint8Array(2 * 1 * 4).fill(1);
    const mip2 = new Uint8Array(1 * 1 * 4).fill(2);
    uploadTexture(context(gl), handle, {
      ...source,
      levels: [
        { data: source.data, height: 2, width: 4 },
        { data: mip1, height: 1, width: 2 },
        { data: mip2, height: 1, width: 1 },
      ],
    }, texture({ sampler: { minFilter: "linear-mipmap-linear" } }));

    expect(gl.calls.filter(({ name }) => name === "texImage2D").map(({ args }) => args)).toEqual([
      [gl.TEXTURE_2D, 0, gl.RGBA, 4, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data],
      [gl.TEXTURE_2D, 1, gl.RGBA, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, mip1],
      [gl.TEXTURE_2D, 2, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, mip2],
    ]);
    expect(gl.calls.some(({ name }) => name === "generateMipmap")).toBe(false);
  });

  it("uploads a complete ETC2 chain with the sRGB format and compressed byte payloads", () => {
    const gl = new FakeGl();
    const levels = [
      { data: new Uint8Array(16).fill(1), height: 4, width: 4 },
      { data: new Uint8Array(16).fill(2), height: 2, width: 2 },
      { data: new Uint8Array(16).fill(3), height: 1, width: 1 },
    ];
    uploadTexture(context(gl), handle, {
      ...levels[0]!,
      format: 0x9278,
      kind: "compressed-texture",
      levels,
      srgbFormat: 0x9279,
    }, texture({
      colorSpace: "srgb",
      sampler: { minFilter: "linear-mipmap-linear" },
      uri: "compressed.ktx2",
    }));

    expect(gl.calls.filter(({ name }) => name === "compressedTexImage2D").map(({ args }) => args)).toEqual([
      [gl.TEXTURE_2D, 0, 0x9279, 4, 4, 0, levels[0]!.data],
      [gl.TEXTURE_2D, 1, 0x9279, 2, 2, 0, levels[1]!.data],
      [gl.TEXTURE_2D, 2, 0x9279, 1, 1, 0, levels[2]!.data],
    ]);
    expect(gl.calls.some(({ name }) => name === "generateMipmap")).toBe(false);
  });

  it("uses the DOM-source overload, authored sampler state, and mipmap generation", () => {
    const gl = new FakeGl();
    const source = { height: 8, width: 8 } as unknown as HTMLImageElement;
    uploadTexture(context(gl), handle, source, texture({
      sampler: {
        magFilter: "nearest",
        minFilter: "linear-mipmap-nearest",
        wrapS: "repeat",
        wrapT: "mirrored-repeat",
      },
    }));
    expect(gl.calls.find(({ name, args }) => name === "pixelStorei" && args[0] === gl.UNPACK_FLIP_Y_WEBGL))
      .toEqual({ args: [gl.UNPACK_FLIP_Y_WEBGL, false], name: "pixelStorei" });
    expect(gl.calls.find(({ name }) => name === "texImage2D")?.args).toEqual([
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source,
    ]);
    expect(gl.calls.filter(({ name }) => name === "texParameteri").map(({ args }) => args[2])).toEqual([
      gl.NEAREST, gl.LINEAR_MIPMAP_NEAREST, gl.REPEAT, gl.MIRRORED_REPEAT,
    ]);
    expect(gl.calls.filter(({ name }) => name === "generateMipmap")).toEqual([
      { args: [gl.TEXTURE_2D], name: "generateMipmap" },
    ]);
  });

  it("selects linear and sRGB internal formats without issuing commands", () => {
    const gl = new FakeGl();
    expect(textureUploadInternalFormat(context(gl), "linear")).toBe(gl.RGBA);
    expect(textureUploadInternalFormat(context(gl), "srgb")).toBe(gl.SRGB8_ALPHA8);
    expect(textureUploadInternalFormat(context(gl), undefined)).toBe(gl.RGBA);
    expect(gl.calls).toHaveLength(0);
  });

  it("stops before sampler and mipmap commands when texImage fails", () => {
    const gl = new FakeGl();
    gl.failTexImage = true;
    expect(() => uploadTexture(context(gl), handle, decoded(), texture({
      sampler: { minFilter: "linear-mipmap-linear" },
    }))).toThrow(/texImage failure/);
    expect(gl.calls.some(({ name }) => name === "bindTexture")).toBe(true);
    expect(gl.calls.filter(({ name }) => name === "texParameteri")).toHaveLength(0);
    expect(gl.calls.filter(({ name }) => name === "generateMipmap")).toHaveLength(0);
  });
});
