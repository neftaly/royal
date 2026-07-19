import { describe, expect, it, vi } from "vitest";
import type { CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import {
  ordinaryTextureStorageBytes,
  TextureGpuOwner,
} from "../../packages/renderer-webgl/src/texture/gpu-owner";
import { fitOrdinaryTextureStorage } from "../../packages/renderer-webgl/src/texture/storage-fit";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

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
  storageKey = "shared-image:srgb",
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
  storageKey,
});

describe("ordinary texture GPU owner", () => {
  it("computes exact RGBA storage and coherently denies a mip expansion over budget", () => {
    expect(ordinaryTextureStorageBytes(8, 8, false)).toBe(256);
    expect(ordinaryTextureStorageBytes(8, 8, true)).toBe(340);
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(300);
    const owner = new TextureGpuOwner(gl, budget);

    const bindings = owner.reconcile([
      binding("nearest", "nearest"),
      binding("mipmapped", "linear-mipmap-linear"),
    ]);

    expect(bindings[0]!.texture).not.toBeNull();
    expect(bindings[1]).toEqual({ sampler: null, texture: null });
    expect(gl.generateMipmap).not.toHaveBeenCalled();
    expect(budget.snapshot()).toEqual({ budgetBytes: 300, deniedClaims: 1, retainedBytes: 256 });
  });

  it("fits the largest aspect-preserving mip chain under a storage ceiling", () => {
    expect(fitOrdinaryTextureStorage(8, 8, 340)).toEqual({ height: 8, width: 8 });
    expect(fitOrdinaryTextureStorage(8, 8, 100)).toEqual({ height: 4, width: 4 });
    expect(fitOrdinaryTextureStorage(8, 4, 100)).toEqual({ height: 3, width: 7 });
    expect(() => fitOrdinaryTextureStorage(8, 8, 3)).toThrow("at least four bytes");
  });

  it("fuzzes storage fits for boundedness and maximality", () => {
    forEachFuzzCase({ cases: 256, envName: "ROYAL_TEXTURE_STORAGE_FUZZ_CASES", seed: 0x7e87_1202 }, ({ random }) => {
      const width = random.int(1, 4_097);
      const height = random.int(1, 4_097);
      const authoredBytes = ordinaryTextureStorageBytes(width, height, true);
      const maxBytes = authoredBytes === 4 ? 4 : random.int(4, authoredBytes + 1);
      const fitted = fitOrdinaryTextureStorage(width, height, maxBytes);

      assertFuzz(fitted.width >= 1 && fitted.width <= width, "fitted width must stay within the source");
      assertFuzz(fitted.height >= 1 && fitted.height <= height, "fitted height must stay within the source");
      assertFuzz(
        ordinaryTextureStorageBytes(fitted.width, fitted.height, true) <= maxBytes,
        "fitted mip chain must respect its byte ceiling",
      );

      const longest = Math.max(width, height);
      const nextLongest = Math.max(fitted.width, fitted.height) + 1;
      if (nextLongest <= longest) {
        const nextWidth = Math.max(1, Math.floor(width / longest * nextLongest));
        const nextHeight = Math.max(1, Math.floor(height / longest * nextLongest));
        assertFuzz(
          ordinaryTextureStorageBytes(nextWidth, nextHeight, true) > maxBytes,
          "fitted size must be the largest aspect-preserving candidate",
        );
      }
    });
  });

  it("does not create GL storage when the initial persistent claim is denied", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(300);
    const owner = new TextureGpuOwner(gl, budget);
    const bindings = owner.reconcile([binding("mipmapped", "linear-mipmap-linear")]);
    expect(bindings[0]).toEqual({ sampler: null, texture: null });
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

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

    const retained = owner.reconcile([binding("mipmapped", "linear-mipmap-linear")]);
    expect(retained[0]).toBe(first[1]);
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
    expect(owner.takeUploadedStorageKeys()).toEqual([]);
  });

  it("rolls back new sampler work without disturbing retained storage or bindings", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const first = owner.reconcile([binding("nearest", "nearest")]);
    vi.mocked(gl.createSampler).mockReturnValueOnce(null as unknown as WebGLSampler);
    expect(() => owner.reconcile([binding("broken", "nearest")]))
      .toThrow("could not allocate a texture sampler");
    const retained = owner.reconcile([binding("nearest", "nearest")]);
    expect(retained[0]).toBe(first[0]);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).not.toHaveBeenCalled();
  });

  it("retains an incremental publication until the next complete claim reconciliation", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const retained = owner.retain(binding("nearest", "nearest"));
    expect(owner.retain(binding("nearest", "nearest"))).toBe(retained);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.createSampler).toHaveBeenCalledTimes(1);
    owner.reconcile([]);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteSampler).toHaveBeenCalledTimes(1);
  });

  it("applies context-global unpack state once per context generation", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    owner.reconcile([
      binding("first", "nearest", "first-image:srgb"),
      binding("second", "nearest", "second-image:srgb"),
    ]);
    expect(gl.pixelStorei).toHaveBeenCalledTimes(3);

    owner.invalidate();
    owner.reconcile([binding("third", "nearest", "third-image:srgb")]);
    expect(gl.pixelStorei).toHaveBeenCalledTimes(6);
  });
});
