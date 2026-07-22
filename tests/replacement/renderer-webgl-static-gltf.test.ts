import { describe, expect, it, vi } from "vitest";
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
import { createKtx2Etc2Fixture } from "./support/ktx2-etc2-fixture";
import { decodedTextureKey } from "../../packages/renderer-webgl/src/texture/asset-owner";

describe("static glTF preparation core", () => {
  const requireExtensions = (
    document: Record<string, unknown>,
    ...extensions: string[]
  ): void => {
    const declarations = ["KHR_materials_unlit", ...extensions];
    document.extensionsRequired = declarations;
    document.extensionsUsed = declarations;
  };

  it("prepares an explicit document scene through the same canonical lowering path", () => {
    const document = staticTriangleDocument();
    document.scenes = [{ name: "Complete", nodes: [0] }, { nodes: [1] }];
    const bytes = staticTriangleGlb(document);

    const defaultScene = prepareStaticGlb(bytes, "scene-default");
    const secondScene = prepareStaticGlb(
      bytes,
      "scene-second",
      "two-scenes.glb",
      "two-scenes.glb",
      true,
      1,
    );

    expect(defaultScene.bounds).toEqual({ max: [2, 3, 0], min: [0, 1, 0] });
    expect(defaultScene.sceneIndex).toBe(0);
    expect(defaultScene.scenes).toEqual([
      { index: 0, name: "Complete" },
      { index: 1 },
    ]);
    expect(secondScene.bounds).toEqual({ max: [1, 3, 0], min: [-1, 1, 0] });
    expect(secondScene.sceneIndex).toBe(1);
    expect(secondScene.scenes).toEqual(defaultScene.scenes);
    expect(() => prepareStaticGlb(
      bytes,
      "scene-invalid",
      "two-scenes.glb",
      "two-scenes.glb",
      true,
      2,
    )).toThrow("sceneIndex: index 2 is out of range");

    const invalidName = staticTriangleDocument();
    invalidName.scenes = [{ name: 3, nodes: [0] }];
    expect(() => prepareStaticGlb(staticTriangleGlb(invalidName), "scene-name-invalid"))
      .toThrow("scenes[0].name: must be a string");
  });

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

  it("packs multiple external buffers into the canonical binary boundary", async () => {
    const document = staticTriangleDocument();
    document.buffers = [
      { byteLength: 36, uri: "positions.bin" },
      { byteLength: 6, uri: "indices.bin" },
    ];
    document.bufferViews = [
      { buffer: 0, byteLength: 36 },
      { buffer: 1, byteLength: 6 },
    ];
    const positionBytes = new Uint8Array(36);
    new Float32Array(positionBytes.buffer).set([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0,
    ]);
    const indexBytes = new Uint8Array(6);
    new Uint16Array(indexBytes.buffer).set([0, 1, 2]);
    const read = vi.fn(async (uri: string) => uri.endsWith("positions.bin")
      ? positionBytes
      : indexBytes);
    const prepared = await prepareStaticGltfSource(
      new TextEncoder().encode(JSON.stringify(document)),
      "multi-buffer",
      "multi-buffer.gltf",
      "/models/multi-buffer.gltf",
      read,
    );

    expect(read).toHaveBeenCalledTimes(2);
    expect(prepared.primitives[0]!.geometry.positions).toEqual(new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]));
    expect(prepared.primitives[0]!.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
  });

  it("combines a GLB BIN chunk with declared external buffers", async () => {
    const document = staticTriangleDocument();
    document.buffers = [
      { byteLength: 36 },
      { byteLength: 6, uri: "indices.bin" },
    ];
    document.bufferViews = [
      { buffer: 0, byteLength: 36 },
      { buffer: 1, byteLength: 6 },
    ];
    const positions = new Uint8Array(36);
    new Float32Array(positions.buffer).set([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0,
    ]);
    const indices = new Uint8Array(6);
    new Uint16Array(indices.buffer).set([0, 1, 2]);
    const prepared = await prepareStaticGltfSource(
      glbFromDocument(document, positions),
      "hybrid-buffer",
      "hybrid-buffer.glb",
      "/models/hybrid-buffer.glb",
      async (uri) => {
        expect(uri).toBe("/models/indices.bin");
        return indices;
      },
    );
    expect(prepared.primitives[0]!.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
  });

  it("loads the Draco codec only for a document that declares compressed geometry", async () => {
    const document = staticTriangleDocument();
    requireExtensions(document, "KHR_draco_mesh_compression");
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

  it("rejects the static profile before starting declared codec work", async () => {
    const document = staticTriangleDocument();
    document.asset = { version: "1.0" };
    requireExtensions(document, "KHR_draco_mesh_compression");
    const meshes = document.meshes as Array<{
      primitives: Array<Record<string, unknown>>;
    }>;
    meshes[0]!.primitives[0]!.extensions = {
      KHR_draco_mesh_compression: {
        attributes: { POSITION: 0 },
        bufferView: 0,
      },
    };
    const executeDracoTasks = vi.fn(async () => []);

    await expect(prepareStaticGltfSource(
      staticTriangleGlb(document),
      "preflight-before-codecs",
      "invalid-version.glb",
      "/models/invalid-version.glb",
      async () => new Uint8Array(),
      executeDracoTasks,
    )).rejects.toThrow("asset.version: must be 2.0");
    expect(executeDracoTasks).not.toHaveBeenCalled();
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

  it("normalizes triangle-family modes and rejects unsupported raster topologies", () => {
    for (const mode of [5, 6]) {
      const document = staticTriangleDocument();
      const primitive = (document.meshes as Array<{
        primitives: Array<Record<string, unknown>>;
      }>)[0]!.primitives[0]!;
      primitive.mode = mode;
      expect(prepareStaticGlb(staticTriangleGlb(document), `mode-${mode}`)
        .primitives[0]!.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
    }

    const lines = staticTriangleDocument();
    (lines.meshes as Array<{ primitives: Array<Record<string, unknown>> }>)[0]!
      .primitives[0]!.mode = 1;
    expect(() => prepareStaticGlb(staticTriangleGlb(lines), "lines"))
      .toThrow("must be TRIANGLES, TRIANGLE_STRIP, or TRIANGLE_FAN");
  });

  it("rejects unknown required extensions and out-of-range triangle indices", () => {
    const extensionDocument = staticTriangleDocument();
    extensionDocument.extensionsRequired = ["KHR_future_geometry"];
    extensionDocument.extensionsUsed = ["KHR_materials_unlit", "KHR_future_geometry"];
    expect(() => prepareStaticGlb(staticTriangleGlb(extensionDocument), "future", "future.glb"))
      .toThrow("extensionsRequired[0]: is unsupported");
    requireExtensions(extensionDocument, "KHR_mesh_quantization");
    expect(prepareStaticGlb(staticTriangleGlb(extensionDocument), "quantized").primitives)
      .toHaveLength(1);
    const uncompressedQuantized = staticTriangleDocument();
    requireExtensions(uncompressedQuantized, "KHR_mesh_quantization");
    (uncompressedQuantized.accessors as unknown[]).push({
      bufferView: 0,
      componentType: 5122,
      count: 3,
      normalized: true,
      type: "VEC3",
    });
    const uncompressedMesh = (uncompressedQuantized.meshes as Array<{
      primitives: Array<{ attributes: Record<string, number> }>;
    }>)[0]!;
    uncompressedMesh.primitives[0]!.attributes.NORMAL = 2;
    expect(() => prepareStaticGlb(
      staticTriangleGlb(uncompressedQuantized),
      "uncompressed-quantized",
    )).toThrow("accessors[2]: vertex attribute elements must be 4-byte aligned");
    const misplaced = staticTriangleDocument();
    requireExtensions(misplaced, "KHR_materials_ior");
    const misplacedNodes = misplaced.nodes as Array<Record<string, unknown>>;
    misplacedNodes[1]!.extensions = { KHR_materials_ior: { ior: 1.4 } };
    expect(() => prepareStaticGlb(staticTriangleGlb(misplaced), "misplaced"))
      .toThrow("nodes[1].extensions.KHR_materials_ior: is outside Royal's supported placement profile");
    const duplicated = staticTriangleDocument();
    duplicated.extensionsRequired = ["KHR_materials_unlit", "KHR_materials_unlit"];
    duplicated.extensionsUsed = ["KHR_materials_unlit"];
    expect(() => prepareStaticGlb(staticTriangleGlb(duplicated), "duplicated"))
      .toThrow("extensionsRequired[1]: must not be duplicated");
    const undeclared = staticTriangleDocument();
    (undeclared.nodes as Array<Record<string, unknown>>)[1]!.extensions = {
      KHR_optional_future: {},
    };
    expect(() => prepareStaticGlb(staticTriangleGlb(undeclared), "undeclared"))
      .toThrow("nodes[1].extensions.KHR_optional_future: must be declared in extensionsUsed");
    const requiredButUnused = staticTriangleDocument();
    requiredButUnused.extensionsRequired = ["KHR_materials_unlit"];
    requiredButUnused.extensionsUsed = [];
    expect(() => prepareStaticGlb(staticTriangleGlb(requiredButUnused), "required-unused"))
      .toThrow('extensionsRequired: "KHR_materials_unlit" must also appear in extensionsUsed');
    const duplicateUsed = staticTriangleDocument();
    duplicateUsed.extensionsUsed = [
      "KHR_materials_unlit",
      "KHR_optional_future",
      "KHR_optional_future",
    ];
    expect(() => prepareStaticGlb(staticTriangleGlb(duplicateUsed), "duplicate-used"))
      .toThrow("extensionsUsed[2]: must not be duplicated");
    const opaqueOptionalPayload = staticTriangleDocument();
    opaqueOptionalPayload.extensionsRequired = ["KHR_materials_unlit", "KHR_texture_transform"];
    opaqueOptionalPayload.extensionsUsed = [
      "KHR_materials_unlit",
      "KHR_materials_clearcoat",
      "KHR_texture_transform",
    ];
    opaqueOptionalPayload.materials = [{
      extensions: {
        KHR_materials_clearcoat: {
          clearcoatTexture: {
            extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
            index: 0,
          },
        },
        KHR_materials_unlit: {},
      },
    }];
    expect(prepareStaticGlb(
      staticTriangleGlb(opaqueOptionalPayload),
      "opaque-optional-payload",
    ).primitives).toHaveLength(1);
    const executablePayload = staticTriangleDocument();
    requireExtensions(executablePayload, "KHR_materials_specular", "KHR_texture_transform");
    executablePayload.materials = [{
      extensions: {
        KHR_materials_specular: {
          futureTexture: {
            extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
            index: 0,
          },
        },
      },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(executablePayload), "executable-payload"))
      .toThrow("outside Royal's supported placement profile");
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

  it("lowers KHR_materials_ior without taxing default material shaders", () => {
    const document = staticTriangleDocument();
    requireExtensions(document, "KHR_materials_ior");
    document.materials = [{
      extensions: { KHR_materials_ior: { ior: 1.33 } },
      pbrMetallicRoughness: { metallicFactor: 0 },
    }];
    expect(prepareStaticGlb(staticTriangleGlb(document), "water").primitives[0]!.material)
      .toMatchObject({ indexOfRefraction: 1.33, kind: "standard" });

    const compatibility = staticTriangleDocument();
    requireExtensions(compatibility, "KHR_materials_ior");
    compatibility.materials = [{ extensions: { KHR_materials_ior: { ior: 0 } } }];
    expect(prepareStaticGlb(staticTriangleGlb(compatibility), "compat").primitives[0]!.material)
      .toMatchObject({ indexOfRefraction: 0 });

    const invalid = staticTriangleDocument();
    requireExtensions(invalid, "KHR_materials_ior");
    invalid.materials = [{ extensions: { KHR_materials_ior: { ior: 0.9 } } }];
    expect(() => prepareStaticGlb(staticTriangleGlb(invalid), "invalid-ior"))
      .toThrow("KHR_materials_ior.ior: must be zero or at least one");
  });

  it("lowers and validates KHR_materials_emissive_strength in the cold material reader", () => {
    const document = staticTriangleDocument();
    requireExtensions(document, "KHR_materials_emissive_strength");
    document.materials = [{
      emissiveFactor: [0.25, 0.5, 1],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } },
    }];
    expect(prepareStaticGlb(staticTriangleGlb(document), "emissive-strength")
      .primitives[0]!.material).toMatchObject({ emissiveFactor: [1, 2, 4] });

    const invalid = staticTriangleDocument();
    requireExtensions(invalid, "KHR_materials_emissive_strength");
    invalid.materials = [{
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: -1 } },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(invalid), "invalid-emissive-strength"))
      .toThrow("emissiveStrength: must not be negative");
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

    const prepared = prepareStaticGlb(
      staticTriangleGlb(document),
      "variants-v1",
    );
    const primitive = prepared.primitives[0]!;
    expect(prepared.variantNames).toEqual(["Ruby", "Emerald"]);
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
    expect(prepared.nodeCount).toBe(3);
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
      [{ group: 0, level: 0, thresholds: [0.6, 0.02] }],
      [{ group: 0, level: 1, thresholds: [0.6, 0.02] }],
    ]);
    expect(prepared.primitives[0]!.localModel.slice(12, 15)).toEqual([1, 2, 0]);
    expect(prepared.primitives[1]!.localModel.slice(12, 15)).toEqual([1, 2, -1]);
  });

  it("lowers material MSFT_lod levels, including levels selected through variants", () => {
    const document = staticTriangleDocument();
    requireExtensions(document, "KHR_materials_variants", "MSFT_lod");
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
    requireExtensions(document, "MSFT_lod");
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
      true,
      undefined,
      "v2",
    );
    expect(prepared.textureAssets).toEqual([{
      colorSpace: "srgb",
      gltfResource: true,
      kind: "asset",
      sampler: {
        magFilter: "linear",
        minFilter: "linear-mipmap-linear",
        wrapS: "repeat",
        wrapT: "repeat",
      },
      src: "/models/albedo.png",
      version: "v2",
    }]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      baseColor: [0.25, 0.5, 1, 1],
      baseColorAsset: prepared.textureAssets[0],
      requiresTextureCoordinates: true,
    });
    const sharedFromAnotherRoot = prepareStaticGlb(
      staticTexturedTriangleGlb(),
      "unrelated-parent-content",
      "other.glb",
      "/models/other.glb",
      true,
      undefined,
      "v2",
    ).textureAssets[0]!;
    expect(decodedTextureKey(sharedFromAnotherRoot))
      .toBe(decodedTextureKey(prepared.textureAssets[0]!));
    if (sharedFromAnotherRoot.kind !== "asset") throw new Error("expected external image");
    expect(decodedTextureKey({ ...sharedFromAnotherRoot, version: "v3" }))
      .not.toBe(decodedTextureKey(prepared.textureAssets[0]!));
  });

  it.each([
    [9728, "nearest"],
    [9729, "linear"],
    [9984, "nearest-mipmap-nearest"],
    [9985, "linear-mipmap-nearest"],
    [9986, "nearest-mipmap-linear"],
    [9987, "linear-mipmap-linear"],
  ] as const)("normalizes glTF minification filter %i without retained lookup state", (
    minFilter,
    expected,
  ) => {
    const prepared = prepareStaticGlb(staticTexturedTriangleGlb(
      undefined,
      "albedo.png",
      (document) => {
        document.samplers = [{ minFilter }];
        document.textures = [{ sampler: 0, source: 0 }];
      },
    ), `min-filter:${minFilter}`);
    expect(prepared.textureAssets[0]!.sampler?.minFilter).toBe(expected);
  });

  it("rejects a non-core glTF minification filter", () => {
    const asset = staticTexturedTriangleGlb(undefined, "albedo.png", (document) => {
      document.samplers = [{ minFilter: 1234 }];
      document.textures = [{ sampler: 0, source: 0 }];
    });
    expect(() => prepareStaticGlb(asset, "invalid-min-filter"))
      .toThrow("samplers[0].minFilter: is not a core glTF filter");
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

  it("routes every accepted material texture transform through one canonical affine plan", () => {
    const transformed = () => ({
      extensions: {
        KHR_texture_transform: {
          offset: [0.25, -0.5],
          rotation: Math.PI / 2,
          scale: [2, 3],
        },
      },
      index: 0,
    });
    const asset = staticTexturedTriangleGlb(undefined, "shared.png", (document) => {
      requireExtensions(
        document,
        "KHR_materials_specular",
        "KHR_materials_transmission",
        "KHR_materials_volume",
        "KHR_texture_transform",
      );
      document.materials = [{
        emissiveTexture: transformed(),
        extensions: {
          KHR_materials_specular: {
            specularColorTexture: transformed(),
            specularTexture: transformed(),
          },
          KHR_materials_transmission: {
            transmissionFactor: 1,
            transmissionTexture: transformed(),
          },
          KHR_materials_volume: {
            thicknessFactor: 1,
            thicknessTexture: transformed(),
          },
        },
        normalTexture: transformed(),
        occlusionTexture: transformed(),
        pbrMetallicRoughness: {
          baseColorTexture: transformed(),
          metallicRoughnessTexture: transformed(),
        },
      }];
    });
    const material = prepareStaticGlb(asset, "all-texture-transform-placements")
      .primitives[0]!.material;
    if (material.kind !== "standard") throw new Error("expected a standard material");
    const coordinateFields = [
      "baseColorTextureCoordinates",
      "emissiveTextureCoordinates",
      "metallicRoughnessTextureCoordinates",
      "normalTextureCoordinates",
      "occlusionTextureCoordinates",
      "specularColorTextureCoordinates",
      "specularTextureCoordinates",
      "thicknessTextureCoordinates",
      "transmissionTextureCoordinates",
    ] as const;
    for (const field of coordinateFields) {
      expect(material[field]).toEqual({
        row0: [expect.closeTo(0), -3, 0.25, 0],
        row1: [2, expect.closeTo(0), -0.5, 0],
      });
    }
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

  it("rejects imaginary required AVIF extensions and ignores optional occurrences", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "imaginary-avif.glb");
    const required = parsed.document as Record<string, unknown>;
    required.extensionsRequired = ["KHR_materials_unlit", "EXT_texture_avif"];
    required.extensionsUsed = ["KHR_materials_unlit", "EXT_texture_avif"];
    required.textures = [{
      extensions: { EXT_texture_avif: { source: 99 } },
      source: 0,
    }];
    expect(() => prepareStaticGlb(
      glbFromDocument(required, parsed.binaryChunk!),
      "imaginary-required",
    )).toThrow("extensionsRequired[1]: is unsupported");

    delete required.extensionsRequired;
    const optional = prepareStaticGlb(
      glbFromDocument(required, parsed.binaryChunk!),
      "imaginary-optional",
      "asset.glb",
      "/models/asset.glb",
    );
    expect(optional.textureAssets[0]).toMatchObject({
      kind: "asset",
      src: "/models/albedo.png",
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

  it("selects GS_texture_etc2 before WebP and marks opaque URLs explicitly", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "etc2.gltf");
    const document = parsed.document as Record<string, unknown>;
    document.extensionsRequired = ["KHR_materials_unlit", "GS_texture_etc2"];
    document.extensionsUsed = [
      "KHR_materials_unlit",
      "EXT_texture_webp",
      "GS_texture_etc2",
    ];
    document.images = [
      { uri: "fallback.png" },
      { uri: "fallback.webp" },
      { mimeType: "image/ktx2", uri: "content?id=albedo" },
    ];
    document.textures = [{
      extensions: {
        EXT_texture_webp: { source: 1 },
        GS_texture_etc2: { source: 2 },
      },
      source: 0,
    }];
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "etc2-v1",
      "etc2.gltf",
      "/models/etc2.gltf",
    );
    expect(prepared.textureAssets).toMatchObject([{
      kind: "asset",
      sourceEncoding: "ktx2-etc2",
      src: "/models/content?id=albedo",
    }]);

    const fallbackDocument = structuredClone(document);
    fallbackDocument.extensionsRequired = ["KHR_materials_unlit"];
    const fallback = prepareStaticGlb(
      glbFromDocument(fallbackDocument, parsed.binaryChunk!),
      "etc2-fallback",
      "etc2.gltf",
      "/models/etc2.gltf",
      false,
    );
    expect(fallback.textureAssets).toMatchObject([{
      kind: "asset",
      src: "/models/fallback.webp",
    }]);
    expect(() => prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "etc2-required-unavailable",
      "etc2.gltf",
      "/models/etc2.gltf",
      false,
    )).toThrow("GS_texture_etc2");
  });

  it("lowers embedded GS_texture_etc2 bytes into the ordinary cold recipe", () => {
    const ktx2 = createKtx2Etc2Fixture(152);
    const prepared = prepareStaticGlb(staticTexturedTriangleGlb(
      ktx2,
      "unused.png",
      (document) => {
        requireExtensions(document, "GS_texture_etc2");
        document.images = [{ bufferView: 3, mimeType: "image/ktx2" }];
        document.textures = [{ extensions: { GS_texture_etc2: { source: 0 } } }];
      },
    ), "embedded-etc2");
    expect(prepared.textureAssets).toMatchObject([{
      bytes: ktx2,
      kind: "embedded-asset",
      mimeType: "image/ktx2",
      sourceEncoding: "ktx2-etc2",
    }]);
  });

  it("rejects invalid GS_texture_etc2 placement and image MIME", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "bad-etc2.gltf");
    const misplaced = parsed.document as Record<string, unknown>;
    requireExtensions(misplaced, "GS_texture_etc2");
    (misplaced.nodes as Array<Record<string, unknown>>)[0]!.extensions = {
      GS_texture_etc2: { source: 0 },
    };
    expect(() => prepareStaticGlb(
      glbFromDocument(misplaced, parsed.binaryChunk!),
      "misplaced-etc2",
    )).toThrow("nodes[0].extensions.GS_texture_etc2: is outside Royal's supported placement profile");

    const wrongMime = parseGlb(staticTexturedTriangleGlb(), "bad-mime.gltf");
    const wrongMimeDocument = wrongMime.document as Record<string, unknown>;
    requireExtensions(wrongMimeDocument, "GS_texture_etc2");
    wrongMimeDocument.images = [{ mimeType: "image/png", uri: "opaque" }];
    wrongMimeDocument.textures = [{ extensions: { GS_texture_etc2: { source: 0 } } }];
    expect(() => prepareStaticGlb(
      glbFromDocument(wrongMimeDocument, wrongMime.binaryChunk!),
      "wrong-etc2-mime",
    )).toThrow("images[0].mimeType: must be image/ktx2 for GS_texture_etc2");

    const missingFallback = parseGlb(staticTexturedTriangleGlb(), "missing-fallback.gltf");
    const missingFallbackDocument = missingFallback.document as Record<string, unknown>;
    missingFallbackDocument.extensionsRequired = ["KHR_materials_unlit"];
    missingFallbackDocument.extensionsUsed = ["KHR_materials_unlit", "GS_texture_etc2"];
    missingFallbackDocument.images = [{ uri: "albedo.ktx2" }];
    missingFallbackDocument.textures = [{ extensions: { GS_texture_etc2: { source: 0 } } }];
    expect(() => prepareStaticGlb(
      glbFromDocument(missingFallbackDocument, missingFallback.binaryChunk!),
      "missing-etc2-fallback",
    )).toThrow("textures[0].source: is required when optional GS_texture_etc2 needs a core fallback");
  });

  it("lowers optional and required GS_texture_svg forms into one logical source recipe", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "svg.gltf");
    const optionalDocument = parsed.document as Record<string, unknown>;
    optionalDocument.extensionsUsed = ["KHR_materials_unlit", "GS_texture_svg"];
    optionalDocument.images = [
      { uri: "fallback.png" },
      { mimeType: "image/svg+xml", uri: "vector?id=albedo" },
    ];
    optionalDocument.textures = [{
      extensions: { GS_texture_svg: { source: 1 } },
      source: 0,
    }];
    const optional = prepareStaticGlb(
      glbFromDocument(optionalDocument, parsed.binaryChunk!),
      "svg-optional",
      "svg.gltf",
      "/models/svg.gltf",
    );
    expect(optional.textureAssets).toMatchObject([{
      fallback: { kind: "asset", src: "/models/fallback.png" },
      kind: "asset",
      sourceEncoding: "svg",
      src: "/models/vector?id=albedo",
    }]);

    const requiredDocument = structuredClone(optionalDocument);
    requiredDocument.extensionsRequired = ["KHR_materials_unlit", "GS_texture_svg"];
    requiredDocument.textures = [{ extensions: { GS_texture_svg: { source: 1 } } }];
    const required = prepareStaticGlb(
      glbFromDocument(requiredDocument, parsed.binaryChunk!),
      "svg-required",
      "svg.gltf",
      "/models/svg.gltf",
    );
    expect(required.textureAssets[0]).toMatchObject({
      kind: "asset",
      sourceEncoding: "svg",
      src: "/models/vector?id=albedo",
    });
    expect(required.textureAssets[0]).not.toHaveProperty("fallback");
  });

  it("accepts embedded GS_texture_svg bytes through the same ordinary recipe", () => {
    const encodedSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2"/>',
    );
    const svg = new Uint8Array(Math.ceil(encodedSvg.byteLength / 4) * 4);
    svg.fill(0x20);
    svg.set(encodedSvg);
    const prepared = prepareStaticGlb(staticTexturedTriangleGlb(
      svg,
      "unused.png",
      (document) => {
        requireExtensions(document, "GS_texture_svg");
        document.images = [{ bufferView: 3, mimeType: "image/svg+xml" }];
        document.textures = [{ extensions: { GS_texture_svg: { source: 0 } } }];
      },
    ), "embedded-svg");
    expect(prepared.textureAssets).toMatchObject([{
      bytes: svg,
      kind: "embedded-asset",
      mimeType: "image/svg+xml",
      sourceEncoding: "svg",
    }]);
  });

  it("rejects invalid GS_texture_svg fallback, MIME, and data-slot use", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "bad-svg.gltf");
    const optional = parsed.document as Record<string, unknown>;
    optional.extensionsRequired = ["KHR_materials_unlit"];
    optional.extensionsUsed = ["KHR_materials_unlit", "GS_texture_svg"];
    optional.images = [{ mimeType: "image/svg+xml", uri: "albedo.svg" }];
    optional.textures = [{ extensions: { GS_texture_svg: { source: 0 } } }];
    expect(() => prepareStaticGlb(
      glbFromDocument(optional, parsed.binaryChunk!),
      "missing-svg-fallback",
    )).toThrow("textures[0].source: is required when optional GS_texture_svg needs a core raster fallback");

    const wrongMime = structuredClone(optional);
    wrongMime.extensionsRequired = ["KHR_materials_unlit", "GS_texture_svg"];
    wrongMime.images = [{ mimeType: "image/png", uri: "albedo.svg" }];
    expect(() => prepareStaticGlb(
      glbFromDocument(wrongMime, parsed.binaryChunk!),
      "wrong-svg-mime",
    )).toThrow("images[0].mimeType: must be image/svg+xml for GS_texture_svg");

    const dataSlot = structuredClone(optional);
    dataSlot.extensionsRequired = ["GS_texture_svg"];
    dataSlot.extensionsUsed = ["GS_texture_svg"];
    dataSlot.materials = [{
      pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } },
    }];
    expect(() => prepareStaticGlb(
      glbFromDocument(dataSlot, parsed.binaryChunk!),
      "linear-svg",
    )).toThrow("GS_texture_svg: is supported only for sRGB color texture slots");
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

  it("lowers complete KHR_materials_specular semantics through ordinary texture recipes", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "specular.glb");
    const document = parsed.document as Record<string, unknown>;
    document.extensionsRequired = ["KHR_materials_specular", "KHR_texture_transform"];
    document.extensionsUsed = ["KHR_materials_specular", "KHR_texture_transform"];
    document.images = [{ uri: "shared.png" }, { uri: "shared.png" }];
    document.textures = [{ source: 0 }, { source: 1 }];
    document.materials = [{
      extensions: {
        KHR_materials_specular: {
          specularColorFactor: [0.5, 1, 2],
          specularColorTexture: {
            extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
            index: 1,
          },
          specularFactor: 0.25,
          specularTexture: { index: 0 },
        },
      },
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.4 },
    }];
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "specular-v1",
      "specular.glb",
      "/models/specular.glb",
    );
    expect(prepared.textureAssets.map((asset) => [asset.colorSpace, asset.kind === "asset"
      ? asset.src
      : asset.label])).toEqual([
      ["srgb", "/models/shared.png"],
      ["linear", "/models/shared.png"],
    ]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      kind: "standard",
      requiresTextureCoordinates: true,
      specularColorFactor: [0.5, 1, 2],
      specularColorTextureCoordinates: {
        row0: [1, 0, 0.25, 0],
        row1: [0, 1, 0.5, 0],
      },
      specularFactor: 0.25,
    });
  });

  it("rejects invalid KHR_materials_specular factors and unlit combinations", () => {
    const negativeColor = staticTriangleDocument();
    requireExtensions(negativeColor, "KHR_materials_specular");
    negativeColor.materials = [{
      extensions: { KHR_materials_specular: { specularColorFactor: [1, -1, 1] } },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(negativeColor), "negative-specular"))
      .toThrow("specularColorFactor[1]: must not be negative");

    const invalidCombination = staticTriangleDocument();
    requireExtensions(invalidCombination, "KHR_materials_specular");
    invalidCombination.materials = [{
      extensions: { KHR_materials_specular: {}, KHR_materials_unlit: {} },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(invalidCombination), "unlit-specular"))
      .toThrow("must not combine KHR_materials_specular with KHR_materials_unlit");
  });

  it("lowers transmission and volume semantics through ordinary texture recipes", () => {
    const parsed = parseGlb(staticTexturedTriangleGlb(), "volume.glb");
    const document = parsed.document as Record<string, unknown>;
    requireExtensions(
      document,
      "KHR_materials_ior",
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_texture_transform",
    );
    document.images = [{ uri: "transmission.png" }, { uri: "thickness.png" }];
    document.textures = [{ source: 0 }, { source: 1 }];
    document.materials = [{
      extensions: {
        KHR_materials_ior: { ior: 1.33 },
        KHR_materials_transmission: {
          transmissionFactor: 0.75,
          transmissionTexture: {
            extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
            index: 0,
          },
        },
        KHR_materials_volume: {
          attenuationColor: [0.2, 0.5, 1],
          attenuationDistance: 4,
          thicknessFactor: 2,
          thicknessTexture: { index: 1 },
        },
      },
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.1 },
    }];
    const prepared = prepareStaticGlb(
      glbFromDocument(document, parsed.binaryChunk!),
      "volume-v1",
      "volume.glb",
      "/models/volume.glb",
    );
    expect(prepared.textureAssets.map((asset) => [asset.colorSpace, asset.kind === "asset"
      ? asset.src
      : asset.label])).toEqual([
      ["linear", "/models/thickness.png"],
      ["linear", "/models/transmission.png"],
    ]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      attenuationColor: [0.2, 0.5, 1],
      attenuationDistance: 4,
      indexOfRefraction: 1.33,
      kind: "standard",
      requiresTextureCoordinates: true,
      thicknessFactor: 2,
      transmissionFactor: 0.75,
      transmissionTextureCoordinates: {
        row0: [1, 0, 0.25, 0],
        row1: [0, 1, 0.5, 0],
      },
    });
  });

  it("keeps semantically inactive transmission and thickness images out of loading", () => {
    const document = staticTriangleDocument();
    requireExtensions(document, "KHR_materials_transmission", "KHR_materials_volume");
    document.images = [{ uri: "unused-transmission.png" }, { uri: "unused-thickness.png" }];
    document.textures = [{ source: 0 }, { source: 1 }];
    document.materials = [{
      extensions: {
        KHR_materials_transmission: {
          transmissionFactor: 0,
          transmissionTexture: { index: 0 },
        },
        KHR_materials_volume: {
          thicknessFactor: 2,
          thicknessTexture: { index: 1 },
        },
      },
    }];
    const prepared = prepareStaticGlb(staticTriangleGlb(document), "inactive-transmission");
    expect(prepared.textureAssets).toEqual([]);
    expect(prepared.primitives[0]!.material).toMatchObject({
      requiresTextureCoordinates: false,
      thicknessFactor: 2,
      transmissionFactor: 0,
    });
  });

  it("rejects malformed volume values and unlit transmission combinations", () => {
    const standaloneVolume = staticTriangleDocument();
    requireExtensions(standaloneVolume, "KHR_materials_volume");
    standaloneVolume.materials = [{ extensions: { KHR_materials_volume: {} } }];
    expect(() => prepareStaticGlb(staticTriangleGlb(standaloneVolume), "standalone-volume"))
      .toThrow("KHR_materials_volume: requires KHR_materials_transmission");

    const invalidDistance = staticTriangleDocument();
    requireExtensions(invalidDistance, "KHR_materials_transmission", "KHR_materials_volume");
    invalidDistance.materials = [{
      extensions: {
        KHR_materials_transmission: {},
        KHR_materials_volume: { attenuationDistance: 0 },
      },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(invalidDistance), "invalid-distance"))
      .toThrow("KHR_materials_volume.attenuationDistance: must be greater than zero");

    const invalidThickness = staticTriangleDocument();
    requireExtensions(invalidThickness, "KHR_materials_transmission", "KHR_materials_volume");
    invalidThickness.materials = [{
      extensions: {
        KHR_materials_transmission: {},
        KHR_materials_volume: { thicknessFactor: -1 },
      },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(invalidThickness), "invalid-thickness"))
      .toThrow("KHR_materials_volume.thicknessFactor: must not be negative");

    const unlitTransmission = staticTriangleDocument();
    requireExtensions(unlitTransmission, "KHR_materials_transmission");
    unlitTransmission.materials = [{
      extensions: { KHR_materials_transmission: {}, KHR_materials_unlit: {} },
    }];
    expect(() => prepareStaticGlb(staticTriangleGlb(unlitTransmission), "unlit-transmission"))
      .toThrow("must not combine transmission or volume with KHR_materials_unlit");
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

  it("ignores unconsumed UV1 but rejects mismatched consumed streams", () => {
    const extended = staticTriangleDocument();
    const meshes = extended.meshes as Array<{ primitives: Array<{ attributes: object }> }>;
    meshes[0]!.primitives[0]!.attributes = { POSITION: 0, TEXCOORD_1: 0 };
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
