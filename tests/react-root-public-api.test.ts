import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererRoot } from "@royal/react";
import {
  pass,
  perspectiveCamera,
  scene,
  type RenderRoot,
} from "@royal/renderer-core";

type ContextRequest = {
  readonly contextId: string;
  readonly options: WebGLContextAttributes | undefined;
};

type FakeCanvas = HTMLCanvasElement & {
  readonly contextRequests: readonly ContextRequest[];
};

const fakeWebGl2Context = (): WebGL2RenderingContext => {
  const gl = {
    BACK: 0x0405,
    BLEND: 0x0BE2,
    COLOR_BUFFER_BIT: 0x4000,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    LEQUAL: 0x0203,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RENDERER: 0x1F01,
    SHADING_LANGUAGE_VERSION: 0x8B8C,
    VENDOR: 0x1F00,
    VERSION: 0x1F02,
    blendFunc: () => undefined,
    clear: () => undefined,
    clearColor: () => undefined,
    clearDepth: () => undefined,
    cullFace: () => undefined,
    depthFunc: () => undefined,
    depthMask: () => undefined,
    disable: () => undefined,
    enable: () => undefined,
    getError: () => 0,
    getExtension: () => null,
    getParameter: (name: number) => {
      switch (name) {
        case gl.RENDERER:
          return "Royal test renderer";
        case gl.SHADING_LANGUAGE_VERSION:
          return "WebGL GLSL ES 3.00 Royal";
        case gl.VENDOR:
          return "Royal tests";
        case gl.VERSION:
          return "WebGL 2.0 Royal";
        default:
          return 0;
      }
    },
    getSupportedExtensions: () => [],
    isContextLost: () => false,
    viewport: () => undefined,
  };

  return gl as unknown as WebGL2RenderingContext;
};

const fakeCanvas = (
  gl: WebGL2RenderingContext = fakeWebGl2Context(),
): FakeCanvas => {
  const contextRequests: ContextRequest[] = [];
  const size = { height: 180, width: 320 };
  const canvas = {
    contextRequests,
    get clientHeight() {
      return size.height;
    },
    get clientWidth() {
      return size.width;
    },
    addEventListener: () => undefined,
    getBoundingClientRect: () => ({
      bottom: size.height,
      height: size.height,
      left: 0,
      right: size.width,
      top: 0,
      width: size.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    getContext: (
      contextId: string,
      options?: WebGLContextAttributes,
    ) => {
      contextRequests.push({ contextId, options });
      return contextId === "webgl2" ? gl : null;
    },
    height: 0,
    removeEventListener: () => undefined,
    width: 0,
  };

  return canvas as unknown as FakeCanvas;
};

const zeroGltfInstancingSnapshot = {
  batchInstancesTotal: 0,
  batchPlansBuilt: 0,
  drawCalls: 0,
  instancesDrawn: 0,
  localModelUploadBytes: 0,
  localModelUploadCalls: 0,
  rootPoseUploadBytes: 0,
  rootPoseUploadCalls: 0,
  rootScaleUploadBytes: 0,
  rootScaleUploadCalls: 0,
};

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
      gltfInstancing: zeroGltfInstancingSnapshot,
      latestScene: undefined,
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
      gltfInstancing: zeroGltfInstancingSnapshot,
      latestScene: renderRoot,
    });

    root.dispose();
    expect(root.snapshot()).toEqual({
      context: root.context,
      disposed: true,
      frame: 1,
      gltfInstancing: zeroGltfInstancingSnapshot,
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
