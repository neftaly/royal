import { afterEach, describe, expect, it, vi } from "vitest";
import {
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
  virtualTexture,
  wireframeMaterial,
  type RenderNode,
  type LinearRgba,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly result?: unknown;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type DrawCall = GlCall & {
  readonly name: "drawArrays" | "drawElements";
};

type FetchRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (response: Response) => void;
  readonly url: string;
};

type BitmapRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (bitmap: ImageBitmap) => void;
  readonly source: unknown;
};

const defaultCanvasSize: CanvasSize = { width: 320, height: 180 };
const gltfFixtureSrc = "/fixtures/product-card.gltf";
const gltfFixtureBufferUri = "product-card.bin";
const gltfFixtureImageUri = "product-card-base-color.png";
const gltfFixtureBufferByteLength = 104;

const fakeCanvas = (
  gl: WebGL2RenderingContext,
  size: CanvasSize = defaultCanvasSize,
): FakeCanvas => {
  const target = new EventTarget();
  const canvas = {
    addEventListener: target.addEventListener.bind(target),
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
    removeEventListener: target.removeEventListener.bind(target),
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
    COLOR_ATTACHMENT0: 0x8CE0,
    BROWSER_DEFAULT_WEBGL: 0x9244,
    CLAMP_TO_EDGE: 0x812F,
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
    LESS: 0x0201,
    LINE_LOOP: 0x0002,
    LINE_STRIP: 0x0003,
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
    RGBA16F: 0x881A,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    SCISSOR_TEST: 0x0C11,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88E4,
    RENDERBUFFER: 0x8D41,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MAG_FILTER: 0x2800,
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
    const result = implementation?.(...args);
    calls.push(result === undefined ? { name, args } : { name, args, result });

    return result;
  });

  const glTarget = {
    ...constants,
    drawingBufferHeight: defaultCanvasSize.height,
    drawingBufferWidth: defaultCanvasSize.width,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindFramebuffer: record("bindFramebuffer"),
    bindRenderbuffer: record("bindRenderbuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendFuncSeparate: record("blendFuncSeparate"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => handle<WebGLBuffer>("buffer")),
    createFramebuffer: record("createFramebuffer", () => handle<WebGLFramebuffer>("framebuffer")),
    createProgram: record("createProgram", () => handle<WebGLProgram>("program")),
    createRenderbuffer: record("createRenderbuffer", () => handle<WebGLRenderbuffer>("renderbuffer")),
    createShader: record("createShader", () => handle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => handle<WebGLTexture>("texture")),
    createVertexArray: record("createVertexArray", () => handle<WebGLVertexArrayObject>("vertex-array")),
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
    detachShader: record("detachShader"),
    disable: record("disable"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    framebufferRenderbuffer: record("framebufferRenderbuffer"),
    framebufferTexture2D: record("framebufferTexture2D"),
    frontFace: record("frontFace"),
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
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    checkFramebufferStatus: record("checkFramebufferStatus", () => constants.FRAMEBUFFER_COMPLETE),
    getParameter: record<[number]>("getParameter", (parameter) => {
      if (
        parameter === constants.MAX_COMBINED_TEXTURE_IMAGE_UNITS
        || parameter === constants.MAX_TEXTURE_IMAGE_UNITS
      ) {
        return 8;
      }
      if (parameter === constants.MAX_TEXTURE_SIZE) return 4096;

      return 0;
    }),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.LINK_STATUS) return true;
      if (parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS) return 0;

      return true;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) => {
      if (parameter === constants.COMPILE_STATUS) return true;

      return true;
    }),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniform(name)),
    isContextLost: record("isContextLost", () => false),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    polygonOffset: record("polygonOffset"),
    renderbufferStorage: record("renderbufferStorage"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texSubImage2D: record("texSubImage2D"),
    uniform1f: record("uniform1f"),
    uniform1i: record("uniform1i"),
    uniform2f: record("uniform2f"),
    uniform2fv: record("uniform2fv"),
    uniform3f: record("uniform3f"),
    uniform3fv: record("uniform3fv"),
    uniform4f: record("uniform4f"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix3fv: record("uniformMatrix3fv"),
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

  settleLoad(): void {
    this.complete = true;
    this.dispatch("load");
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
    this.#decodeRejectors.splice(0);
  }

  private dispatch(type: "load"): void {
    const event = new Event(type);
    this.onload?.call(this as unknown as HTMLImageElement, event);

    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

const camera = () => orthographicCamera({
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

const renderScene = (
  children: readonly RenderNode[],
  clearColor: LinearRgba = [0, 0, 0, 0],
) => scene({
  camera: camera(),
  nodes: children,
  clearColor,
});

const drawCalls = (calls: readonly GlCall[]): readonly DrawCall[] =>
  calls.filter((call): call is DrawCall => call.name === "drawArrays" || call.name === "drawElements");

const drawCount = (call: DrawCall): number =>
  call.name === "drawArrays" ? Number(call.args[2]) : Number(call.args[1]);

const eventCount = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

const isNumericArrayLike = (value: unknown): value is ArrayLike<number> =>
  ArrayBuffer.isView(value)
  && !(value instanceof DataView)
  && typeof (value as { readonly length?: unknown }).length === "number";

const numericArray = (value: unknown): readonly number[] => {
  if (Array.isArray(value)) return value.map(Number);
  if (isNumericArrayLike(value)) return Array.from(value, Number);

  return [];
};

const dataLength = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (isNumericArrayLike(value)) return value.length;

  return 0;
};

const bufferUploads = (calls: readonly GlCall[]): readonly { readonly length: number; readonly target: unknown }[] =>
  calls
    .filter((call) => call.name === "bufferData" || call.name === "bufferSubData")
    .map((call) => {
      const payload = call.name === "bufferSubData" ? call.args[2] : call.args[1];

      return {
        length: dataLength(payload),
        target: call.args[0],
      };
    });

const hasTexturePixelUploadAfter = (
  calls: readonly GlCall[],
  firstAllowedUploadIndex: number,
): boolean => {
  const textureStorageIndex = calls.findIndex((call) => call.name === "texStorage2D");

  return calls.some((call, index) =>
    index >= firstAllowedUploadIndex
    && (
      call.name === "texImage2D"
      || (
        call.name === "texSubImage2D"
        && textureStorageIndex >= 0
        && textureStorageIndex < index
      )
    ));
};

const roundNumber = (value: number): number => {
  const rounded = Number(value.toFixed(6));

  return Object.is(rounded, -0) ? 0 : rounded;
};

const uniformVectors = (
  calls: readonly GlCall[],
  size: 3 | 4,
): readonly (readonly number[])[] =>
  calls.flatMap((call) => {
    if (call.name === `uniform${size}f`) {
      return [call.args.slice(1, 1 + size).map(Number)];
    }

    if (call.name !== `uniform${size}fv`) return [];

    const values = numericArray(call.args[1]);
    const offset = typeof call.args[2] === "number" ? call.args[2] : 0;
    const length = typeof call.args[3] === "number" ? call.args[3] : size;

    return [values.slice(offset, offset + length).slice(0, size)];
  });

const expectUniformVector = (
  calls: readonly GlCall[],
  expected: readonly number[],
): void => {
  const actual = uniformVectors(calls, expected.length === 3 ? 3 : 4)
    .map((values) => values.map(roundNumber));

  expect(actual).toContainEqual(expected.map(roundNumber));
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const installAnimationFrameQueue = (): FrameRequestCallback[] => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);

    return callbacks.length;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  return callbacks;
};

const flushAnimationFrames = async (callbacks: FrameRequestCallback[]): Promise<void> => {
  const queued = callbacks.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
  await flushMicrotasks();
};

const gltfFixtureBuffer = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(gltfFixtureBufferByteLength);

  new Float32Array(buffer, 0, 9).set([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0, 0.5, 0,
  ]);
  new Float32Array(buffer, 36, 9).set([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  new Float32Array(buffer, 72, 6).set([
    0, 1,
    1, 1,
    0.5, 0,
  ]);
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

const gltfFixtureDocument = () => ({
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
  asset: {
    generator: "royal renderer-webgl contract fixture",
    version: "2.0",
  },
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
      byteLength: gltfFixtureBufferByteLength,
      uri: gltfFixtureBufferUri,
    },
  ],
  images: [
    {
      mimeType: "image/png",
      uri: gltfFixtureImageUri,
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
      source: 0,
    },
  ],
});

const fakeGltfDocumentResponse = (url: string): Response => {
  const document = gltfFixtureDocument();
  const text = JSON.stringify(document);

  return {
    arrayBuffer: vi.fn(() => Promise.resolve(new TextEncoder().encode(text).buffer)),
    blob: vi.fn(() => Promise.resolve(new Blob([text], { type: "model/gltf+json" }))),
    json: vi.fn(() => Promise.resolve(document)),
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn(() => Promise.resolve(text)),
    url,
  } as unknown as Response;
};

const fakeGltfBufferResponse = (url: string): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(gltfFixtureBuffer())),
  blob: vi.fn(() => Promise.resolve(new Blob([gltfFixtureBuffer()], { type: "application/octet-stream" }))),
  ok: true,
  status: 200,
  statusText: "OK",
  url,
}) as unknown as Response;

const fakeImageResponse = (url: string): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(4))),
  blob: vi.fn(() => Promise.resolve(new Blob(["fake-image"], { type: "image/png" }))),
  ok: true,
  status: 200,
  statusText: "OK",
  url,
}) as unknown as Response;

const fakeImageBitmap = (): ImageBitmap => ({
  close: vi.fn(),
  height: 4,
  width: 4,
}) as unknown as ImageBitmap;

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if ("url" in input && typeof input.url === "string") return input.url;

  return String(input);
};

const installGltfFixtureLoaderStubs = () => {
  const fetchRequests: FetchRequest[] = [];
  const settledFetches = new Set<FetchRequest>();
  const bitmapRequests: BitmapRequest[] = [];

  vi.stubGlobal("Image", ControlledImage);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve, reject) => {
    fetchRequests.push({
      reject,
      resolve,
      url: requestUrl(input),
    });
  })));
  vi.stubGlobal("createImageBitmap", vi.fn((source: ImageBitmapSource) =>
    new Promise<ImageBitmap>((resolve, reject) => {
      bitmapRequests.push({
        reject,
        resolve,
        source,
      });
    })));

  return {
    bitmapRequests,
    fetchRequests,
    settledFetches,
  };
};

const requestedAssetUrls = (loader: ReturnType<typeof installGltfFixtureLoaderStubs>): readonly string[] => [
  ...loader.fetchRequests.map((request) => request.url),
  ...ControlledImage.instances.map((image) => image.src).filter((src) => src.length > 0),
];

const resolvePendingFetch = (
  loader: ReturnType<typeof installGltfFixtureLoaderStubs>,
  pattern: RegExp,
  response: (url: string) => Response,
): boolean => {
  const request = loader.fetchRequests.find((entry) =>
    !loader.settledFetches.has(entry)
    && pattern.test(entry.url));

  if (request === undefined) return false;

  loader.settledFetches.add(request);
  request.resolve(response(request.url));

  return true;
};

const resolveGltfDocument = async (
  loader: ReturnType<typeof installGltfFixtureLoaderStubs>,
): Promise<void> => {
  expect(resolvePendingFetch(loader, /product-card\.gltf(?:$|[?#])/, fakeGltfDocumentResponse)).toBe(true);
  await flushMicrotasks();
};

const settleGltfExternalResources = async (
  loader: ReturnType<typeof installGltfFixtureLoaderStubs>,
  animationFrames: FrameRequestCallback[],
): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    resolvePendingFetch(loader, /product-card\.bin(?:$|[?#])/, fakeGltfBufferResponse);
    resolvePendingFetch(loader, /product-card-base-color\.png(?:$|[?#])/, fakeImageResponse);

    for (const image of ControlledImage.instances) {
      if (!image.complete && image.src.includes(gltfFixtureImageUri)) image.settleLoad();
    }

    await flushMicrotasks();

    for (const request of loader.bitmapRequests.splice(0)) {
      request.resolve(fakeImageBitmap());
    }

    await flushAnimationFrames(animationFrames);
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
});

describe("WebGL renderer product descriptor contracts", () => {
  it("uploads and draws planeGeometry as two triangles", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      }),
    ], [0.01, 0.02, 0.03, 1]));

    expect(calls).toContainEqual({ name: "clearColor", args: [0.01, 0.02, 0.03, 1] });
    expect(bufferUploads(calls).some((upload) => upload.target === gl.ARRAY_BUFFER && upload.length >= 8)).toBe(true);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 6)).toBe(true);
  });

  it("renders wireframeMaterial through line draw calls", () => {
    const color: LinearRgba = [1, 0.8, 0.15, 1];
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      mesh({
        geometry: planeGeometry(1),
        material: wireframeMaterial({ color, width: 2.5 }),
      }),
    ]));

    expect(calls).toContainEqual({ name: "lineWidth", args: [2.5] });
    expectUniformVector(calls, color);
    expect(drawCalls(calls).some((call) =>
      call.args[0] === gl.LINES
      && drawCount(call) > 0
      && drawCount(call) % 2 === 0)).toBe(true);
  });

  it("applies directionalLight data to standardMaterial draws", () => {
    const materialColor: LinearRgba = [0.55, 0.35, 0.2, 1];
    const lightColor: LinearRgba = [0.9, 0.95, 1, 1];
    const lightDirection = [0, -1, 0] as const;
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({
        color: lightColor,
        direction: lightDirection,
      }),
      mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: materialColor }),
      }),
    ]));

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 6)).toBe(true);
    expectUniformVector(calls, materialColor);
    expectUniformVector(calls, lightColor);
    expectUniformVector(calls, [...lightDirection, 0]);
  });

  it("fetches, uploads, and draws the documented narrow glTF subset after resources settle", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const animationFrames = installAnimationFrameQueue();
    const loader = installGltfFixtureLoaderStubs();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      gltf({
        src: gltfFixtureSrc,
        version: "contract-v1",
      }),
    ]));

    expect(requestedAssetUrls(loader)).toEqual(expect.arrayContaining([
      expect.stringMatching(/product-card\.gltf(?:$|[?#])/),
    ]));
    expect(eventCount(calls, "createBuffer")).toBe(0);
    expect(eventCount(calls, "createTexture")).toBe(0);
    expect(drawCalls(calls)).toHaveLength(0);

    await resolveGltfDocument(loader);

    const beforeExternalResourceSettleCallCount = calls.length;
    expect(eventCount(calls, "createBuffer")).toBe(0);
    expect(eventCount(calls, "createTexture")).toBe(0);
    expect(drawCalls(calls)).toHaveLength(0);

    await settleGltfExternalResources(loader, animationFrames);

    expect(requestedAssetUrls(loader)).toEqual(expect.arrayContaining([
      expect.stringMatching(/product-card\.gltf(?:$|[?#])/),
      expect.stringMatching(/product-card\.bin(?:$|[?#])/),
      expect.stringMatching(/product-card-base-color\.png(?:$|[?#])/),
    ]));

    const afterExternalResourceSettleCalls = calls.slice(beforeExternalResourceSettleCallCount);
    const afterExternalResourceSettleUploads = bufferUploads(afterExternalResourceSettleCalls);
    expect(eventCount(afterExternalResourceSettleCalls, "createBuffer")).toBeGreaterThanOrEqual(1);
    expect(eventCount(afterExternalResourceSettleCalls, "createTexture")).toBeGreaterThanOrEqual(1);
    expect(
      afterExternalResourceSettleUploads.some((upload) => upload.target === gl.ARRAY_BUFFER && upload.length >= 9),
      "loaded glTF should upload POSITION/NORMAL/TEXCOORD_0 vertex data",
    ).toBe(true);
    expect(
      afterExternalResourceSettleUploads.some((upload) =>
        upload.target === gl.ELEMENT_ARRAY_BUFFER
        && upload.length >= 3),
      "loaded glTF should upload UNSIGNED_SHORT index data",
    ).toBe(true);
    expect(
      hasTexturePixelUploadAfter(calls, beforeExternalResourceSettleCallCount),
      "loaded glTF baseColorTexture image should upload after image load/decode settles",
    ).toBe(true);
    expect(drawCalls(afterExternalResourceSettleCalls).some((call) =>
      call.args[0] === gl.TRIANGLES
      && drawCount(call) === 3)).toBe(true);
  });

  it("accepts standard material virtual textures as surface base colors while their manifest loads", () => {
    const loader = installGltfFixtureLoaderStubs();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const manifestUrl = "/textures/product-terrain.vt.json";

    expect(() => {
      root.render(renderScene([
        directionalLight({
          color: [1, 1, 1, 1],
          direction: [0, 0, -1],
        }),
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({
            texture: virtualTexture({
              manifestUri: manifestUrl,
              version: "contract-v1",
            }),
          }),
        }),
      ]));
    }).not.toThrow();

    expect(loader.fetchRequests.map((request) => request.url)).toEqual([manifestUrl]);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      manifestRequests: 1,
      preparedResidencyResolutions: 1,
      unsupportedDraws: 0,
    }));
    expect(root.snapshot().diagnostics).toEqual([]);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 6)).toBe(true);
  });

  it("keeps virtual textures on non-surface materials diagnostic", () => {
    const removedFallbackColor: LinearRgba = [0.08, 0.1, 0.12, 1];
    const unsupportedColor: LinearRgba = [1, 0, 1, 1];
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const manifestUrl = "/textures/product-wire.vt.json";

    expect(() => {
      root.render(renderScene([
        mesh({
          geometry: planeGeometry(1),
          material: {
            baseColor: virtualTexture({
              manifestUri: manifestUrl,
              version: "contract-v1",
            }),
            kind: "wireframe",
            width: 2.5,
          },
        }),
      ]));
    }).not.toThrow();

    expectUniformVector(calls, unsupportedColor);
    expect(uniformVectors(calls, 4).map((values) => values.map(roundNumber))).not.toContainEqual(
      removedFallbackColor.map(roundNumber),
    );
    expect(root.snapshot().virtualTexturing.unsupportedDraws).toBeGreaterThan(0);
    expect(root.snapshot().diagnostics).toContainEqual(expect.stringMatching(
      /Virtual texture \/textures\/product-wire\.vt\.json is not rendered.*surface materials/i,
    ));
    expect(drawCalls(calls).some((call) => call.args[0] === gl.LINES && drawCount(call) > 0)).toBe(true);
  });
});
