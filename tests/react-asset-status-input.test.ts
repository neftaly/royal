import { describe, expect, it } from "vitest";
import { imageTexture, virtualTexture } from "@royal/renderer-core";
import { validateGltfAssetStatusInput } from "../packages/react/src/gltf-status";
import { validateTextureAssetRef } from "../packages/react/src/texture-asset-identity";

describe("React glTF status input", () => {
  it("accepts source strings and exact versioned asset identities", () => {
    expect(() => validateGltfAssetStatusInput("/helmet.gltf")).not.toThrow();
    expect(() => validateGltfAssetStatusInput({
      src: "/helmet.gltf",
      version: "release-2",
    })).not.toThrow();
    expect(() => validateGltfAssetStatusInput({
      src: "/helmet.gltf",
      version: 2,
    })).not.toThrow();
  });

  it("rejects malformed identities independently of renderer availability", () => {
    expect(() => validateGltfAssetStatusInput(null)).toThrow(/source string or GltfAssetRef object/i);
    expect(() => validateGltfAssetStatusInput(12)).toThrow(/source string or GltfAssetRef object/i);
    expect(() => validateGltfAssetStatusInput("")).toThrow(/source must be a non-empty string/i);
    expect(() => validateGltfAssetStatusInput({ src: "" })).toThrow(/src must be a non-empty string/i);
    expect(() => validateGltfAssetStatusInput({
      src: "/helmet.gltf",
      version: Number.NaN,
    })).toThrow(/version must be a non-empty string or finite number/i);
    expect(() => validateGltfAssetStatusInput({
      src: "/helmet.gltf",
      version: false,
    })).toThrow(/version must be a non-empty string or finite number/i);
    expect(() => validateGltfAssetStatusInput({
      src: "/helmet.gltf",
      cacheKey: "helmet",
    })).toThrow(/unsupported field.*cacheKey/i);
    expect(() => validateGltfAssetStatusInput({
      bounds: { max: [1, 1], min: [0, 0, 0] },
      src: "/helmet.gltf",
    })).toThrow(/bounds max must be an array of exactly 3 numbers/i);
  });
});

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
    expect(() => validateTextureAssetRef({ kind: "asset", src: "" }, "texture"))
      .toThrow(/src.*non-empty string/i);
    expect(() => validateTextureAssetRef({
      kind: "virtual-asset",
      manifestUri: "/terrain.vt.json",
      version: Number.NaN,
    }, "texture")).toThrow(/version.*finite/i);
    expect(() => validateTextureAssetRef({
      kind: "asset",
      src: "/albedo.png",
      flipY: false,
    }, "texture")).toThrow(/unsupported field.*flipY/i);
  });
});
