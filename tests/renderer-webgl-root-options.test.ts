import { describe, expect, it } from "vitest";
import { resolveWebGlRootOptions } from "@royal/renderer-webgl";

describe("WebGL root option normalization", () => {
  it("resolves defaults and rejects unknown or malformed options", () => {
    const defaults = resolveWebGlRootOptions();
    expect(defaults).toMatchObject({
      alpha: true,
      antialias: true,
      automaticVirtualTextures: false,
    });
    expect(Object.isFrozen(defaults.resourceBudgets)).toBe(true);
    expect(resolveWebGlRootOptions({})).toEqual(defaults);
    expect(resolveWebGlRootOptions({ alpha: false, automaticVirtualTextures: true })).toEqual({
      alpha: false,
      antialias: true,
      automaticVirtualTextures: true,
      resourceBudgets: defaults.resourceBudgets,
    });
    const customBudgets = resolveWebGlRootOptions({
      resourceBudgets: { cpuDecodedBytes: 768 * 1024 * 1024 },
    }).resourceBudgets;
    expect(customBudgets.cpuDecodedBytes).toBe(768 * 1024 * 1024);
    expect(customBudgets.jobs).toBe(defaults.resourceBudgets.jobs);
    expect(Object.isFrozen(customBudgets)).toBe(true);
    expect(() => resolveWebGlRootOptions({
      automaticVirtualTexture: true,
    } as unknown as Parameters<typeof resolveWebGlRootOptions>[0])).toThrow(/unsupported option/);
    expect(() => resolveWebGlRootOptions({
      alpha: 1,
    } as unknown as Parameters<typeof resolveWebGlRootOptions>[0])).toThrow(/alpha must be a boolean/);
    expect(() => resolveWebGlRootOptions({
      resourceBudgets: { decodedCpuBytes: 1 },
    } as unknown as Parameters<typeof resolveWebGlRootOptions>[0])).toThrow(/unsupported option/);
    expect(() => resolveWebGlRootOptions({
      resourceBudgets: { jobs: 0 },
    })).toThrow(/jobs capacity must be at least 1/);
  });
});
