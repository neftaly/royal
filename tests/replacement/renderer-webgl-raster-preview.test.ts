import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextureAssetReader } from "../../packages/renderer-webgl/src/gltf/static-material";
import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { decodedTextureKey, textureStorageKey } from "../../packages/renderer-webgl/src/texture/source";
import type { JsonObject } from "../../packages/renderer-webgl/src/gltf/gltf-values";
import { fakeGl } from "./support/canvas-root-harness";
import { createKtx2Fixture } from "./support/ktx2-fixture";
import { createAvifHeader } from "./support/avif-header";
import { waitFor } from "./support/wait-for";

const documentFor = (): JsonObject => ({ images: [{ uri: "full.png" }, { uri: "preview.ktx2", mimeType: "image/ktx2" }],
  textures: [{ source: 0, extensions: { EXT_texture_astc: { source: 1 } },
    extras: { royal: { astcPreview: { width: 512, height: 512 } } } }] });
const read = (document = documentFor(), baseColor = true) => createTextureAssetReader(document, new Uint8Array(), 0, [],
  "preview", "https://example.test/model.gltf", "preview")(0, "texture", "srgb", baseColor);
const png = (width = 512, height = 512) => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};
const setup = (supported = true, vk = 172) => {
  const gl = fakeGl();
  Object.assign(gl, { getExtension: vi.fn(() => supported ? { getSupportedProfiles: () => ["ldr"] } : null) });
  const native = createKtx2Fixture(vk, 32, 32, 6);
  const fetch = vi.fn(async (uri: string) => new Response((uri.endsWith(".ktx2") ? native : png()) as Uint8Array<ArrayBuffer>,
    { headers: { "content-type": uri.endsWith(".ktx2") ? "image/ktx2" : "image/png" } }));
  const close = vi.fn();
  const bitmap = vi.fn(async () => ({ width: 512, height: 512, close }));
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("createImageBitmap", bitmap);
  return { decoder: createBrowserTextureDecoder(1, true, undefined, undefined, gl), fetch, bitmap, close };
};
afterEach(() => vi.unstubAllGlobals());

describe("explicit raster previews", () => {
  it.each([true, false])("keeps shared-index sRGB roles separate (preview first: %s)", async (previewFirst) => {
    const reader = createTextureAssetReader(documentFor(), new Uint8Array(), 0, [],
      "preview", "https://example.test/model.gltf", "preview");
    const first = reader(0, "texture", "srgb", previewFirst);
    const second = reader(0, "texture", "srgb", !previewFirst);
    const baseColor = previewFirst ? first : second;
    const emissive = previewFirst ? second : first;
    expect(reader(0, "texture", "srgb", true)).toBe(baseColor);
    expect(reader(0, "texture", "srgb", false)).toBe(emissive);
    expect(baseColor.rasterPreview).toEqual({ width: 512, height: 512 });
    expect(emissive.rasterPreview).toBeUndefined();
    expect(emissive.astc).toBeUndefined();
    expect(decodedTextureKey(baseColor)).not.toBe(decodedTextureKey(emissive));
    const dataMap = reader(0, "texture", "linear", false);
    expect(dataMap.astc).toBeUndefined();
    expect(decodedTextureKey(dataMap)).toBe(decodedTextureKey(emissive));
    expect(textureStorageKey(dataMap)).not.toBe(textureStorageKey(emissive));
    const { decoder, fetch, bitmap } = setup();
    const initial = await decoder.decode(first, new AbortController().signal);
    const following = await decoder.decode(second, new AbortController().signal);
    const native = previewFirst ? initial : following;
    const raster = previewFirst ? following : initial;
    try {
      expect(native.kind).toBe("ktx2-native");
      expect(native.preview).toBeDefined();
      expect(raster.kind).toBeUndefined();
      expect(raster.preview).toBeUndefined();
      expect([raster.width, raster.height]).toEqual([512, 512]);
      expect(bitmap).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { initial.close?.(); following.close?.(); }
  });

  it("lowers only opted-in base color and separates preview dimensions in identity", () => {
    const asset = read();
    expect(asset).toMatchObject({ rasterPreview: { width: 512, height: 512 }, astc: { sourceEncoding: "ktx2-astc" } });
    expect(read(documentFor(), false).astc).toBeUndefined();
    const different = { ...asset, rasterPreview: { width: 1024, height: 1024 } };
    expect(decodedTextureKey(different)).not.toBe(decodedTextureKey(asset));
    const document = documentFor(); delete (document.textures as JsonObject[])[0]!.extras;
    expect(read(document).rasterPreview).toBeUndefined();
    expect(read(document).astc).toBeDefined();
    expect(decodedTextureKey(read(document))).not.toBe(decodedTextureKey(asset));
  });

  it.each([null, false, {}, { width: 0, height: 512 }, { width: 512.5, height: 512 }, { width: 512, height: 16385 }])("rejects invalid dimensions %j", (preview) => {
    const document = documentFor();
    (document.textures as JsonObject[])[0]!.extras = { royal: { astcPreview: preview } };
    expect(() => read(document)).toThrow();
  });

  it("rejects required-ASTC preview authorities", () => {
    const document = documentFor(); document.extensionsRequired = ["EXT_texture_astc"];
    expect(() => read(document)).toThrow("requires optional ASTC");
  });

  it.each([166, 172])("loads native %i first, shares lazy full raster decoding and releases its bitmap", async (vk) => {
    const { decoder, fetch, bitmap, close } = setup(true, vk);
    const asset = read(), signal = new AbortController().signal;
    decoder.preload(asset, signal);
    const source = await decoder.decode(asset, signal);
    expect(source).toMatchObject({ kind: "ktx2-native", width: 32, height: 32, sourceWidth: 512, sourceHeight: 512,
      preview: { size: { width: 512, height: 512 }, rasterBytes: 512 * 512 * 4, retainedBytes: 0 } });
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/preview.ktx2"]);
    expect(bitmap).not.toHaveBeenCalled();
    const first = source.preview!.load();
    expect(source.preview!.retainedBytes).toBe(512 * 512 * 4);
    expect(source.preview!.load()).toBe(first);
    const raster = await first;
    expect(raster).toMatchObject({ width: 512, height: 512 });
    expect(source.preview!.raster).toBe(raster);
    expect(bitmap).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/preview.ktx2", "https://example.test/full.png"]);
    source.close?.();
    source.close?.();
    expect(close).toHaveBeenCalledOnce();
    expect(source.preview!.retainedBytes).toBe(0);
    await expect(source.preview!.load()).rejects.toThrow("abort");
  });

  it("uses the full raster once, including read-ahead, when ASTC is unsupported", async () => {
    const { decoder, fetch } = setup(false);
    const asset = read(), signal = new AbortController().signal;
    decoder.preload(asset, signal);
    const source = await decoder.decode(asset, signal);
    expect(source.preview).toBeUndefined();
    expect(source.kind).toBeUndefined();
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/full.png"]);
    source.close?.();
  });

  it("rejects mismatched full dimensions before bitmap decoding and does not retry", async () => {
    const { decoder, fetch, bitmap } = setup();
    const source = await decoder.decode({ ...read(), rasterPreview: { width: 1024, height: 512 } }, new AbortController().signal);
    await expect(source.preview!.load()).rejects.toThrow("dimensions must match");
    await expect(source.preview!.load()).rejects.toThrow("dimensions must match");
    expect(bitmap).not.toHaveBeenCalled();
    expect(source.preview!.retainedBytes).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    source.close?.();
  });

  it("releases a late bitmap after disposal and clears its reservation", async () => {
    const { decoder, bitmap, close } = setup();
    let finish!: (image: { width: number; height: number; close: typeof close }) => void;
    bitmap.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const source = await decoder.decode(read(), new AbortController().signal);
    const pending = source.preview!.load();
    const rejected = expect(pending).rejects.toThrow("abort");
    await waitFor(() => expect(bitmap).toHaveBeenCalledOnce());
    source.close?.();
    finish({ width: 512, height: 512, close });
    await rejected;
    expect(close).toHaveBeenCalledOnce();
    expect(source.preview!.raster).toBeUndefined();
    expect(source.preview!.retainedBytes).toBe(0);
  });

  it("recovers directly to the full raster when the native preview fails", async () => {
    const { decoder, fetch } = setup();
    fetch.mockImplementation(async uri => uri.endsWith(".ktx2") ? new Response("missing", { status: 404 })
      : new Response(png(), { headers: { "content-type": "image/png" } }));
    const source = await decoder.decode(read(), new AbortController().signal);
    expect(source.preview).toBeUndefined();
    expect(source.width).toBe(512);
    expect(fetch).toHaveBeenCalledTimes(2);
    source.close?.();
  });

  it("keeps the native source after one failed full-source request", async () => {
    const { decoder, fetch } = setup();
    const source = await decoder.decode(read(), new AbortController().signal);
    fetch.mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(source.preview!.load()).rejects.toThrow("404");
    await expect(source.preview!.load()).rejects.toThrow("404");
    expect(source.kind).toBe("ktx2-native");
    expect(source.preview!.retainedBytes).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    source.close?.();
  });

  it("selects full raster read-ahead for retained CPU alpha", () => {
    const { decoder, fetch } = setup();
    decoder.preload(read(), new AbortController().signal, true);
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/full.png"]);
  });

  it("promotes a required AVIF authority without a core source", async () => {
    const document = documentFor();
    const texture = (document.textures as JsonObject[])[0]!;
    delete texture.source;
    document.extensionsRequired = ["EXT_texture_avif"];
    (texture.extensions as JsonObject).EXT_texture_avif = { source: 0 };
    (document.images as JsonObject[])[0] = { uri: "full.avif", mimeType: "image/avif" };
    const { decoder, fetch } = setup();
    const source = await decoder.decode(read(document), new AbortController().signal);
    fetch.mockResolvedValue(new Response(createAvifHeader(512, 512) as Uint8Array<ArrayBuffer>, { headers: { "content-type": "image/avif" } }));
    await source.preview!.load();
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/preview.ktx2", "https://example.test/full.avif"]);
    expect(source.preview!.raster).toMatchObject({ width: 512, height: 512 });
    source.close?.();
  });
});
