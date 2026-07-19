import { describe, expect, it } from "vitest";
import { parseGlb } from "../../packages/renderer-webgl/src/gltf/glb";
import {
  prepareStaticGlb,
  prepareStaticGltfSource,
} from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  glbFromDocument,
  staticInstancedTriangleGlb,
  staticTriangleDocument,
  staticTriangleGlb,
  staticTriangleGltf,
  staticTexturedTriangleGlb,
} from "./support/static-glb";

describe("static glTF preparation core", () => {
  it("loads a JSON glTF external buffer relative to the document", async () => {
    const fixture = staticTriangleGltf();
    const read = async (uri: string): Promise<Uint8Array> => {
      expect(uri).toBe("/models/triangle.bin");
      return fixture.binary;
    };
    const prepared = await prepareStaticGltfSource(
      fixture.document,
      "json-v1",
      "triangle.gltf",
      "/models/triangle.gltf",
      read,
    );
    expect(prepared.primitives).toHaveLength(1);
    expect(prepared.primitives[0]!.geometry.positions).toEqual(new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]));
  });

  it("loads the Draco codec only for a document that declares compressed geometry", async () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_draco_mesh_compression"];
    document.extensionsUsed = ["KHR_draco_mesh_compression"];
    const meshes = document.meshes as Array<{
      primitives: Array<Record<string, unknown>>;
    }>;
    meshes[0]!.primitives[0]!.extensions = {
      KHR_draco_mesh_compression: {
        attributes: { POSITION: 0 },
        bufferView: 0,
      },
    };

    await expect(prepareStaticGltfSource(
      staticTriangleGlb(document),
      "invalid-draco",
      "invalid-draco.glb",
      "/models/invalid-draco.glb",
      async () => new Uint8Array(),
    )).rejects.toThrow("Draco decode failed");
  });

  it("lowers one unlit GLB triangle into the canonical surface ABI", () => {
    const bytes = staticTriangleGlb();
    const prepared = prepareStaticGlb(bytes, "asset:v1", "triangle.glb");
    expect(prepared.primitives).toHaveLength(1);
    const primitive = prepared.primitives[0]!;
    expect(prepared.bounds).toEqual({ max: [2, 3, 0], min: [0, 1, 0] });
    expect(primitive.material).toMatchObject({
      baseColor: [0.2, 0.4, 0.8, 1],
      kind: "unlit",
      requiresTextureCoordinates: false,
    });
    expect(primitive.geometry.key).toBe("asset:v1:mesh:0:primitive:0");
    expect(primitive.geometry.positions).toEqual(new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]));
    expect(primitive.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
    expect(primitive.geometry.positions.buffer).toBe(bytes.buffer);
    expect(primitive.geometry.bounds).toEqual({ max: [1, 1, 0], min: [-1, -1, 0] });
    expect(primitive.localModel.slice(12, 15)).toEqual([1, 2, 0]);
  });

  it("rejects unknown required extensions and out-of-range triangle indices", () => {
    const extensionDocument = staticTriangleDocument();
    extensionDocument.extensionsRequired = ["KHR_future_geometry"];
    expect(() => prepareStaticGlb(staticTriangleGlb(extensionDocument), "future", "future.glb"))
      .toThrow("extensionsRequired[0]: is unsupported");
    expect(() => prepareStaticGlb(staticTriangleGlb(undefined, 3), "bad-index", "bad.glb"))
      .toThrow("vertex index is out of range");
  });

  it("normalizes core opaque metallic-roughness and the implicit glTF material", () => {
    const standard = staticTriangleDocument();
    delete standard.extensionsRequired;
    delete standard.extensionsUsed;
    standard.materials = [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.1, 0.2, 0.3, 0.4],
        metallicFactor: 0.25,
        roughnessFactor: 0.75,
      },
    }];
    expect(prepareStaticGlb(staticTriangleGlb(standard), "standard").primitives[0]!.material)
      .toMatchObject({
        baseColor: [0.1, 0.2, 0.3, 0.4],
        emissiveFactor: [0, 0, 0],
        kind: "standard",
        metallicFactor: 0.25,
        normalScale: 1,
        occlusionStrength: 1,
        requiresTextureCoordinates: false,
        roughnessFactor: 0.75,
      });

    delete standard.materials;
    const meshes = standard.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    delete meshes[0]!.primitives[0]!.material;
    expect(prepareStaticGlb(staticTriangleGlb(standard), "implicit").primitives[0]!.material)
      .toMatchObject({
        baseColor: [1, 1, 1, 1],
        emissiveFactor: [0, 0, 0],
        kind: "standard",
        metallicFactor: 1,
        normalScale: 1,
        occlusionStrength: 1,
        requiresTextureCoordinates: false,
        roughnessFactor: 1,
      });
  });

  it("retains one canonical material identity for primitives sharing an authored material", () => {
    const document = staticTriangleDocument();
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives.push({ ...meshes[0]!.primitives[0] });
    const prepared = prepareStaticGlb(staticTriangleGlb(document), "shared-material");
    expect(prepared.primitives).toHaveLength(2);
    expect(prepared.primitives[1]!.material).toBe(prepared.primitives[0]!.material);
  });

  it("lowers KHR_materials_variants names to canonical material choices", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_materials_variants"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_materials_variants"];
    document.extensions = {
      KHR_materials_variants: {
        variants: [{ name: "Ruby" }, { name: "Emerald" }],
      },
    };
    const materials = document.materials as Array<Record<string, unknown>>;
    materials.push({
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [0.8, 0.02, 0.04, 1] },
    });
    const meshes = document.meshes as Array<{
      primitives: Array<Record<string, unknown>>;
    }>;
    meshes[0]!.primitives[0]!.extensions = {
      KHR_materials_variants: {
        mappings: [{ material: 1, variants: [0, 1] }],
      },
    };

    const primitive = prepareStaticGlb(
      staticTriangleGlb(document),
      "variants-v1",
    ).primitives[0]!;
    expect(primitive.material.baseColor).toEqual([0.2, 0.4, 0.8, 1]);
    expect(primitive.materialVariants?.get("Ruby")?.baseColor)
      .toEqual([0.8, 0.02, 0.04, 1]);
    expect(primitive.materialVariants?.get("Emerald"))
      .toBe(primitive.materialVariants?.get("Ruby"));
  });

  it("batches repeated mesh nodes while preserving their composed transforms", () => {
    const document = staticTriangleDocument();
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes.push({ mesh: 0, translation: [5, 6, 0] });
    const scenes = document.scenes as Array<{ nodes: number[] }>;
    scenes[0]!.nodes.push(nodes.length - 1);
    const prepared = prepareStaticGlb(staticTriangleGlb(document), "repeated-nodes");
    expect(prepared.primitives).toHaveLength(1);
    expect(prepared.primitives[0]!.instanceBatch).toMatchObject({ handedness: 1 });
    const models = prepared.primitives[0]!.instanceBatch!.localModels;
    expect([models[12], models[13], models[28], models[29]]).toEqual([1, 2, 5, 6]);
    expect(prepared.bounds).toEqual({ max: [6, 7, 0], min: [0, 1, 0] });
  });

  it("lowers node MSFT_lod members to one canonical ordered set", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    document.extensionsUsed = ["KHR_materials_unlit", "MSFT_lod"];
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { MSFT_lod: { ids: [2] } };
    nodes[1]!.extras = { MSFT_screencoverage: [0.6, 0.02] };
    nodes.push({ mesh: 0, translation: [0, 2, -1] });

    const prepared = prepareStaticGlb(staticTriangleGlb(document), "lod-v1");
    expect(prepared.primitives).toHaveLength(2);
    expect(prepared.primitives.map((primitive) => primitive.lods)).toEqual([
      [{ group: "lod-v1:node:1:lod", level: 0, thresholds: [0.6, 0.02] }],
      [{ group: "lod-v1:node:1:lod", level: 1, thresholds: [0.6, 0.02] }],
    ]);
    expect(prepared.primitives[0]!.localModel.slice(12, 15)).toEqual([1, 2, 0]);
    expect(prepared.primitives[1]!.localModel.slice(12, 15)).toEqual([1, 2, -1]);
  });

  it("lowers material MSFT_lod levels, including levels selected through variants", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = [
      "KHR_materials_unlit",
      "KHR_materials_variants",
      "MSFT_lod",
    ];
    document.extensions = {
      KHR_materials_variants: { variants: [{ name: "Ruby" }] },
    };
    const materials = document.materials as Array<Record<string, unknown>>;
    materials.push({
      extensions: { KHR_materials_unlit: {}, MSFT_lod: { ids: [2] } },
      extras: { MSFT_screencoverage: [0.4, 0] },
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.02, 0.03, 1] },
    }, {
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [0.3, 0.01, 0.02, 1] },
    });
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives[0]!.extensions = {
      KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] },
    };

    const primitive = prepareStaticGlb(staticTriangleGlb(document), "material-lod").primitives[0]!;
    expect(primitive.materialVariantLods?.get("Ruby")?.thresholds).toEqual([0.4, 0]);
    expect(primitive.materialVariantLods?.get("Ruby")?.levels.map((level) => level.baseColor))
      .toEqual([[0.9, 0.02, 0.03, 1], [0.3, 0.01, 0.02, 1]]);
  });

  it("rejects child and MSFT_lod cycles before publishing partial geometry", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { MSFT_lod: { ids: [0] } };
    expect(() => prepareStaticGlb(staticTriangleGlb(document), "lod-cycle"))
      .toThrow("child/MSFT_lod cycle");
  });

  it("lowers reachable KHR_lights_punctual nodes without a separate runtime path", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_lights_punctual"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_lights_punctual"];
    document.extensions = {
      KHR_lights_punctual: {
        lights: [{
          color: [0.5, 0.75, 1],
          intensity: 12,
          range: 8,
          spot: { innerConeAngle: 0.2, outerConeAngle: 0.5 },
          type: "spot",
        }],
      },
    };
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { KHR_lights_punctual: { light: 0 } };
    const prepared = prepareStaticGlb(staticTriangleGlb(document), "punctual-v1");
    expect(prepared.lights).toEqual([{
      color: [0.5, 0.75, 1],
      innerConeAngle: 0.2,
      intensity: 12,
      kind: "spot",
      localModel: expect.arrayContaining([1, 2, 0, 1]),
      outerConeAngle: 0.5,
      range: 8,
    }]);
    expect(prepared.lights[0]!.localModel.slice(12, 15)).toEqual([1, 2, 0]);
  });

  it("preserves alpha-mask and double-sided raster intent", () => {
    const document = staticTriangleDocument();
    const materials = document.materials as Array<Record<string, unknown>>;
    materials[0] = {
      alphaCutoff: 0.25,
      alphaMode: "MASK",
      doubleSided: true,
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 0.4] },
    };
    expect(prepareStaticGlb(staticTriangleGlb(document), "masked").primitives[0]!.material)
      .toMatchObject({
        alphaCutoff: 0.25,
        baseColor: [1, 0.5, 0.25, 0.4],
        doubleSided: true,
        kind: "unlit",
        requiresTextureCoordinates: false,
      });
  });

  it("lowers alpha blending into the shared surface presentation contract", () => {
    const document = staticTriangleDocument();
    const materials = document.materials as Array<Record<string, unknown>>;
    materials[0] = {
      alphaMode: "BLEND",
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 0.4] },
    };
    expect(prepareStaticGlb(staticTriangleGlb(document), "blended").primitives[0]!.material)
      .toMatchObject({
        alphaBlend: true,
        baseColor: [1, 0.5, 0.25, 0.4],
        kind: "unlit",
      });
  });

  it("lowers external base color images to the shared ordinary texture contract", () => {
    const prepared = prepareStaticGlb(
      staticTexturedTriangleGlb(),
      "asset-v2",
      "textured.glb",
      "/models/textured.glb",
    );
    expect(prepared.textureAssets).toEqual([{
      colorSpace: "srgb",
      contentKey: "asset-v2:external:/models/albedo.png",
      kind: "asset",
      sampler: {
        magFilter: "linear",
        minFilter: "linear-mipmap-linear",
        wrapS: "repeat",
        wrapT: "repeat",
      },
      src: "/models/albedo.png",
    }]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      baseColor: [0.25, 0.5, 1, 1],
      baseColorAsset: prepared.textureAssets[0],
      requiresTextureCoordinates: true,
    });
  });

  it("lowers KHR_texture_transform and TEXCOORD_1 without a second texture path", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "transformed.glb");
    const document = parsed.document as Record<string, unknown>;
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_texture_transform"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_texture_transform"];
    const materials = document.materials as Array<{
      pbrMetallicRoughness: { baseColorTexture: Record<string, unknown> };
    }>;
    materials[0]!.pbrMetallicRoughness.baseColorTexture = {
      extensions: {
        KHR_texture_transform: {
          offset: [0.25, 0.5],
          scale: [2, 3],
          texCoord: 1,
        },
      },
      index: 0,
    };
    const meshes = document.meshes as Array<{
      primitives: Array<{ attributes: Record<string, unknown> }>;
    }>;
    meshes[0]!.primitives[0]!.attributes.TEXCOORD_1 = 2;
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "transformed-v1",
      "transformed.glb",
    );
    expect(prepared.primitives[0]!.geometry.textureCoordinates1).toEqual(
      prepared.primitives[0]!.geometry.textureCoordinates0,
    );
    expect(prepared.primitives[0]!.material.baseColorTextureCoordinates).toEqual({
      row0: [2, 0, 0.25, 1],
      row1: [0, 3, 0.5, 0],
    });
    expect(prepared.textureAssets).toHaveLength(1);
  });

  it("does not prepare or reject textures unreachable from the selected scene", () => {
    const document = staticTriangleDocument();
    document.images = [{ bufferView: 99, mimeType: "image/png" }];
    document.textures = [{ source: 0 }];
    const prepared = prepareStaticGlb(staticTriangleGlb(document), "unused", "unused.glb");
    expect(prepared.textureAssets).toEqual([]);
  });

  it("borrows reachable embedded image bytes as another cold source recipe", () => {
    const image = new Uint8Array([137, 80, 78, 71]);
    const prepared = prepareStaticGlb(
      staticTexturedTriangleGlb(image),
      "embedded-v1",
      "embedded.glb",
    );
    const source = prepared.textureAssets[0]!;
    expect(source).toMatchObject({
      contentKey: "embedded-v1:bufferView:3",
      kind: "embedded-asset",
      label: "embedded.glb images[0]",
      mimeType: "image/png",
    });
    if (source.kind === "embedded-asset") {
      expect(source.bytes).toEqual(image);
      expect(source.bytes.buffer).toBe(prepared.primitives[0]!.geometry.positions.buffer);
    }
  });

  it("preserves data image URIs without applying container-relative resolution", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    const prepared = prepareStaticGlb(
      staticTexturedTriangleGlb(undefined, uri),
      "data-image",
      "/models/data.glb",
      "/models/data.glb",
    );
    expect(prepared.textureAssets[0]).toMatchObject({ kind: "asset", src: uri });
  });

  it("selects EXT_texture_avif sources through the ordinary texture lifecycle", () => {
    const external = prepareStaticGlb(
      staticTexturedTriangleGlb(undefined, "albedo.avif", "avif"),
      "avif-external",
      "/models/asset.glb",
      "/models/asset.glb",
    );
    expect(external.textureAssets[0]).toMatchObject({
      kind: "asset",
      src: "/models/albedo.avif",
    });

    const embedded = prepareStaticGlb(
      staticTexturedTriangleGlb(new Uint8Array([0, 0, 0, 1]), "unused", "avif"),
      "avif-embedded",
      "embedded.glb",
    );
    expect(embedded.textureAssets[0]).toMatchObject({
      kind: "embedded-asset",
      mimeType: "image/avif",
    });
  });

  it("selects EXT_texture_webp through the same ordinary texture lifecycle", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "webp.glb");
    const document = parsed.document as Record<string, unknown>;
    document.extensionsRequired = ["KHR_materials_unlit", "EXT_texture_webp"];
    document.extensionsUsed = ["KHR_materials_unlit", "EXT_texture_webp"];
    document.images = [{ uri: "albedo.webp" }];
    document.textures = [{ extensions: { EXT_texture_webp: { source: 0 } } }];
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "webp-v1",
      "webp.glb",
      "/models/webp.glb",
    );
    expect(prepared.textureAssets).toMatchObject([{
      kind: "asset",
      src: "/models/albedo.webp",
    }]);
  });

  it("converges core material texture channels on color-space-aware source recipes", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "material.glb");
    const document = parsed.document as Record<string, unknown>;
    document.images = [
      { uri: "base.png" },
      { uri: "shared-data.png" },
      { uri: "shared-data.png" },
      { uri: "emissive.png" },
    ];
    document.textures = [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }];
    document.materials = [{
      emissiveFactor: [0.25, 0.5, 1],
      emissiveTexture: { index: 3 },
      normalTexture: { index: 1, scale: 0.75 },
      occlusionTexture: { index: 2, strength: 0.4 },
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0.2,
        metallicRoughnessTexture: { index: 2 },
        roughnessFactor: 0.6,
      },
    }];
    delete document.extensionsRequired;
    delete document.extensionsUsed;
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "material-v1",
      "material.glb",
      "/models/material.glb",
    );
    expect(prepared.textureAssets.map((asset) => [asset.colorSpace, asset.kind === "asset"
      ? asset.src
      : asset.label])).toEqual([
      ["srgb", "/models/base.png"],
      ["srgb", "/models/emissive.png"],
      ["linear", "/models/shared-data.png"],
    ]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      emissiveFactor: [0.25, 0.5, 1],
      metallicFactor: 0.2,
      normalScale: 0.75,
      occlusionStrength: 0.4,
      requiresTextureCoordinates: true,
      roughnessFactor: 0.6,
    });
    const material = prepared.primitives[0]!.material;
    if (material.kind === "standard") {
      expect(material.normalAsset?.contentKey).toBe(material.metallicRoughnessAsset?.contentKey);
    }
  });

  it("schedules authored occlusion through the ordinary texture lifecycle", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "occlusion.glb");
    const document = parsed.document as Record<string, unknown>;
    document.images = [{ uri: "ao.png" }];
    document.textures = [{ source: 0 }];
    document.materials = [{ occlusionTexture: { index: 0, strength: 0.4 } }];
    delete document.extensionsRequired;
    delete document.extensionsUsed;
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "occlusion-v1",
      "occlusion.glb",
      "/models/occlusion.glb",
    );
    expect(prepared.textureAssets).toMatchObject([{
      colorSpace: "linear",
      kind: "asset",
      src: "/models/ao.png",
    }]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      occlusionAsset: { kind: "asset", src: "/models/ao.png" },
      occlusionStrength: 0.4,
    });
  });

  it("lowers EXT_mesh_gpu_instancing accessors into one compact draw batch", async () => {
    const prepared = await prepareStaticGltfSource(
      staticInstancedTriangleGlb(),
      "instances-v1",
      "instances.glb",
      "/models/instances.glb",
      async () => new Uint8Array(),
    );
    expect(prepared.primitives).toHaveLength(1);
    expect(prepared.bounds).toEqual({ max: [12, 4, 0], min: [-11, 0, 0] });
    expect(prepared.primitives[0]!.instanceBatch).toMatchObject({
      handedness: 1,
      key: "instances-v1:node:1:instances:0",
    });
    const models = prepared.primitives[0]!.instanceBatch!.localModels;
    expect(models.length).toBe(32);
    expect([models[12], models[13], models[14], models[28], models[29], models[30]])
      .toEqual([11, 2, 0, -9, 2, 0]);
  });

  it("borrows validated normal and primary-UV streams into the canonical ABI", () => {
    const document = staticTriangleDocument();
    document.accessors = [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC2" },
    ];
    document.bufferViews = [
      { buffer: 0, byteLength: 36, byteOffset: 0 },
      { buffer: 0, byteLength: 6, byteOffset: 36 },
      { buffer: 0, byteLength: 36, byteOffset: 44 },
      { buffer: 0, byteLength: 24, byteOffset: 80 },
    ];
    document.buffers = [{ byteLength: 104 }];
    document.meshes = [{ primitives: [{
      attributes: { NORMAL: 2, POSITION: 0, TEXCOORD_0: 3 },
      indices: 1,
      material: 0,
    }] }];
    const binary = new Uint8Array(104);
    new Float32Array(binary.buffer, 0, 9).set([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]);
    new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
    new Float32Array(binary.buffer, 44, 9).set([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    new Float32Array(binary.buffer, 80, 6).set([0, 0, 1, 0, 0.5, 1]);
    const bytes = glbFromDocument(document, binary);

    const geometry = prepareStaticGlb(bytes, "attributes:v1").primitives[0]!.geometry;
    expect(geometry.normals).toEqual(new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]));
    expect(geometry.textureCoordinates0).toEqual(new Float32Array([0, 0, 1, 0, 0.5, 1]));
    expect(geometry.normals?.buffer).toBe(bytes.buffer);
    expect(geometry.textureCoordinates0?.buffer).toBe(bytes.buffer);
  });

  it("ignores unconsumed vertex streams but rejects mismatched consumed streams", () => {
    const extended = staticTriangleDocument();
    const meshes = extended.meshes as Array<{ primitives: Array<{ attributes: object }> }>;
    meshes[0]!.primitives[0]!.attributes = { COLOR_0: 0, POSITION: 0, TEXCOORD_1: 0 };
    expect(prepareStaticGlb(staticTriangleGlb(extended), "extended").primitives)
      .toHaveLength(1);

    const mismatched = staticTriangleDocument();
    mismatched.accessors = [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 0, componentType: 5126, count: 2, type: "VEC3" },
    ];
    const mismatchedMeshes = mismatched.meshes as Array<{
      primitives: Array<{ attributes: object }>;
    }>;
    mismatchedMeshes[0]!.primitives[0]!.attributes = { NORMAL: 2, POSITION: 0 };
    expect(() => prepareStaticGlb(staticTriangleGlb(mismatched), "mismatched"))
      .toThrow("attributes.NORMAL: count must match POSITION");
  });

  it("renders static animation poses but rejects texture and hierarchy ambiguity explicitly", () => {
    const textured = staticTriangleDocument();
    const materials = textured.materials as Array<Record<string, unknown>>;
    materials[0]!.pbrMetallicRoughness = { baseColorTexture: { index: 0 } };
    expect(() => prepareStaticGlb(staticTriangleGlb(textured), "textured", "textured.glb"))
      .toThrow("baseColorTexture.index: index 0 is out of range");

    const animated = staticTriangleDocument();
    animated.animations = [{}];
    expect(prepareStaticGlb(
      staticTriangleGlb(animated),
      "animated",
      "animated.glb",
    ).primitives).toHaveLength(1);

    const shared = staticTriangleDocument();
    shared.scenes = [{ nodes: [0, 1] }];
    expect(() => prepareStaticGlb(staticTriangleGlb(shared), "shared", "shared.glb"))
      .toThrow("is cyclic or has multiple parents");
  });
});
