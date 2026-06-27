import { describe, expect, it } from "vitest";
import {
  collectRendererCapabilityRows,
  type RendererCapabilityProbeRow,
  type WebGlLikeContext,
} from "../src/webgl/webgl-capabilities";

type FakeWebGlInput = {
  readonly versionLabel: string;
  readonly shadingLanguageVersion?: string;
  readonly supportedExtensions?: readonly string[];
  readonly extensionObjects?: Readonly<Record<string, unknown>>;
  readonly compressedFormats?: readonly number[];
  readonly maxTextureSize?: number;
  readonly maxTextureImageUnits?: number;
  readonly maxCombinedTextureImageUnits?: number;
  readonly webgl2Constants?: boolean;
};

const VERSION = 0x1F02;
const SHADING_LANGUAGE_VERSION = 0x8B8C;
const VENDOR = 0x1F00;
const RENDERER = 0x1F01;
const MAX_TEXTURE_SIZE = 0x0D33;
const MAX_TEXTURE_IMAGE_UNITS = 0x8872;
const MAX_COMBINED_TEXTURE_IMAGE_UNITS = 0x8B4D;
const COMPRESSED_TEXTURE_FORMATS = 0x86A3;

const fakeWebGl = (input: FakeWebGlInput): WebGlLikeContext => {
  return {
    COMPRESSED_TEXTURE_FORMATS,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS,
    MAX_TEXTURE_IMAGE_UNITS,
    MAX_TEXTURE_SIZE,
    RENDERER,
    SHADING_LANGUAGE_VERSION,
    VENDOR,
    VERSION,
    ...(input.webgl2Constants === true ? { READ_BUFFER: 0x0C02, TEXTURE_3D: 0x806F, beginQuery: () => undefined } : {}),
    getExtension: (name) => input.extensionObjects?.[name] ?? null,
    getParameter: (name) => {
      switch (name) {
        case VERSION:
          return input.versionLabel;
        case SHADING_LANGUAGE_VERSION:
          return input.shadingLanguageVersion ?? "WebGL GLSL ES 1.0";
        case VENDOR:
          return "Royal Fake GPU Vendor";
        case RENDERER:
          return "Royal Fake GPU";
        case MAX_TEXTURE_SIZE:
          return input.maxTextureSize ?? 4096;
        case MAX_TEXTURE_IMAGE_UNITS:
          return input.maxTextureImageUnits ?? 8;
        case MAX_COMBINED_TEXTURE_IMAGE_UNITS:
          return input.maxCombinedTextureImageUnits ?? 16;
        case COMPRESSED_TEXTURE_FORMATS:
          return input.compressedFormats ?? [];
        default:
          return undefined;
      }
    },
    getSupportedExtensions: () => input.supportedExtensions ?? [],
  };
};

const capability = (rows: readonly RendererCapabilityProbeRow[], name: string): RendererCapabilityProbeRow | undefined => {
  const row = rows.find((candidate) =>
    candidate.kind === "renderer_capability" && candidate.capability === name
  );
  expect(row).toBeDefined();
  return row;
};

describe("collectRendererCapabilityRows", () => {
  it("produces deterministic WebGL1 capability, extension, timer, compressed-format, and limit rows", () => {
    const result = collectRendererCapabilityRows(fakeWebGl({
      compressedFormats: [0x83F0, 0x9274],
      extensionObjects: {
        ANGLE_instanced_arrays: {},
        EXT_disjoint_timer_query: {},
        EXT_texture_filter_anisotropic: {},
        OES_texture_float: {},
        WEBGL_compressed_texture_s3tc: {
          COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83F1,
          COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83F0,
        },
        WEBGL_draw_buffers: {},
        WEBGL_lose_context: {},
      },
      maxCombinedTextureImageUnits: 24,
      maxTextureImageUnits: 12,
      maxTextureSize: 8192,
      supportedExtensions: [
        "WEBGL_lose_context",
        "WEBGL_draw_buffers",
        "OES_texture_float",
        "EXT_texture_filter_anisotropic",
        "EXT_disjoint_timer_query",
        "WEBGL_compressed_texture_s3tc",
        "ANGLE_instanced_arrays",
      ],
      versionLabel: "WebGL 1.0",
    }));

    expect(result.rows.map((row) => row.kind)).toEqual([
      "context_version",
      "max_texture_size",
      "max_texture_units",
      "max_texture_units",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "renderer_capability",
      "webgl_extension",
      "webgl_extension",
      "webgl_extension",
      "webgl_extension",
      "webgl_extension",
      "webgl_extension",
      "webgl_extension",
      "gpu_timer_query_support",
      "compressed_texture_format",
      "compressed_texture_format",
      "compressed_texture_format",
    ]);
    expect(capability(result.rows, "draw_buffers")).toMatchObject({
      extension: "WEBGL_draw_buffers",
      source: "webgl-extension",
      supported: true,
    });
    expect(capability(result.rows, "gpu_timer_query")).toMatchObject({
      extension: "EXT_disjoint_timer_query",
      supported: true,
    });
    expect(result.rows.filter((row) => row.kind === "webgl_extension")).toEqual([
      { kind: "webgl_extension", name: "ANGLE_instanced_arrays", supported: true },
      { kind: "webgl_extension", name: "EXT_disjoint_timer_query", supported: true },
      { kind: "webgl_extension", name: "EXT_texture_filter_anisotropic", supported: true },
      { kind: "webgl_extension", name: "OES_texture_float", supported: true },
      { kind: "webgl_extension", name: "WEBGL_compressed_texture_s3tc", supported: true },
      { kind: "webgl_extension", name: "WEBGL_draw_buffers", supported: true },
      { kind: "webgl_extension", name: "WEBGL_lose_context", supported: true },
    ]);
    expect(result.rows.filter((row) => row.kind === "compressed_texture_format")).toEqual([
      {
        extension: "WEBGL_compressed_texture_s3tc",
        family: "s3tc",
        format: "COMPRESSED_RGB_S3TC_DXT1_EXT",
        kind: "compressed_texture_format",
        value: 0x83F0,
      },
      {
        extension: "WEBGL_compressed_texture_s3tc",
        family: "s3tc",
        format: "COMPRESSED_RGBA_S3TC_DXT1_EXT",
        kind: "compressed_texture_format",
        value: 0x83F1,
      },
      {
        extension: "webgl_reported",
        family: "unknown",
        format: "0x9274",
        kind: "compressed_texture_format",
        value: 0x9274,
      },
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.key)).toEqual([
      "depth_texture",
      "half_float_texture",
      "webgl2",
    ]);
  });

  it("treats WebGL2 core features as supported without browser globals", () => {
    const result = collectRendererCapabilityRows(fakeWebGl({
      extensionObjects: {
        EXT_disjoint_timer_query_webgl2: {},
        WEBGL_compressed_texture_astc: {},
      },
      supportedExtensions: [
        "WEBGL_compressed_texture_astc",
        "EXT_disjoint_timer_query_webgl2",
      ],
      versionLabel: "WebGL 2.0",
      webgl2Constants: true,
    }), {
      webgpu: {
        features: ["texture-compression-bc", "timestamp-query"],
        limits: { maxTextureDimension2D: 16384 },
        status: "available",
      },
    });

    expect(capability(result.rows, "webgl2")).toMatchObject({
      source: "webgl2-core",
      supported: true,
    });
    expect(capability(result.rows, "depth_texture")).toMatchObject({
      source: "webgl2-core",
      supported: true,
    });
    expect(capability(result.rows, "instancing")).toMatchObject({
      source: "webgl2-core",
      supported: true,
    });
    expect(result.rows).toContainEqual({
      extension: "EXT_disjoint_timer_query_webgl2",
      kind: "gpu_timer_query_support",
      queryApi: "webgl2",
      supported: true,
    });
    expect(result.rows.filter((row) => row.kind === "webgpu_feature_gate")).toEqual([
      { feature: "texture-compression-bc", kind: "webgpu_feature_gate", supported: true },
      { feature: "timestamp-query", kind: "webgpu_feature_gate", supported: true },
    ]);
    expect(result.rows).toContainEqual({
      kind: "webgpu_limit",
      name: "maxTextureDimension2D",
      value: 16384,
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.key)).toEqual(["anisotropy", "lose_context"]);
  });

  it("reports stable missing-gate diagnostics for a minimal fake context", () => {
    const result = collectRendererCapabilityRows(fakeWebGl({
      supportedExtensions: [],
      versionLabel: "WebGL 1.0",
    }), {
      webgpu: {
        reason: "navigator.gpu unavailable in this runtime",
        status: "unavailable",
      },
    });

    expect(result.rows).toContainEqual({
      api: "webgl",
      kind: "context_version",
      renderer: "Royal Fake GPU",
      shadingLanguageVersion: "WebGL GLSL ES 1.0",
      vendor: "Royal Fake GPU Vendor",
      version: 1,
      versionLabel: "WebGL 1.0",
    });
    expect(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.key])).toEqual([
      ["renderer_capability_missing", "anisotropy"],
      ["renderer_capability_missing", "compressed_texture"],
      ["renderer_capability_missing", "depth_texture"],
      ["renderer_capability_missing", "draw_buffers"],
      ["renderer_capability_missing", "float_texture"],
      ["renderer_capability_missing", "gpu_timer_query"],
      ["renderer_capability_missing", "half_float_texture"],
      ["renderer_capability_missing", "instancing"],
      ["renderer_capability_missing", "lose_context"],
      ["renderer_capability_missing", "webgl2"],
      ["webgpu_unavailable", "webgpu"],
    ]);
  });
});
