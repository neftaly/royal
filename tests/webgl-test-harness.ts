import { vi } from "vitest";

export type WebGlTestCall = {
  readonly args: readonly unknown[];
  readonly name: string;
};

export type WebGlTestContextOptions = {
  readonly constants?: Readonly<Record<string, number>>;
  readonly drawingBufferSize?: WebGlTestCanvasSize;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly methods?: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;
  readonly parameters?: Readonly<Record<number, unknown>>;
};

export type WebGlTestCanvasSize = {
  readonly height: number;
  readonly width: number;
};

export type WebGlTestContext = {
  readonly calls: readonly WebGlTestCall[];
  readonly gl: WebGL2RenderingContext;
};

export type WebGlTestContextRequest = {
  readonly contextId: string;
  readonly options: WebGLContextAttributes | undefined;
};

export type WebGlTestCanvas = HTMLCanvasElement & {
  readonly contextRequests: readonly WebGlTestContextRequest[];
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): Event;
  dispatchFakeEvent(type: string, event: Event): void;
};

const DEFAULT_SIZE: WebGlTestCanvasSize = { height: 180, width: 320 };

const DEFAULT_CONSTANTS = {
  ACTIVE_TEXTURE: 0x84E0,
  ARRAY_BUFFER: 0x8892,
  BACK: 0x0405,
  BLEND: 0x0BE2,
  CLAMP_TO_EDGE: 0x812F,
  COLOR_BUFFER_BIT: 0x4000,
  COMPILE_STATUS: 0x8B81,
  COMPRESSED_TEXTURE_FORMATS: 0x86A3,
  CULL_FACE: 0x0B44,
  CCW: 0x0901,
  CW: 0x0900,
  DEPTH_BUFFER_BIT: 0x0100,
  DEPTH_TEST: 0x0B71,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  FLOAT: 0x1406,
  FRAMEBUFFER: 0x8D40,
  FRAGMENT_SHADER: 0x8B30,
  FUNC_ADD: 0x8006,
  LEQUAL: 0x0203,
  LINEAR: 0x2601,
  LINK_STATUS: 0x8B82,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  MAX_TEXTURE_SIZE: 0x0D33,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
  ONE: 1,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  POLYGON_OFFSET_FILL: 0x8037,
  RASTERIZER_DISCARD: 0x8C89,
  RENDERER: 0x1F01,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  SAMPLE_ALPHA_TO_COVERAGE: 0x809E,
  SAMPLE_COVERAGE: 0x80A0,
  SCISSOR_TEST: 0x0C11,
  SHADING_LANGUAGE_VERSION: 0x8B8C,
  STATIC_DRAW: 0x88E4,
  STENCIL_TEST: 0x0B90,
  TEXTURE0: 0x84C0,
  TEXTURE_2D: 0x0DE1,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MAX_LEVEL: 0x813D,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TRIANGLES: 0x0004,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_INT: 0x1405,
  UNSIGNED_SHORT: 0x1403,
  VENDOR: 0x1F00,
  VERSION: 0x1F02,
  VERTEX_SHADER: 0x8B31,
} as const;

const noop = (): undefined => undefined;

const handle = <Handle>(kind: string): Handle =>
  ({ id: Symbol(kind), kind } as unknown as Handle);

export const createStrictWebGl2Context = (
  options: WebGlTestContextOptions = {},
): WebGlTestContext => {
  const calls: WebGlTestCall[] = [];
  const constants = { ...DEFAULT_CONSTANTS, ...options.constants };
  const extensions = options.extensions ?? {};
  const size = options.drawingBufferSize ?? DEFAULT_SIZE;
  const uniform = handle<WebGLUniformLocation>("uniform");

  const defaultParameter = (parameter: number): unknown => {
    if (Object.hasOwn(options.parameters ?? {}, parameter)) {
      return options.parameters?.[parameter];
    }
    switch (parameter) {
      case constants.COMPRESSED_TEXTURE_FORMATS:
        return new Uint32Array();
      case constants.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
        return 32;
      case constants.MAX_TEXTURE_IMAGE_UNITS:
      case constants.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
        return 16;
      case constants.MAX_TEXTURE_SIZE:
        return 4096;
      case constants.RENDERER:
        return "Royal strict test renderer";
      case constants.SHADING_LANGUAGE_VERSION:
        return "WebGL GLSL ES 3.00 Royal";
      case constants.VENDOR:
        return "Royal tests";
      case constants.VERSION:
        return "WebGL 2.0 Royal";
      default:
        return 0;
    }
  };

  const methods: Record<string, (...args: readonly unknown[]) => unknown> = {
    activeTexture: noop,
    attachShader: noop,
    beginQuery: noop,
    bindAttribLocation: noop,
    bindBuffer: noop,
    bindFramebuffer: noop,
    bindTexture: noop,
    bindVertexArray: noop,
    blendEquationSeparate: noop,
    blendFunc: noop,
    bufferData: noop,
    bufferSubData: noop,
    clear: noop,
    clearColor: noop,
    clearDepth: noop,
    colorMask: noop,
    compileShader: noop,
    createBuffer: () => handle<WebGLBuffer>("buffer"),
    createProgram: () => handle<WebGLProgram>("program"),
    createShader: () => handle<WebGLShader>("shader"),
    createTexture: () => handle<WebGLTexture>("texture"),
    createVertexArray: () => handle<WebGLVertexArrayObject>("vertex-array"),
    cullFace: noop,
    deleteBuffer: noop,
    deleteProgram: noop,
    deleteShader: noop,
    deleteTexture: noop,
    deleteVertexArray: noop,
    depthFunc: noop,
    depthMask: noop,
    depthRange: noop,
    detachShader: noop,
    disable: noop,
    disableVertexAttribArray: noop,
    drawArrays: noop,
    drawElements: noop,
    enable: noop,
    enableVertexAttribArray: noop,
    frontFace: noop,
    getAttribLocation: (_program, name) => name === "a_position" ? 0 : -1,
    getContextAttributes: () => ({ alpha: true, antialias: true }),
    getError: () => 0,
    getExtension: (name) => typeof name === "string" ? extensions[name] ?? null : null,
    getParameter: (parameter) => typeof parameter === "number" ? defaultParameter(parameter) : 0,
    getProgramInfoLog: () => "",
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getShaderParameter: () => true,
    getSupportedExtensions: () => Object.keys(extensions),
    getUniformLocation: () => uniform,
    isContextLost: () => false,
    linkProgram: noop,
    pixelStorei: noop,
    shaderSource: noop,
    texImage2D: noop,
    texParameteri: noop,
    texStorage2D: noop,
    uniform1i: noop,
    uniform3f: noop,
    uniform3fv: noop,
    uniform4fv: noop,
    uniformMatrix4fv: noop,
    useProgram: noop,
    vertexAttrib4f: noop,
    vertexAttribDivisor: noop,
    vertexAttribPointer: noop,
    viewport: noop,
    ...options.methods,
  };

  const target: Record<PropertyKey, unknown> = {
    ...constants,
    drawingBufferHeight: size.height,
    drawingBufferWidth: size.width,
  };
  for (const [name, implementation] of Object.entries(methods)) {
    target[name] = vi.fn((...args: readonly unknown[]) => {
      calls.push({ args, name });
      return implementation(...args);
    });
  }

  const gl = new Proxy(target, {
    get(proxyTarget, property, receiver) {
      if (Reflect.has(proxyTarget, property)) return Reflect.get(proxyTarget, property, receiver);
      if (typeof property === "symbol") return undefined;
      throw new Error(
        `Strict WebGL2 test context does not implement ${JSON.stringify(property)}; `
          + "add it to the shared baseline or provide a per-test override",
      );
    },
  }) as unknown as WebGL2RenderingContext;

  return { calls, gl };
};

export const createWebGlTestCanvas = (
  gl: WebGL2RenderingContext | null,
  size: WebGlTestCanvasSize = DEFAULT_SIZE,
): WebGlTestCanvas => {
  const contextRequests: WebGlTestContextRequest[] = [];
  let contextAttributes: WebGLContextAttributes = { alpha: true, antialias: true };
  const listeners = new Map<string, Array<{
    readonly capture: boolean;
    readonly listener: EventListenerOrEventListenerObject;
  }>>();

  const dispatch = (type: string, event: Event): void => {
    const typeListeners = listeners.get(type) ?? [];
    for (const { listener } of [
      ...typeListeners.filter(({ capture }) => capture),
      ...typeListeners.filter(({ capture }) => !capture),
    ]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  };

  const canvas = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (listener === null) return;
      const capture = typeof options === "boolean" ? options : options?.capture ?? false;
      const typeListeners = listeners.get(type) ?? [];
      if (!typeListeners.some((entry) => entry.capture === capture && entry.listener === listener)) {
        typeListeners.push({ capture, listener });
      }
      listeners.set(type, typeListeners);
    },
    get clientHeight() {
      return size.height;
    },
    get clientWidth() {
      return size.width;
    },
    contextRequests,
    dispatchContextEvent: (type: "webglcontextlost" | "webglcontextrestored") => {
      const event = new Event(type, { cancelable: true });
      dispatch(type, event);
      return event;
    },
    dispatchFakeEvent: dispatch,
    getBoundingClientRect: vi.fn(() => ({
      bottom: size.height,
      height: size.height,
      left: 0,
      right: size.width,
      top: 0,
      width: size.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })),
    getContext: vi.fn((contextId: string, options?: WebGLContextAttributes) => {
      contextRequests.push({ contextId, options });
      if (contextId === "webgl2") {
        contextAttributes = {
          alpha: options?.alpha ?? true,
          antialias: options?.antialias ?? true,
        };
      }
      return contextId === "webgl2" ? gl : null;
    }),
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
        entry.capture === capture && entry.listener === listener
      );
      if (index !== -1) typeListeners.splice(index, 1);
    },
    width: 0,
  };

  if (gl !== null) {
    Object.defineProperty(gl, "canvas", {
      configurable: true,
      value: canvas,
    });
    Object.defineProperty(gl, "getContextAttributes", {
      configurable: true,
      value: () => contextAttributes,
    });
  }

  return canvas as unknown as WebGlTestCanvas;
};
