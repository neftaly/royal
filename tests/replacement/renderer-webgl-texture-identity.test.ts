import { imageTexture } from "@royal/renderer-core";
import { expect, it } from "vitest";
import { decodedTextureKey, textureStorageKey, type TextureSourceRef } from "../../packages/renderer-webgl/src/texture/source";
import { automaticVirtualTextureAssetKey } from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";

it("keeps automatic page identity sensitive to nested sampler changes", () => {
  const sampler = { wrapS: "repeat" as "repeat" | "clamp-to-edge" };
  const asset = { ...imageTexture("/one.png"), sampler };
  const first = automaticVirtualTextureAssetKey(asset);
  expect(automaticVirtualTextureAssetKey({ ...asset })).toBe(first);
  sampler.wrapS = "clamp-to-edge";
  expect(automaticVirtualTextureAssetKey(asset)).not.toBe(first);
  const clamped = automaticVirtualTextureAssetKey(asset);
  asset.src = "/two.png";
  expect(automaticVirtualTextureAssetKey(asset)).not.toBe(clamped);
});

it("preserves typed identity and color-space semantics when a previously keyed recipe changes", () => {
  const asset = { ...imageTexture("/one.png"), version: 1 as string | number, colorSpace: "srgb" as "srgb" | "linear" };
  const first = textureStorageKey(asset);
  expect(textureStorageKey({ ...asset })).toBe(first);
  asset.src = "/two.png";
  expect(textureStorageKey(asset)).not.toBe(first);
  const numericVersion = decodedTextureKey(asset);
  asset.version = "1";
  expect(decodedTextureKey(asset)).not.toBe(numericVersion);
  const decoded = decodedTextureKey(asset), storage = textureStorageKey(asset);
  asset.colorSpace = "linear";
  expect(decodedTextureKey(asset)).toBe(decoded);
  expect(textureStorageKey(asset)).not.toBe(storage);
  Object.assign(asset, { sourceEncoding: "invalid" });
  expect(() => textureStorageKey(asset)).toThrow("sourceEncoding");
});

it("revalidates nested ASTC and preview changes after a cache hit", () => {
  const astc = { ...imageTexture("/one.astc"), sourceEncoding: "ktx2-astc" as const };
  const asset = { ...imageTexture("/one.png"), astc, rasterPreview: { width: 64, height: 64 } };
  const first = decodedTextureKey(asset);
  expect(decodedTextureKey(asset)).toBe(first);
  asset.rasterPreview.width = 65;
  expect(decodedTextureKey(asset)).not.toBe(first);
  const preview = decodedTextureKey(asset);
  astc.src = "/two.astc";
  expect(decodedTextureKey(asset)).not.toBe(preview);
  Object.assign(astc, { colorSpace: "linear" });
  expect(() => decodedTextureKey(asset)).toThrow("same-color-space");
});

it("does not conceal a detached embedded source after its identity was cached", () => {
  const bytes = new Uint8Array(4);
  const asset: TextureSourceRef = { kind: "embedded-asset", bytes, contentKey: "pixels", label: "embedded", mimeType: "image/png" };
  expect(decodedTextureKey(asset)).toBe(decodedTextureKey(asset));
  structuredClone(bytes, { transfer: [bytes.buffer] });
  expect(() => decodedTextureKey(asset)).toThrow("bytes must not be empty");
});
