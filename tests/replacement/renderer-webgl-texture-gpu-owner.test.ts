import { describe, expect, it, vi } from "vitest";
import type { CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";
import {
  ordinaryTextureStorageBytes,
  TextureGpuOwner,
} from "../../packages/renderer-webgl/src/texture/gpu-owner";
import { ETC2_SRGB8_ALPHA8_WEBGL_FORMAT } from "../../packages/renderer-webgl/src/texture/etc2-storage";
import { fitOrdinaryTextureStorage } from "../../packages/renderer-webgl/src/texture/storage-fit";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

const fakeGl = (): WebGL2RenderingContext => ({
  CLAMP_TO_EDGE: 0x812f,
  COMPRESSED_RGBA8_ETC2_EAC: 0x9278,
  COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9279,
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
  compressedTexImage2D: vi.fn(),
  createSampler: vi.fn(() => ({})),
  createTexture: vi.fn(() => ({})),
  deleteSampler: vi.fn(),
  deleteTexture: vi.fn(),
  generateMipmap: vi.fn(),
  pixelStorei: vi.fn(),
  samplerParameteri: vi.fn(),
  texImage2D: vi.fn(),
  texStorage2D: vi.fn(),
  texSubImage2D: vi.fn(),
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

const compressedBinding = (
  levelCount: number,
  minFilter: CanonicalTextureBinding["sampler"]["minFilter"],
): CanonicalTextureBinding => ({
  colorSpace: "srgb",
  decoded: {
    colorSpace: "srgb",
    height: 8,
    kind: "ktx2-etc2",
    levels: Array.from({ length: levelCount }, (_, level) => {
      const width = Math.max(1, 8 >> level);
      const height = Math.max(1, 8 >> level);
      return {
        blocks: new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16),
        height,
        width,
      };
    }),
    width: 8,
  },
  sampler: { magFilter: "linear", minFilter, wrapS: "repeat", wrapT: "repeat" },
  samplerKey: `compressed:${minFilter}`,
  storageKey: "compressed-image:srgb",
});

describe("ordinary texture GPU owner", () => {
  it("computes exact RGBA storage and coherently denies a mip expansion over budget", () => {
    expect(ordinaryTextureStorageBytes(8, 8, false)).toBe(256);
    expect(ordinaryTextureStorageBytes(8, 8, true)).toBe(340);
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(300);
    const owner = new TextureGpuOwner(gl, budget);
    expect(budget.availableBytes).toBe(300);

    const bindings = owner.reconcileComplete([
      binding("nearest", "nearest"),
      binding("mipmapped", "linear-mipmap-linear"),
    ]);

    expect(bindings[0]!.texture).not.toBeNull();
    expect(bindings[1]).toEqual({ sampler: null, target: "2d", texture: null });
    expect(gl.generateMipmap).not.toHaveBeenCalled();
    expect(budget.snapshot()).toEqual({ budgetBytes: 300, deniedClaims: 1, retainedBytes: 256 });
    expect(budget.availableBytes).toBe(44);
    owner.dispose();
    expect(budget.availableBytes).toBe(300);
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
    const bindings = owner.reconcileComplete([binding("mipmapped", "linear-mipmap-linear")]);
    expect(bindings[0]).toEqual({ sampler: null, target: "2d", texture: null });
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("defers distinct upload storage until a later frame without reporting failure", () => {
    const gl = fakeGl();
    const uploadBudget = new FrameUploadBudgetOwner(256);
    const owner = new TextureGpuOwner(gl, new PersistentGpuBudgetOwner(), uploadBudget);
    const first = binding("first", "nearest", "first-image:srgb");
    const second = binding("second", "nearest", "second-image:srgb");

    const initial = owner.reconcileComplete([first, second]);
    expect(initial[0]!.texture).not.toBeNull();
    expect(initial[1]).toEqual({ sampler: null, target: "2d", texture: null });
    expect(owner.isUploadDeferred(second.storageKey)).toBe(true);
    expect(owner.takeDeniedStorageKeys()).toEqual([]);
    expect(uploadBudget.snapshot()).toEqual({
      admittedBytes: 256,
      budgetBytes: 256,
      deferredUploads: 1,
    });

    uploadBudget.beginFrame();
    owner.beginFrame();
    expect(owner.retain(second).texture).not.toBeNull();
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
  });

  it("shares storage, separates samplers, and adds mipmaps once when later demanded", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const first = owner.reconcileComplete([
      binding("nearest", "nearest"),
      binding("mipmapped", "linear-mipmap-linear"),
    ]);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    expect(gl.createSampler).toHaveBeenCalledTimes(2);
    expect(first[0]!.texture).toBe(first[1]!.texture);
    expect(first[0]!.sampler).not.toBe(first[1]!.sampler);

    const retained = owner.reconcileComplete([binding("mipmapped", "linear-mipmap-linear")]);
    expect(retained[0]).toBe(first[1]);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    owner.reconcileComplete([]);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteSampler).toHaveBeenCalledTimes(2);
  });

  it("releases superseded storage before admitting an exactly full replacement", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(256);
    const owner = new TextureGpuOwner(gl, budget);
    const first = binding("first", "nearest", "first-image:srgb");
    const second = binding("second", "nearest", "second-image:srgb");

    expect(owner.reconcileComplete([first])[0]!.texture).not.toBeNull();
    expect(budget.snapshot()).toEqual({
      budgetBytes: 256,
      deniedClaims: 0,
      retainedBytes: 256,
    });
    const replacement = owner.reconcileComplete([second]);

    expect(replacement[0]!.texture).not.toBeNull();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(2);
    expect(owner.takeUploadedStorageKeys()).toEqual([second.storageKey]);
    expect(owner.takeDeniedStorageKeys()).toEqual([]);
    expect(budget.snapshot()).toEqual({
      budgetBytes: 256,
      deniedClaims: 0,
      retainedBytes: 256,
    });
  });

  it("keeps storage and samplers owned by later members of a bounded batch", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const first = binding("first-sampler", "nearest", "first-image:srgb");
    const later = binding("later-sampler", "linear", "later-image:srgb");

    const initial = owner.reconcileComplete([first, later]);
    vi.mocked(gl.deleteSampler).mockClear();
    vi.mocked(gl.deleteTexture).mockClear();
    const batch = owner.reconcileClaimedBatch(
      [first],
      new Set([first.storageKey, later.storageKey]),
      new Set([first.samplerKey, later.samplerKey]),
    );

    expect(batch[0]).toBe(initial[0]);
    expect(gl.deleteSampler).not.toHaveBeenCalled();
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(owner.reconcileClaimedBatch(
      [later],
      new Set([first.storageKey, later.storageKey]),
      new Set([first.samplerKey, later.samplerKey]),
    )[0]).toBe(initial[1]);
    expect(gl.createSampler).toHaveBeenCalledTimes(2);
    expect(gl.createTexture).toHaveBeenCalledTimes(2);
  });

  it("fuzzes bounded batch composition against complete storage and sampler ownership", () => {
    forEachFuzzCase({
      cases: 64,
      envName: "ROYAL_TEXTURE_CLAIM_FUZZ_CASES",
      seed: 0x0c1a_1a55,
    }, ({ random }) => {
      const gl = fakeGl();
      const owner = new TextureGpuOwner(gl);
      const storageCount = random.int(1, 9);
      const samplerCount = random.int(1, 6);
      const bindingCount = random.int(storageCount, 17);
      const bindings = random.array(bindingCount, (index) => {
        const storage = index < storageCount ? index : random.int(0, storageCount);
        const sampler = random.int(0, samplerCount);
        return binding(
          `sampler-${sampler}`,
          sampler % 2 === 0 ? "nearest" : "linear",
          `storage-${storage}`,
        );
      });
      const complete = owner.reconcileComplete(bindings);
      const completeStorageClaim = new Set(bindings.map((entry) => entry.storageKey));
      const completeSamplerClaim = new Set(bindings.map((entry) => entry.samplerKey));
      const batchIndices: number[] = [];
      for (let index = 0; index < bindings.length; index += 1) {
        if (random.boolean()) batchIndices.push(index);
      }
      if (batchIndices.length === 0) batchIndices.push(random.int(0, bindings.length));
      const batch = batchIndices.map((index) => bindings[index]!);
      const createdTextures = vi.mocked(gl.createTexture).mock.calls.length;
      const createdSamplers = vi.mocked(gl.createSampler).mock.calls.length;
      const retained = owner.reconcileClaimedBatch(
        batch,
        completeStorageClaim,
        completeSamplerClaim,
      );

      assertFuzz(
        vi.mocked(gl.createTexture).mock.calls.length === createdTextures,
        "a bounded batch must reuse every complete-claim texture",
      );
      assertFuzz(
        vi.mocked(gl.createSampler).mock.calls.length === createdSamplers,
        "a bounded batch must reuse every complete-claim sampler",
      );
      assertFuzz(
        vi.mocked(gl.deleteTexture).mock.calls.length === 0,
        "a bounded batch must not delete texture storage owned outside the batch",
      );
      assertFuzz(
        vi.mocked(gl.deleteSampler).mock.calls.length === 0,
        "a bounded batch must not delete samplers owned outside the batch",
      );
      for (let index = 0; index < batchIndices.length; index += 1) {
        assertFuzz(
          retained[index] === complete[batchIndices[index]!],
          "a bounded batch must preserve each resident binding identity",
        );
      }
    });
  });

  it("rejects a bounded batch outside either complete resource claim", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const texture = binding("sampler", "nearest", "image:srgb");

    expect(() => owner.reconcileClaimedBatch(
      [texture],
      new Set<string>(),
      new Set([texture.samplerKey]),
    )).toThrow("outside its complete storage claim");
    expect(() => owner.reconcileClaimedBatch(
      [texture],
      new Set([texture.storageKey]),
      new Set<string>(),
    )).toThrow("outside its complete sampler claim");
    expect(gl.createTexture).not.toHaveBeenCalled();
  });

  it("allocates a known mip chain immutably before uploading its base level", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    expect(owner.reconcileComplete([binding("mipmapped", "linear-mipmap-linear")])[0]!.texture)
      .not.toBeNull();
    expect(gl.texStorage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 4, gl.SRGB8_ALPHA8, 8, 8);
    expect(gl.texSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      expect.any(Object),
    );
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(gl.generateMipmap).toHaveBeenCalledOnce();
  });

  it("uploads a complete ETC2 pyramid directly with its exact compressed budget", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(112);
    const owner = new TextureGpuOwner(gl, budget);
    const result = owner.reconcileComplete([compressedBinding(4, "linear-mipmap-linear")]);

    expect(result[0]!.texture).not.toBeNull();
    expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(4);
    expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
      1,
      gl.TEXTURE_2D,
      0,
      ETC2_SRGB8_ALPHA8_WEBGL_FORMAT,
      8,
      8,
      0,
      expect.any(Uint8Array),
    );
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(gl.generateMipmap).not.toHaveBeenCalled();
    expect(gl.pixelStorei).not.toHaveBeenCalled();
    expect(budget.snapshot()).toEqual({ budgetBytes: 112, deniedClaims: 0, retainedBytes: 112 });
    expect(owner.snapshot()).toEqual({
      compressedBytes: 112,
      compressedTextures: 1,
      fittedTextures: 0,
      residentBytes: 112,
      residentTextures: 1,
    });
  });

  it("accepts a base-only ETC2 texture for non-mip sampling but rejects invented mipmaps", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    expect(owner.reconcileComplete([compressedBinding(1, "linear")])[0]!.texture).not.toBeNull();
    expect(() => owner.reconcileComplete([compressedBinding(1, "linear-mipmap-linear")]))
      .toThrow("complete offline mip pyramid");
    expect(gl.generateMipmap).not.toHaveBeenCalled();
  });

  it("rejects compressed storage before allocation when ETC2 was not enabled", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(
      gl,
      new PersistentGpuBudgetOwner(),
      new FrameUploadBudgetOwner(),
      false,
    );
    expect(() => owner.reconcileComplete([compressedBinding(1, "linear")]))
      .toThrow("WEBGL_compressed_texture_etc");
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(gl.compressedTexImage2D).not.toHaveBeenCalled();
  });

  it("deletes newly allocated storage when sampler preparation fails", () => {
    const gl = fakeGl();
    vi.mocked(gl.createSampler).mockReturnValue(null as unknown as WebGLSampler);
    const owner = new TextureGpuOwner(gl);
    expect(() => owner.reconcileComplete([binding("broken", "nearest")]))
      .toThrow("could not allocate a texture sampler");
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(owner.takeUploadedStorageKeys()).toEqual([]);
  });

  it("rolls back new sampler work without disturbing retained storage or bindings", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    const first = owner.reconcileComplete([binding("nearest", "nearest")]);
    vi.mocked(gl.createSampler).mockReturnValueOnce(null as unknown as WebGLSampler);
    expect(() => owner.reconcileComplete([binding("broken", "nearest")]))
      .toThrow("could not allocate a texture sampler");
    const retained = owner.reconcileComplete([binding("nearest", "nearest")]);
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
    owner.reconcileComplete([]);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteSampler).toHaveBeenCalledTimes(1);
  });

  it("applies context-global unpack state once per context generation", () => {
    const gl = fakeGl();
    const owner = new TextureGpuOwner(gl);
    owner.reconcileComplete([
      binding("first", "nearest", "first-image:srgb"),
      binding("second", "nearest", "second-image:srgb"),
    ]);
    expect(gl.pixelStorei).toHaveBeenCalledTimes(3);

    owner.invalidate();
    owner.reconcileComplete([binding("third", "nearest", "third-image:srgb")]);
    expect(gl.pixelStorei).toHaveBeenCalledTimes(6);
  });
});
