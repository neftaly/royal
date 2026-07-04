import { describe, expect, it } from "vitest";
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
} from "../packages/renderer-webgl/src/gltf/schema";

type MeshoptExtensionName = "EXT_meshopt_compression" | "KHR_meshopt_compression";

const meshoptAttributeBytes = Uint8Array.from([
  160, 1, 63, 0, 0, 0, 88, 87, 88, 1, 38, 0, 0, 0, 1, 12,
  0, 0, 0, 88, 1, 8, 0, 0, 0, 0, 0, 0, 0, 1, 63, 0,
  0, 0, 23, 24, 23, 1, 38, 0, 0, 0, 1, 12, 0, 0, 0, 23,
  1, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
]);

const decodedAttributeBytes = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  44, 1, 0, 0, 0, 0, 0, 0, 244, 1, 0, 0,
  0, 0, 44, 1, 0, 0, 0, 0, 0, 0, 244, 1,
  44, 1, 44, 1, 0, 0, 0, 0, 244, 1, 244, 1,
]);

const meshoptColorBytes = Uint8Array.from([
  160, 1, 63, 0, 0, 0, 126, 125, 76, 1, 63, 0, 0, 0, 253, 253,
  254, 1, 63, 0, 0, 0, 131, 130, 128, 1, 63, 0, 0, 0, 125, 63,
  126, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 127, 193, 255,
]);

const decodedColorBytes = Uint8Array.from([
  254, 1, 0, 255,
  0, 254, 0, 128,
  1, 0, 255, 64,
  102, 102, 102, 191,
]);

const arrayBufferFromBytes = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

const extensionBlock = (
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
  extraExtensions: NonNullable<GltfBufferView["extensions"]> = {},
): NonNullable<GltfBufferView["extensions"]> => ({
  ...extraExtensions,
  [extensionName]: extension,
});

const meshoptDocument = (
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
  extraExtensions?: GltfBufferView["extensions"],
): GltfDocument => ({
  bufferViews: [
    {
      buffer: 1,
      byteLength: extension.count * extension.byteStride,
      extensions: extensionBlock(extensionName, extension, extraExtensions ?? {}),
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
  it("supports required KHR_meshopt_compression without recognizing KHR_animation_pointer", () => {
    expect(supportedGltfExtensions.has("KHR_meshopt_compression")).toBe(true);
    expect(unsupportedRequiredGltfExtensions({
      extensionsRequired: ["KHR_meshopt_compression"],
    })).toEqual([]);

    expect(supportedGltfExtensions.has("KHR_animation_pointer")).toBe(false);
    expect(unsupportedRequiredGltfExtensions({
      extensionsRequired: ["KHR_animation_pointer"],
    })).toEqual(["KHR_animation_pointer"]);
    expect(() => assertSupportedRequiredGltfExtensions("animated.gltf", {
      extensionsRequired: ["KHR_animation_pointer"],
    })).toThrow(/KHR_animation_pointer/);
  });

  it("decodes KHR_meshopt_compression bufferViews through the meshopt decoder", async () => {
    const extension: GltfMeshoptCompressionExtension = {
      buffer: 0,
      byteLength: meshoptAttributeBytes.byteLength,
      byteStride: 12,
      count: 4,
      mode: "ATTRIBUTES",
    };
    const document = meshoptDocument("KHR_meshopt_compression", extension, {
      VENDOR_keep: { enabled: true },
    });

    const decoded = await decodeGltfMeshoptBufferViews(document, [
      arrayBufferFromBytes(meshoptAttributeBytes),
      new ArrayBuffer(0),
    ]);

    expect(Array.from(new Uint8Array(decoded.buffers[2] ?? new ArrayBuffer(0)))).toEqual(
      Array.from(decodedAttributeBytes),
    );
    expect(decoded.document.bufferViews?.[0]).toMatchObject({
      buffer: 2,
      byteLength: decodedAttributeBytes.byteLength,
      byteOffset: 0,
      extensions: {
        VENDOR_keep: { enabled: true },
      },
    });
  });

  it("allows the KHR meshopt COLOR filter while keeping it invalid for EXT meshopt", async () => {
    const extension: GltfMeshoptCompressionExtension = {
      buffer: 0,
      byteLength: meshoptColorBytes.byteLength,
      byteStride: 4,
      count: 4,
      filter: "COLOR",
      mode: "ATTRIBUTES",
    };

    await expect(decodedBytes(meshoptDocument("KHR_meshopt_compression", extension), meshoptColorBytes))
      .resolves.toEqual(decodedColorBytes);
    await expect(decodedBytes(meshoptDocument("EXT_meshopt_compression", extension), meshoptColorBytes))
      .rejects.toThrow(/EXT_meshopt_compression has unsupported filter COLOR/);
  });

  it("rejects bufferViews that declare both EXT and KHR meshopt compression", async () => {
    const extension: GltfMeshoptCompressionExtension = {
      buffer: 0,
      byteLength: meshoptAttributeBytes.byteLength,
      byteStride: 12,
      count: 4,
      mode: "ATTRIBUTES",
    };
    const document: GltfDocument = {
      bufferViews: [
        {
          buffer: 1,
          byteLength: decodedAttributeBytes.byteLength,
          extensions: {
            EXT_meshopt_compression: extension,
            KHR_meshopt_compression: extension,
          },
        },
      ],
    };

    await expect(decodeGltfMeshoptBufferViews(document, [
      arrayBufferFromBytes(meshoptAttributeBytes),
      new ArrayBuffer(0),
    ])).rejects.toThrow(/KHR_meshopt_compression must not also use EXT_meshopt_compression/);
  });

  it("rejects buffers that declare both EXT and KHR meshopt fallback markers", async () => {
    const document: GltfDocument = {
      buffers: [
        {
          byteLength: 0,
          extensions: {
            EXT_meshopt_compression: { fallback: true },
            KHR_meshopt_compression: { fallback: true },
          },
        },
      ],
    };

    await expect(decodeGltfMeshoptBufferViews(document, [new ArrayBuffer(0)]))
      .rejects.toThrow(/buffer 0 KHR_meshopt_compression must not also use EXT_meshopt_compression/);
  });
});
