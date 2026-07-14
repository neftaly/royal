import { describe, expect, it } from "vitest";
import { WebGlContextCapabilityOwner } from "../packages/renderer-webgl/src/context-capability-owner";
import { createStrictWebGl2Context } from "./webgl-test-harness";

describe("WebGlContextCapabilityOwner", () => {
  it("owns negotiated attributes and refreshes an immutable capability snapshot", () => {
    let attributes: WebGLContextAttributes | null = { alpha: false, antialias: true };
    const parallelShaderCompile = { COMPLETION_STATUS_KHR: 0x91b1 };
    const { gl } = createStrictWebGl2Context({
      extensions: {
        EXT_color_buffer_float: {},
        KHR_parallel_shader_compile: parallelShaderCompile,
      },
      methods: { getContextAttributes: () => attributes },
      parameters: {
        0x0D33: 8192,
        0x8872: 12,
      },
    });
    const owner = new WebGlContextCapabilityOwner(gl, { alpha: false });

    expect(owner.attributes).toEqual({ alpha: false, antialias: true });
    expect(Object.isFrozen(owner.attributes)).toBe(true);
    expect(owner.probe()).toEqual({
      hdrColorBuffer: true,
      maxTextureImageUnits: 12,
      maxTextureSize: 8192,
      parallelShaderCompile,
    });
    expect(Object.isFrozen(owner.capabilities)).toBe(true);

    attributes = { alpha: false, antialias: true };
    expect(owner.validateRestoreAndProbe()).toBe(owner.capabilities);
    attributes = { alpha: true, antialias: true };
    expect(() => owner.validateRestoreAndProbe())
      .toThrow("Royal WebGL context requested alpha=false but received alpha=true");
  });

  it("rejects unavailable attributes and sanitizes non-finite numeric capabilities", () => {
    const unavailable = createStrictWebGl2Context({
      methods: { getContextAttributes: () => null },
    });
    expect(() => new WebGlContextCapabilityOwner(unavailable.gl))
      .toThrow("Royal WebGL context attributes are unavailable");

    const invalidLimits = createStrictWebGl2Context({
      extensions: {},
      parameters: {
        0x0D33: Number.POSITIVE_INFINITY,
        0x8872: Number.NaN,
      },
    });
    const owner = new WebGlContextCapabilityOwner(invalidLimits.gl);
    expect(owner.probe()).toEqual({
      hdrColorBuffer: false,
      maxTextureImageUnits: 0,
      maxTextureSize: 0,
      parallelShaderCompile: undefined,
    });
  });

  it("rejects restored attribute drift when the original request used defaults", () => {
    let attributes: WebGLContextAttributes = { alpha: true, antialias: true };
    const { gl } = createStrictWebGl2Context({
      methods: { getContextAttributes: () => attributes },
    });
    const owner = new WebGlContextCapabilityOwner(gl);

    attributes = { alpha: true, antialias: false };
    expect(() => owner.validateRestoreAndProbe())
      .toThrow("Royal WebGL context restoration changed renderer context attributes");
  });
});
