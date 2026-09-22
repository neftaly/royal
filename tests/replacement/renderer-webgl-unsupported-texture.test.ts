import { expect, it } from "vitest";
import { createTextureAssetReader } from "../../packages/renderer-webgl/src/gltf/static-material";
import { validateRequiredExtensionProfile } from "../../packages/renderer-webgl/src/gltf/required-extension-profile";
import type { JsonObject } from "../../packages/renderer-webgl/src/gltf/gltf-values";

it("ignores optional GS_texture_svg payloads and rejects required use", () => {
  const document: JsonObject = {
    asset: { version: "2.0" }, extensionsUsed: ["GS_texture_svg"],
    images: [{ uri: "raster.png" }],
    textures: [{ source: 0, extensions: { GS_texture_svg: { source: "invalid and opaque" } } }],
  };
  expect(() => validateRequiredExtensionProfile(document, document.extensionsRequired as string[] ?? [], ["GS_texture_svg"], "test", false, false)).not.toThrow();
  const asset = createTextureAssetReader(document, new Uint8Array(), 0, [], "test", "https://example.test/model.gltf", "test")(0, "texture");
  expect(asset).toMatchObject({ kind: "asset", src: "https://example.test/raster.png" });
  document.extensionsRequired = ["GS_texture_svg"];
  expect(() => validateRequiredExtensionProfile(document, document.extensionsRequired as string[] ?? [], ["GS_texture_svg"], "test", false, false)).toThrow("GS_texture_svg");
});
