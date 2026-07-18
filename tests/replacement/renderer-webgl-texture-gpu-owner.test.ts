import { describe, expect, it, vi } from "vitest";
import type { CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { TextureGpuOwner } from "../../packages/renderer-webgl/src/texture/gpu-owner";

const fakeGl = (): WebGL2RenderingContext => ({
  CLAMP_TO_EDGE: 0x812f,
  LINEAR: 0x2601,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  MIRRORED_REPEAT: 0x8370,
  NEAREST: 0x2600,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  NONE: 0,
  REPEAT: 0x2901,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  SRGB8_ALPHA8: 0x8c43,
  TEXTURE0: 0x84c0,
  TEXTURE_2D: 0x0de1,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNSIGNED_BYTE: 0x1401,
  activeTexture: vi.fn(),
  bindTexture: vi.fn(),
  createSampler: vi.fn(() => ({})),
  createTexture: vi.fn(() => ({})),
  deleteSampler: vi.fn(),
  deleteTexture: vi.fn(),
  generateMipmap: vi.fn(),
  pixelStorei: vi.fn(),
  samplerParameteri: vi.fn(),
  texImage2D: vi.fn(),
} as unknown as WebGL2RenderingContext);

const binding = (
  samplerKey: string,
  minFilter: CanonicalTextureBinding["sampler"]["minFilter"],
): CanonicalTextureBinding => ({
  colorSpace: "srgb",
  decoded: { height: 8, source: {} as ImageBitmap, width: 8 },
  sampler: {
    magFilter: "linear",
    minFilter,
    wrapS: "repeat",
    wrapT: "repeat",
  },
  samplerKey,
  storageKey: "shared-image:srgb",
});

describe("ordinary texture GPU owner", () => {
  it("shares storage, separates samplers, and adds mipmaps once when later demanded", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const first = owner.reconcile([
      binding("nearest", "nearest"),
      binding("mipmapped", "linear-mipmap-linear"),
    ]);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    expect(gl.createSampler).toHaveBeenCalledTimes(2);
    expect(first[0]!.texture).toBe(first[1]!.texture);
    expect(first[0]!.sampler).not.toBe(first[1]!.sampler);

    owner.reconcile([binding("mipmapped", "linear-mipmap-linear")]);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    owner.reconcile([]);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteSampler).toHaveBeenCalledTimes(2);
  });

  it("deletes newly allocated storage when sampler preparation fails", () => {
    const gl = fakeGl();
    vi.mocked(gl.createSampler).mockReturnValue(null as unknown as WebGLSampler);
    const owner = new TextureGpuOwner(gl);
    expect(() => owner.reconcile([binding("broken", "nearest")]))
      .toThrow("could not allocate a texture sampler");
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });
});
