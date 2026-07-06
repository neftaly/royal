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

export const fakeCanvas = (
  gl: WebGL2RenderingContext = fakeWebGl2Context(),
): FakeCanvas => {
  const contextRequests: ContextRequest[] = [];
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
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
    ) => {
      if (listener === null) return;

      const typeListeners = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    dispatchFakeEvent: (type: string, event: PointerEvent) => {
      for (const listener of listeners.get(type) ?? []) {
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
      return contextId === "webgl2" ? gl : null;
    },
    height: 0,
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) => {
      if (listener === null) return;

      listeners.get(type)?.delete(listener);
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
    preserveDrawingBuffer: false,
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
    get latestScene() {
      return latestScene;
    },
    diagnostics: vi.fn(() => diagnostics),
    dispose: vi.fn(),
    invalidate: vi.fn(),
    pick: vi.fn((input: PickInput) => pick(latestScene, input)),
    render: vi.fn((scene: RenderRoot) => {
      latestScene = scene;
      frame += 1;
    }),
    snapshot: vi.fn(() => ({
      context: root.context,
      disposed: root.disposed,
      frame: root.frame,
      latestScene: root.latestScene,
    })),
  };

  return root;
};
