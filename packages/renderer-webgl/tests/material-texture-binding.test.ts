import {
  solidTexture,
  textureAsset,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { lowerMaterialBaseColorBinding } from "../src/material-texture-binding";
import type { TextureAssetLoadResult } from "../src/texture-cache";

describe("lowerMaterialBaseColorBinding", () => {
  it("preserves solid texture identity", () => {
    const source = solidTexture({
      color: [0.2, 0.3, 0.4, 1],
      colorSpace: "linear",
      id: "paint",
      revision: 2,
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toEqual({
      color: [0.2, 0.3, 0.4, 1],
      kind: "solid",
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).not.toHaveBeenCalled();
  });

  it("preserves asset texture identity and load state", () => {
    const source = textureAsset({
      colorSpace: "srgb",
      fallback: solidTexture({ color: [0.1, 0.2, 0.3, 1] }),
      id: "crate-base-color",
      revision: "b",
      sampler: {
        magFilter: "nearest",
        minFilter: "linear-mipmap-linear",
        wrapS: "repeat",
        wrapT: "clamp-to-edge",
      },
      uri: "https://example.test/crate.png",
    });
    const load = {
      kind: "ready",
      texture: {} as WebGLTexture,
    } satisfies TextureAssetLoadResult;
    const onTextureSettled = vi.fn();
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => load),
    };

    const binding = lowerMaterialBaseColorBinding(source, {
      onTextureSettled,
      textureCache,
    });

    expect(binding).toEqual({
      fallbackColor: [0.1, 0.2, 0.3, 1],
      kind: "asset",
      load,
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).toHaveBeenCalledWith(
      source,
      onTextureSettled,
    );
  });

  it("uses white as the asset fallback color when none is declared", () => {
    const source = textureAsset({
      id: "albedo",
      uri: "https://example.test/albedo.png",
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => ({ kind: "loading" } as const)),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toMatchObject({
      fallbackColor: [1, 1, 1, 1],
      kind: "asset",
      source,
    });
  });
});
