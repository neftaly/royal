import { describe, expect, it } from "vitest";
import { readGltfScene } from "../packages/renderer-webgl/src/gltf/scene-reader";
import type { GltfDocument } from "../packages/renderer-webgl/src/gltf/schema";

const triangleBuffer = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(9 * Float32Array.BYTES_PER_ELEMENT);
  new Float32Array(buffer).set([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  return buffer;
};

const triangleDocument = (): GltfDocument => ({
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
  bufferViews: [{ buffer: 0, byteLength: 36 }],
  buffers: [{ byteLength: 36 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  nodes: [{ mesh: 0 }],
  scene: 0,
  scenes: [{ nodes: [0] }],
});

describe("glTF scene reader", () => {
  it("prepares geometry, material texture identity, and punctual lights without WebGL", () => {
    const document: GltfDocument = {
      ...triangleDocument(),
      extensions: {
        KHR_lights_punctual: {
          lights: [{ color: [0.5, 0.25, 1], intensity: 2, type: "point" }],
        },
      },
      images: [{ uri: "albedo.png" }],
      materials: [{
        alphaMode: "MASK",
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.4, 0.6, 0.8],
          baseColorTexture: { index: 0 },
        },
      }],
      nodes: [{ extensions: { KHR_lights_punctual: { light: 0 } }, mesh: 0 }],
      samplers: [{ magFilter: 9728, wrapS: 33071 }],
      textures: [{ sampler: 0, source: 0 }],
    };
    const diagnostics: string[] = [];
    const scene = readGltfScene({
      assetKey: "asset",
      buffers: [triangleBuffer()],
      diagnostics: { recordDiagnostic: (message) => diagnostics.push(message) },
      document,
      dracoPrimitives: new Map(),
      src: "https://example.test/models/scene.gltf",
    });

    expect(diagnostics).toEqual([]);
    expect(scene.bounds).toEqual({ max: [1, 1, 0], min: [0, 0, 0] });
    expect(scene.lights).toEqual([{
      color: [1, 0.5, 2, 1],
      kind: "point",
      position: [0, 0, 0],
    }]);
    expect(scene.primitives).toHaveLength(1);
    expect(scene.primitives[0]?.normals).toBeUndefined();
    expect(scene.primitives[0]?.material).toMatchObject({
      alphaCutoff: 0.5,
      alphaMode: "MASK",
      color: [0.2, 0.4, 0.6, 0.8],
      sourceMaterialIndex: 0,
    });
    expect(scene.primitives[0]?.material.baseColorTexture).toMatchObject({
      sampler: { magFilter: "nearest", wrapS: "clamp-to-edge" },
      sourceUri: "https://example.test/models/albedo.png",
    });
  });

  it("prefers WebP extension sources without relying on canvas encoding support", () => {
    const document: GltfDocument = {
      ...triangleDocument(),
      images: [{ uri: "fallback.png" }, { uri: "preferred.webp" }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{
        extensions: { EXT_texture_webp: { source: 1 } },
        source: 0,
      }],
    };
    const scene = readGltfScene({
      assetKey: "asset",
      buffers: [triangleBuffer()],
      diagnostics: { recordDiagnostic: () => undefined },
      document,
      dracoPrimitives: new Map(),
      src: "https://example.test/models/scene.gltf",
    });

    expect(scene.primitives[0]?.material.baseColorTexture?.sourceUri)
      .toBe("https://example.test/models/preferred.webp");
  });

  it("reports aggregate asset bounds after authored hierarchy transforms", () => {
    const scene = readGltfScene({
      assetKey: "transformed",
      buffers: [triangleBuffer()],
      diagnostics: { recordDiagnostic: () => undefined },
      document: {
        ...triangleDocument(),
        materials: [{}],
        nodes: [
          { children: [1], translation: [2, -3, 4] },
          { mesh: 0, scale: [2, 3, 4] },
        ],
      },
      dracoPrimitives: new Map(),
      src: "transformed.gltf",
    });

    expect(scene.bounds).toEqual({ max: [4, 0, 4], min: [2, -3, 4] });
  });

  it("reads node LOD, material LOD, variants, and extension diagnostics as scene facts", () => {
    const base = triangleDocument();
    const diagnostics: Array<{ key?: string; message: string }> = [];
    const scene = readGltfScene({
      assetKey: "lod-asset",
      buffers: [triangleBuffer()],
      diagnostics: {
        recordDiagnostic: (message, key) => diagnostics.push({
          ...(key === undefined ? {} : { key }),
          message,
        }),
      },
      document: {
        ...base,
        extensions: { KHR_materials_variants: { variants: [{ name: "red" }] } },
        materials: [
          {
            extensions: {
              KHR_materials_anisotropy: { anisotropyTexture: { index: 0 } },
              MSFT_lod: { ids: [1] },
            },
            extras: { MSFT_screencoverage: [0.8, 0] },
          },
          { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } },
          { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
        ],
        meshes: [{ primitives: [{
          attributes: { POSITION: 0 },
          extensions: {
            KHR_materials_variants: { mappings: [{ material: 2, variants: [0] }] },
          },
          material: 0,
        }] }],
        nodes: [
          { extensions: { MSFT_lod: { ids: [1] } }, mesh: 0 },
          { mesh: 0 },
        ],
      },
      dracoPrimitives: new Map(),
      src: "scene.gltf",
    });

    expect(scene).toMatchObject({
      hasMaterialLod: true,
      hasMaterialVariants: true,
      hasNodeLod: true,
      variants: ["red"],
    });
    expect(scene.primitives.map((primitive) => primitive.nodeLod?.level)).toEqual([0, 1]);
    expect(scene.primitives[0]?.materialLod?.levels).toHaveLength(2);
    expect(scene.primitives[0]?.materialVariants?.[0]?.variants).toEqual([0]);
    expect(diagnostics.some(({ key }) => key === "gltf-material-extension:KHR_materials_anisotropy.anisotropyTexture"))
      .toBe(false);
  });

  it("terminates malformed cyclic child traversal at the reader boundary", () => {
    const diagnostics: Array<{ key?: string; message: string }> = [];
    const scene = readGltfScene({
      assetKey: "cycle",
      buffers: [triangleBuffer()],
      diagnostics: {
        recordDiagnostic: (message, key) => diagnostics.push({
          ...(key === undefined ? {} : { key }),
          message,
        }),
      },
      document: {
        ...triangleDocument(),
        materials: [{}],
        nodes: [{ children: [0], mesh: 0 }],
      },
      dracoPrimitives: new Map(),
      src: "cycle.gltf",
    });

    expect(scene.primitives).toHaveLength(1);
    expect(diagnostics).toContainEqual({
      key: "gltf-node-cycle:cycle:0:0",
      message: "glTF node tree cycle skipped at node 0",
    });
  });
});
