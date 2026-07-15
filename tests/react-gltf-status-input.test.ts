import { describe, expect, it } from "vitest";
import { validateGltfAssetStatusInput } from "../packages/react/src/gltf-status";

describe("React glTF status input", () => {
  it("accepts source strings and exact versioned asset identities", () => {
    expect(() => validateGltfAssetStatusInput("/helmet.gltf")).not.toThrow();
    expect(() => validateGltfAssetStatusInput({
      uri: "/helmet.gltf",
      version: "release-2",
    })).not.toThrow();
    expect(() => validateGltfAssetStatusInput({
      uri: "/helmet.gltf",
      version: 2,
    })).not.toThrow();
  });

  it("rejects malformed identities independently of renderer availability", () => {
    expect(() => validateGltfAssetStatusInput(null)).toThrow(/source string or GltfAssetRef object/i);
    expect(() => validateGltfAssetStatusInput(12)).toThrow(/source string or GltfAssetRef object/i);
    expect(() => validateGltfAssetStatusInput("")).toThrow(/source must be a non-empty string/i);
    expect(() => validateGltfAssetStatusInput({ uri: "" })).toThrow(/uri must be a non-empty string/i);
    expect(() => validateGltfAssetStatusInput({
      uri: "/helmet.gltf",
      version: Number.NaN,
    })).toThrow(/version must be a non-empty string or finite number/i);
    expect(() => validateGltfAssetStatusInput({
      uri: "/helmet.gltf",
      version: false,
    })).toThrow(/version must be a non-empty string or finite number/i);
    expect(() => validateGltfAssetStatusInput({
      uri: "/helmet.gltf",
      cacheKey: "helmet",
    })).toThrow(/unsupported field.*cacheKey/i);
    expect(() => validateGltfAssetStatusInput({
      bounds: { max: [1, 1], min: [0, 0, 0] },
      uri: "/helmet.gltf",
    })).toThrow(/bounds max must be an array of exactly 3 numbers/i);
  });
});
