import type { RenderRoot } from "@royal/renderer-core";
import {
  rendererRootOptionsSemanticKey,
  type RoyalRendererRoot,
} from "@royal/renderer-webgl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  Canvas,
  createOrbitCameraController,
  createOrbitControls,
  GltfOrbitCameraFit,
  OrbitControls,
  type CanvasProps,
  createRendererRoot,
  useCanvasPick,
  useCanvasSize,
  useGltfAssetStatus,
  useTextureAssetStatus,
  useVirtualTextureStatus,
  useOrbitCamera,
  useOrbitCameraView,
  useRendererLifecycle,
} from "../../packages/react/src/index";
import { selectObservedRoot } from "../../packages/react/src/observation/select-root";
import { observeCanvasSize } from "../../packages/react/src/runtime/canvas";

const emptyScene = {
  camera: {},
  clearColor: [0, 0, 0, 0],
  kind: "scene",
  nodes: [],
} as unknown as RenderRoot;

describe("replacement React public API", () => {
  it("server-renders an ordinary canvas with stable pre-mount observation", () => {
    const Status = () => createElement("output", null, useRendererLifecycle().state);
    const html = renderToStaticMarkup(createElement(
      Canvas,
      { "aria-label": "preview", scene: emptyScene },
      createElement(Status),
    ));
    expect(html).toContain('<canvas aria-label="preview"></canvas>');
    expect(html).toContain("<output>unavailable</output>");
  });

  it("keeps Canvas an ordinary DOM boundary with explicit Royal ownership", () => {
    const props = {
      "aria-label": "preview",
      "data-testid": "royal",
      className: "viewport",
      rendererOptions: { alpha: false, antialias: true },
      scene: emptyScene,
    } satisfies CanvasProps;
    expect(createElement(Canvas, props).props).toMatchObject(props);
    expectTypeOf(createRendererRoot).toBeFunction();
    expectTypeOf(useCanvasSize).toBeFunction();
    expectTypeOf(useGltfAssetStatus).toBeFunction();
    expectTypeOf(useTextureAssetStatus).toBeFunction();
    expectTypeOf(useVirtualTextureStatus).toBeFunction();
    expectTypeOf(createOrbitCameraController).toBeFunction();
    expectTypeOf(createOrbitControls).toBeFunction();
    expectTypeOf(GltfOrbitCameraFit).toBeFunction();
    expectTypeOf(OrbitControls).toBeFunction();
    expectTypeOf(useOrbitCamera).toBeFunction();
    expectTypeOf(useOrbitCameraView).toBeFunction();
    expectTypeOf(useCanvasPick).toBeFunction();
    expectTypeOf(useRendererLifecycle).toBeFunction();
  });

  it("server-renders exact glTF status as idle before root mount", () => {
    const Status = () => createElement("output", null, useGltfAssetStatus("/model.glb").state);
    const html = renderToStaticMarkup(createElement(
      Canvas,
      { scene: emptyScene },
      createElement(Status),
    ));
    expect(html).toContain("<output>idle</output>");
  });

  it("server-renders authored VT status as idle before root mount", () => {
    const Status = () => createElement(
      "output",
      null,
      useVirtualTextureStatus("/map.vt.json").state,
    );
    const html = renderToStaticMarkup(createElement(
      Canvas,
      { scene: emptyScene },
      createElement(Status),
    ));
    expect(html).toContain("<output>idle</output>");
  });

  it("gives semantically equal creation options the same canvas lifetime", () => {
    expect(rendererRootOptionsSemanticKey(undefined)).toBe("11:1342177280");
    expect(rendererRootOptionsSemanticKey({})).toBe("11:1342177280");
    expect(rendererRootOptionsSemanticKey({ alpha: true, antialias: true }))
      .toBe("11:1342177280");
    expect(rendererRootOptionsSemanticKey({ alpha: false })).toBe("01:1342177280");
    expect(rendererRootOptionsSemanticKey({ antialias: false })).toBe("10:1342177280");
    expect(rendererRootOptionsSemanticKey({ persistentGpuByteBudget: 1024 })).toBe("11:1024");
  });

  it("rejects option aliases and invalid values instead of guessing", () => {
    expect(() => rendererRootOptionsSemanticKey({
      antiAlias: false,
    } as unknown as Parameters<typeof rendererRootOptionsSemanticKey>[0])).toThrow(
      "unsupported field antiAlias",
    );
    expect(() => rendererRootOptionsSemanticKey({
      alpha: 1,
    } as unknown as Parameters<typeof rendererRootOptionsSemanticKey>[0])).toThrow(
      "option alpha must be a boolean",
    );
    expect(() => rendererRootOptionsSemanticKey({ persistentGpuByteBudget: 0 })).toThrow(
      "persistentGpuByteBudget must be a positive safe integer",
    );
  });

  it("uses one context-or-explicit-root placement model", () => {
    const root = {} as RoyalRendererRoot;
    expect(selectObservedRoot(undefined, { root }, "useThing")).toBe(root);
    expect(selectObservedRoot(undefined, { root: null }, "useThing")).toBeNull();
    expect(selectObservedRoot(root, undefined, "useThing")).toBe(root);
    expect(() => selectObservedRoot(undefined, undefined, "useThing")).toThrow(
      "useThing must be used inside <Canvas> or receive { root }",
    );
  });

  it("observes canvas size without forcing layout and reuses it for DPR changes", () => {
    let observe: ResizeObserverCallback | undefined;
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    const canvas = { getBoundingClientRect: vi.fn() } as unknown as HTMLCanvasElement;
    const setSize = vi.fn();
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        observe = callback;
      }

      disconnect = disconnect;
      observe = vi.fn();
    });
    vi.stubGlobal("addEventListener", vi.fn((type: string, listener: () => void) => {
      if (type === "resize") resize = listener;
    }));
    vi.stubGlobal("removeEventListener", vi.fn());
    try {
      const release = observeCanvasSize(canvas, {
        setSize,
      } as unknown as RoyalRendererRoot);
      expect(canvas.getBoundingClientRect).not.toHaveBeenCalled();
      observe?.([
        { contentRect: { height: 180, width: 320 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
      expect(setSize).toHaveBeenLastCalledWith({
        cssHeight: 180,
        cssWidth: 320,
        devicePixelRatio: 2,
      });

      vi.stubGlobal("devicePixelRatio", 3);
      resize?.();
      expect(setSize).toHaveBeenLastCalledWith({
        cssHeight: 180,
        cssWidth: 320,
        devicePixelRatio: 3,
      });
      expect(canvas.getBoundingClientRect).not.toHaveBeenCalled();
      release();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
