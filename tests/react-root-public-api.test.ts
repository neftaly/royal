import { describe, expect, it } from "vitest";
import { createRoot } from "@royal/react";
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

describe("React root public API", () => {
  it("normalizes context options and renders through the public root", () => {
    const canvas = fakeCanvas();
    const root = createRoot(canvas, {
      backend: "webgl2",
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

  it("rejects rendering after disposal", () => {
    const root = createRoot(fakeCanvas());

    root.dispose();

    expect(() => root.render(emptyScene())).toThrow("disposed Royal renderer root");
  });
});
