import { describe, expect, it, vi } from "vitest";
import {
  canvasContextOptionsSemanticKey,
  disposeCanvasRendererRoot,
} from "../packages/react/src/canvas-renderer-runtime";
import {
  rendererRootOptionsSemanticKey,
  validateRendererOptions,
} from "../packages/react/src/root";
import { fakeRendererRoot } from "./react-test-fixtures";

describe("Canvas renderer root cleanup", () => {
  it("rejects unknown renderer option names before deriving lifetime identity", () => {
    expect(() => validateRendererOptions({
      automaticVirtualTexture: true,
    } as unknown as Parameters<typeof validateRendererOptions>[0]))
      .toThrow(/unsupported option.*automaticVirtualTexture/i);
    expect(() => rendererRootOptionsSemanticKey([] as unknown as Parameters<typeof rendererRootOptionsSemanticKey>[0]))
      .toThrow("Renderer options must be an object");
  });

  it("replaces the DOM canvas only for immutable WebGL context attributes", () => {
    const defaults = canvasContextOptionsSemanticKey(undefined);
    expect(canvasContextOptionsSemanticKey({})).toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ alpha: true, antialias: true })).toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ automaticVirtualTextures: true })).toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ alpha: false })).not.toBe(defaults);
    expect(canvasContextOptionsSemanticKey({ antialias: false })).not.toBe(defaults);
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
    const changedBudgets = rendererRootOptionsSemanticKey({
      alpha: true,
      antialias: false,
      resourceBudgets: { cpuDecodedBytes: 768 * 1024 * 1024 },
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
    expect(changedBudgets).not.toBe(first);
  });

  it("gives omitted and explicit renderer defaults one semantic identity", () => {
    const omitted = rendererRootOptionsSemanticKey(undefined);
    const explicit = rendererRootOptionsSemanticKey({
      alpha: true,
      antialias: true,
      automaticVirtualTextures: false,
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
