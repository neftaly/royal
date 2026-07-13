import { describe, expect, it, vi } from "vitest";
import {
  createStrictWebGl2Context,
  createWebGlTestCanvas,
} from "./webgl-test-harness";

describe("shared WebGL test harness", () => {
  it("fails fast when production code reaches an unmodeled WebGL API", () => {
    const { gl } = createStrictWebGl2Context();

    expect(() => (gl as unknown as Record<string, unknown>).unmodeledExtensionPoint).toThrow(
      "Strict WebGL2 test context does not implement \"unmodeledExtensionPoint\"",
    );
  });

  it("composes focused behavior overrides while retaining call recording", () => {
    const createTexture = vi.fn(() => null);
    const { calls, gl } = createStrictWebGl2Context({
      methods: { createTexture },
      parameters: { 0x0D33: 8192 },
    });

    expect(gl.getParameter(gl.MAX_TEXTURE_SIZE)).toBe(8192);
    expect(gl.createTexture()).toBeNull();
    expect(createTexture).toHaveBeenCalledOnce();
    expect(calls.map(({ name }) => name)).toEqual(["getParameter", "createTexture"]);
  });

  it("models context attributes and browser context lifecycle events", () => {
    const { gl } = createStrictWebGl2Context();
    const canvas = createWebGlTestCanvas(gl);
    const lost = vi.fn((event: Event) => event.preventDefault());
    const restored = vi.fn();
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);

    expect(canvas.getContext("webgl2", { alpha: false, antialias: false })).toBe(gl);
    expect(gl.getContextAttributes()).toMatchObject({ alpha: false, antialias: false });
    expect(canvas.dispatchContextEvent("webglcontextlost").defaultPrevented).toBe(true);
    canvas.dispatchContextEvent("webglcontextrestored");
    expect(lost).toHaveBeenCalledOnce();
    expect(restored).toHaveBeenCalledOnce();
  });
});
