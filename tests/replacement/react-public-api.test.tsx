import { prefilteredEnvironment, type Scene } from "@royal/renderer-core";
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
} as unknown as Scene;

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
      pixelRatio: 1,
      rendererOptions: { alpha: false, antialias: true },
      scene: emptyScene,
    } satisfies CanvasProps;
    expect(createElement(Canvas, props).props).toMatchObject(props);
    expectTypeOf(createRendererRoot).toBeFunction();
    expectTypeOf(createRendererRoot).returns.toEqualTypeOf<RoyalRendererRoot>();
    expectTypeOf<CanvasProps["scene"]>().toEqualTypeOf<Scene>();
    expectTypeOf(useCanvasSize).toBeFunction();
    expectTypeOf(useGltfAssetStatus).toBeFunction();
    expectTypeOf(useTextureAssetStatus).toBeFunction();
    expectTypeOf(useVirtualTextureStatus).toBeFunction();
    expectTypeOf(usePrefilteredEnvironmentStatus).toBeFunction();
    expectTypeOf(createOrbitCameraController).toBeFunction();
    expectTypeOf(createOrbitCameraController({ initial: { distance: 3 } }).camera)
      .toMatchTypeOf<Scene["camera"]>();
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
    expect(rendererRootOptionsSemanticKey(undefined)).toBe("000:268435456:8:4194304");
    expect(rendererRootOptionsSemanticKey({})).toBe("000:268435456:8:4194304");
    expect(rendererRootOptionsSemanticKey({ alpha: true, antialias: true }))
      .toBe("110:268435456:8:4194304");
    expect(rendererRootOptionsSemanticKey({ alpha: true })).toBe("100:268435456:8:4194304");
    expect(rendererRootOptionsSemanticKey({ antialias: true })).toBe("010:268435456:8:4194304");
    expect(rendererRootOptionsSemanticKey({ automaticVirtualTexturing: true }))
      .toBe("001:268435456:8:4194304");
    expect(rendererRootOptionsSemanticKey({ persistentGpuByteBudget: 1024 }))
      .toBe("000:1024:8:4194304");
    expect(rendererRootOptionsSemanticKey({ maxConcurrentPreparationJobs: 2 }))
      .toBe("000:268435456:2:4194304");
    expect(rendererRootOptionsSemanticKey({ ordinaryTextureUploadByteBudgetPerFrame: 1024 }))
      .toBe("000:268435456:8:1024");
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
    expect(() => rendererRootOptionsSemanticKey({
      automaticVirtualTexturing: 1,
    } as unknown as Parameters<typeof rendererRootOptionsSemanticKey>[0])).toThrow(
      "option automaticVirtualTexturing must be a boolean",
    );
    expect(() => rendererRootOptionsSemanticKey({ persistentGpuByteBudget: 0 })).toThrow(
      "persistentGpuByteBudget must be a positive safe integer",
    );
    expect(() => rendererRootOptionsSemanticKey({ maxConcurrentPreparationJobs: 0 })).toThrow(
      "maxConcurrentPreparationJobs must be a positive safe integer",
    );
    expect(() => rendererRootOptionsSemanticKey({
      ordinaryTextureUploadByteBudgetPerFrame: 0,
    })).toThrow(
      "ordinaryTextureUploadByteBudgetPerFrame must be a positive safe integer",
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

  it("publishes an explicit pixel ratio without forwarding a DOM prop", () => {
    let observe: ResizeObserverCallback | undefined;
    let frame: FrameRequestCallback | undefined;
    const setSize = vi.fn();
    vi.stubGlobal("devicePixelRatio", 3);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        observe = callback;
      }

      disconnect = vi.fn();
      observe = vi.fn();
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    try {
      const html = renderToStaticMarkup(createElement(Canvas, { pixelRatio: 1, scene: emptyScene }));
      expect(html).not.toContain("pixelRatio");
      const release = observeCanvasSize({} as HTMLCanvasElement, {
        setSize,
      } as unknown as RoyalRendererRoot, 1);
      observe?.([
        { contentRect: { height: 180, width: 320 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
      frame?.(0);
      expect(setSize).toHaveBeenCalledWith({
        cssHeight: 180,
        cssWidth: 320,
        devicePixelRatio: 1,
      });
      release();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
