import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectNativeKtx2, inspectEtc2Ktx2 } from "../../packages/renderer-webgl/src/ktx2";
import { parseKtx2Native } from "../../packages/renderer-webgl/src/texture/ktx2-native";
import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { TextureGpuOwner } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import { planVirtualTextureAtlasStorage } from "../../packages/renderer-webgl/src/virtual-texture/storage-plan";
import { readVirtualTexturePage } from "../../packages/renderer-webgl/src/virtual-texture/browser-page-source";
import type { CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { createKtx2Fixture } from "./support/ktx2-fixture";
import { fakeGl } from "./support/canvas-root-harness";

const formats = [
  { vk: 165, format: "astc-6x6", block: 6, bytes: 16, linear: 0x93b4, srgb: 0x93d4, encoding: "ktx2-astc-6x6" },
  { vk: 171, format: "astc-8x8", block: 8, bytes: 16, linear: 0x93b7, srgb: 0x93d7, encoding: "ktx2-astc-8x8" },
  { vk: 133, format: "bc1-rgba", block: 4, bytes: 8, linear: 0x83f1, srgb: 0x8c4d, encoding: "ktx2-bc1" },
  { vk: 137, format: "bc3-rgba", block: 4, bytes: 16, linear: 0x83f3, srgb: 0x8c4f, encoding: "ktx2-bc3" },
  { vk: 145, format: "bc7-rgba", block: 4, bytes: 16, linear: 0x8e8c, srgb: 0x8e8d, encoding: "ktx2-bc7" },
] as const;
const sampler = { magFilter: "linear", minFilter: "linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" } as const;
const manifestFor = (encoding: string, borderTexels = 2) => parseVirtualTextureManifest({
  contractVersion: 2, pageSize: 128, borderTexels, virtualSize: [128, 128],
  pageEncoding: encoding, pages: { uriTemplate: "{mip}-{x}-{y}.ktx2" },
});
afterEach(() => vi.unstubAllGlobals());

describe.each(formats)("native $format", ({ vk, format, block, bytes, linear, srgb, encoding }) => {
  it.each(["linear", "srgb"] as const)("parses and uploads %s authored mip levels without copying blocks", async (colorSpace) => {
    const payload = createKtx2Fixture(vk + (colorSpace === "srgb" ? 1 : 0), 16, 16, 5);
    const parsed = parseKtx2Native(payload);
    expect(inspectNativeKtx2(payload)).toMatchObject({ format, colorSpace, levelCount: 5 });
    expect(() => inspectEtc2Ktx2(payload)).toThrow("unsupported vkFormat");
    expect(parsed.levels.map((level) => level.blocks.byteLength)).toEqual(
      [16, 8, 4, 2, 1].map((size) => Math.ceil(size / block) ** 2 * bytes),
    );
    for (const level of parsed.levels) expect(level.blocks.buffer).toBe(payload.buffer);
    const decoded = await createBrowserTextureDecoder(1, false).decode({
      kind: "embedded-asset", bytes: payload, contentKey: format, label: format,
      mimeType: "image/ktx2", sourceEncoding: "ktx2-native", colorSpace,
    }, new AbortController().signal);
    expect(decoded.kind).toBe("ktx2-native");
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })) });
    const budget = new PersistentGpuBudgetOwner(4096);
    const owner = new TextureGpuOwner(gl, budget, undefined, false);
    const binding: CanonicalTextureBinding = {
      decoded, colorSpace, sampler: { ...sampler, minFilter: "linear-mipmap-linear" },
      storageKey: format, samplerKey: "mips",
    };
    const resolved = owner.reconcileComplete([binding]);
    expect(resolved[0]!.texture).not.toBeNull();
    expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(5);
    expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(1, gl.TEXTURE_2D, 0, colorSpace === "srgb" ? srgb : linear, 16, 16, 0, expect.any(Uint8Array));
    expect(gl.generateMipmap).not.toHaveBeenCalled();
    expect(budget.snapshot().retainedBytes).toBe(inspectNativeKtx2(payload).storageBytes);
    for (let frame = 0; frame < 100; frame++) owner.reconcileComplete([binding]);
    expect(gl.getExtension).toHaveBeenCalledOnce();
    expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(5);
    owner.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("omits unsupported native textures while ordinary textures continue rendering", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(4096);
    const owner = new TextureGpuOwner(gl, budget);
    const native = parseKtx2Native(createKtx2Fixture(vk + 1, 16, 16));
    const binding: CanonicalTextureBinding = {
      decoded: { ...native, format, kind: "ktx2-native" }, colorSpace: "srgb", sampler,
      storageKey: "native", samplerKey: "linear",
    };
    const ordinary: CanonicalTextureBinding = { ...binding, storageKey: "image", decoded: { width: 4, height: 4, source: {} as ImageBitmap } };
    for (let frame = 0; frame < 100; frame++) {
      const result = owner.reconcileComplete([binding, ordinary]);
      expect(result[0]!.texture).toBeNull();
      expect(result[1]!.texture).not.toBeNull();
    }
    expect(gl.getExtension).toHaveBeenCalledOnce();
    expect(gl.compressedTexImage2D).not.toHaveBeenCalled();
    expect(budget.snapshot().retainedBytes).toBe(64);
    owner.dispose();
  });

  it("validates VT gutters, exact atlas bytes and mismatched page formats", async () => {
    const extent = block === 8 ? 136 : 132;
    const manifest = manifestFor(encoding, (extent - 128) / 2);
    const plan = planVirtualTextureAtlasStorage(manifest, 2048, 1024 * 1024);
    expect(plan.allocationBytes).toBe(plan.slotCount * (extent / block) ** 2 * bytes);
    expect(() => manifestFor(encoding, 1)).toThrow("block-compatible");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(createKtx2Fixture(vk + 1, extent, extent).slice().buffer as ArrayBuffer)));
    const page = await readVirtualTexturePage("https://test.invalid/test.json", manifest, { mip: 0, x: 0, y: 0 }, new AbortController().signal);
    expect(page).toMatchObject({ kind: format, colorSpace: "srgb" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(createKtx2Fixture(152, extent, extent).slice().buffer as ArrayBuffer)));
    await expect(readVirtualTexturePage("https://test.invalid/test.json", manifest, { mip: 0, x: 0, y: 0 }, new AbortController().signal)).rejects.toThrow("format does not match");
  });
});

describe("native format validation", () => {
  it("rejects HDR, Basis, wrong descriptors and corrupt block lengths", () => {
    for (const vk of [0, 1000066004, 143]) expect(() => parseKtx2Native(createKtx2Fixture(vk))).toThrow();
    for (const vk of [166, 172, 134, 138, 146]) {
      const payload = createKtx2Fixture(vk, 16, 16);
      const view = new DataView(payload.buffer);
      const dfd = view.getUint32(48, true);
      payload[dfd + 12] = 0;
      expect(() => parseKtx2Native(payload)).toThrow("color model");
      const wrongPlane = createKtx2Fixture(vk, 16, 16);
      wrongPlane[dfd + 21] = 1;
      expect(() => parseKtx2Native(wrongPlane)).toThrow("descriptor");
      const wrongLength = createKtx2Fixture(vk, 16, 16);
      new DataView(wrongLength.buffer).setBigUint64(88, 8n, true);
      expect(() => parseKtx2Native(wrongLength)).toThrow("block storage");
    }
  });

  it("accepts partial ASTC edge blocks but rejects incompatible BC base/mip dimensions", () => {
    expect(inspectNativeKtx2(createKtx2Fixture(166, 13, 7))).toMatchObject({ storageBytes: 96 });
    expect(() => parseKtx2Native(createKtx2Fixture(134, 13, 8))).toThrow("multiples of 4");
    expect(() => parseKtx2Native(createKtx2Fixture(134, 12, 8, 2))).toThrow("mip dimensions");
  });

  it("does not confuse HDR-only ASTC support or linear-only S3TC with LDR/sRGB support", () => {
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn((name: string) => name === "WEBGL_compressed_texture_astc"
      ? { getSupportedProfiles: () => ["hdr"] } : name === "WEBGL_compressed_texture_s3tc" ? {} : null) });
    const owner = new TextureGpuOwner(gl, new PersistentGpuBudgetOwner(4096));
    for (const vk of [166, 134]) {
      const decoded = parseKtx2Native(createKtx2Fixture(vk, 16, 16));
      if (decoded.format === "etc2-rgba") throw new Error("expected native format");
      expect(owner.reconcileComplete([{
        decoded: { ...decoded, format: decoded.format, kind: "ktx2-native" }, colorSpace: "srgb", sampler,
        storageKey: String(vk), samplerKey: "linear",
      }])[0]!.texture).toBeNull();
    }
    owner.dispose();
  });
});

describe("native review regressions", () => {
  it("re-enables extensions after context invalidation", () => {
    const gl = fakeGl();
    const extension = vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] }));
    Object.assign(gl, { getExtension: extension });
    const owner = new TextureGpuOwner(gl);
    const decoded = parseKtx2Native(createKtx2Fixture(166, 16, 16));
    const binding: CanonicalTextureBinding = {
      decoded: { ...decoded, format: "astc-6x6", kind: "ktx2-native" },
      colorSpace: "srgb", sampler, storageKey: "astc", samplerKey: "linear",
    };
    expect(owner.retain(binding).texture).not.toBeNull();
    owner.invalidate();
    expect(owner.retain(binding).texture).not.toBeNull();
    expect(extension).toHaveBeenCalledTimes(2);
    expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("enforces explicit ETC2 claims and rejects unimplemented retained-alpha decoding", async () => {
    const bytes = createKtx2Fixture(166, 16, 16, 5);
    const asset = { kind: "embedded-asset", bytes, contentKey: "astc", label: "astc", mimeType: "image/ktx2" } as const;
    const decoder = createBrowserTextureDecoder();
    const signal = new AbortController().signal;
    await expect(decoder.decode({ ...asset, sourceEncoding: "ktx2-etc2" }, signal)).rejects.toThrow("format does not match");
    await expect(decoder.decode(asset, signal, undefined, true)).rejects.toThrow("retained CPU alpha");
    const fitted = await decoder.decode(asset, signal, 48);
    expect(fitted).toMatchObject({ kind: "ktx2-native", format: "astc-6x6", width: 4, sourceWidth: 16 });
    await expect(decoder.decode({ ...asset, bytes: createKtx2Fixture(134, 16, 16, 5) }, signal, 16)).rejects.toThrow("multiples of 4");
  });

  it("rejects unsafe uint64 offsets without allocating BigInts in the parser", () => {
    const bytes = createKtx2Fixture(166, 16, 16);
    new DataView(bytes.buffer).setUint32(84, 0x200000, true);
    expect(() => parseKtx2Native(bytes)).toThrow("safe integer capacity");
  });
});

it("waits for a lost context before testing device support and cancels that wait cleanly", async () => {
  const canvas = new EventTarget();
  const listening = vi.spyOn(canvas, "addEventListener");
  const gl = fakeGl();
  let lost = true;
  Object.assign(gl, { canvas, isContextLost: () => lost,
    getExtension: vi.fn(() => lost ? null : { getSupportedProfiles: () => ["ldr"] }),
  });
  const decoder = createBrowserTextureDecoder(1, true, undefined, undefined, undefined, gl);
  const bytes = createKtx2Fixture(166, 16, 16, 5);
  const asset = { kind: "embedded-asset", bytes, contentKey: "astc", label: "astc", mimeType: "image/ktx2" } as const;
  const pending = decoder.decode(asset, new AbortController().signal);
  await vi.waitFor(() => expect(listening).toHaveBeenCalledOnce());
  expect(gl.getExtension).not.toHaveBeenCalled();
  lost = false;
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  const decoded = await pending;
  expect(decoded.kind).toBe("ktx2-native");
  decoded.close?.();
  lost = true;
  const controller = new AbortController();
  const cancelled = decoder.decode(asset, controller.signal);
  const rejection = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(listening).toHaveBeenCalledTimes(2));
  controller.abort();
  await rejection;
});
