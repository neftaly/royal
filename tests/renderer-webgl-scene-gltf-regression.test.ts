import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const decodeBasisuMock = vi.hoisted(() => vi.fn());

vi.mock("../packages/renderer-webgl/src/gltf/codecs/basisu", () => ({
  decodeGltfBasisuRgba: decodeBasisuMock,
}));

import {
  boxGeometry,
  createCameraViewResource,
  createGltfInstanceTransforms,
  directionalLight,
  gltf,
  gltfInstances,
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
  type RenderObjectHandle,
  type RenderNode,
  type RenderRoot,
} from "@royal/renderer-core";
import { createWebGlRoot, type WebGlGltfInstancingSnapshot } from "@royal/renderer-webgl";

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
const triangleEmissiveImageUri = "staged-triangle-emissive.png";
const triangleImageUri = "staged-triangle.png";
const triangleBasisuImageUri = "staged-triangle.ktx2";
const triangleMetallicRoughnessImageUri = "staged-triangle-metallic-roughness.png";
const triangleNormalImageUri = "staged-triangle-normal.png";
const triangleOcclusionImageUri = "staged-triangle-occlusion.png";
const triangleJpegImageUri = "staged-triangle.jpg";
const triangleSvgImageUri = "staged-triangle.svg";
const triangleSvgTexture = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path d=\"M64 64h384v384H64z\" fill=\"#f60\"/></svg>";
const triangleVariantImageUri = "staged-triangle-variant.png";
const triangleWebpImageUri = "staged-triangle.webp";
const iblSpecularImageUris = [
  "ibl-pos-x.png",
  "ibl-neg-x.png",
  "ibl-pos-y.png",
  "ibl-neg-y.png",
  "ibl-pos-z.png",
  "ibl-neg-z.png",
] as const;
const triangleBinByteLength = 104;
const meshoptCompressedPositionByteLength = 56;
const meshoptCompressedIndexByteLength = 18;
const meshoptCompressedTriangleBinByteLength = meshoptCompressedPositionByteLength + meshoptCompressedIndexByteLength;
const dracoCompressedTriangleBinByteLength = 173;
const instancedTriangleBinByteLength = triangleBinByteLength + 48;
const lodGltfSrc = "https://example.test/fixtures/lod.gltf";
const lodBinUri = "lod.bin";
const lodImageUri = "lod-shared.png";
const lodBinByteLength = 102;
const khronosEnvironmentTestGltfSrc = "https://example.test/khronos/EnvironmentTest/glTF-IBL/EnvironmentTest.gltf";
const khronosEnvironmentTestFixtureUrl = new URL(
  "./fixtures/khronos/EnvironmentTest/glTF-IBL/EnvironmentTest.gltf",
  import.meta.url,
);
const khronosEnvironmentTestTransform = {
  position: [0, -0.25, 0] as const,
  rotation: [0, 0, 0] as const,
  scale: [0.05, 0.05, 0.05] as const,
};

type TestGltfDocument = {
  readonly buffers?: readonly {
    readonly byteLength?: number;
    readonly uri?: string;
  }[];
  readonly extensions?: {
    readonly EXT_lights_image_based?: {
      readonly lights?: readonly {
        readonly specularImages?: readonly (readonly number[])[];
      }[];
    };
  };
  readonly images?: readonly Record<string, unknown>[];
};

const khronosEnvironmentTestDocument = (): TestGltfDocument & Record<string, unknown> =>
  JSON.parse(readFileSync(khronosEnvironmentTestFixtureUrl, "utf8")) as TestGltfDocument & Record<string, unknown>;

const khronosEnvironmentTestBuffer = (document: TestGltfDocument): ArrayBuffer =>
  new ArrayBuffer(document.buffers?.[0]?.byteLength ?? 0);

const khronosEnvironmentTestLdrSpecularDocument = (): TestGltfDocument & Record<string, unknown> => {
  const document = khronosEnvironmentTestDocument();
  const specularImageIndexes = new Set(
    document.extensions?.EXT_lights_image_based?.lights?.[0]?.specularImages?.flat() ?? [],
  );
  const images = document.images?.map((image, imageIndex) =>
    specularImageIndexes.has(imageIndex) ? { ...image, mimeType: "image/jpeg" } : image);

  return {
    ...document,
    ...(images === undefined ? {} : { images }),
  };
};

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
    CCW: 0x0901,
    CW: 0x0900,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    DYNAMIC_DRAW: 0x88E8,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINE_LOOP: 0x0002,
    LINE_STRIP: 0x0003,
    LINES: 0x0001,
    LINK_STATUS: 0x8B82,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    NO_ERROR: 0,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    POINTS: 0x0000,
    REPEAT: 0x2901,
    RGBA: 0x1908,
    RGBA32F: 0x8814,
    SRGB8_ALPHA8: 0x8C43,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88E4,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MAX_LEVEL: 0x813D,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLE_FAN: 0x0006,
    TRIANGLE_STRIP: 0x0005,
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
    const recordedArgs = name === "bufferSubData" && args[2] instanceof Float32Array
      ? args.map((value, index) => index === 2 ? Float32Array.from(args[2] as Float32Array) : value)
      : args;
    calls.push({ args: recordedArgs as Arguments, name });

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
    bindVertexArray: record("bindVertexArray"),
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
    frontFace: record("frontFace"),
    generateMipmap: record("generateMipmap"),
    getActiveAttrib: record("getActiveAttrib", () => null),
    getActiveUniform: record("getActiveUniform", () => null),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("color")) return 10;
      if (normalized.includes("emissive")) return 12;
      if (normalized.includes("tangent")) return 11;
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
      if (parameter === constants.MAX_COMBINED_TEXTURE_IMAGE_UNITS) return 32;
      if (parameter === constants.MAX_TEXTURE_IMAGE_UNITS || parameter === constants.MAX_VERTEX_TEXTURE_IMAGE_UNITS) {
        return 16;
      }
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
    texSubImage2D: record("texSubImage2D"),
    uniform1i: record("uniform1i"),
    uniform3f: record("uniform3f"),
    uniform3fv: record("uniform3fv"),
    uniform4f: record("uniform4f"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    validateProgram: record("validateProgram"),
    vertexAttrib2f: record("vertexAttrib2f"),
    vertexAttrib4f: record("vertexAttrib4f"),
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

let latestAnimationFrames: FrameRequestCallback[] = [];

const installViewportInvalidationStubs = () => {
  const animationFrames: FrameRequestCallback[] = [];
  latestAnimationFrames = animationFrames;
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
    mediaQueries,
    triggerViewportChange: (target: Element, devicePixelRatio = 2) => {
      vi.stubGlobal("devicePixelRatio", devicePixelRatio);
      for (const mediaQueryList of [...mediaQueries]) mediaQueryList.dispatchEvent(new Event("change"));
      for (const observer of ControlledResizeObserver.instances) observer.trigger(target);
    },
  };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const fakeImageBitmap = (size: number): ImageBitmap => ({
  close: vi.fn(),
  height: size,
  width: size,
}) as unknown as ImageBitmap;

const settleKhronosEnvironmentTestIblBitmaps = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
): Promise<void> => {
  const mipSizes = [256, 128, 64, 32, 16] as const;
  let settled = 0;
  let settledImages = 0;
  for (let attempt = 0; attempt < 80 && settled < 30; attempt += 1) {
    await flushMicrotasks();
    await flushAnimationFrames(latestAnimationFrames);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    while (settledImages < ControlledImage.instances.length) {
      ControlledImage.instances[settledImages]?.settleLoad();
      settledImages += 1;
    }
    while (settled < loader.bitmapRequests.length) {
      loader.bitmapRequests[settled]?.resolve(fakeImageBitmap(mipSizes[settled % mipSizes.length] ?? 16));
      settled += 1;
    }
  }
  expect(loader.bitmapRequests).toHaveLength(30);
  await flushMicrotasks();
};

const settleControlledImageWave = async (expected: number): Promise<void> => {
  let settled = 0;
  for (let attempt = 0; attempt < 80 && settled < expected; attempt += 1) {
    await flushMicrotasks();
    await flushAnimationFrames(latestAnimationFrames);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    while (settled < ControlledImage.instances.length) {
      ControlledImage.instances[settled]?.settleLoad();
      settled += 1;
    }
  }
  expect(ControlledImage.instances).toHaveLength(expected);
  await flushMicrotasks();
  await flushAnimationFrames(latestAnimationFrames);
};

const flushAnimationFrames = async (callbacks: FrameRequestCallback[]): Promise<void> => {
  const queued = callbacks.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
  await flushMicrotasks();
};

const flushPreparedAssetBoundary = async (): Promise<void> => {
  await flushMicrotasks();
  await flushAnimationFrames(latestAnimationFrames);
};

const waitForAnimationFrameWork = async (
  callbacks: FrameRequestCallback[],
  isReady: () => boolean,
): Promise<void> => {
  for (let attempt = 0; attempt < 80 && !isReady(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await flushMicrotasks();
    await flushAnimationFrames(callbacks);
  }
  expect(isReady()).toBe(true);
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
    camera: camera(),
    nodes: children,
    clearColor: [0, 0, 0, 0],
  });

const drawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArrays" || call.name === "drawElements");

const instancedDrawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArraysInstanced" || call.name === "drawElementsInstanced");

const shaderSources = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "shaderSource")
    .map((call) => String(call.args[1] ?? ""));

const drawCount = (call: GlCall): number =>
  call.name === "drawArrays" ? Number(call.args[2]) : Number(call.args[1]);

const instancedDrawInstanceCount = (call: GlCall): number =>
  call.name === "drawArraysInstanced" ? Number(call.args[3]) : Number(call.args[4]);

const callCount = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

const lodScaleForCoverage = (coverage: number): number =>
  Math.sqrt(coverage / 0.5625);

const lodStereoViews = (reverse = false) => {
  const identity = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const lowScale = lodScaleForCoverage(0.1);
  const lowProjection = [
    lowScale, 0, 0, 0,
    0, lowScale, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const views = [
    {
      projectionMatrix: identity,
      viewMatrix: identity,
      viewport: { height: 80, width: 100, x: 0, y: 0 },
    },
    {
      projectionMatrix: lowProjection,
      viewMatrix: identity,
      viewport: { height: 80, width: 100, x: 100, y: 0 },
    },
  ];
  return reverse ? views.reverse() : views;
};

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

const bufferUploadPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "bufferData" || call.name === "bufferSubData")
    .map((call) => numericArray(call.name === "bufferSubData" ? call.args[2] : call.args[1]))
    .filter((values) => values.length > 0);

const bufferSubDataUploadRanges = (calls: readonly GlCall[]): readonly {
  readonly byteOffset: number;
  readonly floatLength: number | undefined;
  readonly floatOffset: number;
}[] =>
  calls
    .filter((call) => call.name === "bufferSubData")
    .map((call) => ({
      byteOffset: Number(call.args[1] ?? 0),
      floatLength: typeof call.args[4] === "number" ? call.args[4] : undefined,
      floatOffset: typeof call.args[3] === "number" ? call.args[3] : 0,
    }));

const bufferSubDataPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "bufferSubData")
    .map((call) => {
      const values = numericArray(call.args[2]);
      const offset = typeof call.args[3] === "number" ? call.args[3] : 0;
      const length = typeof call.args[4] === "number" ? call.args[4] : values.length - offset;

      return values.slice(offset, offset + length);
    })
    .filter((values) => values.length > 0);

const gltfInstancingSnapshotKeys = [
  "batchPlansBuilt",
  "batchInstancesTotal",
  "drawCalls",
  "instancesDrawn",
  "localModelUploadBytes",
  "localModelUploadCalls",
  "rootPoseUploadBytes",
  "rootPoseUploadCalls",
  "rootScaleUploadBytes",
  "rootScaleUploadCalls",
] as const satisfies readonly (keyof WebGlGltfInstancingSnapshot)[];

const gltfInstancingDelta = (
  after: WebGlGltfInstancingSnapshot,
  before: WebGlGltfInstancingSnapshot,
): WebGlGltfInstancingSnapshot => {
  const delta = {} as Record<keyof WebGlGltfInstancingSnapshot, number>;
  for (const key of gltfInstancingSnapshotKeys) {
    delta[key] = after[key] - before[key];
  }
  return delta;
};

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

const waitForUniform1iPayload = async (
  callbacks: FrameRequestCallback[],
  calls: readonly GlCall[],
  name: string,
  value: number,
): Promise<void> => waitForAnimationFrameWork(
  callbacks,
  () => uniform1iPayloads(calls, name).includes(value),
);

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

const uniform2fvPayloads = (
  calls: readonly GlCall[],
  name: string,
): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "uniform2fv" && uniformLocationName(call.args[0]) === name)
    .map((call) => {
      const values = numericArray(call.args[1]);
      const offset = typeof call.args[2] === "number" ? call.args[2] : 0;
      const length = typeof call.args[3] === "number" ? call.args[3] : 2;

      return values.slice(offset, offset + length).slice(0, 2);
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

const vertexColorTriangleBin = (): ArrayBuffer => {
  const bytes = new Uint8Array(triangleBinByteLength + 9);
  bytes.set(new Uint8Array(triangleBin()));
  bytes.set([
    255, 0, 0,
    0, 128, 0,
    0, 0, 255,
  ], triangleBinByteLength);

  return bytes.buffer;
};

const tangentTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength + 48);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 12).set([
    1, 0, 0, 1,
    1, 0, 0, 1,
    1, 0, 0, 1,
  ]);

  return buffer;
};

const multiUvTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength + 24);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 6).set([
    0.125, 0.25,
    0.375, 0.5,
    0.625, 0.75,
  ]);

  return buffer;
};

const meshoptCompressedTriangleBin = (): ArrayBuffer => {
  const bytes = Uint8Array.from([
    160, 0, 0, 0, 1, 60, 0, 0, 0, 129, 255, 0, 0, 0, 1, 48,
    0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 63, 0, 0, 0, 0, 225, 240, 0, 118, 135, 86, 103, 120,
    169, 134, 101, 137, 104, 152, 1, 105, 0, 0,
  ]);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

const dracoCompressedTriangleBin = (): ArrayBuffer => {
  const bytes = Uint8Array.from([
    68, 82, 65, 67, 79, 2, 2, 1, 1, 0, 0, 0, 3, 1, 2, 1,
    0, 0, 1, 7, 255, 1, 17, 1, 1, 0, 1, 1, 0, 3, 255, 0,
    0, 0, 0, 0, 1, 0, 0, 1, 0, 9, 3, 0, 0, 2, 1, 1,
    9, 3, 0, 1, 3, 1, 3, 9, 2, 0, 2, 2, 1, 1, 1, 0,
    15, 3, 173, 42, 47, 85, 21, 3, 160, 122, 129, 72, 255, 31, 0, 0,
    0, 0, 0, 0, 0, 255, 63, 0, 0, 0, 0, 0, 191, 0, 0, 0,
    191, 0, 0, 0, 0, 0, 0, 128, 63, 14, 0, 3, 1, 0, 10, 3,
    173, 42, 27, 85, 21, 3, 175, 90, 129, 0, 254, 3, 255, 3, 0, 0,
    255, 1, 0, 0, 10, 1, 1, 1, 0, 13, 3, 173, 42, 39, 85, 21,
    3, 160, 122, 129, 212, 255, 1, 0, 0, 0, 0, 0, 255, 15, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 63, 12,
  ]);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

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

const triangleWithBasisuBytes = (): ArrayBuffer => {
  const base = triangleBin();
  const buffer = new ArrayBuffer(base.byteLength + 4);
  new Uint8Array(buffer).set(new Uint8Array(base));
  new Uint8Array(buffer, base.byteLength).set([0xAB, 0x4B, 0x54, 0x58]);

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

const nodeLodSeparatedBoundsDocument = () => {
  const document = nodeLodDocument();
  return {
    ...document,
    nodes: [
      {
        ...document.nodes[0],
        translation: [10, 0, 0],
      },
      {
        ...document.nodes[1],
      },
    ],
  };
};

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

const materialSecondaryTexturePendingLodDocument = () => {
  const base = materialTexturePendingLodDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular"],
    extensionsUsed: ["KHR_materials_specular"],
    materials: [
      base.materials[0],
      {
        emissiveFactor: [0.1, 0.2, 0.3],
        emissiveTexture: {
          index: 0,
        },
        extensions: {
          KHR_materials_specular: {
            specularTexture: {
              index: 0,
            },
          },
        },
        normalTexture: {
          index: 0,
        },
        occlusionTexture: {
          index: 0,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0, 1, 0, 1],
          metallicRoughnessTexture: {
            index: 0,
          },
        },
      },
    ],
  };
};

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

const vertexColorTriangleDocument = () => {
  const base = solidTriangleDocument();
  const colorBufferViewIndex = base.bufferViews.length;
  const colorAccessorIndex = base.accessors.length;
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: colorBufferViewIndex,
        componentType: 5121,
        count: 3,
        normalized: true,
        type: "VEC3",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 9,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: triangleBinByteLength + 9,
        uri: triangleBinUri,
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            attributes: {
              ...primitive.attributes,
              COLOR_0: colorAccessorIndex,
            },
          },
        ],
      },
    ],
  };
};

const normalTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    images: [
      {
        mimeType: "image/png",
        uri: triangleNormalImageUri,
      },
    ],
    materials: [
      {
        normalTexture: {
          index: 0,
          scale: 0.42,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
      },
    ],
    textures: [
      {
        source: 0,
      },
    ],
  };
};

const tangentTriangleDocument = () => {
  const base = normalTextureTriangleDocument();
  const tangentBufferViewIndex = base.bufferViews.length;
  const tangentAccessorIndex = base.accessors.length;
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: tangentBufferViewIndex,
        componentType: 5126,
        count: 3,
        type: "VEC4",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 48,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: triangleBinByteLength + 48,
        uri: triangleBinUri,
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            attributes: {
              ...primitive.attributes,
              TANGENT: tangentAccessorIndex,
            },
          },
        ],
      },
    ],
  };
};

const multiUvEmissiveTriangleDocument = () => {
  const base = emissiveTextureTriangleDocument();
  const uv1BufferViewIndex = base.bufferViews.length;
  const uv1AccessorIndex = base.accessors.length;
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: uv1BufferViewIndex,
        componentType: 5126,
        count: 3,
        type: "VEC2",
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
    ],
    buffers: [
      {
        byteLength: triangleBinByteLength + 24,
        uri: triangleBinUri,
      },
    ],
    materials: [
      {
        ...base.materials[0],
        emissiveTexture: {
          index: 0,
          texCoord: 1,
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            attributes: {
              ...primitive.attributes,
              TEXCOORD_1: uv1AccessorIndex,
            },
          },
        ],
      },
    ],
  };
};

const doubleSidedTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.62, 0.36, 1],
        },
      },
    ],
  };
};

const alphaMaskTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    materials: [
      {
        alphaCutoff: 0.37,
        alphaMode: "MASK",
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.62, 0.36, 0.25],
        },
      },
    ],
  };
};

const alphaBlendTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    materials: [
      {
        alphaMode: "BLEND",
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.2, 0.1, 0.4],
        },
      },
      {
        alphaMode: "OPAQUE",
        pbrMetallicRoughness: {
          baseColorFactor: [0.1, 0.8, 0.2, 0.25],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

const mirroredTriangleNodesDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    nodes: [
      {
        mesh: 0,
      },
      {
        mesh: 0,
        scale: [-1, 1, 1],
      },
    ],
    scenes: [
      {
        nodes: [0, 1],
      },
    ],
  };
};

const metallicRoughnessTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.62, 0.36, 1],
          metallicFactor: 0.75,
          roughnessFactor: 0.2,
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.3, 0.4, 1],
          metallicFactor: -2,
          roughnessFactor: 3,
        },
      },
    ],
    meshes: [
      {
        primitives: [
          ...(base.meshes[0]?.primitives ?? []),
          {
            attributes: {
              NORMAL: 1,
              POSITION: 0,
              TEXCOORD_0: 2,
            },
            indices: 3,
            material: 1,
            mode: 4,
          },
        ],
      },
    ],
  };
};

const metallicRoughnessTextureTriangleDocument = () => {
  const base = triangleDocument();

  return {
    ...base,
    images: [
      ...(base.images ?? []),
      {
        mimeType: "image/png",
        uri: triangleMetallicRoughnessImageUri,
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: {
            index: 0,
          },
          metallicFactor: 0.8,
          metallicRoughnessTexture: {
            index: 1,
          },
          roughnessFactor: 0.6,
        },
      },
    ],
    textures: [
      ...(base.textures ?? []),
      {
        sampler: 0,
        source: 1,
      },
    ],
  };
};

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

const iblCoefficients = (
  c0: readonly [number, number, number],
  c8: readonly [number, number, number] = [0, 0, 0],
): readonly (readonly [number, number, number])[] =>
  Array.from({ length: 9 }, (_unused, index) =>
    index === 0 ? c0 : index === 8 ? c8 : [0, 0, 0] as const);

const sceneSelectedImageBasedLightTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      EXT_lights_image_based: {
        lights: [
          {
            intensity: 4,
            irradianceCoefficients: iblCoefficients([9, 9, 9]),
            specularImages: [
              [0, 1, 2, 3, 4, 5],
            ],
            specularImageSize: 4,
          },
          {
            irradianceCoefficients: iblCoefficients([0.7, 0.6, 0.5]),
            specularImages: [
              [0, 1, 2, 3, 4, 5],
            ],
            specularImageSize: 4,
          },
        ],
      },
    },
    extensionsUsed: ["EXT_lights_image_based"],
    images: iblSpecularImageUris.map((uri) => ({ mimeType: "image/png", uri })),
    scene: 1,
    scenes: [
      {
        extensions: {
          EXT_lights_image_based: {
            light: 0,
          },
        },
        nodes: [0],
      },
      {
        extensions: {
          EXT_lights_image_based: {
            light: 1,
          },
        },
        nodes: [0],
      },
    ],
  };
};

const invalidImageBasedLightReferenceTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      EXT_lights_image_based: {
        lights: [
          {
            irradianceCoefficients: iblCoefficients([0.5, 0.5, 0.5]),
            specularImages: [
              [0, 1, 2, 3, 4, 5],
            ],
            specularImageSize: 4,
          },
        ],
      },
    },
    extensionsUsed: ["EXT_lights_image_based"],
    images: iblSpecularImageUris.map((uri) => ({ mimeType: "image/png", uri })),
    scenes: [
      {
        extensions: {
          EXT_lights_image_based: {
            light: 5,
          },
        },
        nodes: [0],
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

const emissiveTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    images: [
      {
        mimeType: "image/png",
        uri: triangleEmissiveImageUri,
      },
    ],
    materials: [
      {
        emissiveFactor: [0.4, 0.5, 0.6],
        emissiveTexture: {
          index: 0,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
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

const occlusionTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    images: [
      {
        mimeType: "image/png",
        uri: triangleOcclusionImageUri,
      },
    ],
    materials: [
      {
        occlusionTexture: {
          index: 0,
          strength: 0.35,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
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

const materialPbrExtensionFactorsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    extensionsUsed: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    materials: [
      {
        extensions: {
          KHR_materials_clearcoat: {
            clearcoatFactor: 0.75,
            clearcoatRoughnessFactor: 0.2,
          },
          KHR_materials_ior: {
            ior: 1.33,
          },
          KHR_materials_specular: {
            specularColorFactor: [1.4, 0.5, 0.25],
            specularFactor: 0.35,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

const materialPbrExtensionDefaultsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    extensionsUsed: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    materials: [
      {
        extensions: {
          KHR_materials_clearcoat: {},
          KHR_materials_ior: {},
          KHR_materials_specular: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

const materialPbrExtensionTextureDiagnosticTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular"],
    extensionsUsed: ["KHR_materials_specular", "KHR_materials_clearcoat"],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        extensions: {
          KHR_materials_clearcoat: {
            clearcoatNormalTexture: { index: 4 },
            clearcoatRoughnessTexture: { index: 3 },
            clearcoatTexture: { index: 2 },
          },
          KHR_materials_specular: {
            specularColorTexture: { index: 1 },
            specularTexture: { index: 0 },
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 5 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

const materialSheenIridescenceFactorsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceFactor: 0.65,
            iridescenceIor: 1.8,
            iridescenceThicknessMaximum: 620,
            iridescenceThicknessMinimum: 120,
          },
          KHR_materials_sheen: {
            sheenColorFactor: [1.4, 0.2, 0.1],
            sheenRoughnessFactor: 0.55,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

const materialSheenIridescenceDefaultsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {},
          KHR_materials_sheen: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

const materialSheenIridescenceTextureDiagnosticTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceTexture: { index: 2 },
            iridescenceThicknessTexture: { index: 3 },
          },
          KHR_materials_sheen: {
            sheenColorTexture: { index: 0 },
            sheenRoughnessTexture: { index: 1 },
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 4 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

const materialSheenIridescenceBatchKeyTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceFactor: 0.15,
            iridescenceThicknessMaximum: 300,
          },
          KHR_materials_sheen: {
            sheenColorFactor: [0.1, 0.2, 0.3],
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceFactor: 0.85,
            iridescenceThicknessMaximum: 700,
          },
          KHR_materials_sheen: {
            sheenColorFactor: [0.3, 0.2, 0.1],
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

const materialTransmissionVolumeTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission", "KHR_materials_volume"],
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.3, 0.35, 1],
        },
      },
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionFactor: 0.65,
          },
          KHR_materials_volume: {
            attenuationColor: [0.8, 0.6, 0.4],
            attenuationDistance: 2,
            thicknessFactor: 0.4,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.95, 1, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

const materialTransmissionVolumeDefaultsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission", "KHR_materials_volume"],
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    materials: [
      {
        extensions: {
          KHR_materials_transmission: {},
          KHR_materials_volume: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

const materialDispersionTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_ior",
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    extensionsUsed: [
      "KHR_materials_ior",
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.3, 0.35, 1],
        },
      },
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: 0.8,
          },
          KHR_materials_ior: {
            ior: 1.6,
          },
          KHR_materials_transmission: {
            transmissionFactor: 0.7,
          },
          KHR_materials_volume: {
            attenuationColor: [0.9, 0.8, 0.7],
            attenuationDistance: 3,
            thicknessFactor: 0.5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.95, 1, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

const materialDispersionDefaultsClampingTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    extensionsUsed: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    materials: [
      {
        extensions: {
          KHR_materials_dispersion: {},
          KHR_materials_transmission: {},
          KHR_materials_volume: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.45, 0.5, 0.55, 1],
        },
      },
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: -0.5,
          },
          KHR_materials_transmission: {},
          KHR_materials_volume: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.65, 0.7, 0.75, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

const materialTransmissionVolumeTextureDiagnosticTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission", "KHR_materials_volume"],
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionTexture: { index: 0 },
          },
          KHR_materials_volume: {
            thicknessTexture: { index: 1 },
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 2 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

const materialOverfullTextureUnitTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_clearcoat",
      "KHR_materials_iridescence",
      "KHR_materials_sheen",
      "KHR_materials_specular",
      "KHR_materials_transmission",
      "KHR_materials_volume",
    ],
    extensionsUsed: [
      "KHR_materials_clearcoat",
      "KHR_materials_iridescence",
      "KHR_materials_sheen",
      "KHR_materials_specular",
      "KHR_materials_transmission",
      "KHR_materials_volume",
    ],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        emissiveFactor: [0.2, 0.3, 0.4],
        emissiveTexture: { index: 4 },
        extensions: {
          KHR_materials_clearcoat: {
            clearcoatFactor: 0.75,
            clearcoatRoughnessTexture: { index: 8 },
            clearcoatTexture: { index: 7 },
          },
          KHR_materials_iridescence: {
            iridescenceFactor: 0.5,
            iridescenceTexture: { index: 11 },
            iridescenceThicknessTexture: { index: 12 },
          },
          KHR_materials_sheen: {
            sheenColorTexture: { index: 9 },
            sheenRoughnessTexture: { index: 10 },
          },
          KHR_materials_specular: {
            specularColorTexture: { index: 6 },
            specularTexture: { index: 5 },
          },
          KHR_materials_transmission: {
            transmissionFactor: 1,
            transmissionTexture: { index: 13 },
          },
          KHR_materials_volume: {
            thicknessFactor: 1,
            thicknessTexture: { index: 14 },
          },
        },
        normalTexture: { index: 2 },
        occlusionTexture: { index: 3 },
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 1 },
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 15 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

const materialOverfullSolidBaseImageBasedLightTriangleDocument = () => {
  const base = materialOverfullTextureUnitTriangleDocument();
  const material = base.materials[0]!;

  return {
    ...base,
    extensions: {
      EXT_lights_image_based: {
        lights: [
          {
            intensity: 1,
            irradianceCoefficients: iblCoefficients([0.4, 0.4, 0.4]),
            specularImages: [
              [1, 2, 3, 4, 5, 6],
            ],
            specularImageSize: 4,
          },
        ],
      },
    },
    extensionsUsed: [
      ...base.extensionsUsed,
      "EXT_lights_image_based",
    ],
    images: [
      ...base.images,
      ...iblSpecularImageUris.map((uri) => ({ mimeType: "image/png", uri })),
    ],
    materials: [
      {
        ...material,
        pbrMetallicRoughness: {
          baseColorFactor: [0.42, 0.42, 0.42, 1],
          metallicRoughnessTexture: material.pbrMetallicRoughness.metallicRoughnessTexture,
        },
      },
    ],
    scenes: [
      {
        ...base.scenes[0],
        extensions: {
          EXT_lights_image_based: {
            light: 0,
          },
        },
      },
    ],
  };
};

const materialTransmissionBatchKeyTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission"],
    extensionsUsed: ["KHR_materials_transmission"],
    materials: [
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionFactor: 0.2,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionFactor: 0.8,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

const materialDispersionBatchKeyTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    extensionsUsed: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    materials: [
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: 0.2,
          },
          KHR_materials_transmission: {
            transmissionFactor: 0.6,
          },
          KHR_materials_volume: {
            thicknessFactor: 0.5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: 0.8,
          },
          KHR_materials_transmission: {
            transmissionFactor: 0.6,
          },
          KHR_materials_volume: {
            thicknessFactor: 0.5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
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

const responseWithText = (url: string, text: string, type = "text/plain"): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(new TextEncoder().encode(text).buffer)),
  blob: vi.fn(() => Promise.resolve(new Blob([text], { type }))),
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(() => Promise.resolve(text)),
  url,
}) as unknown as Response;

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if ("url" in input && typeof input.url === "string") return input.url;

  return Object.prototype.toString.call(input);
};

const installStagedGltfLoader = () => {
  const bitmapRequests: BitmapRequest[] = [];
  const fetchRequests: FetchRequest[] = [];
  const objectUrlBlobs: Blob[] = [];
  const settledFetches = new Set<FetchRequest>();
  let nextObjectUrl = 0;

  vi.stubGlobal("Image", ControlledImage);
  class TestURL extends URL {
    static createObjectURL = vi.fn((blob: Blob) => {
      objectUrlBlobs.push(blob);
      return `blob:royal-test-${nextObjectUrl += 1}`;
    });
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);
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
    objectUrlBlobs,
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

const installCanvasImageMimeTypeSupport = (supported: readonly string[]): void => {
  const supportedTypes = new Set(supported.map((type) => type.toLowerCase()));
  vi.stubGlobal("document", {
    createElement: vi.fn((tagName: string) => tagName === "canvas"
      ? {
        toDataURL: vi.fn((type?: string) => {
          const normalizedType = String(type ?? "image/png").toLowerCase();
          return supportedTypes.has(normalizedType)
            ? `data:${normalizedType};base64,AA==`
            : "data:image/png;base64,AA==";
        }),
      }
      : {}),
  });
};

const installCanvas2d = (): {
  readonly contexts: Array<{
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly drawImage: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    readonly putImageData: ReturnType<typeof vi.fn>;
  }>;
} => {
  const contexts: Array<{
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly drawImage: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    readonly putImageData: ReturnType<typeof vi.fn>;
  }> = [];

  vi.stubGlobal("document", {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== "canvas") throw new Error(`unexpected element ${tagName}`);
      const context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low" as ImageSmoothingQuality,
        putImageData: vi.fn(),
      };
      contexts.push(context);

      return {
        height: 0,
        getContext: vi.fn((contextId: string) => contextId === "2d" ? context : null),
        width: 0,
      };
    }),
  });

  return { contexts };
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
  decodeBasisuMock.mockReset();
  ControlledImage.instances.splice(0);
  ControlledResizeObserver.instances.splice(0);
});

describe("WebGL renderer scene and glTF regressions", () => {
  it("publishes mixed-scene packet topology before retrying a throwing ref attachment", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let failAttachment = true;
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "packet-ref-retry" }),
      mesh({
        geometry: planeGeometry(0.25),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        ref: (handle) => {
          if (handle !== null && failAttachment) {
            failAttachment = false;
            throw new Error("ref attachment failed");
          }
        },
      }),
    ]);

    expect(() => root.render(renderGraph)).toThrow("ref attachment failed");
    expect(() => root.render(renderGraph)).not.toThrow();
    expect(drawCalls(calls), "the retry must render the direct portion of the committed generation")
      .toHaveLength(1);

    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 3);
    expect(
      drawCalls(calls).slice(-2),
      "the ready glTF occurrence must remain reverse-mapped after the ref failure",
    ).toHaveLength(2);
    expect(root.snapshot().planning).toMatchObject({ planCompiles: 1, planRevision: 1, sceneCommits: 1 });
    root.dispose();
  });

  it("fills a retained loading occurrence without rebuilding on camera frames", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const cameraView = createCameraViewResource(camera());
    const renderGraph = scene({
      camera: cameraView,
      clearColor: [0, 0, 0, 0],
      nodes: [
        gltf({ src: triangleGltfSrc, version: "packet-shared-readiness" }),
      ],
    });

    root.render(renderGraph);
    expect(drawCalls(calls), "loading packet occurrence ranges must remain empty").toHaveLength(0);
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => drawCalls(calls).length === 1,
    );
    expect(drawCalls(calls), "the ready event must fill its reverse-mapped occurrence").toHaveLength(1);

    const planning = root.snapshot().planning;
    const callsBeforeCameraFrame = calls.length;
    cameraView.position[0] = 0.1;
    cameraView.commit();
    await flushAnimationFrames(viewport.animationFrames);
    expect(drawCalls(calls.slice(callsBeforeCameraFrame))).toHaveLength(1);
    expect(root.snapshot().planning, "camera-only frames must retain the compiled packet topology").toEqual(planning);
  });

  it("appends every occurrence of one ready request across direct-mesh ordering segments", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "packet-shared-segments" }),
      mesh({ geometry: planeGeometry(0.25), material: unlitMaterial({ color: [1, 1, 1, 1] }) }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        version: "packet-shared-segments",
      }),
    ]);

    root.render(renderGraph);
    expect(drawCalls(calls), "only the direct mesh draws while both packet ranges are loading").toHaveLength(1);
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 4);
    expect(drawCalls(calls).slice(-3).map((call) => call.args[0])).toEqual([
      gl.TRIANGLES,
      gl.TRIANGLES,
      gl.TRIANGLES,
    ]);
  });

  it("ignores a stale loading asset completion after replacing its frame plan", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const oldGraph = renderScene([gltf({ src: triangleGltfSrc, version: "packet-stale-old" })]);
    const nextGraph = renderScene([gltf({ src: triangleGltfSrc, version: "packet-stale-next" })]);

    root.render(oldGraph);
    root.render(nextGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(drawCalls(calls), "the released plan's completion must not populate the replacement slot")
      .toHaveLength(0);

    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 1);
    expect(drawCalls(calls)).toHaveLength(1);
  });

  it("matches retained local sidedness with a negative ordinary glTF root scale", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([gltf({
      src: triangleGltfSrc,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] },
      version: "packet-negative-root",
    })]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 1);
    expect(calls.filter((call) => call.name === "frontFace").map((call) => call.args[0])).toContain(gl.CW);
  });

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
    expect(viewport.mediaQueries.map((query) => query.media)).toEqual(["(resolution: 1dppx)"]);

    viewport.triggerViewportChange(canvas);
    await flushMicrotasks();
    expect(viewport.mediaQueries.map((query) => query.media)).toEqual([
      "(resolution: 1dppx)",
      "(resolution: 2dppx)",
    ]);

    viewport.triggerViewportChange(canvas, 3);
    await flushMicrotasks();
    expect(viewport.mediaQueries.map((query) => query.media)).toEqual([
      "(resolution: 1dppx)",
      "(resolution: 2dppx)",
      "(resolution: 3dppx)",
    ]);

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

  it("draws default glTF materials front-sided with back-face culling", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "default-front-sided-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(readyFrameCalls).toContainEqual({ args: [gl.CULL_FACE], name: "enable" });
    expect(readyFrameCalls).toContainEqual({ args: [gl.BACK], name: "cullFace" });
    expect(readyFrameCalls).toContainEqual({ args: [gl.CCW], name: "frontFace" });
  });

  it("multiplies textured glTF base color by baseColorFactor", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const base = triangleDocument();
    const renderGraph = renderScene([gltf({ src: triangleGltfSrc, version: "textured-base-color-factor" })]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...base,
        materials: [{
          pbrMetallicRoughness: {
            baseColorFactor: [0.2, 0.4, 0.6, 0.8],
            baseColorTexture: { index: 0 },
          },
        }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    root.render(renderGraph);

    expect(ControlledImage.instances).toHaveLength(1);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);

    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it("draws double-sided glTF materials without face culling", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "double-sided-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, doubleSidedTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(readyFrameCalls).toContainEqual({ args: [gl.CULL_FACE], name: "disable" });
    expect(readyFrameCalls).not.toContainEqual({ args: [gl.CULL_FACE], name: "enable" });
    expect(readyFrameCalls.some((call) => call.name === "cullFace")).toBe(false);
  });

  it("threads glTF MASK alpha cutoff into the surface shader", async () => {
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
        version: "alpha-mask-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, alphaMaskTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(sources).toContain("u_alphaSettings");
    expect(sources).toContain("discard");
    expect(uniform4fvPayloads(readyFrameCalls, "u_alphaSettings").map(roundVector))
      .toContainEqual([1, 0.37, 0, 0]);
  });

  it("draws glTF BLEND alpha after opaque batches and resets depth writes", async () => {
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
        version: "alpha-blend-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, alphaBlendTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const drawIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "drawArrays" || call.name === "drawElements")
      .map(({ index }) => index);
    const depthMaskIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "depthMask")
      .map(({ call, index }) => ({ index, value: call.args[0] }));
    const firstBlendDepthMask = depthMaskIndexes.find(({ value }) => value === false);
    const finalDepthMask = depthMaskIndexes.at(-1);
    const blendStateIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => (call.name === "enable" || call.name === "disable") && call.args[0] === gl.BLEND);
    const firstBlendEnable = blendStateIndexes.find(({ call }) => call.name === "enable");
    const finalBlendState = blendStateIndexes.at(-1);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(instancedDrawCalls(readyFrameCalls)).toHaveLength(0);
    expect(readyFrameCalls).toContainEqual({ args: [gl.BLEND], name: "enable" });
    expect(readyFrameCalls).toContainEqual({
      args: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
      name: "blendFuncSeparate",
    });
    expect(uniform4fvPayloads(readyFrameCalls, "u_alphaSettings").map(roundVector))
      .toEqual([[0, 0, 0, 0], [2, 0, 0, 0]]);
    expect(firstBlendEnable?.index).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(firstBlendEnable?.index).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(firstBlendDepthMask?.index).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(firstBlendDepthMask?.index).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(finalBlendState?.call).toEqual({ args: [gl.BLEND], name: "disable" });
    expect(finalBlendState?.index).toBeGreaterThan(drawIndexes[1] ?? -1);
    expect(finalDepthMask?.value).toBe(true);
  });

  it("splits one-sided mirrored glTF draws so frontFace tracks model orientation", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "mirrored-front-face-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, mirroredTriangleNodesDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const frontFaceValues = readyFrameCalls
      .filter((call) => call.name === "frontFace")
      .map((call) => call.args[0]);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(instancedDrawCalls(readyFrameCalls)).toHaveLength(0);
    expect(frontFaceValues).toContain(gl.CCW);
    expect(frontFaceValues).toContain(gl.CW);
    expect(readyFrameCalls.filter((call) =>
      call.name === "cullFace" && call.args[0] === gl.BACK)).toHaveLength(2);
  });

  it("allows explicitly unlit standardMaterial meshes to render black", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => {
      root.render(renderScene([
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({ color: [1, 1, 1, 1] }),
        }),
      ]));
    }).not.toThrow();
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
    expect(root.snapshot().resourceGovernor.byClass).toMatchObject({
      "asset-decode": { cpuDecodedBytes: expect.any(Number) },
      geometry: { cpuDecodedBytes: expect.any(Number) },
    });
    expect(root.snapshot().resourceGovernor.byClass["asset-decode"].cpuDecodedBytes).toBeGreaterThan(0);
    expect(root.snapshot().resourceGovernor.byClass.geometry.cpuDecodedBytes).toBeGreaterThan(0);

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
    expect(root.snapshot().resourceGovernor.byClass["asset-decode"].cpuDecodedBytes).toBe(0);
    expect(root.snapshot().resourceGovernor.byClass.geometry.cpuDecodedBytes).toBeGreaterThan(0);

    root.render(renderScene([]));
    expect(root.snapshot().resourceGovernor.byClass.geometry.cpuDecodedBytes).toBe(0);
  });

  it("switches a prepared glTF draw from fallback color to settled base-color texture", async () => {
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
        version: "staged-texture-settle",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    expect(uniform1iPayloads(calls, "u_useTexture").at(-1)).toBe(0);
    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([0.5, 0.5, 0.5, 1]);
    expect(ControlledImage.instances).toHaveLength(1);

    const callsBeforeImageSettle = calls.length;
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);
    const imageReadyCalls = calls.slice(callsBeforeImageSettle);

    expect(drawCalls(imageReadyCalls).length).toBeGreaterThanOrEqual(1);
    expect(uniform1iPayloads(imageReadyCalls, "u_useTexture")).toContain(1);
  });

  it("uses opted-in generated VT for glTF raster baseColorTexture without manifest probing", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { contexts } = installCanvas2d();
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "gltf-base-color-generated-vt",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    const baseColorImage = ControlledImage.instances.find((image) => /staged-triangle\.png(?:$|[?#])/.test(image.src));
    expect(baseColorImage?.src).toBe("https://example.test/fixtures/staged-triangle.png");
    baseColorImage!.height = 512;
    baseColorImage!.naturalHeight = 512;
    baseColorImage!.naturalWidth = 512;
    baseColorImage!.width = 512;
    baseColorImage?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    root.render(renderGraph);

    expect(loader.fetchRequests.some((request) => request.url.includes(".vt.json"))).toBe(false);

    for (
      let frame = 0;
      frame < 8
      && (contexts.length === 0 || root.snapshot().virtualTexturing.shaderBinds === 0);
      frame += 1
    ) {
      await flushMicrotasks();
      root.render(renderGraph);
      await flushAnimationFrames(viewport.animationFrames);
    }

    expect(contexts[0]?.drawImage).toHaveBeenCalled();
    expect(contexts[0]?.drawImage.mock.calls[0]).toEqual([
      baseColorImage,
      0,
      0,
      512,
      512,
      0,
      0,
      256,
      256,
    ]);
    expect(shaderSources(calls).join("\n")).toContain("sampleVirtualBaseColor");
    expect(uniform1iPayloads(calls, "u_useVirtualTexture")).toContain(1);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPageFailures: 0,
      generatedPagesTarget: 5,
      manifestRequests: 0,
      manifestsReady: 1,
      residentPages: expect.any(Number),
      uploadedPages: expect.any(Number),
    }));
    expect(root.snapshot().virtualTexturing.generatedPageRequests).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.residentPages).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.uploadedPages).toBeGreaterThan(0);
  });

  it("shares glTF texture uploads for simultaneously leased matching computed bufferView content", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    class CloseTrackedImageBitmap {
      readonly close = vi.fn();
      readonly height: number;
      readonly width: number;

      constructor(size: number) {
        this.height = size;
        this.width = size;
      }
    }
    vi.stubGlobal("ImageBitmap", CloseTrackedImageBitmap);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const matchingTriangleBinUri = "matching-triangle.bin";
    const bufferViewImageDocument = (bufferUri: string): unknown => ({
      ...triangleDocument(),
      bufferViews: [
        ...(triangleDocument().bufferViews),
        { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
      ],
      buffers: [{ byteLength: triangleBinByteLength + 4, uri: bufferUri }],
      images: [{ bufferView: 4, mimeType: "image/png" }],
    });
    const firstGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "computed-content-key-a",
      }),
    ]);
    const secondGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "computed-content-key-a",
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        version: "computed-content-key-b",
      }),
    ]);

    root.render(firstGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(triangleBinUri)))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(1);
    const firstBitmap = new CloseTrackedImageBitmap(4);
    loader.bitmapRequests[0]?.resolve(firstBitmap as unknown as ImageBitmap);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(viewport.animationFrames, () => callCount(calls, "texImage2D") >= 1);

    expect(callCount(calls, "texImage2D")).toBe(1);
    const uploadsBeforeSecondGltf = callCount(calls, "texImage2D");
    const bitmapRequestsBeforeSecondGltf = loader.bitmapRequests.length;

    root.render(secondGraph);
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(matchingTriangleBinUri)))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(bitmapRequestsBeforeSecondGltf + 1);
    const secondBitmap = new CloseTrackedImageBitmap(4);
    loader.bitmapRequests[bitmapRequestsBeforeSecondGltf]?.resolve(secondBitmap as unknown as ImageBitmap);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    root.render(secondGraph);

    expect(
      callCount(calls, "texImage2D"),
      "different glTF bufferView images with identical encoded bytes should reuse the content-addressed upload",
    ).toBe(uploadsBeforeSecondGltf);
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);

    root.render(renderScene([]));
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
    expect(secondBitmap.close).toHaveBeenCalledTimes(1);
    expect(root.snapshot().textureResidency).toMatchObject({
      activeLeases: 0,
      preparedBytes: 0,
      preparedSources: 0,
      resources: 0,
    });
  });

  it("keeps explicit glTF extras.contentKey ahead of computed image content keys", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const explicitContentKey = "royal-test:explicit-content-key-wins";
    const matchingTriangleBinUri = "matching-triangle-explicit.bin";
    const bufferViewImageDocument = (
      bufferUri: string,
      extras?: { readonly contentKey: string },
    ): unknown => ({
      ...triangleDocument(),
      bufferViews: [
        ...(triangleDocument().bufferViews),
        { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
      ],
      buffers: [{ byteLength: triangleBinByteLength + 4, uri: bufferUri }],
      images: [{
        ...(extras === undefined ? {} : { extras }),
        bufferView: 4,
        mimeType: "image/png",
      }],
    });
    const firstGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "explicit-content-key-a",
      }),
    ]);
    const secondGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        version: "explicit-content-key-b",
      }),
    ]);

    root.render(firstGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(triangleBinUri, { contentKey: explicitContentKey })))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(1);
    loader.bitmapRequests[0]?.resolve(fakeImageBitmap(4));
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(viewport.animationFrames, () => callCount(calls, "texImage2D") >= 1);

    expect(callCount(calls, "texImage2D")).toBe(1);
    const uploadsBeforeSecondGltf = callCount(calls, "texImage2D");
    const bitmapRequestsBeforeSecondGltf = loader.bitmapRequests.length;

    root.render(secondGraph);
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(matchingTriangleBinUri)))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle-explicit\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(bitmapRequestsBeforeSecondGltf + 1);
    loader.bitmapRequests[bitmapRequestsBeforeSecondGltf]?.resolve(fakeImageBitmap(4));
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => callCount(calls, "texImage2D") >= uploadsBeforeSecondGltf + 1,
    );
    root.render(secondGraph);

    expect(
      callCount(calls, "texImage2D"),
      "explicit extras.contentKey should not be replaced by the computed key for identical bytes",
    ).toBe(uploadsBeforeSecondGltf + 1);
  });

  it("automatically instances matching glTF geometry across different asset URLs", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const leftRef: { current: RenderObjectHandle | null } = { current: null };
    const rightRef: { current: RenderObjectHandle | null } = { current: null };
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
        ref: leftRef,
        version: "instanced-a",
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        transform: {
          position: [0.25, 0, 0],
          rotation: [0, 0, 0],
        },
        ref: rightRef,
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
    const instancingBeforeReadyRender = root.snapshot().gltfInstancing;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);
    const readyInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeReadyRender);

    expect(instancedDraws).toHaveLength(1);
    expect(instancedDraws[0]?.name).toBe("drawElementsInstanced");
    expect(instancedDraws[0]?.args[0]).toBe(gl.TRIANGLES);
    expect(instancedDraws[0]?.args[1]).toBe(3);
    expect(instancedDrawInstanceCount(instancedDraws[0]!)).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(readyFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 32, floatOffset: 0 },
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      { byteOffset: 0, floatLength: 6, floatOffset: 0 },
    ]);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 7
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT
      && call.args[4] === 24
      && call.args[5] === 0)).toBe(true);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 8
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT
      && call.args[4] === 24
      && call.args[5] === 12)).toBe(true);
    expect(readyInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 1,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 32 * Float32Array.BYTES_PER_ELEMENT,
      localModelUploadCalls: 1,
      rootPoseUploadBytes: 12 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootScaleUploadCalls: 1,
    });

    const callsBeforeImperativeChange = calls.length;
    const instancingBeforeImperativeChange = root.snapshot().gltfInstancing;
    leftRef.current?.position.set([-0.5, 0, 0]);
    await flushAnimationFrames(viewport.animationFrames);
    const changedFrameCalls = calls.slice(callsBeforeImperativeChange);
    const changedInstancedDraws = instancedDrawCalls(changedFrameCalls);
    const changedInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeImperativeChange);

    expect(changedInstancedDraws).toHaveLength(1);
    expect(instancedDrawInstanceCount(changedInstancedDraws[0]!)).toBe(2);
    expect(drawCalls(changedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(changedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 6, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(changedFrameCalls).map(roundVector)).toEqual([
      [-0.5, 0, 0, 0, 0, 0],
    ]);
    expect(changedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforeSecondImperativeChange = calls.length;
    const instancingBeforeSecondImperativeChange = root.snapshot().gltfInstancing;
    rightRef.current?.position.set([0.5, 0, 0]);
    await flushAnimationFrames(viewport.animationFrames);
    const secondChangedFrameCalls = calls.slice(callsBeforeSecondImperativeChange);
    const secondChangedInstancedDraws = instancedDrawCalls(secondChangedFrameCalls);
    const secondChangedInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeSecondImperativeChange,
    );

    expect(secondChangedInstancedDraws).toHaveLength(1);
    expect(instancedDrawInstanceCount(secondChangedInstancedDraws[0]!)).toBe(2);
    expect(drawCalls(secondChangedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(secondChangedFrameCalls)).toEqual([
      { byteOffset: 24, floatLength: 6, floatOffset: 6 },
    ]);
    expect(bufferSubDataPayloads(secondChangedFrameCalls).map(roundVector)).toEqual([
      [0.5, 0, 0, 0, 0, 0],
    ]);
    expect(secondChangedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforeAdjacentPoseSlotChange = calls.length;
    const instancingBeforeAdjacentPoseSlotChange = root.snapshot().gltfInstancing;
    leftRef.current?.position.set([-0.6, 0, 0]);
    rightRef.current?.position.set([0.6, 0, 0]);
    await flushAnimationFrames(viewport.animationFrames);
    const adjacentPoseSlotFrameCalls = calls.slice(callsBeforeAdjacentPoseSlotChange);
    const adjacentPoseSlotInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeAdjacentPoseSlotChange,
    );

    expect(instancedDrawCalls(adjacentPoseSlotFrameCalls)).toHaveLength(1);
    expect(drawCalls(adjacentPoseSlotFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(adjacentPoseSlotFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(adjacentPoseSlotFrameCalls).map(roundVector)).toEqual([
      [-0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    ]);
    expect(adjacentPoseSlotInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 12 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforePoseChange = calls.length;
    const instancingBeforePoseChange = root.snapshot().gltfInstancing;
    leftRef.current?.position.set([-0.75, 0, 0]);
    leftRef.current?.rotation.set(0, 0, 0.25);
    rightRef.current?.position.set([0.75, 0, 0]);
    rightRef.current?.rotation.set(0, 0, -0.25);
    await flushAnimationFrames(viewport.animationFrames);
    const poseChangedFrameCalls = calls.slice(callsBeforePoseChange);
    const poseChangedInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforePoseChange);

    expect(instancedDrawCalls(poseChangedFrameCalls)).toHaveLength(1);
    expect(drawCalls(poseChangedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(poseChangedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(poseChangedFrameCalls).map(roundVector)).toEqual([
      [-0.75, 0, 0, 0, 0, 0.25, 0.75, 0, 0, 0, 0, -0.25],
    ]);
    expect(poseChangedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 12 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforeScaleChange = calls.length;
    const instancingBeforeScaleChange = root.snapshot().gltfInstancing;
    leftRef.current?.scale.set(2, 2, 2);
    await flushAnimationFrames(viewport.animationFrames);
    const scaleChangedFrameCalls = calls.slice(callsBeforeScaleChange);
    const scaleChangedInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeScaleChange);

    expect(instancedDrawCalls(scaleChangedFrameCalls)).toHaveLength(1);
    expect(drawCalls(scaleChangedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(scaleChangedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 3, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(scaleChangedFrameCalls).map(roundVector)).toEqual([
      [2, 2, 2],
    ]);
    expect(scaleChangedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 0,
      rootPoseUploadCalls: 0,
      rootScaleUploadBytes: 3 * Float32Array.BYTES_PER_ELEMENT,
      rootScaleUploadCalls: 1,
    });

    const deletedVertexArraysBeforeSingle = callCount(calls, "deleteVertexArray");
    const callsBeforeSingle = calls.length;
    rightRef.current?.position.set(100, 0, 0);
    await flushAnimationFrames(viewport.animationFrames);
    const singleCalls = calls.slice(callsBeforeSingle);
    expect(instancedDrawCalls(singleCalls)).toHaveLength(0);
    expect(drawCalls(singleCalls)).toHaveLength(1);
    expect(callCount(calls, "deleteVertexArray")).toBeGreaterThan(deletedVertexArraysBeforeSingle);

    const createdVertexArraysBeforeRebatch = callCount(calls, "createVertexArray");
    const callsBeforeRebatch = calls.length;
    rightRef.current?.position.set(0.75, 0, 0);
    await flushAnimationFrames(viewport.animationFrames);
    const rebatchCalls = calls.slice(callsBeforeRebatch);
    expect(instancedDrawCalls(rebatchCalls)).toHaveLength(1);
    expect(callCount(calls, "createVertexArray")).toBeGreaterThan(createdVertexArraysBeforeRebatch);
  });

  it("uploads only a committed bulk pose range in a 10k source", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({ count: 10_000 });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-partial-pose-10k",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    const callsBeforeCommit = fake.calls.length;
    const countersBeforeCommit = renderRoot.snapshot().gltfInstancing;
    for (let index = 477; index < 480; index += 1) {
      instances.positions[index * 3] = index * 0.000_01;
    }
    instances.commitPose(477, 3);
    await flushAnimationFrames(viewport.animationFrames);
    const frameCalls = fake.calls.slice(callsBeforeCommit);
    const counters = gltfInstancingDelta(renderRoot.snapshot().gltfInstancing, countersBeforeCommit);

    expect(bufferSubDataUploadRanges(frameCalls)).toEqual([
      { byteOffset: 477 * 6 * Float32Array.BYTES_PER_ELEMENT, floatLength: 18, floatOffset: 477 * 6 },
    ]);
    expect(counters.rootPoseUploadBytes).toBe(72);
    expect(counters.rootPoseUploadCalls).toBe(1);
    expect(counters.rootScaleUploadBytes).toBe(0);
    expect(counters.rootScaleUploadCalls).toBe(0);
    renderRoot.dispose();
  });

  it("keeps bulk instance scale stable across pose-only animation frames", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({
      count: 2,
      positions: [-0.25, 0, 0, 0.25, 0, 0],
      scales: [0.5, 0.5, 0.5, 0.75, 0.75, 0.75],
    });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-pose-scale-stability",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    for (let frame = 0; frame < 3; frame += 1) {
      const callsBeforePose = fake.calls.length;
      const countersBeforePose = renderRoot.snapshot().gltfInstancing;
      instances.positions[0] = -0.3 - frame * 0.1;
      instances.positions[3] = 0.3 + frame * 0.1;
      instances.rotations[2] = frame * 0.1;
      instances.rotations[5] = -frame * 0.1;
      instances.commitPose();
      await flushAnimationFrames(viewport.animationFrames);
      const frameCalls = fake.calls.slice(callsBeforePose);
      const counters = gltfInstancingDelta(renderRoot.snapshot().gltfInstancing, countersBeforePose);

      expect(instancedDrawCalls(frameCalls)).toHaveLength(1);
      expect(bufferSubDataUploadRanges(frameCalls)).toEqual([
        { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      ]);
      expect(counters.rootPoseUploadBytes).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
      expect(counters.rootPoseUploadCalls).toBe(1);
      expect(counters.rootScaleUploadBytes).toBe(0);
      expect(counters.rootScaleUploadCalls).toBe(0);
      expect(Array.from(instances.scales)).toEqual([0.5, 0.5, 0.5, 0.75, 0.75, 0.75]);
    }

    renderRoot.dispose();
  });

  it("refreshes bulk instance scales when culling swaps equal-count visible slots", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({
      count: 3,
      positions: [-0.4, 0, 0, 100, 0, 0, 0.4, 0, 0],
      scales: [0.5, 0.5, 0.5, 1, 1, 1, 0.75, 0.75, 0.75],
    });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-equal-count-visibility-swap",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    const callsBeforeSwap = fake.calls.length;
    const countersBeforeSwap = renderRoot.snapshot().gltfInstancing;
    instances.positions[0] = 100;
    instances.positions[3] = -0.4;
    instances.commitPose();
    await flushAnimationFrames(viewport.animationFrames);
    const swapCalls = fake.calls.slice(callsBeforeSwap);
    const counters = gltfInstancingDelta(renderRoot.snapshot().gltfInstancing, countersBeforeSwap);

    expect(instancedDrawCalls(swapCalls)).toHaveLength(1);
    expect(bufferSubDataUploadRanges(swapCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      { byteOffset: 0, floatLength: 3, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(swapCalls).map(roundVector)).toEqual([
      [-0.4, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0],
      [1, 1, 1],
    ]);
    expect(counters.rootPoseUploadBytes).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
    expect(counters.rootPoseUploadCalls).toBe(1);
    expect(counters.rootScaleUploadBytes).toBe(3 * Float32Array.BYTES_PER_ELEMENT);
    expect(counters.rootScaleUploadCalls).toBe(1);

    renderRoot.dispose();
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
    const instancingBeforeReadyRender = root.snapshot().gltfInstancing;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const readyInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);
    const instanceModelPayload = bufferUploadPayloads(readyFrameCalls)
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
    expect(readyInstancing.batchPlansBuilt).toBe(1);
    expect(readyInstancing.batchInstancesTotal).toBe(2);

    const callsBeforeSecondReadyRender = calls.length;
    const instancingBeforeSecondReadyRender = root.snapshot().gltfInstancing;
    root.render(renderGraph);
    const secondReadyFrameCalls = calls.slice(callsBeforeSecondReadyRender);
    const secondReadyInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeSecondReadyRender,
    );

    expect(instancedDrawCalls(secondReadyFrameCalls)).toHaveLength(1);
    expect(secondReadyFrameCalls.filter((call) => call.name === "bufferSubData")).toHaveLength(0);
    expect(secondReadyFrameCalls.filter((call) =>
      call.name === "bindBuffer" && call.args[1] !== null)).toHaveLength(0);
    expect(secondReadyInstancing.batchPlansBuilt).toBe(0);
    expect(secondReadyInstancing.batchInstancesTotal).toBe(2);

    const translatedRenderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.1, 0, 0], rotation: [0, 0, 0] },
        version: "ext-mesh-gpu-instancing",
      }),
    ]);
    const callsBeforeTranslatedRender = calls.length;
    const instancingBeforeTranslatedRender = root.snapshot().gltfInstancing;
    root.render(translatedRenderGraph);
    const translatedFrameCalls = calls.slice(callsBeforeTranslatedRender);
    const translatedInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeTranslatedRender,
    );

    expect(instancedDrawCalls(translatedFrameCalls)).toHaveLength(1);
    expect(bufferSubDataUploadRanges(translatedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
    ]);
    expect(translatedInstancing.batchPlansBuilt).toBe(0);
    expect(translatedInstancing.batchInstancesTotal).toBe(2);
    expect(translatedInstancing.rootPoseUploadBytes).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
    expect(translatedInstancing.rootPoseUploadCalls).toBe(1);

    const expandedRenderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "ext-mesh-gpu-instancing",
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.4, 0, 0], rotation: [0, 0, 0] },
        version: "ext-mesh-gpu-instancing",
      }),
    ]);
    const callsBeforeExpandedRender = calls.length;
    const instancingBeforeExpandedRender = root.snapshot().gltfInstancing;
    root.render(expandedRenderGraph);
    const expandedInstancedDraws = instancedDrawCalls(calls.slice(callsBeforeExpandedRender));
    const expandedInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeExpandedRender,
    );

    expect(expandedInstancedDraws).toHaveLength(1);
    expect(instancedDrawInstanceCount(expandedInstancedDraws[0]!)).toBe(4);
    expect(expandedInstancing.batchPlansBuilt).toBe(0);
    expect(expandedInstancing.batchInstancesTotal).toBe(4);
  });

  it("reuses instanced glTF model buffers across supplied XR views", async () => {
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
        version: "ext-mesh-gpu-instancing-xr-views",
      }),
    ]);
    const projectionMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const leftViewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -0.03, 0, 0, 1,
    ];
    const rightViewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.03, 0, 0, 1,
    ];
    const xrViews = [
      {
        projectionMatrix,
        viewMatrix: leftViewMatrix,
        viewport: { height: 80, width: 100, x: 0, y: 0 },
      },
      {
        projectionMatrix,
        viewMatrix: rightViewMatrix,
        viewport: { height: 80, width: 100, x: 100, y: 0 },
      },
    ];

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, instancedTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, instancedTriangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.renderViews(renderGraph, { views: xrViews });
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);

    expect(instancedDraws).toHaveLength(2);
    expect(instancedDraws.map(instancedDrawInstanceCount)).toEqual([2, 2]);
    expect(bufferSubDataUploadRanges(readyFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 32, floatOffset: 0 },
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      { byteOffset: 0, floatLength: 6, floatOffset: 0 },
    ]);

    const callsBeforeSecondReadyRender = calls.length;
    root.renderViews(renderGraph, { views: xrViews });
    const secondReadyFrameCalls = calls.slice(callsBeforeSecondReadyRender);

    expect(instancedDrawCalls(secondReadyFrameCalls)).toHaveLength(2);
    expect(secondReadyFrameCalls.filter((call) => call.name === "bufferSubData")).toHaveLength(0);

    const callsBeforeLightChange = calls.length;
    const plansBeforeLightChange = root.snapshot().gltfInstancing.batchPlansBuilt;
    root.render(renderScene([
      directionalLight({
        color: [0.5, 0.75, 1, 1],
        direction: [1, 0, 0],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "ext-mesh-gpu-instancing-xr-views",
      }),
    ]));
    const lightChangedFrameCalls = calls.slice(callsBeforeLightChange);

    expect(instancedDrawCalls(lightChangedFrameCalls)).toHaveLength(1);
    expect(lightChangedFrameCalls.filter((call) => call.name === "bufferData")).toHaveLength(0);
    expect(lightChangedFrameCalls.filter((call) => call.name === "bufferSubData")).toHaveLength(0);
    expect(root.snapshot().gltfInstancing.batchPlansBuilt).toBe(plansBeforeLightChange);
  });

  it("refreshes equal-count bulk membership independently for asymmetric XR views", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const instances = createGltfInstanceTransforms({
      count: 3,
      positions: [-1.5, 0, 0, 0, 0, 0, 1.5, 0, 0],
    });
    const renderGraph = renderScene([
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-asymmetric-xr-membership",
      }),
    ]);
    const projectionMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const xrViews = [
      {
        projectionMatrix,
        viewMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          1, 0, 0, 1,
        ],
        viewport: { height: 80, width: 100, x: 0, y: 0 },
      },
      {
        projectionMatrix,
        viewMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          -1, 0, 0, 1,
        ],
        viewport: { height: 80, width: 100, x: 100, y: 0 },
      },
    ];

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeViews = calls.length;
    root.renderViews(renderGraph, { views: xrViews });
    const viewCalls = calls.slice(callsBeforeViews);
    const instancedDraws = instancedDrawCalls(viewCalls);
    const posePayloads = bufferSubDataPayloads(viewCalls)
      .filter((payload) => payload.length === 12)
      .map(roundVector);

    expect(instancedDraws).toHaveLength(2);
    expect(instancedDraws.map(instancedDrawInstanceCount)).toEqual([2, 2]);
    expect(posePayloads).toEqual([
      [-1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 0],
    ]);
    root.dispose();
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
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_useClusteredLights")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightKind[0]")).toContain(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightColor[0]").map(roundVector)).toContainEqual([1, 1, 2, 1]);
    const clusteredData = readyFrameCalls.find((call) =>
      call.name === "texImage2D" && call.args[3] === 4 && call.args[4] === 2);
    expect(numericArray(clusteredData?.args[8]).slice(0, 8).map(roundNumber)).toEqual([
      3, 1.5, 0.75, 1, 1, 2, 3, 5,
    ]);
  });

  it("uses optional EXT_lights_image_based diffuse and specular cubemap irradiance", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const document = khronosEnvironmentTestDocument();
    const renderGraph = renderScene([
      gltf({
        src: khronosEnvironmentTestGltfSrc,
        transform: khronosEnvironmentTestTransform,
        version: "ext-lights-image-based-optional",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/EnvironmentTest\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, document))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/EnvironmentTest_binary\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, khronosEnvironmentTestBuffer(document)))).toBe(true);
    await flushMicrotasks();

    const callsBeforeSpecularImagesSettle = calls.length;
    await settleKhronosEnvironmentTestIblBitmaps(loader);

    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeSpecularImagesSettle);
    const sources = shaderSources(readyFrameCalls).join("\n");
    const diagnostics = root.snapshot().diagnostics.join("\n");

    expect(drawCalls(readyFrameCalls).length).toBeGreaterThan(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_useIblIrradiance")).toContain(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceSettings").map(roundVector))
      .toContainEqual([1, 1, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[0]").map(roundVector))
      .toContainEqual([1.883914, 1.233669, 1.681576, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[8]").map(roundVector))
      .toContainEqual([0.432833, 0.126378, -0.004153, 0]);
    expect(sources).toContain("iblDiffuseIrradiance");
    expect(sources).toContain("iblSpecularSample");
    expect(sources).toContain("iblDecodeSpecularRadiance");
    expect(sources).toContain("u_iblSpecularSettings.w > 0.5");
    expect(sources).toContain("iblEnvironmentBrdf");
    expect(sources).toContain("iblGgxScattering");
    expect(sources).toContain("iblSpecularOcclusion");
    expect(sources).toContain("textureLod(u_iblSpecularCube");
    expect(sources).toContain("return radiance * u_iblSpecularSettings.y;");
    expect(sources).toContain("+ cosineWeightedIrradiance * scattering.multi;");
    expect(sources).toContain("iblClearcoatRadiance");
    expect(sources).toContain("materialDiffuseColor(baseColor.rgb) * cosineWeightedIrradiance");
    expect(diagnostics).not.toMatch(/EXT_lights_image_based light 0 specularImages are ignored/i);
    const cubeFaceTargets = readyFrameCalls
      .filter((call) => call.name === "texImage2D")
      .map((call) => Number(call.args[0]))
      .filter((target) => target >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && target < gl.TEXTURE_CUBE_MAP_POSITIVE_X + 6);
    const expectedCubeFaceTargets = Array.from({ length: 5 }, () => [
      gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 1,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 2,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 3,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 4,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 5,
    ]).flat();

    expect(cubeFaceTargets).toEqual(expectedCubeFaceTargets);
    expect(uniform1iPayloads(readyFrameCalls, "u_useIblSpecular")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_iblSpecularCube")).toContain(2);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblSpecularSettings").map(roundVector))
      .toContainEqual([1, 1, 5, 1]);
    expect(readyFrameCalls.some((call) => call.name === "generateMipmap" && call.args[0] === gl.TEXTURE_CUBE_MAP))
      .toBe(false);
  });

  it("treats non-PNG EXT_lights_image_based specular images as LDR", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const document = khronosEnvironmentTestLdrSpecularDocument();
    const renderGraph = renderScene([
      gltf({
        src: khronosEnvironmentTestGltfSrc,
        transform: khronosEnvironmentTestTransform,
        version: "ext-lights-image-based-ldr-specular",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/EnvironmentTest\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, document))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/EnvironmentTest_binary\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, khronosEnvironmentTestBuffer(document)))).toBe(true);
    await flushMicrotasks();

    const callsBeforeSpecularImagesSettle = calls.length;
    await settleKhronosEnvironmentTestIblBitmaps(loader);

    root.render(renderGraph);
    const specularReadyCalls = calls.slice(callsBeforeSpecularImagesSettle);

    expect(uniform1iPayloads(specularReadyCalls, "u_useIblSpecular")).toContain(1);
    expect(uniform4fvPayloads(specularReadyCalls, "u_iblSpecularSettings").map(roundVector))
      .toContainEqual([1, 1, 5, 0]);
  });

  it("selects EXT_lights_image_based from the active glTF scene and applies defaults", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "ext-lights-image-based-scene-selection",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, sceneSelectedImageBasedLightTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceSettings").map(roundVector))
      .toContainEqual([1, 1, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[0]").map(roundVector))
      .toContainEqual([0.7, 0.6, 0.5, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[0]").map(roundVector))
      .not.toContainEqual([9, 9, 9, 0]);
    expect(matrixUniformPayloads(readyFrameCalls, "u_iblWorldToIbl").map(roundVector))
      .toContainEqual([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
  });

  it("diagnoses invalid optional EXT_lights_image_based scene references and falls back to default lighting", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "ext-lights-image-based-invalid-reference",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, invalidImageBasedLightReferenceTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const diagnostics = root.snapshot().diagnostics.join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_useIblIrradiance")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(0);
    expect(diagnostics).toMatch(/EXT_lights_image_based skipped: missing light 5/i);
  });

  it("accepts required EXT_lights_image_based with specular cubemap support", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const document = {
      ...khronosEnvironmentTestDocument(),
      extensionsRequired: ["EXT_lights_image_based"],
    };
    const renderGraph = renderScene([
      gltf({
        src: khronosEnvironmentTestGltfSrc,
        transform: khronosEnvironmentTestTransform,
        version: "ext-lights-image-based-required",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/EnvironmentTest\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, document))).toBe(true);
    await flushMicrotasks();

    expect(loader.resolvePendingFetch(/EnvironmentTest_binary\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, khronosEnvironmentTestBuffer(document)))).toBe(true);
    await flushMicrotasks();

    expect(loader.fetchRequests.some((request) => /EnvironmentTest_binary\.bin(?:$|[?#])/.test(request.url)))
      .toBe(true);
    await settleKhronosEnvironmentTestIblBitmaps(loader);
    expect(root.snapshot().diagnostics.some((message) =>
      /unsupported required glTF extension.*EXT_lights_image_based/i.test(message))).toBe(false);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    expect(drawCalls(calls.slice(callsBeforeReadyRender)).length).toBeGreaterThan(0);
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

  it("uploads and binds glTF emissive textures", async () => {
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
        version: "emissive-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, emissiveTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle-emissive.png",
    ]);
    const callsBeforePendingTextureRender = calls.length;
    root.render(renderGraph);
    const pendingTextureFrameCalls = calls.slice(callsBeforePendingTextureRender);
    const programsAfterPendingTextureRender = callCount(calls, "createProgram");

    expect(drawCalls(pendingTextureFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_useEmissiveTexture")).toContain(0);
    expect(shaderSources(calls).join("\n")).toContain("uniform sampler2D u_emissiveTexture;");

    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useEmissiveTexture", 1);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(callCount(calls, "createProgram")).toBe(programsAfterPendingTextureRender);
    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(calls, "u_emissiveColor").map(roundVector))
      .toContainEqual([0.4, 0.5, 0.6, 1]);
    expect(uniform1iPayloads(calls, "u_useEmissiveTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_emissiveTexture")).toContain(4);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 4)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_emissiveTexture;");
    expect(sources).toContain("texture(u_emissiveTexture, materialTextureUv(u_emissiveUvSet");
  });

  it("uses glTF emissiveTexture texCoord 1 when present", async () => {
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
        version: "multi-uv-emissive",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, multiUvEmissiveTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, multiUvTriangleBin()))).toBe(true);
    await flushMicrotasks();

    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0.125, 0.25,
      0.375, 0.5,
      0.625, 0.75,
    ]);
    expect(sources).toContain("layout(location = 11) in vec2 a_uv1;");
    expect(uniform1iPayloads(calls, "u_emissiveUvSet")).toContain(1);
    expect(sources).toContain("in vec2 a_uv1;");
    expect(sources).toContain("texture(u_emissiveTexture, materialTextureUv(u_emissiveUvSet");
  });

  it("renders glTF metallic and roughness factors as surface uniforms", async () => {
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
        version: "metallic-roughness-factors",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, metallicRoughnessTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const pbrFactors = uniform4fvPayloads(readyFrameCalls, "u_materialPbrFactors").map(roundVector);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(pbrFactors).toContainEqual([0.75, 0.2, 0, 0]);
    expect(pbrFactors).toContainEqual([0, 1, 0, 0]);
  });

  it("uploads and binds glTF metallic-roughness textures", async () => {
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
        version: "metallic-roughness-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, metallicRoughnessTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await settleControlledImageWave(2);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
      "https://example.test/fixtures/staged-triangle-metallic-roughness.png",
    ]);
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useMetallicRoughnessTexture", 1);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(callCount(calls, "texImage2D")).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_useMetallicRoughnessTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_metallicRoughnessTexture")).toContain(3);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 3)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_metallicRoughnessTexture;");
    expect(sources).toContain("texture(u_metallicRoughnessTexture, materialTextureUv(u_metallicRoughnessUvSet");
  });

  it("uploads and binds glTF occlusion textures", async () => {
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
        version: "occlusion-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, occlusionTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle-occlusion.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useOcclusionTexture", 1);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(calls, "u_occlusionSettings").map(roundVector))
      .toContainEqual([0.35, 0, 0, 0]);
    expect(uniform1iPayloads(calls, "u_useOcclusionTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_occlusionTexture")).toContain(5);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 5)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_occlusionTexture;");
    expect(sources).toContain("texture(u_occlusionTexture, materialTextureUv(u_occlusionUvSet");
  });

  it("uploads and binds core glTF normal textures without colliding with transmission texture units", async () => {
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
        version: "normal-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, normalTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle-normal.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useNormalTexture", 1);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_useNormalTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_normalTexture")).toContain(1);
    expect(uniform4fvPayloads(calls, "u_normalTextureSettings").map(roundVector))
      .toContainEqual([0.42, 0, 0, 0]);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 1)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_normalTexture;");
    expect(sources).toContain("dFdx(v_worldPosition)");
    expect(sources).toContain("texture(u_normalTexture, materialTextureUv(u_normalUvSet");
  });

  it("uploads and binds glTF TANGENT attributes for normal mapping", async () => {
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
        version: "normal-tangent",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, tangentTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, tangentTriangleBin()))).toBe(true);
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      1, 0, 0, 1,
      1, 0, 0, 1,
      1, 0, 0, 1,
    ]);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 2
      && call.args[1] === 4
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(sources).toContain("in vec4 a_tangent;");
    expect(sources).toContain("v_tangent.w < 0.0");
  });

  it("renders required KHR material specular, IOR, and clearcoat factors as surface uniforms", async () => {
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
        version: "khr-materials-pbr-extension-factors",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialPbrExtensionFactorsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_specularColorFactor").map(roundVector))
      .toContainEqual([1.4, 0.5, 0.25, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_materialExtensionFactors").map(roundVector))
      .toContainEqual([0.35, 1.33, 0.75, 0.2]);
  });

  it("renders required KHR material specular, IOR, and clearcoat defaults deterministically", async () => {
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
        version: "khr-materials-pbr-extension-defaults",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialPbrExtensionDefaultsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_specularColorFactor").map(roundVector))
      .toContainEqual([1, 1, 1, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_materialExtensionFactors").map(roundVector))
      .toContainEqual([1, 1.5, 0, 0]);
  });

  it("uploads and binds KHR material specular and clearcoat textures", async () => {
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
        version: "khr-materials-pbr-extension-texture-diagnostics",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialPbrExtensionTextureDiagnosticTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_useSpecularColorTexture").includes(1)
        && uniform1iPayloads(calls, "u_useClearcoatRoughnessTexture").includes(1),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");
    const diagnostics = root.snapshot().diagnostics.join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_useSpecularTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_specularTexture")).toContain(6);
    expect(uniform1iPayloads(calls, "u_useSpecularColorTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_specularColorTexture")).toContain(7);
    expect(uniform1iPayloads(calls, "u_useClearcoatTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_clearcoatTexture")).toContain(8);
    expect(uniform1iPayloads(calls, "u_useClearcoatRoughnessTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_clearcoatRoughnessTexture")).toContain(9);
    for (const unit of [6, 7, 8, 9]) {
      expect(calls.some((call) =>
        call.name === "activeTexture"
        && call.args[0] === gl.TEXTURE0 + unit)).toBe(true);
    }
    expect(sources).toContain("uniform sampler2D u_specularTexture;");
    expect(sources).toContain("texture(u_specularTexture, materialTextureUv(u_specularUvSet");
    expect(sources).toContain("texture(u_specularColorTexture, materialTextureUv(u_specularColorUvSet");
    expect(sources).toContain("texture(u_clearcoatTexture, materialTextureUv(u_clearcoatUvSet");
    expect(sources).toContain("texture(u_clearcoatRoughnessTexture, materialTextureUv(u_clearcoatRoughnessUvSet");
    expect(diagnostics).not.toMatch(/KHR_materials_specular\.specularTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_specular\.specularColorTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_clearcoat\.clearcoatTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_clearcoat\.clearcoatRoughnessTexture.*ignored/i);
    expect(diagnostics).toMatch(/KHR_materials_clearcoat\.clearcoatNormalTexture.*extension normal maps/i);
  });

  it("rejects required KHR_materials_clearcoat normal maps before fetching dependent resources", async () => {
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
        version: "khr-materials-clearcoat-required-normal-map",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...solidTriangleDocument(),
        extensionsRequired: ["KHR_materials_clearcoat"],
        extensionsUsed: ["KHR_materials_clearcoat"],
        materials: [{
          extensions: {
            KHR_materials_clearcoat: {
              clearcoatNormalTexture: { index: 0 },
            },
          },
        }],
      }))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(root.snapshot().diagnostics.some((message) =>
      /glTF load failed for .*staged-triangle\.gltf/i.test(message))).toBe(true);

    root.render(renderGraph);
    expect(drawCalls(calls)).toHaveLength(0);
  });

  it("renders required KHR material sheen and iridescence factors as visible shader uniforms", async () => {
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
        version: "khr-materials-sheen-iridescence-factors",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceFactorsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([1, 0.2, 0.1, 0.55]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0.65, 1.8, 120, 620]);
    expect(sources).toContain("materialSheenContribution");
    expect(sources).toContain("materialSheenAlbedoScale");
    expect(sources).toContain("materialIridescenceTint");
    expect(sources).toContain("vec3 fresnel = mix(f0, f90, fresnelPow(VdotH)) * materialIridescenceTint(VdotH);");
  });

  it("renders required KHR material sheen and iridescence defaults exactly", async () => {
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
        version: "khr-materials-sheen-iridescence-defaults",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceDefaultsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([0, 0, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0, 1.3, 100, 400]);
  });

  it("uploads and binds KHR material sheen and iridescence textures", async () => {
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
        version: "khr-materials-sheen-iridescence-texture-diagnostics",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceTextureDiagnosticTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_useSheenColorTexture").includes(1)
        && uniform1iPayloads(calls, "u_useIridescenceThicknessTexture").includes(1),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");
    const diagnostics = root.snapshot().diagnostics.join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_useSheenColorTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_sheenColorTexture")).toContain(10);
    expect(uniform1iPayloads(calls, "u_useSheenRoughnessTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_sheenRoughnessTexture")).toContain(11);
    expect(uniform1iPayloads(calls, "u_useIridescenceTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_iridescenceTexture")).toContain(12);
    expect(uniform1iPayloads(calls, "u_useIridescenceThicknessTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_iridescenceThicknessTexture")).toContain(13);
    for (const unit of [10, 11, 12, 13]) {
      expect(calls.some((call) =>
        call.name === "activeTexture"
        && call.args[0] === gl.TEXTURE0 + unit)).toBe(true);
    }
    expect(sources).toContain("uniform sampler2D u_sheenColorTexture;");
    expect(sources).toContain("texture(u_sheenColorTexture, materialTextureUv(u_sheenColorUvSet");
    expect(sources).toContain("texture(u_sheenRoughnessTexture, materialTextureUv(u_sheenRoughnessUvSet");
    expect(sources).toContain("texture(u_iridescenceTexture, materialTextureUv(u_iridescenceUvSet");
    expect(sources).toContain("texture(u_iridescenceThicknessTexture, materialTextureUv(u_iridescenceThicknessUvSet");
    expect(diagnostics).not.toMatch(/KHR_materials_sheen\.sheenColorTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_sheen\.sheenRoughnessTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_iridescence\.iridescenceTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_iridescence\.iridescenceThicknessTexture.*ignored/i);
  });

  it("renders distinct sheen and iridescence uniforms for split glTF materials", async () => {
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
        version: "khr-materials-sheen-iridescence-batch-key",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceBatchKeyTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([0.1, 0.2, 0.3, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([0.3, 0.2, 0.1, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0.15, 1.3, 100, 300]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0.85, 1.3, 100, 700]);
  });

  it("renders required KHR materials transmission and volume through current-frame screen sampling", async () => {
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
        version: "khr-materials-transmission-volume",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    // The first ready frame initiates the opaque variant and retains the
    // transmission variant for the next demand frame.
    const callsBeforeShaderWarmup = calls.length;
    root.render(renderGraph);
    const callsBeforeReadyRender = calls.length;
    root.flushInvalidated();
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const shaderWarmupAndReadyCalls = calls.slice(callsBeforeShaderWarmup);
    const sources = shaderSources(readyFrameCalls).join("\n");
    const readyDrawCalls = drawCalls(readyFrameCalls);
    const copyIndex = readyFrameCalls.findIndex((call) => call.name === "copyTexSubImage2D");
    const drawIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "drawArrays" || call.name === "drawElements")
      .map(({ index }) => index);

    expect(readyDrawCalls).toHaveLength(2);
    expect(copyIndex).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(copyIndex).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(shaderWarmupAndReadyCalls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, gl.RGBA, defaultCanvasSize.width, defaultCanvasSize.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null],
      name: "texImage2D",
    });
    expect(readyFrameCalls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, 0, 0, 0, 0, defaultCanvasSize.width, defaultCanvasSize.height],
      name: "copyTexSubImage2D",
    });
    expect(readyFrameCalls).toContainEqual({
      args: [gl.TEXTURE0 + 1],
      name: "activeTexture",
    });
    expect(uniform1iPayloads(readyFrameCalls, "u_useTransmissionTexture")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_transmissionScreenTexture")).toContain(1);
    expect(uniform2fvPayloads(readyFrameCalls, "u_viewportOrigin").map(roundVector))
      .toContainEqual([0, 0]);
    expect(uniform2fvPayloads(readyFrameCalls, "u_viewportSize").map(roundVector))
      .toContainEqual([defaultCanvasSize.width, defaultCanvasSize.height]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_attenuationColorFactor").map(roundVector))
      .toContainEqual([0.8, 0.6, 0.4, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.65, 0.4, 2, 1]);
    expect(sources).toContain("materialVolumeAttenuation");
    expect(sources).toContain("materialTransmissionScreenColor");
    expect(sources).toContain("gl_FragCoord.xy - u_viewportOrigin");
    expect(sources).toContain("texture(u_transmissionScreenTexture");
    expect(sources).toContain("lit = mix(lit, transmitted + lit * fresnel, transmission);");
    expect(sources).toContain("mix(environmentFallback, screenSample.rgb, screenSample.a)");
    expect(sources).not.toContain("u_refractionColor");

    const callsBeforeStableRender = calls.length;
    root.render(renderGraph);
    const stableFrameCalls = calls.slice(callsBeforeStableRender);

    expect(stableFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(1);
    expect(stableFrameCalls.some((call) =>
      call.name === "texImage2D"
      && call.args[0] === gl.TEXTURE_2D
      && call.args[1] === 0
      && call.args[2] === gl.RGBA
      && call.args[3] === defaultCanvasSize.width
      && call.args[4] === defaultCanvasSize.height)).toBe(false);

    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const callsBeforeViews = calls.length;
    root.renderViews(renderGraph, {
      views: [
        {
          projectionMatrix: identity,
          viewMatrix: identity,
          viewport: { height: 80, width: 100, x: 11, y: 13 },
        },
        {
          projectionMatrix: identity,
          viewMatrix: identity,
          viewport: { height: 80, width: 100, x: 127, y: 17 },
        },
      ],
    });
    const viewCalls = calls.slice(callsBeforeViews);
    expect(viewCalls
      .filter((call) => call.name === "copyTexSubImage2D")
      .map((call) => call.args.slice(4, 8)))
      .toEqual([
        [11, 13, 100, 80],
        [127, 17, 100, 80],
      ]);
    expect(uniform2fvPayloads(viewCalls, "u_viewportOrigin").map(roundVector))
      .toEqual(expect.arrayContaining([[11, 13], [127, 17]]));
  });

  it("takes an independent transmission screen copy on each side of a direct-mesh barrier", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "transmission-segment-barrier",
      }),
      mesh({
        geometry: planeGeometry(0.1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.25, 0, 0], rotation: [0, 0, 0] },
        version: "transmission-segment-barrier",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    root.render(renderGraph);
    root.flushInvalidated();
    const callsBeforeReadyFrame = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyFrame);
    const orderedSubmissionCalls = readyFrameCalls.filter((call) =>
      call.name === "drawArrays"
      || call.name === "drawElements"
      || call.name === "copyTexSubImage2D");

    expect(drawCalls(readyFrameCalls)).toHaveLength(5);
    expect(readyFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(2);
    expect(orderedSubmissionCalls.map((call) => call.name)).toEqual([
      "drawElements",
      "copyTexSubImage2D",
      "drawElements",
      "drawElements",
      "drawElements",
      "copyTexSubImage2D",
      "drawElements",
    ]);
    root.dispose();
  });

  it("renders required KHR materials transmission and volume defaults exactly", async () => {
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
        version: "khr-materials-transmission-volume-defaults",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeDefaultsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(readyFrameCalls.some((call) => call.name === "copyTexSubImage2D")).toBe(false);
    expect(uniform1iPayloads(readyFrameCalls, "u_useTransmissionTexture")).toContain(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_attenuationColorFactor").map(roundVector))
      .toContainEqual([1, 1, 1, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0, 0, 0, 0]);
  });

  it("renders required KHR materials dispersion through per-channel transmission sampling", async () => {
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
        version: "khr-materials-dispersion",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialDispersionTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    // The retained demand frame is the first one where both the opaque source
    // and dispersive surface shaders are ready.
    root.render(renderGraph);
    const callsBeforeReadyRender = calls.length;
    root.flushInvalidated();
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");
    const readyDrawCalls = drawCalls(readyFrameCalls);
    const copyIndex = readyFrameCalls.findIndex((call) => call.name === "copyTexSubImage2D");
    const drawIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "drawArrays" || call.name === "drawElements")
      .map(({ index }) => index);
    const diagnostics = root.snapshot().diagnostics.join("\n");

    expect(readyDrawCalls).toHaveLength(2);
    expect(copyIndex).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(copyIndex).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(diagnostics).not.toMatch(/unsupported required glTF extension/i);
    expect(uniform4fvPayloads(readyFrameCalls, "u_materialExtensionFactors").map(roundVector))
      .toContainEqual([1, 1.6, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_attenuationColorFactor").map(roundVector))
      .toContainEqual([0.9, 0.8, 0.7, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.7, 0.5, 3, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector))
      .toContainEqual([0.8, 0, 0, 0]);
    expect(sources).toContain("uniform vec4 u_dispersionFactors;");
    expect(sources).toContain("materialDispersionIors");
    expect(sources).toContain("float halfSpread = (safeIor - 1.0) * 0.025 * max(dispersion, 0.0);");
    expect(sources).toContain("vec3(safeIor - halfSpread, safeIor, safeIor + halfSpread)");
    expect(sources).toContain("texture(u_transmissionScreenTexture, redUv).r");
    expect(sources).toContain("texture(u_transmissionScreenTexture, blueUv).b");
  });

  it("defaults and clamps KHR materials dispersion to non-negative scalar uniforms", async () => {
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
        version: "khr-materials-dispersion-defaults-clamping",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialDispersionDefaultsClampingTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const dispersionPayloads = uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector);
    const transmissionVolumePayloads = uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors")
      .map(roundVector);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(readyFrameCalls.some((call) => call.name === "copyTexSubImage2D")).toBe(false);
    expect(dispersionPayloads).toContainEqual([0, 0, 0, 0]);
    expect(transmissionVolumePayloads).toContainEqual([0, 0, 0, 0]);
  });

  it("uploads and binds KHR materials transmission and volume texture multipliers", async () => {
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
        version: "khr-materials-transmission-volume-texture-diagnostics",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeTextureDiagnosticTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");
    const diagnostics = root.snapshot().diagnostics.join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_useMaterialTransmissionTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_materialTransmissionTexture")).toContain(14);
    expect(uniform1iPayloads(calls, "u_useThicknessTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_thicknessTexture")).toContain(15);
    for (const unit of [14, 15]) {
      expect(calls.some((call) =>
        call.name === "activeTexture"
        && call.args[0] === gl.TEXTURE0 + unit)).toBe(true);
    }
    expect(sources).toContain("uniform sampler2D u_materialTransmissionTexture;");
    expect(sources).toContain("texture(u_materialTransmissionTexture, materialTextureUv(u_materialTransmissionUvSet");
    expect(sources).toContain("texture(u_thicknessTexture, materialTextureUv(u_thicknessUvSet");
    expect(diagnostics).not.toMatch(/KHR_materials_transmission\.transmissionTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_volume\.thicknessTexture.*ignored/i);
  });

  it("does not alias optional material textures when fragment texture units are exhausted", async () => {
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
        version: "overfull-texture-units",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialOverfullTextureUnitTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_useSheenColorTexture").includes(1)
        && uniform1iPayloads(calls, "u_useThicknessTexture").includes(1),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const overfullSurfaceSource =
      shaderSources(calls).filter((source) => source.includes("u_materialTransmissionTexture")).at(-1) ?? "";
    const enabledSamplerUniforms = [
      "u_texture",
      "u_transmissionScreenTexture",
      "u_emissiveTexture",
      "u_metallicRoughnessTexture",
      "u_normalTexture",
      "u_occlusionTexture",
      "u_specularTexture",
      "u_specularColorTexture",
      "u_clearcoatTexture",
      "u_clearcoatRoughnessTexture",
      "u_sheenColorTexture",
      "u_sheenRoughnessTexture",
      "u_iridescenceTexture",
      "u_iridescenceThicknessTexture",
      "u_materialTransmissionTexture",
      "u_thicknessTexture",
    ].map((name) => uniform1iPayloads(calls, name).at(-1));

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(enabledSamplerUniforms).toHaveLength(new Set(enabledSamplerUniforms).size);
    expect(enabledSamplerUniforms).toEqual(expect.arrayContaining(Array.from({ length: 16 }, (_value, index) => index)));
    expect((overfullSurfaceSource.match(/uniform sampler/g) ?? [])).toHaveLength(16);
    expect(overfullSurfaceSource).not.toContain("u_iblSpecularCube");
    expect(uniform1iPayloads(calls, "u_useMaterialTransmissionTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_materialTransmissionTexture")).toContain(14);
    expect(uniform1iPayloads(calls, "u_useThicknessTexture")).toContain(1);
    expect(uniform1iPayloads(calls, "u_thicknessTexture")).toContain(15);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 16)).toBe(false);
  });

  it("uses material samplers before optional BRDF LUT when IBL exhausts texture units", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "overfull-texture-units-ibl",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialOverfullSolidBaseImageBasedLightTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await settleControlledImageWave(7);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_thicknessTexture").includes(15),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const surfaceSource =
      shaderSources(calls).filter((source) => source.includes("u_materialTransmissionTexture")).at(-1) ?? "";

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect((surfaceSource.match(/uniform sampler/g) ?? [])).toHaveLength(16);
    expect(surfaceSource).toContain("uniform samplerCube u_iblSpecularCube;");
    expect(surfaceSource).not.toContain("uniform sampler2D u_iblBrdfLut;");
    expect(uniform1iPayloads(calls, "u_iblSpecularCube")).toContain(2);
    expect(uniform1iPayloads(calls, "u_useIblBrdfLut")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_iblBrdfLut")).toEqual([]);
    expect(uniform1iPayloads(calls, "u_normalTexture")).toContain(0);
    expect(uniform1iPayloads(calls, "u_materialTransmissionTexture")).toContain(14);
    expect(uniform1iPayloads(calls, "u_thicknessTexture")).toContain(15);
    expect(readyFrameCalls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 16)).toBe(false);
  });

  it("renders distinct transmission uniforms while sampling the current frame once", async () => {
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
        version: "khr-materials-transmission-batch-key",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionBatchKeyTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(readyFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.2, 0, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.8, 0, 0, 0]);
  });

  it("renders distinct dispersion uniforms while sampling the current frame once", async () => {
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
        version: "khr-materials-dispersion-batch-key",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialDispersionBatchKeyTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(readyFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector))
      .toContainEqual([0.2, 0, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector))
      .toContainEqual([0.8, 0, 0, 0]);
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
    const programsBeforeTextureReady = callCount(calls, "createProgram");
    const vertexArraysBeforeTextureReady = callCount(calls, "createVertexArray");

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(callCount(calls, "createProgram")).toBeGreaterThan(programsBeforeTextureReady);
    expect(callCount(calls, "createVertexArray")).toBe(vertexArraysBeforeTextureReady);
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

  it("decodes required EXT_meshopt_compression bufferViews before reading accessors", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "ext-meshopt-compression" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          {
            buffer: 1,
            byteLength: 36,
            byteOffset: 0,
            extensions: {
              EXT_meshopt_compression: {
                buffer: 0,
                byteLength: meshoptCompressedPositionByteLength,
                byteOffset: 0,
                byteStride: 12,
                count: 3,
                mode: "ATTRIBUTES",
              },
            },
            target: 34962,
          },
          {
            buffer: 1,
            byteLength: 6,
            byteOffset: 36,
            extensions: {
              EXT_meshopt_compression: {
                buffer: 0,
                byteLength: meshoptCompressedIndexByteLength,
                byteOffset: meshoptCompressedPositionByteLength,
                byteStride: 2,
                count: 3,
                mode: "TRIANGLES",
              },
            },
            target: 34963,
          },
        ],
        buffers: [
          { byteLength: meshoptCompressedTriangleBinByteLength, uri: triangleBinUri },
          { byteLength: 42 },
        ],
        extensionsRequired: ["EXT_meshopt_compression"],
        extensionsUsed: ["EXT_meshopt_compression"],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, meshoptCompressedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await waitForAnimationFrameWork(viewport.animationFrames, () =>
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3));

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
  });

  it("decodes required KHR_draco_mesh_compression primitive geometry and texture coordinates", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "khr-draco-mesh-compression" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { componentType: 5126, count: 3, max: [0.5, 0.5, 0], min: [-0.5, -0.5, 0], type: "VEC3" },
          { componentType: 5126, count: 3, type: "VEC3" },
          { componentType: 5126, count: 3, type: "VEC2" },
          { componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [{ buffer: 0, byteLength: dracoCompressedTriangleBinByteLength, byteOffset: 0 }],
        buffers: [{ byteLength: dracoCompressedTriangleBinByteLength, uri: triangleBinUri }],
        extensionsRequired: ["KHR_draco_mesh_compression"],
        extensionsUsed: ["KHR_draco_mesh_compression"],
        images: [{ mimeType: "image/png", uri: triangleImageUri }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        meshes: [{
          primitives: [{
            attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
            extensions: {
              KHR_draco_mesh_compression: {
                attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
                bufferView: 0,
              },
            },
            indices: 3,
            material: 0,
            mode: 4,
          }],
        }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
        textures: [{ sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, dracoCompressedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
    );

    expect(root.snapshot().diagnostics).toEqual([]);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    const payloads = bufferDataPayloads(calls).map(roundVector);
    expect(payloads).toContainEqual([
      0.000031, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
    expect(payloads).toContainEqual([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
    expect(payloads).toContainEqual([
      0.500122, 1,
      0, 0,
      1, 0,
    ]);
    expect(payloads).toContainEqual([0, 1, 2]);
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
            normalTexture: {
              extensions: {
                KHR_texture_transform: { offset: [0.4, 0.3], scale: [0.25, 0.5] },
              },
              index: 0,
            },
            occlusionTexture: {
              extensions: {
                KHR_texture_transform: { offset: [0.2, 0.1], scale: [0.5, 0.5] },
              },
              index: 0,
            },
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
              metallicRoughnessTexture: {
                extensions: {
                  KHR_texture_transform: { offset: [0.1, 0.2], scale: [0.25, 0.25] },
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
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow0").map(roundVector))
      .toContainEqual([0.5, 0, 0.25, 0]);
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow1").map(roundVector))
      .toContainEqual([0, 0.25, 0.5, 0]);
    expect(uniform4fvPayloads(calls, "u_metallicRoughnessUvRow0").map(roundVector))
      .toContainEqual([0.25, 0, 0.1, 0]);
    expect(uniform4fvPayloads(calls, "u_normalUvRow0").map(roundVector))
      .toContainEqual([0.25, 0, 0.4, 0]);
    expect(uniform4fvPayloads(calls, "u_occlusionUvRow0").map(roundVector))
      .toContainEqual([0.5, 0, 0.2, 0]);
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

  it("loads glTF bufferView base-color images on primitives without normals", async () => {
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
      {
        const document = triangleDocument();
        const primitive = document.meshes[0]?.primitives[0];
        return responseWithJson(url, {
          ...document,
          bufferViews: [
            ...document.bufferViews,
            { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
          ],
          buffers: [{ byteLength: triangleBinByteLength + 4, uri: triangleBinUri }],
          images: [{ bufferView: 4, mimeType: "image/png" }],
          meshes: [{
            primitives: [{
              ...primitive,
              attributes: {
                POSITION: 0,
                TEXCOORD_0: 2,
              },
            }],
          }],
        });
      })).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    expect(loader.bitmapRequests).toHaveLength(1);

    loader.bitmapRequests[0]?.resolve({ height: 1, width: 1 } as ImageBitmap);
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(uniform1iPayloads(calls, "u_useTexture")).toContain(1);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
  });

  it("loads required EXT_texture_webp base-color texture sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installCanvasImageMimeTypeSupport(["image/webp"]);
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
        images: [{ uri: triangleWebpImageUri }],
        textures: [{ extensions: { EXT_texture_webp: { source: 0 } }, sampler: 0 }],
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

  it("uses core JPEG sources when optional EXT_texture_webp is not canvas-supported", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installCanvasImageMimeTypeSupport(["image/jpeg"]);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "optional-webp-unsupported" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["EXT_texture_webp"],
        images: [
          { mimeType: "image/jpeg", uri: triangleJpegImageUri },
          { mimeType: "image/webp", uri: triangleWebpImageUri },
        ],
        textures: [{ extensions: { EXT_texture_webp: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleJpegImageUri}`))).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleWebpImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("uses optional EXT_texture_webp sources when canvas-supported", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installCanvasImageMimeTypeSupport(["image/jpeg", "image/webp"]);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "optional-webp-supported" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["EXT_texture_webp"],
        images: [
          { mimeType: "image/jpeg", uri: triangleJpegImageUri },
          { mimeType: "image/webp", uri: triangleWebpImageUri },
        ],
        textures: [{ extensions: { EXT_texture_webp: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleWebpImageUri}`))).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleJpegImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("loads GS_texture_svg base-color texture sources through automatic image upload", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "svg-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, triangleSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.instances[0]?.src.startsWith("blob:")).toBe(true);
    expect(await loader.objectUrlBlobs[0]?.text()).toContain("width=\"512\"");
    expect(await loader.objectUrlBlobs[0]?.text()).toContain("height=\"512\"");
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => calls.some((call) => call.name === "generateMipmap" && call.args[0] === gl.TEXTURE_2D),
    );

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(calls.some((call) => call.name === "generateMipmap" && call.args[0] === gl.TEXTURE_2D)).toBe(true);
  });

  it("uses opted-in generated VT for plain glTF .svg image sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        throw new Error("unexpected 2D canvas raster fallback");
      }),
    });
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const renderGraph = renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "plain-svg-texture-auto-vt" }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        images: [
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, triangleSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances[0]?.src).toBe("blob:royal-test-1");
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    root.render(renderGraph);

    expect(loader.fetchRequests.some((request) => request.url.includes(".vt.json"))).toBe(false);
    expect(loader.fetchRequests.some((request) => request.url.includes("svg-uri:"))).toBe(false);

    for (
      let frame = 0;
      frame < 8
      && root.snapshot().virtualTexturing.shaderBinds === 0;
      frame += 1
    ) {
      await flushMicrotasks();
      root.render(renderGraph);
      const generatedPageImage = ControlledImage.instances.find((image) => image.src === "blob:royal-test-2");
      generatedPageImage?.settleLoad();
      await flushAnimationFrames(viewport.animationFrames);
    }

    expect(loader.objectUrlBlobs.length).toBeGreaterThan(1);
    expect(await loader.objectUrlBlobs[1]?.text()).toContain("<image href=\"data:image/svg+xml;base64,");
    expect(globalThis.document?.createElement).not.toHaveBeenCalled();
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPageFailures: 0,
      generatedPagesTarget: 5,
      manifestsReady: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("sizes generated GS_texture_svg VT residency for the source mip pyramid", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const tigerSizedSvgTexture = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\" width=\"1024\" height=\"1024\">",
      "<rect x=\"0\" y=\"0\" width=\"1024\" height=\"1024\" fill=\"#c7b084\"/>",
      "<path d=\"M128 128h768v768H128z\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "svg-generated-vt-budget" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, tigerSizedSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.fetchRequests.some((request) => request.url.includes(".vt.json"))).toBe(false);

    expect(
      calls.some((call) =>
        call.name === "texImage2D"
        && call.args[0] === gl.TEXTURE_2D
        && call.args[3] === 1280
        && call.args[4] === 1280),
      "a 1024px generated SVG should fit its 16 + 4 + 1 page pyramid in a 5x5 atlas",
    ).toBe(true);
  });

  it("preserves URI SVG asset base while normalizing viewBox-only SVG textures", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const wrapperSvgTexture = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 210 287\" width=\"1024\" height=\"1024\">",
      "<script>globalThis.__royalUnsafeSvgScript = true</script>",
      "<rect x=\"0\" y=\"0\" width=\"210\" height=\"287\" fill=\"#c7b084\" onload=\"globalThis.__royalUnsafeSvgOnload = true\"/>",
      "<a href=\"javascript:globalThis.__royalUnsafeSvgHref = true\"><text x=\"0\" y=\"0\">unsafe</text></a>",
      "<image href=\"ghostscript-tiger.svg\" x=\"10\" y=\"10\" width=\"190\" height=\"267\" preserveAspectRatio=\"xMidYMid meet\"/>",
      "</svg>",
    ].join("");
    const nestedTigerSvg = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">",
      "<path d=\"M1 1h8v8H1z\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "svg-texture-relative-image-reference" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, wrapperSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/ghostscript-tiger\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, nestedTigerSvg, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.objectUrlBlobs).toHaveLength(1);
    const normalizedSvg = await loader.objectUrlBlobs[0]?.text();
    expect(normalizedSvg).toContain("width=\"1024\"");
    expect(normalizedSvg).toContain("height=\"1024\"");
    expect(normalizedSvg).toContain("xml:base=\"https://example.test/fixtures/staged-triangle.svg\"");
    expect(normalizedSvg).toContain("x=\"10\"");
    expect(normalizedSvg).toContain("width=\"190\"");
    expect(normalizedSvg).toContain("preserveAspectRatio=\"xMidYMid meet\"");
    expect(normalizedSvg).toContain("href=\"data:image/svg+xml;base64,");
    expect(normalizedSvg).not.toContain("<script");
    expect(normalizedSvg).not.toContain("onload=");
    expect(normalizedSvg).not.toContain("javascript:");
    expect(normalizedSvg).not.toContain("d=\"M1 1h8v8H1z\"");
    expect(normalizedSvg).not.toContain("href=\"ghostscript-tiger.svg\"");
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(root.snapshot().diagnostics).toEqual([]);
  });

  it("prefers optional GS_texture_svg sources over core raster fallbacks when supported", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "optional-svg-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, triangleSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.instances[0]?.src.startsWith("blob:")).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("rejects GS_texture_svg images without a finite viewBox or width and height", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "dimensionless-svg-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          {
            mimeType: "image/svg+xml",
            uri: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
          },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(root.snapshot().diagnostics).toContainEqual(expect.stringMatching(
      /GS_texture_svg .*requires a finite viewBox or finite width and height/i,
    ));
    expect(ControlledImage.instances).toHaveLength(0);
  });

  it("loads required KHR_texture_basisu base-color texture URI sources through sRGB upload", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const basisuBytes = Uint8Array.from([0xAB, 0x4B, 0x54, 0x58]);
    const decodedPixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]);
    decodeBasisuMock.mockResolvedValue({
      data: decodedPixels,
      height: 1,
      kind: "rgba-texture",
      width: 2,
    });

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "basisu-texture-uri" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_texture_basisu"],
        extensionsUsed: ["KHR_texture_basisu"],
        images: [{ mimeType: "image/ktx2", uri: triangleBasisuImageUri }],
        textures: [{ extensions: { KHR_texture_basisu: { source: 0 } }, sampler: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    expect(loader.resolvePendingFetch(/staged-triangle\.ktx2(?:$|[?#])/, (url) =>
      responseWithBuffer(url, basisuBytes.buffer.slice(0)))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(Array.from(new Uint8Array(decodeBasisuMock.mock.calls[0]?.[0] as ArrayBuffer))).toEqual(Array.from(basisuBytes));
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(calls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedPixels],
      name: "texImage2D",
    });
  });

  it("loads required KHR_texture_basisu base-color texture bufferView sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const decodedPixels = Uint8Array.from([0, 0, 255, 255]);
    decodeBasisuMock.mockResolvedValue({
      data: decodedPixels,
      height: 1,
      kind: "rgba-texture",
      width: 1,
    });

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "basisu-texture-buffer-view" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        bufferViews: [
          ...(triangleDocument().bufferViews),
          { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
        ],
        buffers: [{ byteLength: triangleBinByteLength + 4, uri: triangleBinUri }],
        extensionsRequired: ["KHR_texture_basisu"],
        extensionsUsed: ["KHR_texture_basisu"],
        images: [{ bufferView: 4, mimeType: "image/ktx2" }],
        textures: [{ extensions: { KHR_texture_basisu: { source: 0 } }, sampler: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithBasisuBytes()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await flushAnimationFrames(viewport.animationFrames);

    expect(Array.from(new Uint8Array(decodeBasisuMock.mock.calls[0]?.[0] as ArrayBuffer)))
      .toEqual([0xAB, 0x4B, 0x54, 0x58]);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(calls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedPixels],
      name: "texImage2D",
    });
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

  it("renders all core glTF primitive modes", async () => {
    const primitiveModes = [
      { drawMode: (gl: WebGL2RenderingContext) => gl.POINTS, mode: 0, version: "points" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.LINE_LOOP, mode: 2, version: "line-loop" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.LINE_STRIP, mode: 3, version: "line-strip" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.TRIANGLE_STRIP, mode: 5, version: "triangle-strip" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.TRIANGLE_FAN, mode: 6, version: "triangle-fan" },
    ] as const;

    for (const { drawMode, mode, version } of primitiveModes) {
      vi.stubGlobal("devicePixelRatio", 1);
      const viewport = installViewportInvalidationStubs();
      const loader = installStagedGltfLoader();
      const { calls, gl } = fakeGl();
      const root = createWebGlRoot(fakeCanvas(gl));

      root.render(renderScene([
        directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
        gltf({ src: triangleGltfSrc, version: `core-primitive-${version}` }),
      ]));
      expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
        responseWithJson(url, {
          ...triangleDocument(),
          images: [],
          materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 3, material: 0, mode }] }],
          samplers: [],
          textures: [],
        }))).toBe(true);
      await flushMicrotasks();
      expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
        responseWithBuffer(url, triangleBin()))).toBe(true);
      await flushMicrotasks();
      await flushAnimationFrames(viewport.animationFrames);

      expect(drawCalls(calls).some((call) => call.args[0] === drawMode(gl) && drawCount(call) === 3)).toBe(true);
      expect(root.snapshot().diagnostics.some((message) => /unsupported primitive mode/i.test(message))).toBe(false);
      root.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("skips invalid glTF primitive modes with a diagnostic", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "invalid-primitive-mode" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        images: [],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 99 }] }],
        samplers: [],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls)).toHaveLength(0);
    expect(root.snapshot().diagnostics.some((message) => /unsupported primitive mode 99/i.test(message))).toBe(true);
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
        extensionsUsed: ["VENDOR_future_material_extension"],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "optional unsupported extension should fall back to core glTF data",
    ).toBe(true);
  });

  it("renders required KHR material anisotropy and diffuse transmission factors", async () => {
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
        version: "required-anisotropy-extension",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...solidTriangleDocument(),
        extensionsRequired: ["KHR_materials_anisotropy", "KHR_materials_diffuse_transmission"],
        extensionsUsed: ["KHR_materials_anisotropy", "KHR_materials_diffuse_transmission"],
        materials: [
          {
            extensions: {
              KHR_materials_anisotropy: {
                anisotropyRotation: 1.125,
                anisotropyStrength: 0.65,
              },
              KHR_materials_diffuse_transmission: {
                diffuseTransmissionColorFactor: [0.25, 0.5, 0.75],
                diffuseTransmissionFactor: 0.4,
              },
            },
            pbrMetallicRoughness: {
              baseColorFactor: [0.8, 0.62, 0.36, 1],
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_anisotropyFactors").map(roundVector))
      .toContainEqual([0.65, 1.125, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_diffuseTransmissionFactors").map(roundVector))
      .toContainEqual([0.25, 0.5, 0.75, 0.4]);
    expect(sources).toContain("uniform vec4 u_anisotropyFactors;");
    expect(sources).toContain("uniform vec4 u_diffuseTransmissionFactors;");
    expect(sources).toContain("materialAnisotropicGgxDistribution");
    expect(sources).toContain("diffuseTransmissionFactor = clamp(u_diffuseTransmissionFactors.a");
    expect(root.snapshot().diagnostics.some((message) =>
      /unsupported required glTF extension.*KHR_materials_anisotropy/i.test(message))).toBe(false);
  });

  it("diagnoses optional KHR material extension textures while using scalar factors", async () => {
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
        version: "optional-anisotropy-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...solidTriangleDocument(),
        extensionsUsed: ["KHR_materials_anisotropy", "KHR_materials_diffuse_transmission"],
        materials: [
          {
            extensions: {
              KHR_materials_anisotropy: {
                anisotropyRotation: 0.25,
                anisotropyStrength: 0.5,
                anisotropyTexture: { index: 0 },
              },
              KHR_materials_diffuse_transmission: {
                diffuseTransmissionColorFactor: [0.4, 0.5, 0.6],
                diffuseTransmissionColorTexture: { index: 2 },
                diffuseTransmissionFactor: 0.35,
                diffuseTransmissionTexture: { index: 1 },
              },
            },
            pbrMetallicRoughness: {
              baseColorFactor: [0.8, 0.62, 0.36, 1],
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "optional anisotropy texture should leave the scalar-factor material drawable",
    ).toBe(true);
    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/KHR_materials_anisotropy\.anisotropyTexture.*factor and rotation.*textures are not yet supported/i);
    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/KHR_materials_diffuse_transmission\.diffuseTransmissionTexture.*factor and color factor.*textures are not yet supported/i);
    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/KHR_materials_diffuse_transmission\.diffuseTransmissionColorTexture.*factor and color factor.*textures are not yet supported/i);
  });

  it("multiplies glTF COLOR_0 vertex colors into base color", async () => {
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
        version: "core-color-0",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, vertexColorTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, vertexColorTriangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(bufferDataPayloads(readyFrameCalls).map(roundVector)).toContainEqual([
      1, 0, 0, 1,
      0, 0.501961, 0, 1,
      0, 0, 1, 1,
    ]);
    expect(readyFrameCalls.some((call) => call.name === "getAttribLocation")).toBe(false);
    expect(readyFrameCalls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 12
      && call.args[1] === 4
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(sources).toContain("in vec4 a_color;");
    expect(sources).toContain("* v_color");
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
    expect(calls.some((call) => call.name === "getAttribLocation")).toBe(false);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 1
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 10
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

  it("draws a large visible lower node LOD on its first frame when LOD0 is outside every view", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: lodGltfSrc, version: "node-lod-visible-fallback" }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, nodeLodSeparatedBoundsDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const readyDraws = drawCalls(calls);
    expect(readyDraws, "a visible lower LOD must prevent first-frame blanking").not.toHaveLength(0);
    expect(drawCount(readyDraws.at(-1)!)).toBe(3);
  });

  it("shares the highest visible node LOD coverage across stereo views independent of view order", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: lodGltfSrc, version: "node-lod-stereo" }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    for (const reverse of [false, true]) {
      const callsBeforeViews = calls.length;
      root.renderViews(renderGraph, { views: lodStereoViews(reverse) });
      const draws = drawCalls(calls.slice(callsBeforeViews));
      expect(draws, `both stereo views should draw in ${reverse ? "reverse" : "forward"} order`)
        .toHaveLength(2);
      expect(draws.map(drawCount), "the higher-coverage eye should select LOD0 for both eyes")
        .toEqual([6, 6]);
    }
  });

  it("preserves the prior shared node LOD while its group is invisible in every view", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const highScale = lodScaleForCoverage(0.205);
    const renderGraph = renderScene([
      gltf({
        ref,
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [highScale, highScale, 1],
        },
        version: "node-lod-invisible-retention",
      }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);
    expect(drawCount(drawCalls(calls).at(-1)!)).toBe(6);

    if (ref.current === null) throw new Error("Expected glTF render-object ref to be attached");
    ref.current.position.x = 10;
    const callsBeforeInvisible = calls.length;
    root.renderViews(renderGraph, { views: lodStereoViews() });
    expect(drawCalls(calls.slice(callsBeforeInvisible))).toHaveLength(0);

    const returnScale = lodScaleForCoverage(0.198);
    ref.current.position.x = 0;
    ref.current.scale.x = returnScale;
    ref.current.scale.y = returnScale;
    const callsBeforeReturn = calls.length;
    root.render(renderGraph);
    const returnedDraws = drawCalls(calls.slice(callsBeforeReturn));
    expect(returnedDraws).toHaveLength(1);
    expect(drawCount(returnedDraws[0]!), "an all-invisible frame must not demote retained LOD0").toBe(6);
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

  it("shares material LOD selection across stereo views independent of view order", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: lodGltfSrc, version: "material-lod-stereo" }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, materialLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    for (const reverse of [false, true]) {
      const callsBeforeViews = calls.length;
      root.renderViews(renderGraph, { views: lodStereoViews(reverse) });
      const viewCalls = calls.slice(callsBeforeViews);
      expect(drawCalls(viewCalls)).toHaveLength(2);
      expect(
        uniform4fvPayloads(viewCalls, "u_color").map(roundVector),
        "a lower-coverage eye must not mutate the finalized shared material LOD",
      ).not.toContainEqual([0, 0, 1, 1]);
    }
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
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow0").map(roundVector))
      .toContainEqual([0.5, 0, 0.25, 0]);
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow1").map(roundVector))
      .toContainEqual([0, 0.25, 0.5, 0]);
  });

  it("keeps node-level MSFT_lod selection stable inside a threshold hysteresis band", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const initialScale = lodScaleForCoverage(0.205);
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const graph = renderScene([
      gltf({
        src: lodGltfSrc,
        ref,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [initialScale, initialScale, 1],
        },
        version: "node-lod-hysteresis",
      }),
    ]);
    const renderGraph = (coverage: number) => {
      const value = lodScaleForCoverage(coverage);
      if (ref.current !== null) {
        ref.current.scale.x = value;
        ref.current.scale.y = value;
      }
      return graph;
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

  it("draws selected material LOD fallback before binding its settled base-color texture", async () => {
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
      callCount(pendingCalls, "texImage2D"),
      "selecting a pending lower material must not upload its ordinary texture during draw",
    ).toBe(0);
    expect(
      callCount(pendingCalls, "generateMipmap"),
      "selecting a pending lower material must not generate mipmaps during draw",
    ).toBe(0);
    expect(
      uniform4fvPayloads(calls, "u_color").map(roundVector).at(-1),
      "renderer should draw the selected lower material with its solid fallback",
    ).toEqual([0.5, 0.5, 0.5, 1]);

    const settledCallsStart = calls.length;
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);

    const settledCalls = calls.slice(settledCallsStart);
    const uploadIndex = settledCalls.findIndex((call) => call.name === "texImage2D");
    const drawIndex = settledCalls.findIndex((call) => drawCalls([call]).length === 1);
    expect(uploadIndex, "settled decoded glTF image should upload through the texture cache").toBeGreaterThanOrEqual(0);
    expect(drawIndex, "settled lower material should draw on the invalidated frame").toBeGreaterThan(uploadIndex);
    expect(uniform1iPayloads(settledCalls, "u_useTexture").at(-1)).toBe(1);
  });

  it("draws the selected material LOD while secondary texture slots are pending", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "material-lod-secondary-textures-pending",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, materialSecondaryTexturePendingLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([1, 0, 0, 1]);
    expect(ControlledImage.instances, "secondary material textures should be staged but not settled").toHaveLength(1);

    const pendingCallsStart = calls.length;
    root.render(renderGraph(0.2));
    const pendingCalls = calls.slice(pendingCallsStart);

    expect(drawCalls(pendingCalls), "pending normal/ORM/emissive/extension textures should not block the LOD").toHaveLength(1);
    expect(uniform4fvPayloads(pendingCalls, "u_color").map(roundVector)).toContainEqual([0, 1, 0, 1]);
    expect(uniform1iPayloads(pendingCalls, "u_useMetallicRoughnessTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useNormalTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useEmissiveTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useOcclusionTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useSpecularTexture")).not.toContain(1);
  });

  it("budgets settled glTF ordinary texture uploads across animation frames", async () => {
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
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.2, 0.2, 1],
        },
        version: "ordinary-texture-upload-budget",
      }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, materialSecondaryTexturePendingLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances, "secondary material textures should share one staged image").toHaveLength(1);
    expect(callCount(calls, "texImage2D")).toBe(0);

    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    const uploadsBeforeFrames = callCount(calls, "texImage2D");
    const mipmapsBeforeFrames = callCount(calls, "generateMipmap");
    await flushAnimationFrames(viewport.animationFrames);
    expect(callCount(calls, "texImage2D") - uploadsBeforeFrames).toBe(1);
    expect(callCount(calls, "generateMipmap") - mipmapsBeforeFrames).toBe(1);

    await flushAnimationFrames(viewport.animationFrames);
    expect(callCount(calls, "texImage2D") - uploadsBeforeFrames).toBe(2);
    expect(callCount(calls, "generateMipmap") - mipmapsBeforeFrames).toBe(2);

    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_useSpecularTexture").includes(1)
        && uniform1iPayloads(calls, "u_useEmissiveTexture").includes(1),
    );
    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.TRIANGLES);
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
