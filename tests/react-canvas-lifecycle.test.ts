import { describe, expect, it, vi } from "vitest";
import {
  canvasContextOptionsSemanticKey,
  disposeCanvasRendererRoot,
  normalizeCanvasRendererOptions,
} from "../packages/react/src/canvas-renderer-runtime";
import { rendererRootOptionsSemanticKey } from "../packages/react/src/root";
import { fakeRendererRoot } from "./react-test-fixtures";

describe("Canvas renderer root cleanup", () => {
  it("normalizes omitted and empty renderer options to the same effect identity", () => {
    expect(normalizeCanvasRendererOptions(undefined)).toBeUndefined();
    expect(normalizeCanvasRendererOptions({})).toBeUndefined();
  });

  it("replaces the DOM canvas only for immutable WebGL context attributes", () => {
    const defaults = canvasContextOptionsSemanticKey(undefined);
    expect(canvasContextOptionsSemanticKey({})).toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ alpha: true, antialias: true })).toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ generatedImageVirtualTextures: true })).toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ alpha: false })).not.toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ antialias: false })).not.toBe(defaults);
  });

  it("retains normalized context changes that recreate the renderer root", () => {
    expect(normalizeCanvasRendererOptions({ alpha: false })).toEqual({ alpha: false });
    expect(normalizeCanvasRendererOptions({ alpha: true })).toEqual({ alpha: true });
  });

  it("retains the root for equivalent rendererOptions and recreates it for semantic changes", () => {
    const first = rendererRootOptionsSemanticKey({
      alpha: true,
      antialias: false,
    });
    const reordered = rendererRootOptionsSemanticKey({
      antialias: false,
      alpha: true,
    });
    const changed = rendererRootOptionsSemanticKey({
      alpha: true,
      antialias: true,
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("gives omitted and explicit renderer defaults one semantic identity", () => {
    const omitted = rendererRootOptionsSemanticKey(undefined);
    const explicit = rendererRootOptionsSemanticKey({
      alpha: true,
      antialias: true,
      generatedImageVirtualTextures: false,
    });

    expect(rendererRootOptionsSemanticKey({})).toBe(omitted);
    expect(explicit).toBe(omitted);
    expect(rendererRootOptionsSemanticKey({ alpha: false })).not.toBe(omitted);
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
