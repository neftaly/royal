import { describe, expect, it } from "vitest";
import { resolveWebGlRootOptions } from "@royal/renderer-webgl";

describe("WebGL root option normalization", () => {
  it("resolves defaults and rejects unknown or malformed options", () => {
    const defaults = resolveWebGlRootOptions();
    expect(defaults).toEqual({
      alpha: true,
      antialias: true,
      automaticVirtualTextures: false,
    });
    expect(resolveWebGlRootOptions({})).toEqual(defaults);
    expect(resolveWebGlRootOptions({ alpha: false, automaticVirtualTextures: true })).toEqual({
      alpha: false,
      antialias: true,
      automaticVirtualTextures: true,
    });
    expect(() => resolveWebGlRootOptions({
      automaticVirtualTexture: true,
    } as unknown as Parameters<typeof resolveWebGlRootOptions>[0])).toThrow(/unsupported option/);
    expect(() => resolveWebGlRootOptions({
      alpha: 1,
    } as unknown as Parameters<typeof resolveWebGlRootOptions>[0])).toThrow(/alpha must be a boolean/);
  });
});
