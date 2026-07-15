import { describe, expect, it } from "vitest";
import { imageTexture, virtualTexture } from "@royal/renderer-core";
import { validateTextureAssetRef } from "../packages/react/src/texture-asset-identity";

describe("React texture status input", () => {
  it("accepts exact ordinary and authored virtual texture descriptors", () => {
    expect(() => validateTextureAssetRef(imageTexture("/albedo.png"), "texture"))
      .not.toThrow();
    expect(() => validateTextureAssetRef(virtualTexture({
      manifestUri: "/terrain.vt.json",
      version: "release-2",
    }), "texture")).not.toThrow();
  });

  it("rejects malformed identities independently of renderer availability", () => {
    expect(() => validateTextureAssetRef(null, "texture"))
      .toThrow(/TextureAssetRef or VirtualTextureAssetRef object/i);
    expect(() => validateTextureAssetRef({ kind: "solid" }, "texture"))
      .toThrow(/kind must be "asset" or "virtual-asset"/i);
    expect(() => validateTextureAssetRef({ kind: "asset", uri: "" }, "texture"))
      .toThrow(/src.*non-empty string/i);
    expect(() => validateTextureAssetRef({
      kind: "virtual-asset",
      manifestUri: "/terrain.vt.json",
      version: Number.NaN,
    }, "texture")).toThrow(/version.*finite/i);
    expect(() => validateTextureAssetRef({
      kind: "asset",
      uri: "/albedo.png",
      flipY: false,
    }, "texture")).toThrow(/unsupported field.*flipY/i);
  });
});
