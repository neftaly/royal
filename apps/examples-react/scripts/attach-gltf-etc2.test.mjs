import { describe, expect, it } from "vitest";
import { attachGltfEtc2Sources } from "./attach-gltf-etc2.mjs";

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
