import { describe, expect, it } from "vitest";
import {
  attachGltfEtc2Sources,
  decodeGltfContainer,
  encodeGltfContainer,
  parseGltfEtc2Attachments,
} from "../../scripts/gltf-etc2-authoring.mjs";

const encoder = new TextEncoder();

const chunk = (type, data) => ({ data: Uint8Array.from(data), type });

const glb = (value, trailingChunks = []) => encodeGltfContainer({
  format: "glb",
  trailingChunks,
}, value);

const inspection = (colorSpace) => ({
  colorSpace,
  height: 1024,
  levelCount: 11,
  storageBytes: 1_398_128,
  width: 1024,
});

const document = () => ({
  asset: { version: "2.0" },
  extensionsUsed: ["KHR_materials_specular"],
  images: [{ uri: "base.png" }, { uri: "normal.png" }],
  materials: [{
    normalTexture: { index: 1 },
    pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
  }],
  textures: [{ source: 0 }, { source: 1 }],
});

describe("offline glTF ETC2 attachment", () => {
  it("validates strict batch attachment records", () => {
    expect(parseGltfEtc2Attachments([
      { textureIndex: 0, uri: "textures/base.ktx2" },
      { textureIndex: 12, uri: "../shared/normal.ktx2" },
    ])).toEqual([
      { textureIndex: 0, uri: "textures/base.ktx2" },
      { textureIndex: 12, uri: "../shared/normal.ktx2" },
    ]);

    expect(() => parseGltfEtc2Attachments({})).toThrow("must be an array");
    expect(() => parseGltfEtc2Attachments([
      { textureIndex: 0, uri: "base.ktx2", quality: "best" },
    ])).toThrow("supports only textureIndex and uri");
    expect(() => parseGltfEtc2Attachments([
      { textureIndex: -1, uri: "base.ktx2" },
    ])).toThrow("non-negative integer");
    for (const uri of ["", "/base.ktx2", "https://example.test/base.ktx2", "base.ktx2?v=2"]) {
      expect(() => parseGltfEtc2Attachments([{ textureIndex: 0, uri }]))
        .toThrow("relative file path without query or fragment");
    }
  });

  it("round-trips GLB JSON while preserving every payload chunk byte-for-byte", () => {
    const chunks = [
      chunk(0x004e4942, [0, 1, 2, 3, 4, 5, 6, 7]),
      chunk(0x1234_5678, [8, 9, 10, 11]),
    ];
    const decoded = decodeGltfContainer(glb(document(), chunks), "scene.glb");
    expect(decoded.format).toBe("glb");
    expect(decoded.document).toEqual(document());
    expect(decoded.trailingChunks).toEqual(chunks);

    const rewritten = attachGltfEtc2Sources(decoded.document, [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "base.ktx2" },
    ]).document;
    const reparsed = decodeGltfContainer(encodeGltfContainer(decoded, rewritten), "output.glb");
    expect(reparsed.document.textures[0].extensions.GS_texture_etc2).toEqual({ source: 2 });
    expect(reparsed.trailingChunks).toEqual(chunks);
  });

  it("parses JSON glTF and emits deterministic formatted JSON", () => {
    const decoded = decodeGltfContainer(encoder.encode(JSON.stringify(document())), "scene.gltf");
    expect(decoded).toEqual({ document: document(), format: "gltf", trailingChunks: [] });
    expect(new TextDecoder().decode(encodeGltfContainer(decoded, decoded.document)))
      .toBe(`${JSON.stringify(document(), null, 2)}\n`);
  });

  it("rejects malformed GLB structure instead of dropping payload bytes", () => {
    const valid = glb(document(), [chunk(0x004e4942, [0, 1, 2, 3])]);
    const version = valid.slice();
    new DataView(version.buffer).setUint32(4, 1, true);
    expect(() => decodeGltfContainer(version)).toThrow("version must be 2");

    const length = valid.slice();
    new DataView(length.buffer).setUint32(8, length.byteLength - 4, true);
    expect(() => decodeGltfContainer(length)).toThrow("does not match");

    const unaligned = valid.slice();
    new DataView(unaligned.buffer).setUint32(12, 3, true);
    expect(() => decodeGltfContainer(unaligned)).toThrow("must be 4-byte aligned");

    const oversized = valid.slice();
    new DataView(oversized.buffer).setUint32(12, valid.byteLength, true);
    expect(() => decodeGltfContainer(oversized)).toThrow("exceeds the declared container length");

    const missingJson = valid.slice();
    new DataView(missingJson.buffer).setUint32(16, 0x004e4942, true);
    expect(() => decodeGltfContainer(missingJson)).toThrow("first chunk must be JSON");

    const duplicateJson = glb(document(), [chunk(0x004e4942, [0x20, 0x20, 0x20, 0x20])]);
    new DataView(duplicateJson.buffer).setUint32(
      duplicateJson.byteLength - 8,
      0x4e4f534a,
      true,
    );
    expect(() => decodeGltfContainer(duplicateJson)).toThrow("more than one JSON chunk");
  });

  it("adds validated optional sources without mutating fallback intent", () => {
    const input = document();
    const { attachments, document: output } = attachGltfEtc2Sources(input, [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "base.ktx2" },
      { inspection: inspection("linear"), textureIndex: 1, uri: "normal.ktx2" },
    ]);

    expect(input.textures).toEqual([{ source: 0 }, { source: 1 }]);
    expect(output.extensionsUsed).toEqual(["KHR_materials_specular", "GS_texture_etc2"]);
    expect(output.images).toEqual([
      { uri: "base.png" },
      { uri: "normal.png" },
      { mimeType: "image/ktx2", uri: "base.ktx2" },
      { mimeType: "image/ktx2", uri: "normal.ktx2" },
    ]);
    expect(output.textures).toEqual([
      { extensions: { GS_texture_etc2: { source: 2 } }, source: 0 },
      { extensions: { GS_texture_etc2: { source: 3 } }, source: 1 },
    ]);
    expect(attachments.map(({ colorSpace, storageBytes, textureIndex }) => ({
      colorSpace,
      storageBytes,
      textureIndex,
    }))).toEqual([
      { colorSpace: "srgb", storageBytes: 1_398_128, textureIndex: 0 },
      { colorSpace: "linear", storageBytes: 1_398_128, textureIndex: 1 },
    ]);
  });

  it("rejects absent fallbacks, ambiguous use, color mismatch, and duplicate attachment", () => {
    const noFallback = document();
    delete noFallback.textures[0].source;
    expect(() => attachGltfEtc2Sources(noFallback, [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "base.ktx2" },
    ])).toThrow("must provide a valid core fallback");

    const ambiguous = document();
    ambiguous.materials[0].normalTexture.index = 0;
    expect(() => attachGltfEtc2Sources(ambiguous, [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "shared.ktx2" },
    ])).toThrow("shared by linear and sRGB");

    expect(() => attachGltfEtc2Sources(document(), [
      { inspection: inspection("linear"), textureIndex: 0, uri: "base.ktx2" },
    ])).toThrow("requires srgb storage");

    expect(() => attachGltfEtc2Sources(document(), [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "first.ktx2" },
      { inspection: inspection("srgb"), textureIndex: 0, uri: "second.ktx2" },
    ])).toThrow("textureIndex is duplicated");
  });

  it("preserves unrelated texture extensions and refuses required-only authoring", () => {
    const input = document();
    input.textures[0].extensions = { EXT_texture_webp: { source: 0 } };
    const { document: output } = attachGltfEtc2Sources(input, [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "base.ktx2" },
    ]);
    expect(output.textures[0].extensions).toEqual({
      EXT_texture_webp: { source: 0 },
      GS_texture_etc2: { source: 2 },
    });

    const required = document();
    required.extensionsRequired = ["GS_texture_etc2"];
    expect(() => attachGltfEtc2Sources(required, [
      { inspection: inspection("srgb"), textureIndex: 0, uri: "base.ktx2" },
    ])).toThrow("authors optional fallback assets");
  });
});
