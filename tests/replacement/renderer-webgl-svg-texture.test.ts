import { expect, it } from "vitest";
import { createTextureAssetReader } from "../../packages/renderer-webgl/src/gltf/static-material";
import { decodedTextureKey } from "../../packages/renderer-webgl/src/texture/source";

it("does not share decoded resources with a conflicting MIME declaration", () => {
  const source = { kind: "asset" as const, src: "automerge:artwork", contentKey: "same-bytes" };
  expect(decodedTextureKey({ ...source, mimeType: "image/svg+xml" }))
    .not.toBe(decodedTextureKey({ ...source, mimeType: "image/png" }));
});

it.each(["image/svg+xml", "image/png", "image/jpeg"])("preserves declared %s on opaque external image URIs", mimeType => {
  const asset = createTextureAssetReader({
    images: [{ uri: "automerge:artwork", mimeType }], textures: [{ source: 0 }],
  }, new Uint8Array(), 0, [], "model", "https://example.test/model.gltf", "test")(0, "texture");
  expect(asset).toMatchObject({ kind: "asset", src: "automerge:artwork", gltfResource: true, mimeType });
});

it("accepts ordinary embedded SVG bytes without a texture extension", () => {
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"/>');
  const asset = createTextureAssetReader({
    images: [{ bufferView: 0, mimeType: "image/svg+xml" }], textures: [{ source: 0 }],
  }, bytes, bytes.length, [{ buffer: 0, byteLength: bytes.length }], "model", "model.glb", "test")(0, "texture");
  expect(asset).toMatchObject({ kind: "embedded-asset", bytes, mimeType: "image/svg+xml" });
});

it.each([null, 4, ""])("rejects invalid external image MIME metadata %s", mimeType => {
  const read = createTextureAssetReader({
    images: [{ uri: "artwork", mimeType }], textures: [{ source: 0 }],
  }, new Uint8Array(), 0, [], "model", "model.gltf", "test");
  expect(() => read(0, "texture")).toThrow("must be a non-empty MIME type");
});
