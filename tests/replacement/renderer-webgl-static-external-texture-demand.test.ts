import { describe, expect, it } from "vitest";
import {
  discoverEarlyStaticGltfRoot,
  discoverExternalStaticGltfTextures,
} from "../../packages/renderer-webgl/src/gltf/static-external-texture-demand";
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

  it("discovers the lowest material LOD image before preferred replacements", () => {
    const document = staticTriangleDocument();
    document.extensions = {
      KHR_materials_variants: { variants: [{ name: "alternate" }] },
    };
    document.extensionsRequired = [
      "KHR_materials_unlit",
      "KHR_materials_variants",
      "MSFT_lod",
    ];
    document.extensionsUsed = document.extensionsRequired;
    document.images = [
      { uri: "preferred-a.webp" },
      { uri: "preview-a.webp" },
      { uri: "preferred-b.webp" },
      { uri: "preview-b.webp" },
    ];
    document.textures = [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }];
    document.materials = [{
      extensions: { KHR_materials_unlit: {}, MSFT_lod: { ids: [1] } },
      pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
    }, {
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
    }, {
      extensions: { KHR_materials_unlit: {}, MSFT_lod: { ids: [3] } },
      pbrMetallicRoughness: { baseColorTexture: { index: 2 } },
    }, {
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorTexture: { index: 3 } },
    }];
    document.meshes = [{ primitives: [{
      attributes: { POSITION: 0 },
      extensions: {
        KHR_materials_variants: { mappings: [{ material: 2, variants: [0] }] },
      },
      indices: 1,
      material: 0,
    }] }];

    const claims = discoverExternalStaticGltfTextures(
      glbFromDocument(document, new Uint8Array(44)),
      "lod-priority-root",
      "lod-priority.gltf",
      "/models/lod-priority.gltf",
    );

    expect(claims.textureAssets.map((asset) =>
      asset.kind === "asset" ? asset.src : asset.kind)).toEqual([
      "/models/preview-a.webp",
      "/models/preview-b.webp",
      "/models/preferred-a.webp",
      "/models/preferred-b.webp",
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
    const early = discoverEarlyStaticGltfRoot(
      bytes,
      "shared-root",
      "shared.gltf",
      "/models/shared.gltf",
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
      undefined,
      7,
    );

    expect(early.textureClaims.textureAssets.map(textureStorageKey))
      .toEqual(prepared.textureAssets.map(textureStorageKey));
    expect(early.textureClaims.alphaMaskTextureAssets.map(decodedTextureKey))
      .toEqual(prepared.alphaMaskTextureAssets.map(decodedTextureKey));
    expect(early.geometryTasks?.tasks[0]?.key)
      .toBe(prepared.primitives[0]?.geometry.sourceKey);
  });

  it("derives material-independent exact geometry task identity", () => {
    const root = (
      color: readonly number[],
      version: number,
      configure?: (document: Record<string, unknown>) => void,
    ) => {
      const document = staticTriangleDocument();
      document.buffers = [{ byteLength: 42, uri: "shared.bin" }];
      const materials = document.materials as Array<Record<string, unknown>>;
      materials[0]!.pbrMetallicRoughness = { baseColorFactor: color };
      configure?.(document);
      return discoverEarlyStaticGltfRoot(
        new TextEncoder().encode(JSON.stringify(document)),
        `root-${color[0]}`,
        "shared.gltf",
        "/models/shared.gltf",
        undefined,
        version,
      ).geometryTasks!.tasks[0]!.key;
    };

    expect(root([1, 0, 0, 1], 1)).toBe(root([0, 0, 1, 1], 1));
    expect(root([1, 0, 0, 1], 1)).not.toBe(root([1, 0, 0, 1], 2));
    expect(root([1, 0, 0, 1], 1)).not.toBe(root(
      [1, 0, 0, 1],
      1,
      (document) => {
        document.buffers = [{ byteLength: 43, uri: "shared.bin" }];
      },
    ));
    expect(root([1, 0, 0, 1], 1)).not.toBe(root(
      [1, 0, 0, 1],
      1,
      (document) => {
        document.extensionsRequired = [
          ...(document.extensionsRequired as string[]),
          "KHR_mesh_quantization",
        ];
        document.extensionsUsed = [
          ...(document.extensionsUsed as string[]),
          "KHR_mesh_quantization",
        ];
      },
    ));
  });
});
