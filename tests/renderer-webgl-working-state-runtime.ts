import { expect, vi } from "vitest";
import {
  boxGeometry,
  mesh,
  orthographicCamera,
  pointLight,
  scene,
  standardMaterial,
  unlitMaterial,
  type LinearRgba,
} from "@royal/renderer-core";

export type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

export type FakeCanvas = HTMLCanvasElement & {
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): Event;
  invokeContextEvent(type: "webglcontextlost" | "webglcontextrestored"): {
    readonly event: Event;
    readonly failure: unknown;
    readonly failurePresent: boolean;
  };
  setCssSize(size: CanvasSize): void;
  getContext: ReturnType<typeof vi.fn>;
};

export type GlCall = {
  readonly name: string;
  readonly args: readonly unknown[];
};

export type FakeGl = {
  readonly gl: WebGL2RenderingContext;
  readonly calls: readonly GlCall[];
};

export const makeHandle = <Handle>(): Handle => ({} as Handle);

export const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  initialSize: CanvasSize = { width: 320, height: 180 },
): FakeCanvas => {
  let cssSize = initialSize;
  const target = new EventTarget();
  const contextListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  const canvas = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      target.addEventListener(type, listener);
      const listeners = contextListeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      contextListeners.set(type, listeners);
    },
    get clientHeight() {
      return cssSize.height;
    },
    get clientWidth() {
      return cssSize.width;
    },
    getBoundingClientRect: vi.fn(() => ({
      bottom: cssSize.height,
      height: cssSize.height,
      left: 0,
      right: cssSize.width,
      top: 0,
      width: cssSize.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })),
    getContext: vi.fn((contextId: string) => (contextId === "webgl2" ? gl : null)),
    dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored") {
      const event = new Event(type, { cancelable: true });
      target.dispatchEvent(event);
      return event;
    },
    invokeContextEvent(type: "webglcontextlost" | "webglcontextrestored") {
      const event = new Event(type, { cancelable: true });
      let failure: unknown;
      let failurePresent = false;
      for (const listener of contextListeners.get(type) ?? []) {
        try {
          if (typeof listener === "function") listener.call(canvas, event);
          else listener.handleEvent(event);
        } catch (value) {
          failure = value;
          failurePresent = true;
          break;
        }
      }
      return { event, failure, failurePresent };
    },
    height: 0,
    setCssSize(size: CanvasSize) {
      cssSize = size;
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      target.removeEventListener(type, listener);
      contextListeners.get(type)?.delete(listener);
    },
    width: 0,
  };

  return canvas as unknown as FakeCanvas;
};

export const fakeGl = (): FakeGl => {
  const calls: GlCall[] = [];
  const uniform = makeHandle<WebGLUniformLocation>();
  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    calls.push({ name, args });
    return implementation?.(...args);
  });
  const recordUniformMatrix = vi.fn((
    location: WebGLUniformLocation | null,
    transpose: boolean,
    value: Float32List,
  ) => {
    // WebGL consumes the matrix synchronously. Snapshot mutable renderer
    // workspaces so later view writes do not rewrite call history.
    calls.push({ name: "uniformMatrix4fv", args: [location, transpose, Array.from(value)] });
  });

  const gl = {
    ACTIVE_TEXTURE: 0x84E0,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_ATTACHMENT: 0x8D00,
    DEPTH_COMPONENT24: 0x81A6,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8D40,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    FRAGMENT_SHADER: 0x8B30,
    HALF_FLOAT: 0x140B,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_SIZE: 0x0D33,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    R32UI: 0x8236,
    RED_INTEGER: 0x8D94,
    RENDERBUFFER: 0x8D41,
    RG32UI: 0x823C,
    RG_INTEGER: 0x8228,
    RGBA: 0x1908,
    RGBA16F: 0x881A,
    RGBA32F: 0x8814,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    SCISSOR_TEST: 0x0C11,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88E4,
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
    VERTEX_SHADER: 0x8B31,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindFramebuffer: record("bindFramebuffer"),
    bindRenderbuffer: record("bindRenderbuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendEquationSeparate: record("blendEquationSeparate"),
    blendFuncSeparate: record("blendFuncSeparate"),
    bufferData: record("bufferData"),
    checkFramebufferStatus: record("checkFramebufferStatus", () => 0x8CD5),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => makeHandle<WebGLBuffer>()),
    createFramebuffer: record("createFramebuffer", () => makeHandle<WebGLFramebuffer>()),
    createProgram: record("createProgram", () => makeHandle<WebGLProgram>()),
    createRenderbuffer: record("createRenderbuffer", () => makeHandle<WebGLRenderbuffer>()),
    createShader: record("createShader", () => makeHandle<WebGLShader>()),
    createTexture: record("createTexture", () => makeHandle<WebGLTexture>()),
    createVertexArray: record("createVertexArray", () => makeHandle<WebGLVertexArrayObject>()),
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteFramebuffer: record("deleteFramebuffer"),
    deleteProgram: record("deleteProgram"),
    deleteRenderbuffer: record("deleteRenderbuffer"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    detachShader: record("detachShader"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    framebufferRenderbuffer: record("framebufferRenderbuffer"),
    framebufferTexture2D: record("framebufferTexture2D"),
    getAttribLocation: record("getAttribLocation", () => 0),
    getContextAttributes: record("getContextAttributes", () => ({ alpha: true, antialias: true })),
    getError: record("getError", () => 0),
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    getParameter: record("getParameter", () => 4096),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record("getProgramParameter", () => true),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record("getShaderParameter", () => true),
    getUniformLocation: record("getUniformLocation", () => uniform),
    linkProgram: record("linkProgram"),
    makeXRCompatible: record("makeXRCompatible", async () => undefined),
    pixelStorei: record("pixelStorei"),
    renderbufferStorage: record("renderbufferStorage"),
    shaderSource: record("shaderSource"),
    scissor: record("scissor"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    texSubImage2D: record("texSubImage2D"),
    uniform1i: record("uniform1i"),
    uniform2f: record("uniform2f"),
    uniform2fv: record("uniform2fv"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: recordUniformMatrix,
    useProgram: record("useProgram"),
    vertexAttrib2f: record("vertexAttrib2f"),
    vertexAttrib4f: record("vertexAttrib4f"),
    vertexAttribDivisor: record("vertexAttribDivisor"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  } as unknown as WebGL2RenderingContext;

  return { calls, gl };
};

export const camera = () => orthographicCamera({
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

export const cube = (color: LinearRgba) => mesh({
  geometry: boxGeometry(1),
  material: unlitMaterial({ color }),
});

export const drawableScene = (clearColor: LinearRgba, color: LinearRgba = [1, 1, 1, 1]) => scene({
  camera: camera(),
  nodes: [cube(color)],
  clearColor,
});

export const clusteredScene = () => scene({
  camera: camera(),
  nodes: [
    pointLight({ intensityCandela: 100, position: [0, 0, 2], range: 10 }),
    mesh({
      geometry: boxGeometry(1),
      material: standardMaterial({ color: [1, 1, 1, 1] }),
    }),
  ],
});

export const drawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArrays" || call.name === "drawElements");

export const countCalls = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

export const expectMatricesToContainClose = (
  matrices: readonly (readonly number[])[],
  expected: readonly number[],
) => {
  const hasMatrix = matrices.some((matrix) =>
    matrix.length === expected.length
    && matrix.every((value, index) => Math.abs(value - expected[index]!) < 0.00001));
  expect(hasMatrix).toBe(true);
};

export const xrSessionEventMethods = (target: EventTarget) => ({
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
});
