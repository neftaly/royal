import { describe, expect, it } from "vitest";
import {
  createGltfImageSourceRecipes,
  gltfImageSourceRecipeBytes,
} from "../packages/renderer-webgl/src/gltf/image-source-recipe";
import { estimateGltfPreparationCpu } from "../packages/renderer-webgl/src/gltf/preparation-admission";
import { gltfImageLoadKey } from "../packages/renderer-webgl/src/gltf/image-keys";
import type { GltfDocument } from "../packages/renderer-webgl/src/gltf/schema";

describe("glTF image source recipes", () => {
  it("shares one owned data-URI buffer across image kinds and accounts it once", () => {
    const assetKey = "asset";
    const src = "https://example.test/model.gltf";
    const uri = "data:image/png;base64,YQ==";
    const image = { mimeType: "image/png", uri } as const;
    const document: GltfDocument = { images: [image] };
    const keys = new Set(["image", "basisu", "svg"].map((kind) =>
      gltfImageLoadKey(assetKey, src, 0, image, kind as "basisu" | "image" | "svg")!));
    const codec = Promise.resolve({}) as Parameters<typeof createGltfImageSourceRecipes>[5];

    const recipes = createGltfImageSourceRecipes(assetKey, src, document, [], keys, codec);

    expect(recipes).toHaveLength(3);
    const buffers = recipes.map((recipe) => "bytes" in recipe.source ? recipe.source.bytes : undefined);
    expect(buffers.every((buffer) => buffer === buffers[0])).toBe(true);
    expect(gltfImageSourceRecipeBytes(recipes)).toBe(1);
    expect(estimateGltfPreparationCpu(document).assetDecode).toBe(1);
  });

  it("retains only demanded embedded image sources", () => {
    const assetKey = "asset";
    const src = "/model.gltf";
    const document: GltfDocument = {
      bufferViews: [
        { buffer: 0, byteLength: 2 },
        { buffer: 0, byteLength: 3, byteOffset: 2 },
      ],
      buffers: [{ byteLength: 5 }],
      images: [
        { bufferView: 0, mimeType: "image/png" },
        { bufferView: 1, mimeType: "image/png" },
      ],
    };
    const key = gltfImageLoadKey(assetKey, src, 1, document.images![1]!, "image")!;

    const recipes = createGltfImageSourceRecipes(
      assetKey,
      src,
      document,
      [new Uint8Array([1, 2, 3, 4, 5]).buffer],
      new Set([key]),
      undefined,
    );

    expect(recipes).toHaveLength(1);
    expect(gltfImageSourceRecipeBytes(recipes)).toBe(3);
  });
});
