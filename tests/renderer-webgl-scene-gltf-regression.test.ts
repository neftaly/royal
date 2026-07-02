import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
  type RenderNode,
  type RenderRoot,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";

type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly args: readonly unknown[];
  readonly name: string;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type FetchRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (response: Response) => void;
  readonly url: string;
};

type BitmapRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (bitmap: ImageBitmap) => void;
};

const defaultCanvasSize: CanvasSize = { height: 180, width: 320 };
const triangleGltfSrc = "https://example.test/fixtures/staged-triangle.gltf";
const matchingTriangleGltfSrc = "https://example.test/fixtures/matching-triangle.gltf";
const triangleBinUri = "staged-triangle.bin";
const triangleImageUri = "staged-triangle.png";
const triangleVariantImageUri = "staged-triangle-variant.png";
const triangleWebpImageUri = "staged-triangle.webp";
const triangleBinByteLength = 104;
const instancedTriangleBinByteLength = triangleBinByteLength + 48;
const lodGltfSrc = "https://example.test/fixtures/lod.gltf";
const lodBinUri = "lod.bin";
const lodImageUri = "lod-shared.png";
const lodBinByteLength = 102;

const fakeCanvas = (
  gl: WebGL2RenderingContext,
  size: CanvasSize = defaultCanvasSize,
): FakeCanvas => {
  const canvas = {
    get clientHeight() {
      return size.height;
    },
    get clientWidth() {
      return size.width;
    },
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
    getContext: vi.fn((contextId: string) => (contextId === "webgl2" ? gl : null)),
    height: 0,
    width: 0,
  };

  (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniforms = new Map<string, WebGLUniformLocation>();
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    DYNAMIC_DRAW: 0x88E8,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINES: 0x0001,
    LINK_STATUS: 0x8B82,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    NO_ERROR: 0,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    REPEAT: 0x2901,
    RGBA: 0x1908,
    STATIC_DRAW: 0x88E4,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
  } as const;

  const handle = <Handle>(kind: string): Handle =>
    ({ id: nextHandleId++, kind }) as Handle;

  const uniform = (name: string): WebGLUniformLocation => {
    const existing = uniforms.get(name);
    if (existing !== undefined) return existing;

    const location = { kind: "uniform", name } as unknown as WebGLUniformLocation;
    uniforms.set(name, location);

    return location;
  };

  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    calls.push({ args, name });

    return implementation?.(...args);
  });

  const glTarget = {
    ...constants,
    drawingBufferHeight: defaultCanvasSize.height,
    drawingBufferWidth: defaultCanvasSize.width,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindTexture: record("bindTexture"),
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => handle<WebGLBuffer>("buffer")),
    createProgram: record("createProgram", () => handle<WebGLProgram>("program")),
    createShader: record("createShader", () => handle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => handle<WebGLTexture>("texture")),
    createVertexArray: record("createVertexArray", () => handle<WebGLVertexArrayObject>("vertex-array")),
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    detachShader: record("detachShader"),
    disable: record("disable"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    generateMipmap: record("generateMipmap"),
    getActiveAttrib: record("getActiveAttrib", () => null),
    getActiveUniform: record("getActiveUniform", () => null),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("normal")) return 1;
      if (normalized.includes("uv") || normalized.includes("texcoord")) return 2;

      return 0;
    }),
    getContextAttributes: record("getContextAttributes", () => ({
      alpha: true,
      antialias: true,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "default",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    })),
    getError: record("getError", () => constants.NO_ERROR),
    getExtension: record("getExtension", () => null),
    getParameter: record<[number]>("getParameter", (parameter) => {
      if (
        parameter === constants.MAX_COMBINED_TEXTURE_IMAGE_UNITS
        || parameter === constants.MAX_TEXTURE_IMAGE_UNITS
      ) return 8;
      if (parameter === constants.MAX_TEXTURE_SIZE) return 4096;

      return 0;
    }),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS) return 0;
      if (parameter === constants.LINK_STATUS) return true;

      return true;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) =>
      parameter === constants.COMPILE_STATUS ? true : true),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniform(name)),
    isContextLost: record("isContextLost", () => false),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    uniform1i: record("uniform1i"),
    uniform3f: record("uniform3f"),
    uniform3fv: record("uniform3fv"),
    uniform4f: record("uniform4f"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    validateProgram: record("validateProgram"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  };

  const gl = new Proxy(glTarget, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      if (typeof property !== "string") return undefined;

      const fallback = record(property);
      Object.defineProperty(target, property, {
        configurable: true,
        value: fallback,
      });

      return fallback;
    },
  }) as unknown as WebGL2RenderingContext;

  return { calls, gl };
};

class ControlledImage {
  static readonly instances: ControlledImage[] = [];

  complete = false;
  crossOrigin: string | null = null;
  height = 4;
  naturalHeight = 4;
  naturalWidth = 4;
  onerror: OnErrorEventHandler = null;
  onload: ((this: HTMLImageElement, event: Event) => unknown) | null = null;
  width = 4;
  #decodeRejectors: Array<(reason?: unknown) => void> = [];
  #decodeResolvers: Array<() => void> = [];
  #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  #src = "";

  constructor() {
    ControlledImage.instances.push(this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  decode(): Promise<void> {
    if (this.complete) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.#decodeResolvers.push(resolve);
      this.#decodeRejectors.push(reject);
    });
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  rejectLoad(reason = new Error("staged glTF image failed")): void {
    for (const reject of this.#decodeRejectors.splice(0)) reject(reason);
    this.#decodeResolvers.splice(0);
    this.dispatch("error");
  }

  settleLoad(): void {
    this.complete = true;
    this.dispatch("load");
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
    this.#decodeRejectors.splice(0);
  }

  private dispatch(type: "error" | "load"): void {
    const event = new Event(type);
    if (type === "load") this.onload?.call(this as unknown as HTMLImageElement, event);
    if (type === "error") this.onerror?.call(this as unknown as HTMLImageElement, event, "", 0, 0, undefined);

    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class ControlledResizeObserver implements ResizeObserver {
  static readonly instances: ControlledResizeObserver[] = [];

  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    ControlledResizeObserver.instances.push(this);
  }

  disconnect(): void {
    return undefined;
  }

  observe(_target: Element): void {
    return undefined;
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  trigger(target: Element): void {
    this.#callback([{
      borderBoxSize: [],
      contentBoxSize: [],
      contentRect: target.getBoundingClientRect(),
      devicePixelContentBoxSize: [],
      target,
    } as unknown as ResizeObserverEntry], this);
  }

  unobserve(_target: Element): void {
    return undefined;
  }
}

const makeMediaQueryList = (query: string): MediaQueryList => {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const legacyListeners = new Set<(this: MediaQueryList, event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    matches: true,
    media: query,
    onchange: null as MediaQueryList["onchange"],
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    },
    addListener: (listener: (this: MediaQueryList, event: MediaQueryListEvent) => void) => {
      legacyListeners.add(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener.call(mediaQueryList, event);
        } else {
          listener.handleEvent(event);
        }
      }
      for (const listener of legacyListeners) listener.call(mediaQueryList, event as MediaQueryListEvent);
      mediaQueryList.onchange?.call(mediaQueryList, event as MediaQueryListEvent);

      return true;
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    },
    removeListener: (listener: (this: MediaQueryList, event: MediaQueryListEvent) => void) => {
      legacyListeners.delete(listener);
    },
  } satisfies MediaQueryList;

  return mediaQueryList;
};

const installViewportInvalidationStubs = () => {
  const animationFrames: FrameRequestCallback[] = [];
  const mediaQueries: MediaQueryList[] = [];

  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    animationFrames.push(callback);

    return animationFrames.length;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    const mediaQueryList = makeMediaQueryList(query);
    mediaQueries.push(mediaQueryList);

    return mediaQueryList;
  }));

  return {
    animationFrames,
    triggerViewportChange: (target: Element) => {
      vi.stubGlobal("devicePixelRatio", 2);
      for (const mediaQueryList of mediaQueries) mediaQueryList.dispatchEvent(new Event("change"));
      for (const observer of ControlledResizeObserver.instances) observer.trigger(target);
    },
  };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const flushAnimationFrames = async (callbacks: FrameRequestCallback[]): Promise<void> => {
  const queued = callbacks.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
  await flushMicrotasks();
};

const camera = () => orthographicCamera({
  bottom: -1,
  far: 20,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

const renderScene = (children: readonly RenderNode[]): RenderRoot =>
  scene({
    children: [
      pass({
        camera: camera(),
        children,
        clearColor: [0, 0, 0, 0],
      }),
    ],
  });

const drawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArrays" || call.name === "drawElements");

const instancedDrawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArraysInstanced" || call.name === "drawElementsInstanced");

const drawCount = (call: GlCall): number =>
  call.name === "drawArrays" ? Number(call.args[2]) : Number(call.args[1]);

const instancedDrawInstanceCount = (call: GlCall): number =>
  call.name === "drawArraysInstanced" ? Number(call.args[3]) : Number(call.args[4]);

const callCount = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

const lodScaleForCoverage = (coverage: number): number =>
  Math.sqrt(coverage / 0.5625);

const isNumericArrayLike = (value: unknown): value is ArrayLike<number> =>
  ArrayBuffer.isView(value)
    && !(value instanceof DataView)
    && typeof (value as { readonly length?: unknown }).length === "number";

const numericArray = (value: unknown): readonly number[] => {
  if (Array.isArray(value)) return value.map(Number);
  if (isNumericArrayLike(value)) return Array.from(value, Number);

  return [];
};

const bufferDataPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "bufferData")
    .map((call) => numericArray(call.args[1]))
    .filter((values) => values.length > 0);

const roundNumber = (value: number): number => {
  const rounded = Number(value.toFixed(6));

  return Object.is(rounded, -0) ? 0 : rounded;
};

const roundVector = (values: readonly number[]): readonly number[] =>
  values.map(roundNumber);

const uniformLocationName = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
    ? value.name
    : undefined;

const uniform1iPayloads = (
  calls: readonly GlCall[],
  name: string,
): readonly number[] =>
  calls
    .filter((call) => call.name === "uniform1i" && uniformLocationName(call.args[0]) === name)
    .map((call) => typeof call.args[1] === "number" ? call.args[1] : NaN);

const uniform4fvPayloads = (
  calls: readonly GlCall[],
  name: string,
): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "uniform4fv" && uniformLocationName(call.args[0]) === name)
    .map((call) => {
      const values = numericArray(call.args[1]);
      const offset = typeof call.args[2] === "number" ? call.args[2] : 0;
      const length = typeof call.args[3] === "number" ? call.args[3] : 4;

      return values.slice(offset, offset + length).slice(0, 4);
    });

const matrixUniformPayloads = (calls: readonly GlCall[], name?: string): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "uniformMatrix4fv")
    .filter((call) => name === undefined || uniformLocationName(call.args[0]) === name)
    .map((call) => {
      const values = numericArray(call.args[2]);
      const offset = typeof call.args[3] === "number" ? call.args[3] : 0;
      const length = typeof call.args[4] === "number" ? call.args[4] : 16;

      return values.slice(offset, offset + length).slice(0, 16);
    });

const textureParameterCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texParameteri");

const texturePixelStoreCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "pixelStorei");

const triangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength);

  new Float32Array(buffer, 0, 9).set([
    0, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);
  new Float32Array(buffer, 36, 9).set([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  new Float32Array(buffer, 72, 6).set([
    0.5, 1.5,
    0, 1,
    1, 1,
  ]);
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

const instancedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(instancedTriangleBinByteLength);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 6).set([
    -0.25, 0, 0,
    0.25, 0, 0,
  ]);
  new Float32Array(buffer, triangleBinByteLength + 24, 6).set([
    1, 1, 1,
    1.25, 1.25, 1.25,
  ]);

  return buffer;
};

const paddedLength = (byteLength: number): number => Math.ceil(byteLength / 4) * 4;

const paddedJsonBytes = (value: unknown): Uint8Array => {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(value));
  const bytes = new Uint8Array(paddedLength(jsonBytes.byteLength));
  bytes.set(jsonBytes);
  bytes.fill(0x20, jsonBytes.byteLength);

  return bytes;
};

const paddedBinaryBytes = (buffer: ArrayBuffer): Uint8Array => {
  const bytes = new Uint8Array(paddedLength(buffer.byteLength));
  bytes.set(new Uint8Array(buffer));

  return bytes;
};

const glbContainer = (document: unknown, binaryChunk: ArrayBuffer): ArrayBuffer => {
  const jsonBytes = paddedJsonBytes(document);
  const binBytes = paddedBinaryBytes(binaryChunk);
  const totalLength = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  let offset = 0;
  view.setUint32(offset, 0x46546C67, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, totalLength, true);
  offset += 4;
  view.setUint32(offset, jsonBytes.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x4E4F534A, true);
  offset += 4;
  new Uint8Array(glb, offset, jsonBytes.byteLength).set(jsonBytes);
  offset += jsonBytes.byteLength;
  view.setUint32(offset, binBytes.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x004E4942, true);
  offset += 4;
  new Uint8Array(glb, offset, binBytes.byteLength).set(binBytes);

  return glb;
};

const dataUriForBuffer = (buffer: ArrayBuffer): string =>
  `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;

const interleavedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(102);
  const view = new DataView(buffer);
  const vertices = [
    { normal: [0, 0, 1], position: [0, 0.5, 0], uv: [0.5, 1.5] },
    { normal: [0, 0, 1], position: [-0.5, -0.5, 0], uv: [0, 1] },
    { normal: [0, 0, 1], position: [0.5, -0.5, 0], uv: [1, 1] },
  ];
  for (const [vertexIndex, vertex] of vertices.entries()) {
    const offset = vertexIndex * 32;
    for (const [componentIndex, value] of vertex.position.entries()) {
      view.setFloat32(offset + componentIndex * 4, value, true);
    }
    for (const [componentIndex, value] of vertex.normal.entries()) {
      view.setFloat32(offset + 12 + componentIndex * 4, value, true);
    }
    for (const [componentIndex, value] of vertex.uv.entries()) {
      view.setFloat32(offset + 24 + componentIndex * 4, value, true);
    }
  }
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

const quantizedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(24);
  new Int16Array(buffer, 0, 9).set([
    0, 32767, 0,
    -32767, -32767, 0,
    32767, -32767, 0,
  ]);
  new Uint16Array(buffer, 18, 3).set([0, 1, 2]);

  return buffer;
};

const sparseTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(40);
  new Uint8Array(buffer, 0, 3).set([0, 1, 2]);
  new Float32Array(buffer, 4, 9).set([
    0, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);

  return buffer;
};

const lineBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(24);
  new Float32Array(buffer).set([
    -0.5, 0, 0,
    0.5, 0, 0,
  ]);

  return buffer;
};

const triangleWithImageBytes = (): ArrayBuffer => {
  const base = triangleBin();
  const buffer = new ArrayBuffer(base.byteLength + 4);
  new Uint8Array(buffer).set(new Uint8Array(base));
  new Uint8Array(buffer, base.byteLength).set([0x89, 0x50, 0x4E, 0x47]);

  return buffer;
};

const lodBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(lodBinByteLength);

  new Float32Array(buffer, 0, 12).set([
    -0.75, -0.75, 0,
    0.75, -0.75, 0,
    0.75, 0.75, 0,
    -0.75, 0.75, 0,
  ]);
  new Uint16Array(buffer, 48, 6).set([0, 1, 2, 0, 2, 3]);
  new Float32Array(buffer, 60, 9).set([
    0, 0.75, 0,
    -0.75, -0.75, 0,
    0.75, -0.75, 0,
  ]);
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

const lodAccessors = () => [
  {
    bufferView: 0,
    componentType: 5126,
    count: 4,
    max: [0.75, 0.75, 0],
    min: [-0.75, -0.75, 0],
    type: "VEC3",
  },
  {
    bufferView: 1,
    componentType: 5123,
    count: 6,
    type: "SCALAR",
  },
  {
    bufferView: 2,
    componentType: 5126,
    count: 3,
    max: [0.75, 0.75, 0],
    min: [-0.75, -0.75, 0],
    type: "VEC3",
  },
  {
    bufferView: 3,
    componentType: 5123,
    count: 3,
    type: "SCALAR",
  },
];

const lodBufferViews = () => [
  {
    buffer: 0,
    byteLength: 48,
    byteOffset: 0,
    target: 34962,
  },
  {
    buffer: 0,
    byteLength: 12,
    byteOffset: 48,
    target: 34963,
  },
  {
    buffer: 0,
    byteLength: 36,
    byteOffset: 60,
    target: 34962,
  },
  {
    buffer: 0,
    byteLength: 6,
    byteOffset: 96,
    target: 34963,
  },
];

const nodeLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
      },
    },
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0, 0, 1, 1],
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
          material: 0,
          mode: 4,
        },
      ],
    },
    {
      primitives: [
        {
          attributes: {
            POSITION: 2,
          },
          indices: 3,
          material: 1,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      mesh: 0,
    },
    {
      mesh: 1,
    },
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0, 1],
    },
  ],
});

const materialLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  materials: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
      },
    },
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0, 0, 1, 1],
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      mesh: 0,
    },
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0],
    },
  ],
});

const materialTexturePendingLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  images: [
    {
      uri: lodImageUri,
    },
  ],
  materials: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
      },
    },
    {
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      mesh: 0,
    },
  ],
  samplers: [
    {},
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0],
    },
  ],
  textures: [
    {
      sampler: 0,
      source: 0,
    },
  ],
});

const materialSharedTextureLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  images: [
    {
      uri: lodImageUri,
    },
  ],
  materials: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
      },
    },
    {
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      mesh: 0,
    },
  ],
  samplers: [
    {},
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0],
    },
  ],
  textures: [
    {
      sampler: 0,
      source: 0,
    },
  ],
});

const triangleDocument = () => ({
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      max: [0.5, 0.5, 0],
      min: [-0.5, -0.5, 0],
      type: "VEC3",
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    },
    {
      bufferView: 2,
      componentType: 5126,
      count: 3,
      type: "VEC2",
    },
    {
      bufferView: 3,
      componentType: 5123,
      count: 3,
      type: "SCALAR",
    },
  ],
  asset: { version: "2.0" },
  bufferViews: [
    {
      buffer: 0,
      byteLength: 36,
      byteOffset: 0,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 36,
      byteOffset: 36,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 24,
      byteOffset: 72,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 6,
      byteOffset: 96,
      target: 34963,
    },
  ],
  buffers: [
    {
      byteLength: triangleBinByteLength,
      uri: triangleBinUri,
    },
  ],
  images: [
    {
      mimeType: "image/png",
      uri: triangleImageUri,
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            NORMAL: 1,
            POSITION: 0,
            TEXCOORD_0: 2,
          },
          indices: 3,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      mesh: 0,
    },
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0],
    },
  ],
  textures: [
    {
      sampler: 0,
      source: 0,
    },
  ],
  samplers: [
    {},
  ],
});

const solidTriangleDocument = () => ({
  ...triangleDocument(),
  images: [],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.62, 0.36, 1],
      },
    },
  ],
  samplers: [],
  textures: [],
});

const instancedTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: 4,
        componentType: 5126,
        count: 2,
        type: "VEC3",
      },
      {
        bufferView: 5,
        componentType: 5126,
        count: 2,
        type: "VEC3",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 24,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteLength: 24,
        byteOffset: triangleBinByteLength + 24,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: instancedTriangleBinByteLength,
        uri: triangleBinUri,
      },
    ],
    extensionsRequired: ["EXT_mesh_gpu_instancing"],
    extensionsUsed: ["EXT_mesh_gpu_instancing"],
    nodes: [
      {
        extensions: {
          EXT_mesh_gpu_instancing: {
            attributes: {
              SCALE: 5,
              TRANSLATION: 4,
            },
          },
        },
        mesh: 0,
      },
    ],
  };
};

const punctualLightTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      KHR_lights_punctual: {
        lights: [
          {
            color: [0.5, 0.5, 1],
            intensity: 2,
            type: "directional",
          },
          {
            color: [1, 0.5, 0.25],
            intensity: 3,
            range: 5,
            type: "point",
          },
          {
            color: [0.25, 1, 0.5],
            intensity: 4,
            range: 6,
            spot: {
              innerConeAngle: 0.1,
              outerConeAngle: 0.5,
            },
            type: "spot",
          },
        ],
      },
    },
    extensionsRequired: ["KHR_lights_punctual"],
    extensionsUsed: ["KHR_lights_punctual"],
    nodes: [
      {
        extensions: {
          KHR_lights_punctual: {
            light: 0,
          },
        },
      },
      {
        extensions: {
          KHR_lights_punctual: {
            light: 1,
          },
        },
        translation: [1, 2, 3],
      },
      {
        extensions: {
          KHR_lights_punctual: {
            light: 2,
          },
        },
        translation: [-1, -2, -3],
      },
      {
        mesh: 0,
      },
    ],
    scenes: [
      {
        nodes: [0, 1, 2, 3],
      },
    ],
  };
};

const emissiveStrengthTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_emissive_strength"],
    extensionsUsed: ["KHR_materials_emissive_strength"],
    materials: [
      {
        emissiveFactor: [0.4, 0.1, 0.2],
        extensions: {
          KHR_materials_emissive_strength: {
            emissiveStrength: 5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
      },
    ],
  };
};

const materialVariantsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      KHR_materials_variants: {
        variants: [
          { name: "ruby" },
          { name: "mint" },
        ],
      },
    },
    extensionsRequired: ["KHR_materials_variants"],
    extensionsUsed: ["KHR_materials_variants"],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.22, 0.24, 0.28, 1],
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.1, 0.08, 1],
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.1, 0.72, 0.46, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              NORMAL: 1,
              POSITION: 0,
              TEXCOORD_0: 2,
            },
            extensions: {
              KHR_materials_variants: {
                mappings: [
                  { material: 1, variants: [0] },
                  { material: 2, variants: [1] },
                ],
              },
            },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
  };
};

const materialVariantTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      KHR_materials_variants: {
        variants: [
          { name: "textured" },
        ],
      },
    },
    extensionsRequired: ["KHR_materials_variants"],
    extensionsUsed: ["KHR_materials_variants"],
    images: [
      {
        uri: triangleVariantImageUri,
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.24, 0.3, 1],
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: {
            index: 0,
          },
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              NORMAL: 1,
              POSITION: 0,
              TEXCOORD_0: 2,
            },
            extensions: {
              KHR_materials_variants: {
                mappings: [
                  { material: 1, variants: [0] },
                ],
              },
            },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    samplers: [
      {},
    ],
    textures: [
      {
        sampler: 0,
        source: 0,
      },
    ],
  };
};

const responseWithJson = (url: string, json: unknown): Response => {
  const text = JSON.stringify(json);

  return {
    arrayBuffer: vi.fn(() => Promise.resolve(new TextEncoder().encode(text).buffer)),
    blob: vi.fn(() => Promise.resolve(new Blob([text], { type: "model/gltf+json" }))),
    json: vi.fn(() => Promise.resolve(json)),
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn(() => Promise.resolve(text)),
    url,
  } as unknown as Response;
};

const responseWithBuffer = (url: string, buffer: ArrayBuffer): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(buffer)),
  blob: vi.fn(() => Promise.resolve(new Blob([buffer], { type: "application/octet-stream" }))),
  ok: true,
  status: 200,
  statusText: "OK",
  url,
}) as unknown as Response;

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if ("url" in input && typeof input.url === "string") return input.url;

  return String(input);
};

const installStagedGltfLoader = () => {
  const bitmapRequests: BitmapRequest[] = [];
  const fetchRequests: FetchRequest[] = [];
  const settledFetches = new Set<FetchRequest>();

  vi.stubGlobal("Image", ControlledImage);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
    new Promise<Response>((resolve, reject) => {
      fetchRequests.push({
        reject,
        resolve,
        url: requestUrl(input),
      });
    })));
  vi.stubGlobal("createImageBitmap", vi.fn(() =>
    new Promise<ImageBitmap>((resolve, reject) => {
      bitmapRequests.push({ reject, resolve });
    })));

  return {
    bitmapRequests,
    fetchRequests,
    rejectPendingFetch: (pattern: RegExp, reason: unknown): boolean => {
      const request = fetchRequests.find((entry) => !settledFetches.has(entry) && pattern.test(entry.url));
      if (request === undefined) return false;

      settledFetches.add(request);
      request.reject(reason);

      return true;
    },
    resolvePendingFetch: (pattern: RegExp, response: (url: string) => Response): boolean => {
      const request = fetchRequests.find((entry) => !settledFetches.has(entry) && pattern.test(entry.url));
      if (request === undefined) return false;

      settledFetches.add(request);
      request.resolve(response(request.url));

      return true;
    },
  };
};

const settleDocumentAndBuffer = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
): Promise<void> => {
  expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
    responseWithJson(url, triangleDocument()))).toBe(true);
  await flushMicrotasks();
  expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
    responseWithBuffer(url, triangleBin()))).toBe(true);
  await flushMicrotasks();
};

const settleLodDocumentAndBuffer = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
  document: unknown,
): Promise<void> => {
  expect(loader.resolvePendingFetch(/lod\.gltf(?:$|[?#])/, (url) =>
    responseWithJson(url, document))).toBe(true);
  await flushMicrotasks();
  expect(loader.resolvePendingFetch(/lod\.bin(?:$|[?#])/, (url) =>
    responseWithBuffer(url, lodBin()))).toBe(true);
  await flushMicrotasks();
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
  ControlledResizeObserver.instances.splice(0);
});

describe("WebGL renderer scene and glTF regressions", () => {
  it("schedules a follow-up render when only DPR changes", async () => {
    const viewport = installViewportInvalidationStubs();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);

    root.render(renderScene([
      mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      }),
    ]));

    const drawCountBeforeChange = drawCalls(calls).length;
    const scheduledBeforeChange = viewport.animationFrames.length;

    viewport.triggerViewportChange(canvas);
    await flushMicrotasks();

    expect(
      viewport.animationFrames.length > scheduledBeforeChange || drawCalls(calls).length > drawCountBeforeChange,
      "DPR-only viewport invalidation should schedule or perform a follow-up render",
    ).toBe(true);
  });

  it("culls clearly offscreen meshes against an orthographic camera", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      mesh({
        geometry: boxGeometry(0.5),
        material: unlitMaterial({ color: [0.9, 0.2, 0.1, 1] }),
      }),
      mesh({
        geometry: boxGeometry(0.5),
        material: unlitMaterial({ color: [0.1, 0.2, 0.9, 1] }),
        transform: {
          position: [100, 0, 0],
          rotation: [0, 0, 0],
        },
      }),
    ]));

    expect(drawCalls(calls), "only the visible mesh should draw").toHaveLength(1);
  });

  it("requires a directionalLight when drawing standardMaterial meshes", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => {
      root.render(renderScene([
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({ color: [1, 1, 1, 1] }),
        }),
      ]));
    }).toThrow(/directionalLight/i);
  });

  it("draws glTF fallback geometry after buffers settle while base-color image is pending or failed", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "staged-fallback",
      }),
    ]);

    root.render(renderGraph);
    expect(drawCalls(calls)).toHaveLength(0);

    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "glTF should draw fallback geometry before its base-color image settles",
    ).toBe(true);

    const drawsBeforeFailure = drawCalls(calls).length;
    const failedImage = new Error("staged base-color decode failed");
    for (const image of ControlledImage.instances) image.rejectLoad(failedImage);
    for (const bitmapRequest of loader.bitmapRequests.splice(0)) bitmapRequest.reject(failedImage);
    loader.rejectPendingFetch(/staged-triangle\.png(?:$|[?#])/, failedImage);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    root.render(renderGraph);

    expect(drawCalls(calls).length, "failed base-color image should not make the glTF disappear")
      .toBeGreaterThan(drawsBeforeFailure);
    expect(root.snapshot().diagnostics.some((message) =>
      /base-?color|image|texture/i.test(message))).toBe(true);
  });

  it("automatically instances matching glTF geometry across different asset URLs", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        transform: {
          position: [-0.25, 0, 0],
          rotation: [0, 0, 0],
        },
        version: "instanced-a",
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        transform: {
          position: [0.25, 0, 0],
          rotation: [0, 0, 0],
        },
        version: "instanced-b",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);

    expect(instancedDraws).toHaveLength(1);
    expect(instancedDraws[0]?.name).toBe("drawElementsInstanced");
    expect(instancedDraws[0]?.args[0]).toBe(gl.TRIANGLES);
    expect(instancedDraws[0]?.args[1]).toBe(3);
    expect(instancedDrawInstanceCount(instancedDraws[0]!)).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(0);
  });

  it("renders required EXT_mesh_gpu_instancing node transforms through the instanced draw path", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "ext-mesh-gpu-instancing",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, instancedTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, instancedTriangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);
    const instanceModelPayload = bufferDataPayloads(readyFrameCalls)
      .find((payload) => payload.length === 32);

    expect(instancedDraws).toHaveLength(1);
    expect(instancedDraws[0]?.name).toBe("drawElementsInstanced");
    expect(instancedDraws[0]?.args[0]).toBe(gl.TRIANGLES);
    expect(instancedDraws[0]?.args[1]).toBe(3);
    expect(instancedDrawInstanceCount(instancedDraws[0]!)).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(0);
    expect(instanceModelPayload).toBeDefined();
    expect(roundVector([
      instanceModelPayload?.[0] ?? 0,
      instanceModelPayload?.[12] ?? 0,
      instanceModelPayload?.[16] ?? 0,
      instanceModelPayload?.[28] ?? 0,
    ])).toEqual([1, -0.25, 1.25, 0.25]);
  });

  it("renders required KHR_lights_punctual directional, point, and spot lights without a pass light", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "khr-lights-punctual",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, punctualLightTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(3);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightKind[0]")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightKind[1]")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightKind[2]")).toContain(2);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightColor[0]").map(roundVector)).toContainEqual([1, 1, 2, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightColor[1]").map(roundVector)).toContainEqual([3, 1.5, 0.75, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightPosition[1]").map(roundVector)).toContainEqual([1, 2, 3, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightDirection[1]").map(roundVector)).toContainEqual([0, -1, 0, 5]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightPosition[2]").map(roundVector)).toContainEqual([-1, -2, -3, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightDirection[2]").map(roundVector)).toContainEqual([0, 0, -1, 6]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightCone[2]").map(roundVector)).toContainEqual([
      roundNumber(Math.cos(0.1)),
      roundNumber(Math.cos(0.5)),
      0,
      0,
    ]);
  });

  it("renders required KHR_materials_emissive_strength as an emissive material multiplier", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "khr-materials-emissive-strength",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, emissiveStrengthTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_color").map(roundVector)).toContainEqual([0.25, 0.25, 0.25, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_emissiveColor").map(roundVector)).toContainEqual([2, 0.5, 1, 1]);
  });

  it("selects KHR_materials_variants materials by name or index and falls back to the base material", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [-0.45, 0, 0], rotation: [0, 0, 0] },
        variant: "ruby",
        version: "khr-materials-variants",
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        variant: 1,
        version: "khr-materials-variants",
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.45, 0, 0], rotation: [0, 0, 0] },
        variant: "missing",
        version: "khr-materials-variants",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialVariantsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const colors = uniform4fvPayloads(readyFrameCalls, "u_color").map(roundVector);

    expect(drawCalls(readyFrameCalls).filter((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3))
      .toHaveLength(3);
    expect(colors).toContainEqual([0.9, 0.1, 0.08, 1]);
    expect(colors).toContainEqual([0.1, 0.72, 0.46, 1]);
    expect(colors).toContainEqual([0.22, 0.24, 0.28, 1]);
  });

  it("settles and uploads images referenced only by KHR_materials_variants materials", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        variant: "textured",
        version: "khr-materials-variants-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialVariantTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleVariantImageUri}`))).toBe(true);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(0);

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("loads glTF buffers from data URIs without fetching external buffer resources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "data-uri-buffer",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        buffers: [
          {
            byteLength: triangleBinByteLength,
            uri: dataUriForBuffer(triangleBin()),
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "glTF should draw from an embedded data URI buffer",
    ).toBe(true);
  });

  it("loads GLB JSON and BIN chunks without fetching external buffer resources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const triangleGlbSrc = "https://example.test/fixtures/staged-triangle.glb";
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGlbSrc,
        version: "glb-bin-chunk",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.glb(?:$|[?#])/, (url) =>
      responseWithBuffer(url, glbContainer({
        ...triangleDocument(),
        buffers: [
          {
            byteLength: triangleBinByteLength,
          },
        ],
      }, triangleBin())))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "GLB should draw from its embedded BIN chunk",
    ).toBe(true);
  });

  it("decodes interleaved glTF accessors with byteStride", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "interleaved-accessors" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 0, byteOffset: 24, componentType: 5126, count: 3, type: "VEC2" },
          { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          { buffer: 0, byteLength: 96, byteOffset: 0, byteStride: 32, target: 34962 },
          { buffer: 0, byteLength: 6, byteOffset: 96, target: 34963 },
        ],
        buffers: [{ byteLength: 102, uri: triangleBinUri }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, interleavedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
  });

  it("decodes required KHR_mesh_quantization normalized integer attributes", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "quantized-accessors" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { bufferView: 0, componentType: 5122, count: 3, normalized: true, type: "VEC3" },
          { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          { buffer: 0, byteLength: 18, byteOffset: 0, target: 34962 },
          { buffer: 0, byteLength: 6, byteOffset: 18, target: 34963 },
        ],
        buffers: [{ byteLength: 24, uri: triangleBinUri }],
        extensionsRequired: ["KHR_mesh_quantization"],
        extensionsUsed: ["KHR_mesh_quantization"],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, quantizedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 1, 0,
      -1, -1, 0,
      1, -1, 0,
    ]);
  });

  it("applies sparse glTF accessor overrides", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "sparse-accessor" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          {
            componentType: 5126,
            count: 3,
            sparse: {
              count: 3,
              indices: { bufferView: 0, componentType: 5121 },
              values: { bufferView: 1 },
            },
            type: "VEC3",
          },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          { buffer: 0, byteLength: 3, byteOffset: 0 },
          { buffer: 0, byteLength: 36, byteOffset: 4 },
        ],
        buffers: [{ byteLength: 40, uri: triangleBinUri }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, sparseTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
  });

  it("applies required KHR_texture_transform to base-color texture coordinates", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "texture-transform" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_texture_transform"],
        extensionsUsed: ["KHR_texture_transform"],
        materials: [
          {
            pbrMetallicRoughness: {
              baseColorTexture: {
                extensions: {
                  KHR_texture_transform: {
                    offset: [0.25, 0.5],
                    scale: [0.5, 0.25],
                  },
                },
                index: 0,
              },
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0.5, 0.875,
      0.25, 0.75,
      0.75, 0.75,
    ]);
  });

  it("applies parent and child transforms when traversing glTF node hierarchies", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "node-hierarchy" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        nodes: [
          { children: [1], translation: [0.25, 0, 0] },
          { mesh: 0, translation: [0.25, 0, 0] },
        ],
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(matrixUniformPayloads(calls, "u_model").map(roundVector)).toContainEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.5, 0, 0, 1,
    ]);
  });

  it("loads glTF base-color images from bufferViews", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "buffer-view-image" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        bufferViews: [
          ...(triangleDocument().bufferViews),
          { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
        ],
        buffers: [{ byteLength: triangleBinByteLength + 4, uri: triangleBinUri }],
        images: [{ bufferView: 4, mimeType: "image/png" }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    expect(loader.bitmapRequests).toHaveLength(1);

    loader.bitmapRequests[0]?.resolve({} as ImageBitmap);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("loads required EXT_texture_webp base-color texture sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "webp-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["EXT_texture_webp"],
        extensionsUsed: ["EXT_texture_webp"],
        images: [{ uri: triangleImageUri }, { uri: triangleWebpImageUri }],
        textures: [{ extensions: { EXT_texture_webp: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleWebpImageUri}`))).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("renders required KHR_materials_unlit glTF materials without lighting", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      gltf({ src: triangleGltfSrc, version: "unlit-material" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_materials_unlit"],
        extensionsUsed: ["KHR_materials_unlit"],
        images: [],
        materials: [
          {
            extensions: { KHR_materials_unlit: {} },
            pbrMetallicRoughness: { baseColorFactor: [0.25, 0.5, 0.75, 1] },
          },
        ],
        samplers: [],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([0.25, 0.5, 0.75, 1]);
    expect(calls.some((call) => call.name === "uniform1i" && uniformLocationName(call.args[0]) === "u_unlit" && call.args[1] === 1))
      .toBe(true);
  });

  it("hides required KHR_node_visibility node hierarchies", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "node-visibility" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_node_visibility"],
        extensionsUsed: ["KHR_node_visibility"],
        images: [],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        nodes: [
          {
            children: [1],
            extensions: { KHR_node_visibility: { visible: false } },
          },
          { mesh: 0 },
        ],
        samplers: [],
        scenes: [{ nodes: [0] }],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls)).toHaveLength(0);
  });

  it("renders glTF line primitives with line draw mode", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "line-primitive" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC3" }],
        asset: { version: "2.0" },
        bufferViews: [{ buffer: 0, byteLength: 24, byteOffset: 0 }],
        buffers: [{ byteLength: 24, uri: triangleBinUri }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 1 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, lineBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.LINES && drawCount(call) === 2)).toBe(true);
  });

  it("skips unsupported glTF primitive modes with a diagnostic", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "unsupported-primitive-mode" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        images: [],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 5 }] }],
        samplers: [],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls)).toHaveLength(0);
    expect(root.snapshot().diagnostics.some((message) => /unsupported primitive mode 5/i.test(message))).toBe(true);
  });

  it("ignores unsupported optional glTF extensions when core fallback data is present", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "optional-extension-fallback",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["KHR_materials_clearcoat"],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "optional unsupported material extension should fall back to core glTF data",
    ).toBe(true);
  });

  it("rejects glTF assets with unsupported required extensions before fetching dependent resources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "unsupported-required-extension",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_draco_mesh_compression"],
        extensionsUsed: ["KHR_draco_mesh_compression"],
      }))).toBe(true);
    await flushMicrotasks();

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(root.snapshot().diagnostics.some((message) =>
      /unsupported required glTF extension.*KHR_draco_mesh_compression/i.test(message))).toBe(true);

    root.render(renderGraph);
    expect(drawCalls(calls)).toHaveLength(0);
  });

  it("binds glTF normals and texcoords, applies node transform, and uses the pass light", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const lightDirection = [0.25, -0.5, -1] as const;
    const renderGraph = renderScene([
      directionalLight({
        color: [0.8, 0.9, 1, 1],
        direction: lightDirection,
      }),
      gltf({
        src: triangleGltfSrc,
        transform: {
          position: [0.2, 0, 0],
          rotation: [0, 0, 0],
          scale: [2, 1, 1],
        },
        version: "staged-shading",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(calls.some((call) => call.name === "getAttribLocation" && call.args[1] === "a_normal")).toBe(true);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 1
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 2
      && call.args[1] === 2
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(uniform4fvPayloads(calls, "u_surfaceLightDirection[0]").map(roundVector)).toContainEqual([
      ...roundVector(lightDirection),
      0,
    ]);
    expect(matrixUniformPayloads(calls).map(roundVector)).toContainEqual(roundVector([
      2, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.2, 0, 0, 1,
    ]));
  });

  it("uploads glTF base-color textures with glTF sampler defaults and image orientation", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "staged-gltf-sampler",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(texturePixelStoreCalls(calls)).toContainEqual({
      args: [gl.UNPACK_FLIP_Y_WEBGL, false],
      name: "pixelStorei",
    });
    expect(textureParameterCalls(calls)).toContainEqual({
      args: [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT],
      name: "texParameteri",
    });
    expect(textureParameterCalls(calls)).toContainEqual({
      args: [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT],
      name: "texParameteri",
    });
  });

  it("selects one node-level MSFT_lod member from screen coverage and suppresses lower roots", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "node-lod",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const highDraws = drawCalls(calls);
    expect(highDraws.at(-1)?.args[0]).toBe(gl.TRIANGLES);
    expect(drawCount(highDraws.at(-1)!), "high coverage should select the six-index LOD0 quad").toBe(6);

    const drawsBeforeLow = drawCalls(calls).length;
    root.render(renderGraph(0.2));

    const lowDraws = drawCalls(calls).slice(drawsBeforeLow);
    expect(lowDraws, "only one node in the LOD chain should draw per render").toHaveLength(1);
    expect(drawCount(lowDraws[0]!), "low coverage should select the referenced three-index LOD1 triangle").toBe(3);
  });

  it("selects material-level MSFT_lod variants from screen coverage", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const high = fakeGl();
    const highRoot = createWebGlRoot(fakeCanvas(high.gl));
    const low = fakeGl();
    const lowRoot = createWebGlRoot(fakeCanvas(low.gl));
    const renderGraph = (version: string, scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version,
      }),
    ]);

    highRoot.render(renderGraph("material-lod-high", 1));
    await settleLodDocumentAndBuffer(loader, materialLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const highColors = uniform4fvPayloads(high.calls, "u_color").map(roundVector);
    expect(highColors).toContainEqual([1, 0, 0, 1]);

    const lowLoader = installStagedGltfLoader();
    lowRoot.render(renderGraph("material-lod-low", 0.2));
    await settleLodDocumentAndBuffer(lowLoader, materialLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const lowColors = uniform4fvPayloads(low.calls, "u_color").map(roundVector);
    expect(lowColors).toContainEqual([0, 0, 1, 1]);
  });

  it("uses selected material LOD texture transforms for glTF texcoords", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      gltf({
        src: triangleGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.2, 0.2, 1],
        },
        version: "material-lod-texture-transform",
      }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_texture_transform"],
        extensionsUsed: ["KHR_texture_transform", "MSFT_lod"],
        materials: [
          {
            extensions: { MSFT_lod: { ids: [1] } },
            extras: { MSFT_screencoverage: [0.2, 0] },
            pbrMetallicRoughness: {
              baseColorTexture: { index: 0 },
            },
          },
          {
            pbrMetallicRoughness: {
              baseColorTexture: {
                extensions: {
                  KHR_texture_transform: {
                    offset: [0.25, 0.5],
                    scale: [0.5, 0.25],
                  },
                },
                index: 0,
              },
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0.5, 0.875,
      0.25, 0.75,
      0.75, 0.75,
    ]);
  });

  it("keeps node-level MSFT_lod selection stable inside a threshold hysteresis band", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (coverage: number) => {
      const scale = lodScaleForCoverage(coverage);

      return renderScene([
        gltf({
          src: lodGltfSrc,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [scale, scale, 1],
          },
          version: "node-lod-hysteresis",
        }),
      ]);
    };
    const renderSelectedCount = (coverage: number): number => {
      const drawsBeforeRender = drawCalls(calls).length;
      root.render(renderGraph(coverage));
      const draws = drawCalls(calls).slice(drawsBeforeRender);
      expect(draws, `coverage ${coverage} should draw exactly one LOD member`).toHaveLength(1);

      return drawCount(draws[0]!);
    };

    root.render(renderGraph(0.205));
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const firstDraw = drawCalls(calls).at(-1);
    expect(firstDraw, "initial high-coverage frame should draw").toBeDefined();
    expect(firstDraw?.args[0]).toBe(gl.TRIANGLES);

    const selectedCounts = [
      drawCount(firstDraw!),
      renderSelectedCount(0.198),
      renderSelectedCount(0.14),
      renderSelectedCount(0.202),
    ];

    expect(
      selectedCounts,
      "selection should not flap for small coverage jitter around the 0.2 threshold",
    ).toEqual([6, 6, 3, 3]);
  });

  it("keeps the loaded material LOD visible while the preferred lower texture LOD is unavailable", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "material-lod-pending-texture",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, materialTexturePendingLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([1, 0, 0, 1]);
    expect(ControlledImage.instances, "lower LOD texture should be staged but not settled").toHaveLength(1);

    const pendingCallsStart = calls.length;
    root.render(renderGraph(0.2));
    const pendingCalls = calls.slice(pendingCallsStart);
    expect(drawCalls(pendingCalls), "pending lower texture LOD should not blank the glTF").toHaveLength(1);
    expect(
      uniform4fvPayloads(pendingCalls, "u_color").map(roundVector),
      "renderer should keep the loaded high material until the lower material texture is usable",
    ).toContainEqual([1, 0, 0, 1]);

    const failedImage = new Error("lower material LOD texture failed");
    for (const image of ControlledImage.instances) image.rejectLoad(failedImage);
    await flushMicrotasks();

    const failedCallsStart = calls.length;
    root.render(renderGraph(0.2));
    const failedCalls = calls.slice(failedCallsStart);
    expect(drawCalls(failedCalls), "failed lower texture LOD should not blank the glTF").toHaveLength(1);
    expect(
      uniform4fvPayloads(failedCalls, "u_color").map(roundVector),
      "renderer should keep the loaded high material after the preferred lower texture fails",
    ).toContainEqual([1, 0, 0, 1]);
    expect(root.snapshot().diagnostics.some((message) => /lod-shared\.png|texture|image/i.test(message))).toBe(true);
  });

  it("uploads a shared glTF texture once across material MSFT_lod levels", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "material-lod-shared-texture",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, materialSharedTextureLodDocument());
    await flushAnimationFrames(viewport.animationFrames);
    expect(ControlledImage.instances, "shared LOD texture should be loaded once by URI").toHaveLength(1);

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.TRIANGLES);
    expect(callCount(calls, "texImage2D"), "high LOD should upload the shared glTF texture once").toBe(1);

    root.render(renderGraph(0.2));

    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.TRIANGLES);
    expect(
      callCount(calls, "texImage2D"),
      "switching to a lower material LOD that references the same texture index must reuse the upload",
    ).toBe(1);
  });
});
