import { describe, expect, it } from "vitest";
import { normalizeBistroWebDocument } from "./normalize-bistro-web.mjs";

describe("Bistro web ingestion normalization", () => {
  it("moves AVIF image identity onto the ordinary texture source without mutating input", () => {
    const input = {
      extensionsRequired: ["KHR_draco_mesh_compression", "EXT_texture_avif"],
      extensionsUsed: ["KHR_draco_mesh_compression", "EXT_texture_avif"],
      textures: [{
        extensions: {
          EXT_texture_avif: { source: 4 },
          ROYAL_other: { retained: true },
        },
        sampler: 2,
      }],
    };
    const result = normalizeBistroWebDocument(input);
    expect(result.normalizedTextures).toBe(1);
    expect(result.document).toEqual({
      extensionsRequired: ["KHR_draco_mesh_compression"],
      extensionsUsed: ["KHR_draco_mesh_compression"],
      textures: [{
        extensions: { ROYAL_other: { retained: true } },
        sampler: 2,
        source: 4,
      }],
    });
    expect(input.textures[0].source).toBeUndefined();
  });

  it("rejects absent and conflicting AVIF source declarations", () => {
    expect(() => normalizeBistroWebDocument({ textures: [] }))
      .toThrow("does not use EXT_texture_avif");
    expect(() => normalizeBistroWebDocument({
      textures: [{
        extensions: { EXT_texture_avif: { source: 1 } },
        source: 2,
      }],
    })).toThrow("conflicting texture sources");
  });
});
