import { describe, expect, it } from "vitest";
import {
  probeWebGlCapabilities,
  rendererCapabilitySummary,
  rendererCapabilitySupported,
  type WebGlCapabilityProbeContext,
} from "@royal/renderer-webgl/capabilities";

type FakeCapabilityContext = {
  readonly gl: WebGlCapabilityProbeContext;
  readonly parameterQueries: readonly number[];
};

const fakeCapabilityContext = (
  versionLabel: string = "WebGL 2.0 Royal capability test",
): FakeCapabilityContext => {
  const parameterQueries: number[] = [];
  const extensions = new Set([
    "EXT_texture_filter_anisotropic",
    "WEBGL_lose_context",
  ]);
  const gl: WebGlCapabilityProbeContext = {
    COMPRESSED_TEXTURE_FORMATS: 0x86A3,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    RENDERER: 0x1F01,
    SHADING_LANGUAGE_VERSION: 0x8B8C,
    VENDOR: 0x1F00,
    VERSION: 0x1F02,
    beginQuery: () => undefined,
    getExtension: (name: string) => extensions.has(name) ? { name } : null,
    getParameter: (name: number) => {
      parameterQueries.push(name);
      switch (name) {
        case gl.COMPRESSED_TEXTURE_FORMATS:
          return new Uint32Array([0x83F0, 0x83F3]);
        case gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
          return 16;
        case gl.MAX_TEXTURE_IMAGE_UNITS:
          return 8;
        case gl.MAX_TEXTURE_SIZE:
          return 4096;
        case gl.RENDERER:
          return "Royal fake renderer";
        case gl.SHADING_LANGUAGE_VERSION:
          return "WebGL GLSL ES 3.00 Royal";
        case gl.VENDOR:
          return "Royal tests";
        case gl.VERSION:
          return versionLabel;
        default:
          return undefined;
      }
    },
    getSupportedExtensions: () => [...extensions],
  };

  return { gl, parameterQueries };
};

describe("renderer-webgl capabilities public API", () => {
  it("reports probed capabilities from a fake WebGL2-like context", () => {
    const { gl, parameterQueries } = fakeCapabilityContext();
    const result = probeWebGlCapabilities(gl);

    expect(result.rows).toContainEqual(expect.objectContaining({
      api: "webgl",
      kind: "context_version",
      renderer: "Royal fake renderer",
      shadingLanguageVersion: "WebGL GLSL ES 3.00 Royal",
      vendor: "Royal tests",
      version: 2,
      versionLabel: "WebGL 2.0 Royal capability test",
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "webgl2",
      kind: "renderer_capability",
      source: "webgl2-core",
      supported: true,
    }));
    expect(result.rows).not.toContainEqual(expect.objectContaining({
      capability: "webgpu",
      kind: "renderer_capability",
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "anisotropy",
      extension: "EXT_texture_filter_anisotropic",
      kind: "renderer_capability",
      source: "webgl-extension",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "draw_buffers",
      kind: "renderer_capability",
      source: "webgl2-core",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "depth_texture",
      kind: "renderer_capability",
      source: "webgl2-core",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "instancing",
      kind: "renderer_capability",
      source: "webgl2-core",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "float_texture",
      kind: "renderer_capability",
      source: "webgl2-core",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "half_float_texture",
      kind: "renderer_capability",
      source: "webgl2-core",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "lose_context",
      extension: "WEBGL_lose_context",
      kind: "renderer_capability",
      source: "webgl-extension",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      kind: "webgl_extension",
      name: "EXT_texture_filter_anisotropic",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      kind: "webgl_extension",
      name: "WEBGL_lose_context",
      supported: true,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      kind: "max_texture_size",
      value: 4096,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      kind: "max_texture_units",
      scope: "fragment",
      value: 8,
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      kind: "max_texture_units",
      scope: "combined",
      value: 16,
    }));
    expect(result.diagnostics).toEqual([]);
    expect(parameterQueries).toContain(gl.VERSION);
    expect(parameterQueries).toContain(gl.RENDERER);
    expect(parameterQueries).toContain(gl.SHADING_LANGUAGE_VERSION);
    expect(parameterQueries).toContain(gl.VENDOR);
    expect(parameterQueries).toContain(gl.MAX_TEXTURE_SIZE);
    expect(parameterQueries).toContain(gl.MAX_TEXTURE_IMAGE_UNITS);
    expect(parameterQueries).toContain(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);

    expect(rendererCapabilitySummary(result)).toMatchObject({
      anisotropy: true,
      compressed_texture: false,
      webgl2: true,
    });
    expect(rendererCapabilitySupported(result, "anisotropy")).toBe(true);
    expect(rendererCapabilitySupported(result.rows, "compressed_texture")).toBe(false);
  });

  it("requires a WebGL-like context instead of returning stubbed rows", () => {
    expect(() => probeWebGlCapabilities({})).toThrow(
      "Renderer capability probing requires a WebGL-like context",
    );
  });
});
