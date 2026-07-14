import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RESOURCE_GOVERNOR_POLICY } from "@royal/renderer-webgl";
import type { RendererOptions } from "@royal/react";
import {
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

  it("retains normalized scalar changes that recreate the renderer root", () => {
    expect(normalizeCanvasRendererOptions({ alpha: false })).toEqual({ alpha: false });
    expect(normalizeCanvasRendererOptions({ alpha: true })).toEqual({ alpha: true });
    expect(normalizeCanvasRendererOptions({ generatedSvgVirtualTextureMaxDimension: 8_192 }))
      .toEqual({ generatedSvgVirtualTextureMaxDimension: 8_192 });
  });

  it("retains a supplied resource governor policy for root construction", () => {
    expect(normalizeCanvasRendererOptions({
      resourceGovernorPolicy: DEFAULT_RESOURCE_GOVERNOR_POLICY,
    })).toEqual({ resourceGovernorPolicy: DEFAULT_RESOURCE_GOVERNOR_POLICY });
  });

  it("retains the root for equivalent rendererOptions and recreates it for semantic changes", () => {
    const first = rendererRootOptionsSemanticKey({
      alpha: true,
      resourceGovernorPolicy: DEFAULT_RESOURCE_GOVERNOR_POLICY,
    });
    const reordered = rendererRootOptionsSemanticKey({
      resourceGovernorPolicy: {
        limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits },
        classes: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.classes },
      },
      alpha: true,
    });
    const changed = rendererRootOptionsSemanticKey({
      alpha: true,
      resourceGovernorPolicy: {
        ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
        limits: {
          ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits,
          jobs: DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.jobs + 1,
        },
      },
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
      generatedSvgVirtualTextureMaxDimension: 16_384,
      resourceGovernorPolicy: DEFAULT_RESOURCE_GOVERNOR_POLICY,
    });

    expect(rendererRootOptionsSemanticKey({})).toBe(omitted);
    expect(explicit).toBe(omitted);
    expect(rendererRootOptionsSemanticKey({ alpha: false })).not.toBe(omitted);
  });

  it("gives concise and fully expanded resource overrides one semantic identity", () => {
    const concise = rendererRootOptionsSemanticKey({
      resourceGovernorPolicy: { limits: { jobs: 3 } },
    });
    const expanded = rendererRootOptionsSemanticKey({
      resourceGovernorPolicy: {
        ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
        limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, jobs: 3 },
      },
    });

    expect(concise).toBe(expanded);
  });

  it("ignores unknown or undefined runtime policy fields in semantic identity", () => {
    const noisy = {
      resourceGovernorPolicy: { limits: { ignored: 1, jobs: undefined } },
    } as unknown as RendererOptions;

    expect(rendererRootOptionsSemanticKey(noisy))
      .toBe(rendererRootOptionsSemanticKey(undefined));
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
