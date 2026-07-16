import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGltfImageSourceRecipes,
  decodePreparedGltfImageSourceRecipe,
  gltfImageSourceRecipeBytes,
  prepareGltfImageSourceRecipe,
} from "../packages/renderer-webgl/src/gltf/image-source-recipe";
import { estimateGltfPreparationCpu } from "../packages/renderer-webgl/src/gltf/preparation-admission";
import { gltfImageLoadKey } from "../packages/renderer-webgl/src/gltf/image-keys";
import type { GltfDocument } from "../packages/renderer-webgl/src/gltf/schema";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("transports an external ordinary image to an identified byte recipe before decode", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const bitmap = { close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap;
    const fetchMock = vi.fn(async (_uri: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(bytes, { headers: { "content-type": "image/png; charset=binary" } });
    });
    const createBitmap = vi.fn(async (blob: Blob) => {
      expect(blob.type).toBe("image/png");
      expect(blob.size).toBe(4);
      return bitmap;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", createBitmap);
    const controller = new AbortController();

    const prepared = await prepareGltfImageSourceRecipe({
      key: "external",
      source: { kind: "html-image", uri: "https://example.test/image.png" },
    }, controller.signal);

    expect(prepared.transportBytes).toBe(4);
    expect(prepared.recipe.source).toMatchObject({
      kind: "bitmap-bytes",
      mimeType: "image/png",
    });
    const decoded = await decodePreparedGltfImageSourceRecipe(prepared, controller.signal);
    expect(decoded.image).toBe(bitmap);
    expect(decoded.contentKey).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createBitmap).toHaveBeenCalledOnce();
  });

  it("passes the renderer-negotiated Basis target into the lazy codec", async () => {
    const image = { data: new Uint8Array(16), height: 4, kind: "compressed-texture", levels: [], width: 4 };
    const decodeGltfBasisuTexture = vi.fn(async () => image);
    const prepared = {
      recipe: {
        key: "basis",
        source: {
          bytes: new ArrayBuffer(4),
          codec: Promise.resolve({ decodeGltfBasisuTexture }),
          kind: "basisu-bytes",
          label: "texture.ktx2",
        },
      },
      transportBytes: 0,
    } as unknown as Parameters<typeof decodePreparedGltfImageSourceRecipe>[0];

    const loaded = await decodePreparedGltfImageSourceRecipe(
      prepared,
      new AbortController().signal,
      { basisuTarget: "bc7" },
    );

    expect(loaded.image).toBe(image);
    expect(decodeGltfBasisuTexture).toHaveBeenCalledWith(expect.any(ArrayBuffer), "texture.ktx2", "bc7");
  });
});
