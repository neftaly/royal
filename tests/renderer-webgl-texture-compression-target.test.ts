import { describe, expect, it, vi } from "vitest";
import {
  activateGltfBasisuTranscodeTarget,
  gltfBasisuTargetAcceptsBaseDimensions,
  selectGltfBasisuTranscodeTarget,
} from "../packages/renderer-webgl/src/texture/compression-target";

describe("glTF BasisU texture compression target", () => {
  it("prefers ASTC, BC7, BC3, then ETC2 and requires the BC3 sRGB companion", () => {
    expect(selectGltfBasisuTranscodeTarget(new Set([
      "WEBGL_compressed_texture_astc",
      "EXT_texture_compression_bptc",
      "WEBGL_compressed_texture_etc",
    ]))).toBe("astc-4x4");
    expect(selectGltfBasisuTranscodeTarget(new Set([
      "EXT_texture_compression_bptc",
      "WEBGL_compressed_texture_etc",
    ]))).toBe("bc7");
    expect(selectGltfBasisuTranscodeTarget(new Set([
      "WEBGL_compressed_texture_s3tc",
      "WEBGL_compressed_texture_s3tc_srgb",
      "WEBGL_compressed_texture_etc",
    ]))).toBe("bc3");
    expect(selectGltfBasisuTranscodeTarget(new Set([
      "WEBGL_compressed_texture_s3tc",
      "WEBGL_compressed_texture_etc",
    ]))).toBe("etc2");
    expect(selectGltfBasisuTranscodeTarget(new Set())).toBe("rgba32");
  });

  it("falls through when an advertised extension cannot be activated", () => {
    const getExtension = vi.fn((name: string) =>
      name === "EXT_texture_compression_bptc" ? null : {});
    const gl = {
      getExtension,
      getSupportedExtensions: () => [
        "EXT_texture_compression_bptc",
        "WEBGL_compressed_texture_etc",
      ],
    } as unknown as WebGL2RenderingContext;

    expect(activateGltfBasisuTranscodeTarget(gl)).toBe("etc2");
    expect(getExtension.mock.calls.map(([name]) => name)).toEqual([
      "EXT_texture_compression_bptc",
      "WEBGL_compressed_texture_etc",
    ]);
  });

  it("rejects non-block-aligned BC top levels without restricting ETC2 or ASTC", () => {
    expect(gltfBasisuTargetAcceptsBaseDimensions("bc7", 10, 12)).toBe(false);
    expect(gltfBasisuTargetAcceptsBaseDimensions("bc3", 12, 10)).toBe(false);
    expect(gltfBasisuTargetAcceptsBaseDimensions("bc7", 12, 16)).toBe(true);
    expect(gltfBasisuTargetAcceptsBaseDimensions("etc2", 10, 10)).toBe(true);
    expect(gltfBasisuTargetAcceptsBaseDimensions("astc-4x4", 10, 10)).toBe(true);
  });
});
