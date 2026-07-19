import { prefilteredEnvironment, type RenderRoot } from "@royal/renderer-core";
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
  type VirtualTextureStatus,
  useVirtualTextureStatus,
  useOrbitCamera,
  useOrbitCameraView,
  usePrefilteredEnvironmentStatus,
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
    expect(html).toContain(
      '<canvas aria-label="preview" style="display:block;width:100%"></canvas>',
    );
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
    expectTypeOf(usePrefilteredEnvironmentStatus).toBeFunction();
    expectTypeOf(createOrbitCameraController).toBeFunction();
    expectTypeOf(createOrbitControls).toBeFunction();
    expectTypeOf(GltfOrbitCameraFit).toBeFunction();
    expectTypeOf(OrbitControls).toBeFunction();
    expectTypeOf(useOrbitCamera).toBeFunction();
    expectTypeOf(useOrbitCameraView).toBeFunction();
    expectTypeOf(useCanvasPick).toBeFunction();
    expectTypeOf(useRendererLifecycle).toBeFunction();
  });

  it("provides a stable CSS sizing default while preserving explicit style overrides", () => {
    const html = renderToStaticMarkup(createElement(Canvas, {
      scene: emptyScene,
      style: { display: "inline-block", width: "40%" },
    }));
    expect(html).toContain('style="display:inline-block;width:40%"');
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

  it("server-renders an offline environment as idle before root mount", () => {
    const environment = prefilteredEnvironment({ src: "/studio.ktx" });
    const Status = () => createElement(
      "output",
      null,
      usePrefilteredEnvironmentStatus(environment).state,
    );
    const html = renderToStaticMarkup(createElement(
      Canvas,
      { scene: emptyScene },
      createElement(Status),
    ));
    expect(html).toContain("<output>idle</output>");
  });

  it("rejects invalid observed texture identity before a renderer mounts", () => {
    const Status = () => createElement("output", null, useTextureAssetStatus({
      contentKey: "",
      kind: "asset",
      src: "/texture.png",
    }).state);
    expect(() => renderToStaticMarkup(createElement(
      Canvas,
      { scene: emptyScene },
      createElement(Status),
    ))).toThrow("texture asset contentKey must be a non-empty string");
  });

  it("exposes one predictable error field for failed and unsupported VT", () => {
    const message = (status: VirtualTextureStatus): string | undefined =>
      status.state === "error" || status.state === "unsupported"
        ? status.error
        : undefined;
    expect(message({
      error: "atlas is too large",
      failedPages: 0,
      pendingPages: 0,
      residentPages: 0,
      state: "unsupported",
    })).toBe("atlas is too large");
    expect(message({
      failedPages: 0,
      pendingPages: 0,
      residentPages: 2,
      state: "ready",
    })).toBeUndefined();
  });

  it("gives semantically equal creation options the same canvas lifetime", () => {
    expect(rendererRootOptionsSemanticKey(undefined)).toBe("11:268435456:8");
    expect(rendererRootOptionsSemanticKey({})).toBe("11:268435456:8");
    expect(rendererRootOptionsSemanticKey({ alpha: true, antialias: true }))
      .toBe("11:268435456:8");
    expect(rendererRootOptionsSemanticKey({ alpha: false })).toBe("01:268435456:8");
    expect(rendererRootOptionsSemanticKey({ antialias: false })).toBe("10:268435456:8");
    expect(rendererRootOptionsSemanticKey({ persistentGpuByteBudget: 1024 })).toBe("11:1024:8");
    expect(rendererRootOptionsSemanticKey({ maxConcurrentPreparationJobs: 2 }))
      .toBe("11:268435456:2");
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
    expect(() => rendererRootOptionsSemanticKey({ maxConcurrentPreparationJobs: 0 })).toThrow(
      "maxConcurrentPreparationJobs must be a positive safe integer",
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
    let frame: FrameRequestCallback | undefined;
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
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
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
      observe?.([
        { contentRect: { height: 200, width: 360 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
      expect(setSize).not.toHaveBeenCalled();
      frame?.(0);
      expect(setSize).toHaveBeenLastCalledWith({
        cssHeight: 200,
        cssWidth: 360,
        devicePixelRatio: 2,
      });

      vi.stubGlobal("devicePixelRatio", 3);
      resize?.();
      frame?.(1);
      expect(setSize).toHaveBeenLastCalledWith({
        cssHeight: 200,
        cssWidth: 360,
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
