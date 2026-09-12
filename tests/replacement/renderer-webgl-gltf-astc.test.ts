import { afterEach, describe, expect, it, vi } from "vitest";
import { preparedStaticGltfTransferBuffers } from "../../packages/renderer-webgl/src/gltf/static-transfer";
import type { PreparedStaticGltf } from "../../packages/renderer-webgl/src/gltf/static-asset";
import { createTextureAssetReader } from "../../packages/renderer-webgl/src/gltf/static-material";
import { createStaticPrimitiveImageDemand } from "../../packages/renderer-webgl/src/gltf/static-image-demand";
import { discoverExternalStaticGltfTextures } from "../../packages/renderer-webgl/src/gltf/static-external-texture-demand";
import { validateRequiredExtensionProfile } from "../../packages/renderer-webgl/src/gltf/required-extension-profile";
import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { decodedTextureKey } from "../../packages/renderer-webgl/src/texture/source";
import { parseKtx2Native } from "../../packages/renderer-webgl/src/texture/ktx2-native";
import type { JsonObject } from "../../packages/renderer-webgl/src/gltf/gltf-values";
import { fakeGl } from "./support/canvas-root-harness";
import { createKtx2Fixture } from "./support/ktx2-fixture";

const documentFor = (svg = true): JsonObject => ({
  asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ material: 0, attributes: {} }] }],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  extensionsUsed: ["EXT_texture_astc", ...(svg ? ["GS_texture_svg"] : [])],
  images: [{ uri: "preview.png" }, { uri: "detail.svg" }, { uri: "native", mimeType: "image/ktx2" }],
  textures: [{ source: 0, extensions: { EXT_texture_astc: { source: 2 }, ...(svg ? { GS_texture_svg: { source: 1 } } : {}) } }],
});
const read = (document: JsonObject) => createTextureAssetReader(
  document, new Uint8Array(), 0, [], "test", "https://example.test/model.gltf", "test",
)(0, "textures[0]", "srgb", true);
const setup = (supported: boolean, vk = 166) => {
  const gl = fakeGl();
  Object.assign(gl, { getExtension: vi.fn(() => supported ? { getSupportedProfiles: () => ["ldr"] } : null) });
  const bytes = createKtx2Fixture(vk, 128, 128, 8);
  const fetch = vi.fn(async (uri: string) => new Response(
    uri.endsWith("native") ? bytes as Uint8Array<ArrayBuffer> : "png",
    { headers: { "content-type": uri.endsWith("native") ? "image/ktx2" : "image/png" } },
  ));
  vi.stubGlobal("fetch", fetch);
  const bitmap = vi.fn(async () => ({ width: 128, height: 128, close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", bitmap);
  return { gl, bytes, fetch, bitmap, decoder: createBrowserTextureDecoder(1, true, undefined, undefined, undefined, gl) };
};
afterEach(() => vi.unstubAllGlobals());

describe("glTF ASTC alternatives", () => {
  it.each([166, 172])("requests only ASTC %i for an SVG preview, including read-ahead", async (vk) => {
    const { decoder, fetch, bitmap } = setup(true, vk);
    const asset = read(documentFor());
    const signal = new AbortController().signal;
    decoder.preload(asset, signal);
    const source = await decoder.decode(asset, signal);
    expect(source).toMatchObject({ kind: "ktx2-native", svgPreview: { load: expect.any(Function) } });
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/native"]);
    expect(bitmap).not.toHaveBeenCalled();
    source.close?.();
    await expect(source.svgPreview!.load()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([false, true])("requests only PNG when ASTC is unavailable (SVG: %s)", async (svg) => {
    const { decoder, fetch, bitmap } = setup(false);
    const asset = read(documentFor(svg));
    const signal = new AbortController().signal;
    decoder.preload(asset, signal);
    const source = await decoder.decode(asset, signal);
    expect(source.kind).toBeUndefined();
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/preview.png"]);
    expect(bitmap).toHaveBeenCalledTimes(svg ? 2 : 1);
    expect(source.svgPreview !== undefined).toBe(svg);
    source.close?.();
  });

  it("selects PNG before read-ahead for retained alpha", () => {
    const { decoder, fetch } = setup(true);
    decoder.preload(read(documentFor()), new AbortController().signal, true);
    expect(fetch.mock.calls.map(([uri]) => uri)).toEqual(["https://example.test/preview.png"]);
  });

  it("selects standalone ASTC and keeps early/worker texture identities identical", async () => {
    const { decoder, fetch } = setup(true);
    for (const svg of [true, false]) {
      const document = documentFor(svg);
      const early = discoverExternalStaticGltfTextures(new TextEncoder().encode(JSON.stringify(document)),
        "test", "test", "https://example.test/model.gltf");
      expect(early.textureAssets).toHaveLength(1);
      expect(decodedTextureKey(early.textureAssets[0]!)).toBe(decodedTextureKey(read(document)));
      const claims: number[] = [];
      createStaticPrimitiveImageDemand(document, "test", (index) => claims.push(index))({ material: 0 }, "primitive");
      expect(new Set(claims)).toEqual(new Set(svg ? [0, 1, 2] : [0, 2]));
    }
    const source = await decoder.decode(read(documentFor(false)), new AbortController().signal);
    expect(source.kind).toBe("ktx2-native");
    expect(source.svgPreview).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    source.close?.();
  });

  it("preserves embedded native bytes and suppresses premature external discovery", () => {
    const document = documentFor();
    const bytes = createKtx2Fixture(166, 4, 4, 3);
    (document.images as JsonObject[])[2] = { bufferView: 0, mimeType: "image/ktx2" };
    document.bufferViews = [{ buffer: 0, byteLength: bytes.length }];
    const asset = createTextureAssetReader(document, bytes, bytes.length, document.bufferViews as JsonObject[],
      "test", "https://example.test/model.gltf", "test")(0, "texture", "srgb", true);
    const native = asset.fallback!.astc!;
    expect(native.kind).toBe("embedded-asset");
    if (native.kind !== "embedded-asset") throw new Error("missing native bytes");
    expect(native.bytes.buffer).toBe(bytes.buffer);
    const transfers = preparedStaticGltfTransferBuffers({ primitives: [], textureAssets: [asset] } as unknown as PreparedStaticGltf);
    expect(transfers).toEqual([bytes.buffer]);
    const copy = structuredClone(asset, { transfer: transfers });
    expect(bytes.byteLength).toBe(0);
    expect(copy.fallback!.astc!.kind === "embedded-asset" && copy.fallback!.astc!.bytes.byteLength).toBeGreaterThan(0);
    expect(discoverExternalStaticGltfTextures(new TextEncoder().encode(JSON.stringify(document)),
      "test", "test", "https://example.test/model.gltf").textureAssets).toEqual([]);
  });

  it("enforces optional fallback, MIME, declaration and placement rules", () => {
    const document = documentFor(false);
    const texture = (document.textures as JsonObject[])[0]!;
    delete texture.source;
    expect(() => read(document)).toThrow("required when EXT_texture_astc is optional");
    document.extensionsRequired = ["EXT_texture_astc"];
    expect(read(document).sourceEncoding).toBe("ktx2-astc");
    expect(() => validateRequiredExtensionProfile(document, ["EXT_texture_astc"], ["EXT_texture_astc"], "test", false, false)).not.toThrow();
    (document.images as JsonObject[])[2]!.mimeType = "image/png";
    expect(() => read(document)).toThrow("must be image/ktx2");
    document.extensions = { EXT_texture_astc: { source: 0 } };
    expect(() => validateRequiredExtensionProfile(document, [], ["EXT_texture_astc"], "test", false, false)).toThrow("placement");
  });

  it("skips transport for required unsupported ASTC", async () => {
    const { decoder, fetch } = setup(false);
    const document = documentFor(false);
    document.extensionsRequired = ["EXT_texture_astc"];
    const asset = read(document);
    decoder.preload(asset, new AbortController().signal);
    await expect(decoder.decode(asset, new AbortController().signal)).rejects.toThrow("native LDR support");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits for restoration before selecting an alternative and cancels without fetching", async () => {
    const { gl, decoder, fetch } = setup(true);
    let lost = true;
    const canvas = new EventTarget();
    Object.assign(gl, { canvas, isContextLost: () => lost });
    const asset = read(documentFor(false));
    const cancel = new AbortController();
    decoder.preload(asset, cancel.signal);
    const aborted = decoder.decode(asset, cancel.signal);
    cancel.abort();
    await expect(aborted).rejects.toThrow("abort");
    expect(fetch).not.toHaveBeenCalled();
    const pending = decoder.decode(asset, new AbortController().signal);
    expect(fetch).not.toHaveBeenCalled();
    lost = false;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    const source = await pending;
    expect(source.kind).toBe("ktx2-native");
    source.close?.();
  });

  it("validates extension-specific ASTC primaries, channel, format and mip coverage", async () => {
    const { decoder, bytes } = setup(true);
    const dfd = new DataView(bytes.buffer).getUint32(48, true);
    bytes[dfd + 13] = 0;
    expect(() => parseKtx2Native(bytes, true)).toThrow("primaries");
    bytes[dfd + 13] = 1;
    bytes[dfd + 31] = 3;
    expect(() => parseKtx2Native(bytes, true)).toThrow("channel");
    expect(() => parseKtx2Native(createKtx2Fixture(152), true)).toThrow("ASTC LDR");
    await expect(decoder.decode({ kind: "embedded-asset", contentKey: "mips", label: "mips",
      mimeType: "image/ktx2", sourceEncoding: "ktx2-astc", bytes: createKtx2Fixture(166, 128, 128),
    }, new AbortController().signal)).rejects.toThrow("full mip pyramid");
  });
});
