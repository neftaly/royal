import { describe, expect, it } from "vitest";
import { discoverExternalStaticGltfTextures } from "../../packages/renderer-webgl/src/gltf/static-external-texture-demand";
import { prepareStaticGltfSource } from "../../packages/renderer-webgl/src/gltf/static-asset";
import { parseGlb } from "../../packages/renderer-webgl/src/gltf/glb";
import {
  decodedTextureKey,
  textureStorageKey,
} from "../../packages/renderer-webgl/src/texture/source";
import {
  glbFromDocument,
  staticTexturedTriangleGlb,
  staticTriangleDocument,
} from "./support/static-glb";

describe("early static external texture demand", () => {
  it("discovers exact external MASK claims without geometry preparation", () => {
    const claims = discoverExternalStaticGltfTextures(
      staticTexturedTriangleGlb(undefined, "counter.avif", (document) => {
        const materials = document.materials as Array<Record<string, unknown>>;
        materials[0]!.alphaMode = "MASK";
      }),
      "counter-root",
      "counter.gltf",
      "/models/counter.gltf",
      true,
      undefined,
      "release-2",
    );

    expect(claims.textureAssets).toHaveLength(1);
    expect(claims.textureAssets[0]).toMatchObject({
      colorSpace: "srgb",
      gltfResource: true,
      kind: "asset",
      src: "/models/counter.avif",
      version: "release-2",
    });
    expect(claims.alphaMaskTextureAssets).toEqual(claims.textureAssets);
  });

  it("leaves embedded image demand for canonical buffer preparation", () => {
    const claims = discoverExternalStaticGltfTextures(
      staticTexturedTriangleGlb(new Uint8Array([137, 80, 78, 71])),
      "embedded-root",
      "embedded.glb",
      "/models/embedded.glb",
    );
    expect(claims).toEqual({
      alphaMaskTextureAssets: [],
      textureAssets: [],
    });
  });

  it("orders visible color before detail across independent materials", () => {
    const document = staticTriangleDocument();
    document.images = [{ uri: "detail.avif" }, { uri: "color.avif" }];
    document.textures = [{ source: 0 }, { source: 1 }];
    document.materials = [
      { normalTexture: { index: 0 } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
    ];
    document.meshes = [{
      primitives: [
        { attributes: { POSITION: 0 }, indices: 1, material: 0 },
        { attributes: { POSITION: 0 }, indices: 1, material: 1 },
      ],
    }];

    const claims = discoverExternalStaticGltfTextures(
      glbFromDocument(document, new Uint8Array(44)),
      "priority-root",
      "priority.gltf",
      "/models/priority.gltf",
    );

    expect(claims.textureAssets.map((asset) =>
      asset.kind === "asset" ? asset.src : asset.kind)).toEqual([
      "/models/color.avif",
      "/models/detail.avif",
    ]);
  });

  it("converges on the canonical prepared texture identities", async () => {
    const parsed = parseGlb(
      staticTexturedTriangleGlb(undefined, "shared.avif", (document) => {
        const materials = document.materials as Array<Record<string, unknown>>;
        materials[0]!.alphaMode = "MASK";
      }),
      "shared-texture-fixture",
    );
    const document = parsed.document as Record<string, unknown>;
    document.buffers = [{ byteLength: 68, uri: "geometry.bin" }];
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const early = discoverExternalStaticGltfTextures(
      bytes,
      "shared-root",
      "shared.gltf",
      "/models/shared.gltf",
      true,
      undefined,
      7,
    );
    const prepared = await prepareStaticGltfSource(
      bytes,
      "shared-root",
      "shared.gltf",
      "/models/shared.gltf",
      async () => parsed.binaryChunk!.subarray(0, 68),
      undefined,
      true,
      undefined,
      7,
    );

    expect(early.textureAssets.map(textureStorageKey))
      .toEqual(prepared.textureAssets.map(textureStorageKey));
    expect(early.alphaMaskTextureAssets.map(decodedTextureKey))
      .toEqual(prepared.alphaMaskTextureAssets.map(decodedTextureKey));
  });
});
