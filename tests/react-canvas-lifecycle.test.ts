import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RESOURCE_GOVERNOR_POLICY } from "@royal/renderer-webgl";
import {
  disposeCanvasRendererRoot,
  normalizeCanvasRendererOptions,
} from "../packages/react/src/canvas";
import { fakeRendererRoot } from "./react-test-fixtures";

describe("Canvas renderer root cleanup", () => {
  it("normalizes omitted and empty context options to the same effect identity", () => {
    expect(normalizeCanvasRendererOptions(undefined)).toBeUndefined();
    expect(normalizeCanvasRendererOptions({})).toBeUndefined();
  });

  it("retains normalized scalar changes that recreate the renderer root", () => {
    expect(normalizeCanvasRendererOptions({ alpha: false })).toEqual({
      context: { alpha: false },
    });
    expect(normalizeCanvasRendererOptions({ alpha: true })).toEqual({
      context: { alpha: true },
    });
    expect(normalizeCanvasRendererOptions({ generatedSvgVirtualTextureRasterDensity: 8 })).toEqual({
      context: { generatedSvgVirtualTextureRasterDensity: 8 },
    });
  });

  it("retains a supplied resource governor policy for root construction", () => {
    expect(normalizeCanvasRendererOptions({
      resourceGovernorPolicy: DEFAULT_RESOURCE_GOVERNOR_POLICY,
    })).toEqual({
      context: { resourceGovernorPolicy: DEFAULT_RESOURCE_GOVERNOR_POLICY },
    });
  });

  it("releases ownership before surfacing a dispose failure", () => {
    const root = fakeRendererRoot();
    const rootRef = { current: root };
    const failure = new Error("dispose failed");
    vi.mocked(root.dispose).mockImplementation(() => {
      expect(rootRef.current).toBeNull();
      throw failure;
    });

    expect(() => disposeCanvasRendererRoot(rootRef, root)).toThrow(failure);
    expect(rootRef.current).toBeNull();
    expect(root.dispose).toHaveBeenCalledOnce();
  });

  it("does not clear a replacement root during option-driven recreation", () => {
    const previousRoot = fakeRendererRoot();
    const replacementRoot = fakeRendererRoot();
    const rootRef = { current: replacementRoot };

    disposeCanvasRendererRoot(rootRef, previousRoot);

    expect(previousRoot.dispose).toHaveBeenCalledOnce();
    expect(rootRef.current).toBe(replacementRoot);
  });

  it("supports StrictMode-style dispose and remount sequences", () => {
    const firstRoot = fakeRendererRoot();
    const secondRoot = fakeRendererRoot();
    const rootRef = { current: firstRoot };

    disposeCanvasRendererRoot(rootRef, firstRoot);
    rootRef.current = secondRoot;
    disposeCanvasRendererRoot(rootRef, secondRoot);

    expect(firstRoot.dispose).toHaveBeenCalledOnce();
    expect(secondRoot.dispose).toHaveBeenCalledOnce();
    expect(rootRef.current).toBeNull();
  });
});
