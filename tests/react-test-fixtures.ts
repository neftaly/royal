import { vi } from "vitest";
import type {
  PickInput,
  PickResult,
  RenderRoot,
} from "@royal/renderer-core";
import type { RoyalRendererRoot } from "../packages/react/src/root";

type ContextRequest = {
  readonly contextId: string;
  readonly options: WebGLContextAttributes | undefined;
};

export type FakeCanvas = HTMLCanvasElement & {
  dispatchFakeEvent(type: string, event: PointerEvent): void;
  readonly contextRequests: readonly ContextRequest[];
};

export const fakeWebGl2Context = (): WebGL2RenderingContext => {
  const gl = {
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    COLOR_BUFFER_BIT: 0x4000,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FUNC_ADD: 0x8006,
    LEQUAL: 0x0203,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    POLYGON_OFFSET_FILL: 0x8037,
    RASTERIZER_DISCARD: 0x8C89,
    RENDERER: 0x1F01,
    SAMPLE_ALPHA_TO_COVERAGE: 0x809E,
    SAMPLE_COVERAGE: 0x80A0,
    SCISSOR_TEST: 0x0C11,
    SHADING_LANGUAGE_VERSION: 0x8B8C,
    STENCIL_TEST: 0x0B90,
    VENDOR: 0x1F00,
    VERSION: 0x1F02,
    blendFunc: () => undefined,
    blendEquationSeparate: () => undefined,
    bindBuffer: () => undefined,
    bindVertexArray: () => undefined,
    clear: () => undefined,
    clearColor: () => undefined,
    clearDepth: () => undefined,
    colorMask: () => undefined,
    cullFace: () => undefined,
    depthFunc: () => undefined,
    depthMask: () => undefined,
    depthRange: () => undefined,
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

export const fakeCanvas = (
  gl: WebGL2RenderingContext = fakeWebGl2Context(),
): FakeCanvas => {
  const contextRequests: ContextRequest[] = [];
  let contextAttributes: WebGLContextAttributes = { alpha: true, antialias: true };
  if (typeof gl.getContextAttributes !== "function") {
    (gl as WebGL2RenderingContext & {
      getContextAttributes: () => WebGLContextAttributes;
    }).getContextAttributes = () => contextAttributes;
  }
  const listeners = new Map<string, Array<{
    readonly capture: boolean;
    readonly listener: EventListenerOrEventListenerObject;
  }>>();
  const size = { height: 180, width: 320 };
  const canvas = {
    contextRequests,
    get clientHeight() {
      return size.height;
    },
    get clientWidth() {
      return size.width;
    },
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (listener === null) return;

      const capture = typeof options === "boolean" ? options : options?.capture ?? false;
      const typeListeners = listeners.get(type) ?? [];
      if (!typeListeners.some((entry) => entry.listener === listener && entry.capture === capture)) {
        typeListeners.push({ capture, listener });
      }
      listeners.set(type, typeListeners);
    },
    dispatchFakeEvent: (type: string, event: PointerEvent) => {
      const typeListeners = listeners.get(type) ?? [];
      for (const { listener } of [
        ...typeListeners.filter(({ capture }) => capture),
        ...typeListeners.filter(({ capture }) => !capture),
      ]) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
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
      if (contextId === "webgl2") {
        contextAttributes = {
          alpha: options?.alpha ?? true,
          antialias: options?.antialias ?? true,
        };
      }
      return contextId === "webgl2" ? gl : null;
    },
    height: 0,
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => {
      if (listener === null) return;

      const capture = typeof options === "boolean" ? options : options?.capture ?? false;
      const typeListeners = listeners.get(type);
      if (typeListeners === undefined) return;
      const index = typeListeners.findIndex((entry) =>
        entry.listener === listener && entry.capture === capture
      );
      if (index !== -1) typeListeners.splice(index, 1);
    },
    width: 0,
  };

  return canvas as unknown as FakeCanvas;
};

export const fakeRendererRoot = ({
  canvas = {} as HTMLCanvasElement,
  context = {
    alpha: true,
    antialias: true,
  },
  diagnostics = {},
  pick = () => undefined,
}: {
  readonly canvas?: HTMLCanvasElement;
  readonly context?: RoyalRendererRoot["context"];
  readonly diagnostics?: unknown;
  readonly pick?: (scene: RenderRoot | undefined, input: PickInput) => PickResult | undefined;
} = {}): RoyalRendererRoot => {
  let frame = 0;
  let latestScene: RenderRoot | undefined;
  const root: RoyalRendererRoot = {
    canvas,
    context,
    get disposed() {
      return false;
    },
    get frame() {
      return frame;
    },
    diagnostics: vi.fn(() => diagnostics),
    dispose: vi.fn(),
    flushInvalidated: vi.fn(),
    invalidate: vi.fn(),
    observeLifecycle: vi.fn((callback: Parameters<RoyalRendererRoot["observeLifecycle"]>[0]) => {
      callback({ generation: 1, lifecycle: "available" });
      return () => undefined;
    }),
    pick: vi.fn((input: PickInput) => pick(latestScene, input)),
    render: vi.fn((scene: RenderRoot) => {
      latestScene = scene;
      frame += 1;
    }),
    snapshot: vi.fn(() => ({
      context: root.context,
      disposed: root.disposed,
      frame: root.frame,
      lifecycle: { generation: 1, lifecycle: "available" as const },
    })),
  };

  return root;
};
