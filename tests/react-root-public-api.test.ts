import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRendererRoot,
  webGlRootForRoyalRoot,
} from "@royal/react";
import {
  pass,
  perspectiveCamera,
  scene,
  type RenderRoot,
} from "@royal/renderer-core";
import { fakeCanvas, fakeRendererRoot } from "./react-test-fixtures";

const emptyScene = (): RenderRoot => scene({
  children: [
    pass({
      camera: perspectiveCamera({
        far: 10,
        fovY: Math.PI / 3,
        near: 0.1,
        position: [0, 0, 2],
        rotation: [0, 0, 0],
      }),
      children: [],
    }),
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React root public API", () => {
  it("normalizes context options and renders through the public root", () => {
    const canvas = fakeCanvas();
    const root = createRendererRoot(canvas, {
      context: {
        alpha: false,
        preserveDrawingBuffer: true,
      },
    });
    const renderRoot = emptyScene();

    expect(root.canvas).toBe(canvas);
    expect(canvas.contextRequests).toEqual([
      {
        contextId: "webgl2",
        options: {
          alpha: false,
          antialias: true,
          preserveDrawingBuffer: true,
        },
      },
    ]);
    expect(root.snapshot()).toEqual({
      context: {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: true,
      },
      disposed: false,
      frame: 0,
      latestScene: undefined,
    });
    expect(root.diagnostics()).toMatchObject({
      disposed: false,
      frame: 0,
      gltfInstancing: expect.any(Object),
      virtualTexturing: expect.any(Object),
    });
    expect(webGlRootForRoyalRoot(root).snapshot()).toMatchObject({
      frame: 0,
      gltfInstancing: expect.any(Object),
      virtualTexturing: expect.any(Object),
    });
    expect(root.pick({ clientX: 1, clientY: 1 })).toBeUndefined();

    root.render(renderRoot);

    expect(root.context).toEqual({
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    expect(root.snapshot()).toEqual({
      context: root.context,
      disposed: false,
      frame: 1,
      latestScene: renderRoot,
    });

    root.dispose();
    expect(root.snapshot()).toEqual({
      context: root.context,
      disposed: true,
      frame: 1,
      latestScene: renderRoot,
    });
  });

  it("keeps the neutral React snapshot on the lean WebGL path", () => {
    const root = createRendererRoot(fakeCanvas());
    const webGlRoot = webGlRootForRoyalRoot(root);
    const webGlSnapshot = vi.spyOn(webGlRoot, "snapshot");

    root.snapshot();

    expect(webGlSnapshot).not.toHaveBeenCalled();
    root.diagnostics();
    expect(webGlSnapshot).toHaveBeenCalledTimes(1);
  });

  it("can wrap a non-WebGL backend root factory", () => {
    const canvas = fakeCanvas();
    const context = {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    const diagnostics = { renderer: "custom-test" };
    const root = createRendererRoot(canvas, {
      backend: (backendCanvas) => fakeRendererRoot({
        canvas: backendCanvas,
        context,
        diagnostics,
      }),
    });
    const renderRoot = emptyScene();

    expect(canvas.contextRequests).toEqual([]);

    root.render(renderRoot);

    expect(root.context).toEqual({
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    expect(root.diagnostics()).toBe(diagnostics);
    expect(() => webGlRootForRoyalRoot(root)).toThrow("not backed by the WebGL renderer");
    expect(root.snapshot()).toEqual({
      context: root.context,
      disposed: false,
      frame: 1,
      latestScene: renderRoot,
    });
  });

  it("rejects rendering after disposal", () => {
    const root = createRendererRoot(fakeCanvas());

    root.dispose();

    expect(() => root.render(emptyScene())).toThrow("disposed Royal renderer root");
  });

  it("exposes coalesced invalidation for imperative changes", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const root = createRendererRoot(fakeCanvas());

    root.render(emptyScene());
    root.invalidate();
    root.invalidate();

    expect(frameCallbacks).toHaveLength(1);
    expect(root.frame).toBe(1);

    frameCallbacks[0]?.(16);

    expect(root.frame).toBe(2);
  });
});
