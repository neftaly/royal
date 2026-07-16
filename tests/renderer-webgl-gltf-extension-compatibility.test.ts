import { describe, expect, it } from "vitest";
import { decodeGltfDracoPrimitives } from "../packages/renderer-webgl/src/gltf/codecs/draco";
import { decodeGltfMeshoptBufferViews } from "../packages/renderer-webgl/src/gltf/codecs/meshopt";
import {
  assertSupportedRequiredGltfExtensions,
  supportedGltfExtensions,
  unsupportedRequiredGltfExtensions,
} from "../packages/renderer-webgl/src/gltf/extensions";
import type {
  GltfBufferView,
  GltfDocument,
  GltfMeshoptCompressionExtension,
  GltfMeshPrimitive,
} from "../packages/renderer-webgl/src/gltf/schema";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const meshoptColorBytes = Uint8Array.from([
  160, 1, 63, 0, 0, 0, 126, 125, 76, 1, 63, 0, 0, 0, 253, 253,
  254, 1, 63, 0, 0, 0, 131, 130, 128, 1, 63, 0, 0, 0, 125, 63,
  126, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 127, 193, 255,
]);

const dracoCompressedTriangleBytes = Uint8Array.from([
  68, 82, 65, 67, 79, 2, 2, 1, 1, 0, 0, 0, 3, 1, 2, 1,
  0, 0, 1, 7, 255, 1, 17, 1, 1, 0, 1, 1, 0, 3, 255, 0,
  0, 0, 0, 0, 1, 0, 0, 1, 0, 9, 3, 0, 0, 2, 1, 1,
  9, 3, 0, 1, 3, 1, 3, 9, 2, 0, 2, 2, 1, 1, 1, 0,
  15, 3, 173, 42, 47, 85, 21, 3, 160, 122, 129, 72, 255, 31, 0, 0,
  0, 0, 0, 0, 0, 255, 63, 0, 0, 0, 0, 0, 191, 0, 0, 0,
  191, 0, 0, 0, 0, 0, 0, 128, 63, 14, 0, 3, 1, 0, 10, 3,
  173, 42, 27, 85, 21, 3, 175, 90, 129, 0, 254, 3, 255, 3, 0, 0,
  255, 1, 0, 0, 10, 1, 1, 1, 0, 13, 3, 173, 42, 39, 85, 21,
  3, 160, 122, 129, 212, 255, 1, 0, 0, 0, 0, 0, 255, 15, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 63, 12,
]);

const arrayBufferFromBytes = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const dracoTrianglePrimitive = (): GltfMeshPrimitive => ({
  attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
  extensions: {
    KHR_draco_mesh_compression: {
      attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
      bufferView: 0,
    },
  },
  indices: 3,
  mode: 4,
});

const dracoTriangleDocument = (
  primitive: GltfMeshPrimitive = dracoTrianglePrimitive(),
  bufferView: GltfBufferView = { buffer: 0, byteLength: dracoCompressedTriangleBytes.byteLength },
): GltfDocument => ({
  accessors: [
    { componentType: 5126, count: 3, type: "VEC3" },
    { componentType: 5126, count: 3, type: "VEC3" },
    { componentType: 5126, count: 3, type: "VEC2" },
    { componentType: 5123, count: 3, type: "SCALAR" },
  ],
  bufferViews: [bufferView],
  buffers: [{ byteLength: bufferView.byteLength }],
  meshes: [{ primitives: [primitive] }],
});

const firstPrimitive = (document: GltfDocument): GltfMeshPrimitive => {
  const primitive = document.meshes?.[0]?.primitives?.[0];
  if (primitive === undefined) throw new Error("test document is missing a primitive");

  return primitive;
};

const paddedDracoTriangleBuffer = (prefixLength: number): ArrayBuffer => {
  const bytes = new Uint8Array(prefixLength + dracoCompressedTriangleBytes.byteLength);
  bytes.fill(0x7f, 0, prefixLength);
  bytes.set(dracoCompressedTriangleBytes, prefixLength);

  return bytes.buffer;
};

const fuzzedDracoTriangleBytes = (random: SeededRandom): Uint8Array => {
  const bytes = new Uint8Array(dracoCompressedTriangleBytes);
  const mutationCount = random.int(1, 4);
  for (let mutation = 0; mutation < mutationCount; mutation += 1) {
    const index = random.int(16, bytes.length);
    bytes[index] = (bytes[index] ?? 0) ^ (1 << random.int(0, 8));
  }

  return bytes;
};

const expectFiniteFloat32Array = (values: Float32Array, label: string): void => {
  expect(values.length, `${label} should not be empty`).toBeGreaterThan(0);
  expect(values.length, `${label} should stay bounded under fuzz`).toBeLessThanOrEqual(1024);
  expect(Array.from(values).every(Number.isFinite), `${label} should contain finite numbers`).toBe(true);
};

const extensionBlock = (
  extension: GltfMeshoptCompressionExtension,
  extraExtensions: NonNullable<GltfBufferView["extensions"]> = {},
): NonNullable<GltfBufferView["extensions"]> => ({
  ...extraExtensions,
  EXT_meshopt_compression: extension,
});

const meshoptDocument = (
  extension: GltfMeshoptCompressionExtension,
  extraExtensions?: GltfBufferView["extensions"],
): GltfDocument => ({
  bufferViews: [
    {
      buffer: 1,
      byteLength: extension.count * extension.byteStride,
      extensions: extensionBlock(extension, extraExtensions ?? {}),
    },
  ],
});

const decodedBytes = async (
  document: GltfDocument,
  compressedBytes: Uint8Array,
): Promise<Uint8Array> => {
  const decoded = await decodeGltfMeshoptBufferViews(document, [
    arrayBufferFromBytes(compressedBytes),
    new ArrayBuffer(0),
  ]);
  const bufferIndex = decoded.document.bufferViews?.[0]?.buffer;
  if (bufferIndex === undefined) throw new Error("meshopt test did not produce a decoded bufferView");
  const buffer = decoded.buffers[bufferIndex];
  if (buffer === undefined) throw new Error("meshopt test did not produce a decoded buffer");

  return new Uint8Array(buffer);
};

describe("renderer-webgl glTF extension compatibility", () => {
  it("rejects draft meshopt and dynamic node extensions", () => {
    expect(supportedGltfExtensions.has("KHR_meshopt_compression")).toBe(false);
    expect(unsupportedRequiredGltfExtensions({
      extensionsRequired: ["KHR_meshopt_compression"],
    })).toEqual(["KHR_meshopt_compression"]);

    expect(supportedGltfExtensions.has("KHR_animation_pointer")).toBe(false);
    expect(unsupportedRequiredGltfExtensions({
      extensionsRequired: ["KHR_animation_pointer"],
    })).toEqual(["KHR_animation_pointer"]);
    expect(() => assertSupportedRequiredGltfExtensions("animated.gltf", {
      extensionsRequired: ["KHR_animation_pointer"],
    })).toThrow(/unsupported required glTF extension.*KHR_animation_pointer/i);

    expect(supportedGltfExtensions.has("KHR_node_visibility")).toBe(false);
    expect(() => assertSupportedRequiredGltfExtensions("visibility.gltf", {
      extensionsRequired: ["KHR_node_visibility"],
    })).toThrow(/unsupported required glTF extension.*KHR_node_visibility/i);
  });

  it("fails explicitly for skeletal and morph deformation assets", () => {
    expect(() => assertSupportedRequiredGltfExtensions("skinned.gltf", {
      nodes: [{ mesh: 0, skin: 0 }],
      skins: [{ joints: [1] }],
    })).toThrow(/node 0.*skinned\.gltf.*unsupported skeletal deformation/i);

    expect(() => assertSupportedRequiredGltfExtensions("morphed.gltf", {
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }] }] }],
    })).toThrow(/mesh 0 primitive 0.*morphed\.gltf.*unsupported morph deformation/i);
  });

  it("rejects the draft COLOR filter for EXT meshopt", async () => {
    const extension: GltfMeshoptCompressionExtension = {
      buffer: 0,
      byteLength: meshoptColorBytes.byteLength,
      byteStride: 4,
      count: 4,
      filter: "COLOR",
      mode: "ATTRIBUTES",
    };

    await expect(decodedBytes(meshoptDocument(extension), meshoptColorBytes))
      .rejects.toThrow(/EXT_meshopt_compression has unsupported filter COLOR/);
  });

  it("decodes KHR_draco_mesh_compression primitives through minidraco", () => {
    const document = dracoTriangleDocument();
    const primitive = firstPrimitive(document);
    const decoded = decodeGltfDracoPrimitives(document, [arrayBufferFromBytes(dracoCompressedTriangleBytes)]);
    const decodedPrimitive = decoded.get(primitive);

    expect(decodedPrimitive).toBeDefined();
    expect(Array.from(decodedPrimitive?.indices ?? []).map(round6)).toEqual([0, 1, 2]);
    expect(Array.from(decodedPrimitive?.attributes.get("POSITION") ?? []).map(round6)).toEqual([
      0.000031, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
    expect(Array.from(decodedPrimitive?.attributes.get("NORMAL") ?? []).map(round6)).toEqual([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
    expect(Array.from(decodedPrimitive?.attributes.get("TEXCOORD_0") ?? []).map(round6)).toEqual([
      0.500122, 1,
      0, 0,
      1, 0,
    ]);
  });

  it("decodes KHR_draco_mesh_compression from byte-offset bufferViews without copying the source slice", () => {
    const prefixLength = 11;
    const document = dracoTriangleDocument(dracoTrianglePrimitive(), {
      buffer: 0,
      byteLength: dracoCompressedTriangleBytes.byteLength,
      byteOffset: prefixLength,
    });
    const primitive = firstPrimitive(document);
    const decoded = decodeGltfDracoPrimitives(document, [paddedDracoTriangleBuffer(prefixLength)]);

    expect(decoded.get(primitive)?.attributes.get("POSITION")?.length).toBe(9);
    expect(Array.from(decoded.get(primitive)?.indices ?? [])).toEqual([0, 1, 2]);
  });

  it("keeps Draco decode bounded for fuzzed compressed payloads", () => {
    forEachFuzzCase({ cases: 24, seed: 0xd4ac_0001 }, ({ label, random }) => {
      const document = dracoTriangleDocument();
      const primitive = firstPrimitive(document);
      const bytes = fuzzedDracoTriangleBytes(random);

      try {
        const decoded = decodeGltfDracoPrimitives(document, [arrayBufferFromBytes(bytes)]);
        const decodedPrimitive = decoded.get(primitive);
        expect(decodedPrimitive, `${label} decoded primitive`).toBeDefined();

        const positions = decodedPrimitive?.attributes.get("POSITION");
        expect(positions, `${label} POSITION`).toBeDefined();
        if (positions === undefined || decodedPrimitive === undefined) return;

        expect(positions.length % 3, `${label} POSITION triplets`).toBe(0);
        expectFiniteFloat32Array(positions, `${label} POSITION`);
        for (const [semantic, values] of decodedPrimitive.attributes) {
          expectFiniteFloat32Array(values, `${label} ${semantic}`);
        }

        const vertexCount = positions.length / 3;
        expect(decodedPrimitive.indices.length % 3, `${label} index triplets`).toBe(0);
        expect(decodedPrimitive.indices.length, `${label} index count bounded`).toBeLessThanOrEqual(1024);
        expect(
          Array.from(decodedPrimitive.indices).every((index) => index >= 0 && index < vertexCount),
          `${label} indices should stay within decoded POSITION vertices`,
        ).toBe(true);
      } catch (error) {
        expect(
          error instanceof Error ? error.message : String(error),
          `${label} should fail with a labeled Draco error`,
        ).toMatch(/KHR_draco_mesh_compression/u);
      }
    });
  });
});
