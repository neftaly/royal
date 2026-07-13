import { readFileSync } from "node:fs";
import { expect, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  decodeBasisu: vi.fn(),
}));
export const decodeBasisuMock = hoistedMocks.decodeBasisu;

vi.mock("../packages/renderer-webgl/src/gltf/codecs/basisu", () => ({
  decodeGltfBasisuRgba: decodeBasisuMock,
}));

import {
  orthographicCamera,
  scene,
  type RenderNode,
  type RenderRoot as SceneRenderRoot,
} from "@royal/renderer-core";
import type { WebGlGltfInstancingSnapshot, WebGlRoot } from "@royal/renderer-webgl";

export type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

export type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

export type GlCall = {
  readonly args: readonly unknown[];
  readonly name: string;
};

export type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

export type FetchRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (response: Response) => void;
  readonly url: string;
};

export type BitmapRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (bitmap: ImageBitmap) => void;
};

export const defaultCanvasSize: CanvasSize = { height: 180, width: 320 };
export const triangleGltfSrc = "https://example.test/fixtures/staged-triangle.gltf";
export const matchingTriangleGltfSrc = "https://example.test/fixtures/matching-triangle.gltf";
export const triangleBinUri = "staged-triangle.bin";
export const triangleEmissiveImageUri = "staged-triangle-emissive.png";
export const triangleImageUri = "staged-triangle.png";
export const triangleBasisuImageUri = "staged-triangle.ktx2";
export const triangleMetallicRoughnessImageUri = "staged-triangle-metallic-roughness.png";
export const triangleNormalImageUri = "staged-triangle-normal.png";
export const triangleOcclusionImageUri = "staged-triangle-occlusion.png";
export const triangleJpegImageUri = "staged-triangle.jpg";
export const triangleSvgImageUri = "staged-triangle.svg";
export const triangleSvgTexture = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path d=\"M64 64h384v384H64z\" fill=\"#f60\"/></svg>";
export const triangleVariantImageUri = "staged-triangle-variant.png";
export const triangleWebpImageUri = "staged-triangle.webp";
export const iblSpecularImageUris = [
  "ibl-pos-x.png",
  "ibl-neg-x.png",
  "ibl-pos-y.png",
  "ibl-neg-y.png",
  "ibl-pos-z.png",
  "ibl-neg-z.png",
] as const;
export const triangleBinByteLength = 104;
export const meshoptCompressedPositionByteLength = 56;
export const meshoptCompressedIndexByteLength = 18;
export const meshoptCompressedTriangleBinByteLength = meshoptCompressedPositionByteLength + meshoptCompressedIndexByteLength;
export const dracoCompressedTriangleBinByteLength = 173;
export const instancedTriangleBinByteLength = triangleBinByteLength + 48;
export const lodGltfSrc = "https://example.test/fixtures/lod.gltf";
export const lodBinUri = "lod.bin";
export const lodImageUri = "lod-shared.png";
export const lodBinByteLength = 102;
export const khronosEnvironmentTestGltfSrc = "https://example.test/khronos/EnvironmentTest/glTF-IBL/EnvironmentTest.gltf";
export const khronosEnvironmentTestFixtureUrl = new URL(
  "./fixtures/khronos/EnvironmentTest/glTF-IBL/EnvironmentTest.gltf",
  import.meta.url,
);
export const khronosEnvironmentTestTransform = {
  position: [0, -0.25, 0] as const,
  rotation: [0, 0, 0] as const,
  scale: [0.05, 0.05, 0.05] as const,
};

export type TestGltfDocument = {
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

export const khronosEnvironmentTestDocument = (): TestGltfDocument & Record<string, unknown> =>
  JSON.parse(readFileSync(khronosEnvironmentTestFixtureUrl, "utf8")) as TestGltfDocument & Record<string, unknown>;

export const khronosEnvironmentTestBuffer = (document: TestGltfDocument): ArrayBuffer =>
  new ArrayBuffer(document.buffers?.[0]?.byteLength ?? 0);

export const khronosEnvironmentTestLdrSpecularDocument = (): TestGltfDocument & Record<string, unknown> => {
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

export const fakeCanvas = (
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

export const fakeGl = (): FakeGl => {
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

export class ControlledImage {
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

export class ControlledResizeObserver implements ResizeObserver {
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

export const makeMediaQueryList = (query: string): MediaQueryList => {
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

export let latestAnimationFrames: FrameRequestCallback[] = [];

const activeRoots = new Set<WebGlRoot>();

export const trackGltfSceneTestRoot = <Root extends WebGlRoot>(root: Root): Root => {
  activeRoots.add(root);

  return root;
};

export const installViewportInvalidationStubs = () => {
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
      const currentMediaQueries = mediaQueries.slice();
      for (const mediaQueryList of currentMediaQueries) mediaQueryList.dispatchEvent(new Event("change"));
      for (const observer of ControlledResizeObserver.instances) observer.trigger(target);
    },
  };
};

export const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

export const fakeImageBitmap = (size: number): ImageBitmap => ({
  close: vi.fn(),
  height: size,
  width: size,
}) as unknown as ImageBitmap;

export const settleKhronosEnvironmentTestIblBitmaps = async (
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

export const settleControlledImageWave = async (expected: number): Promise<void> => {
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

export const flushAnimationFrames = async (callbacks: FrameRequestCallback[]): Promise<void> => {
  const queued = callbacks.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
  await flushMicrotasks();
};

export const flushPreparedAssetBoundary = async (): Promise<void> => {
  await flushMicrotasks();
  await flushAnimationFrames(latestAnimationFrames);
};

export const waitForAnimationFrameWork = async (
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

export const camera = () => orthographicCamera({
  bottom: -1,
  far: 20,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

export const renderScene = (children: readonly RenderNode[]): SceneRenderRoot =>
  scene({
    camera: camera(),
    nodes: children,
    clearColor: [0, 0, 0, 0],
  });

export const drawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArrays" || call.name === "drawElements");

export const instancedDrawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArraysInstanced" || call.name === "drawElementsInstanced");

export const shaderSources = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "shaderSource")
    .map((call) => String(call.args[1] ?? ""));

export const drawCount = (call: GlCall): number =>
  call.name === "drawArrays" ? Number(call.args[2]) : Number(call.args[1]);

export const instancedDrawInstanceCount = (call: GlCall): number =>
  call.name === "drawArraysInstanced" ? Number(call.args[3]) : Number(call.args[4]);

export const callCount = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

export const lodScaleForCoverage = (coverage: number): number =>
  Math.sqrt(coverage / 0.5625);

export const lodStereoViews = (reverse = false) => {
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

export const isNumericArrayLike = (value: unknown): value is ArrayLike<number> =>
  ArrayBuffer.isView(value)
    && !(value instanceof DataView)
    && typeof (value as { readonly length?: unknown }).length === "number";

export const numericArray = (value: unknown): readonly number[] => {
  if (Array.isArray(value)) return value.map(Number);
  if (isNumericArrayLike(value)) return Array.from(value, Number);

  return [];
};

export const bufferDataPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "bufferData")
    .map((call) => numericArray(call.args[1]))
    .filter((values) => values.length > 0);

export const bufferUploadPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "bufferData" || call.name === "bufferSubData")
    .map((call) => numericArray(call.name === "bufferSubData" ? call.args[2] : call.args[1]))
    .filter((values) => values.length > 0);

export const bufferSubDataUploadRanges = (calls: readonly GlCall[]): readonly {
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

export const bufferSubDataPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "bufferSubData")
    .map((call) => {
      const values = numericArray(call.args[2]);
      const offset = typeof call.args[3] === "number" ? call.args[3] : 0;
      const length = typeof call.args[4] === "number" ? call.args[4] : values.length - offset;

      return values.slice(offset, offset + length);
    })
    .filter((values) => values.length > 0);

export const gltfInstancingSnapshotKeys = [
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

export const gltfInstancingDelta = (
  after: WebGlGltfInstancingSnapshot,
  before: WebGlGltfInstancingSnapshot,
): WebGlGltfInstancingSnapshot => {
  const delta = {} as Record<keyof WebGlGltfInstancingSnapshot, number>;
  for (const key of gltfInstancingSnapshotKeys) {
    delta[key] = after[key] - before[key];
  }
  return delta;
};

export const roundNumber = (value: number): number => {
  const rounded = Number(value.toFixed(6));

  return Object.is(rounded, -0) ? 0 : rounded;
};

export const roundVector = (values: readonly number[]): readonly number[] =>
  values.map(roundNumber);

export const uniformLocationName = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
    ? value.name
    : undefined;

export const uniform1iPayloads = (
  calls: readonly GlCall[],
  name: string,
): readonly number[] =>
  calls
    .filter((call) => call.name === "uniform1i" && uniformLocationName(call.args[0]) === name)
    .map((call) => typeof call.args[1] === "number" ? call.args[1] : NaN);

export const waitForUniform1iPayload = async (
  callbacks: FrameRequestCallback[],
  calls: readonly GlCall[],
  name: string,
  value: number,
): Promise<void> => waitForAnimationFrameWork(
  callbacks,
  () => uniform1iPayloads(calls, name).includes(value),
);

export const uniform4fvPayloads = (
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

export const matrixUniformPayloads = (calls: readonly GlCall[], name?: string): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "uniformMatrix4fv")
    .filter((call) => name === undefined || uniformLocationName(call.args[0]) === name)
    .map((call) => {
      const values = numericArray(call.args[2]);
      const offset = typeof call.args[3] === "number" ? call.args[3] : 0;
      const length = typeof call.args[4] === "number" ? call.args[4] : 16;

      return values.slice(offset, offset + length).slice(0, 16);
    });

export const uniform2fvPayloads = (
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

export const textureParameterCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texParameteri");

export const texturePixelStoreCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "pixelStorei");

export const triangleBin = (): ArrayBuffer => {
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

export const vertexColorTriangleBin = (): ArrayBuffer => {
  const bytes = new Uint8Array(triangleBinByteLength + 9);
  bytes.set(new Uint8Array(triangleBin()));
  bytes.set([
    255, 0, 0,
    0, 128, 0,
    0, 0, 255,
  ], triangleBinByteLength);

  return bytes.buffer;
};

export const tangentTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength + 48);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 12).set([
    1, 0, 0, 1,
    1, 0, 0, 1,
    1, 0, 0, 1,
  ]);

  return buffer;
};

export const multiUvTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength + 24);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 6).set([
    0.125, 0.25,
    0.375, 0.5,
    0.625, 0.75,
  ]);

  return buffer;
};

export const meshoptCompressedTriangleBin = (): ArrayBuffer => {
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

export const dracoCompressedTriangleBin = (): ArrayBuffer => {
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

export const instancedTriangleBin = (): ArrayBuffer => {
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

export const paddedLength = (byteLength: number): number => Math.ceil(byteLength / 4) * 4;

export const paddedJsonBytes = (value: unknown): Uint8Array => {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(value));
  const bytes = new Uint8Array(paddedLength(jsonBytes.byteLength));
  bytes.set(jsonBytes);
  bytes.fill(0x20, jsonBytes.byteLength);

  return bytes;
};

export const paddedBinaryBytes = (buffer: ArrayBuffer): Uint8Array => {
  const bytes = new Uint8Array(paddedLength(buffer.byteLength));
  bytes.set(new Uint8Array(buffer));

  return bytes;
};

export const glbContainer = (document: unknown, binaryChunk: ArrayBuffer): ArrayBuffer => {
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

export const dataUriForBuffer = (buffer: ArrayBuffer): string =>
  `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;

export const interleavedTriangleBin = (): ArrayBuffer => {
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

export const quantizedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(24);
  new Int16Array(buffer, 0, 9).set([
    0, 32767, 0,
    -32767, -32767, 0,
    32767, -32767, 0,
  ]);
  new Uint16Array(buffer, 18, 3).set([0, 1, 2]);

  return buffer;
};

export const sparseTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(40);
  new Uint8Array(buffer, 0, 3).set([0, 1, 2]);
  new Float32Array(buffer, 4, 9).set([
    0, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);

  return buffer;
};

export const lineBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(24);
  new Float32Array(buffer).set([
    -0.5, 0, 0,
    0.5, 0, 0,
  ]);

  return buffer;
};

export const triangleWithImageBytes = (): ArrayBuffer => {
  const base = triangleBin();
  const buffer = new ArrayBuffer(base.byteLength + 4);
  new Uint8Array(buffer).set(new Uint8Array(base));
  new Uint8Array(buffer, base.byteLength).set([0x89, 0x50, 0x4E, 0x47]);

  return buffer;
};

export const triangleWithBasisuBytes = (): ArrayBuffer => {
  const base = triangleBin();
  const buffer = new ArrayBuffer(base.byteLength + 4);
  new Uint8Array(buffer).set(new Uint8Array(base));
  new Uint8Array(buffer, base.byteLength).set([0xAB, 0x4B, 0x54, 0x58]);

  return buffer;
};

export const lodBin = (): ArrayBuffer => {
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

export const lodAccessors = () => [
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

export const lodBufferViews = () => [
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

export const nodeLodDocument = () => ({
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

export const nodeLodSeparatedBoundsDocument = () => {
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

export const materialLodDocument = () => ({
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

export const materialTexturePendingLodDocument = () => ({
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

export const materialSecondaryTexturePendingLodDocument = () => {
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

export const materialSharedTextureLodDocument = () => ({
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

export const triangleDocument = () => ({
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

export const solidTriangleDocument = () => ({
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

export const vertexColorTriangleDocument = () => {
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

export const normalTextureTriangleDocument = () => {
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

export const tangentTriangleDocument = () => {
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

export const multiUvEmissiveTriangleDocument = () => {
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

export const doubleSidedTriangleDocument = () => {
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

export const alphaMaskTriangleDocument = () => {
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

export const alphaBlendTriangleDocument = () => {
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

export const mirroredTriangleNodesDocument = () => {
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

export const metallicRoughnessTriangleDocument = () => {
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

export const metallicRoughnessTextureTriangleDocument = () => {
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

export const instancedTriangleDocument = () => {
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

export const punctualLightTriangleDocument = () => {
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

export const iblCoefficients = (
  c0: readonly [number, number, number],
  c8: readonly [number, number, number] = [0, 0, 0],
): readonly (readonly [number, number, number])[] =>
  Array.from({ length: 9 }, (_unused, index) =>
    index === 0 ? c0 : index === 8 ? c8 : [0, 0, 0] as const);

export const sceneSelectedImageBasedLightTriangleDocument = () => {
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

export const invalidImageBasedLightReferenceTriangleDocument = () => {
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

export const emissiveStrengthTriangleDocument = () => {
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

export const emissiveTextureTriangleDocument = () => {
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

export const occlusionTextureTriangleDocument = () => {
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

export const materialPbrExtensionFactorsTriangleDocument = () => {
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

export const materialPbrExtensionDefaultsTriangleDocument = () => {
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

export const materialPbrExtensionTextureDiagnosticTriangleDocument = () => {
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

export const materialSheenIridescenceFactorsTriangleDocument = () => {
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

export const materialSheenIridescenceDefaultsTriangleDocument = () => {
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

export const materialSheenIridescenceTextureDiagnosticTriangleDocument = () => {
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

export const materialSheenIridescenceBatchKeyTriangleDocument = () => {
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

export const materialTransmissionVolumeTriangleDocument = () => {
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

export const materialTransmissionVolumeDefaultsTriangleDocument = () => {
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

export const materialDispersionTriangleDocument = () => {
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

export const materialDispersionDefaultsClampingTriangleDocument = () => {
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

export const materialTransmissionVolumeTextureDiagnosticTriangleDocument = () => {
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

export const materialOverfullTextureUnitTriangleDocument = () => {
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

export const materialOverfullSolidBaseImageBasedLightTriangleDocument = () => {
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

export const materialTransmissionBatchKeyTriangleDocument = () => {
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

export const materialDispersionBatchKeyTriangleDocument = () => {
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

export const materialVariantsTriangleDocument = () => {
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

export const materialVariantTextureTriangleDocument = () => {
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

export const responseWithJson = (url: string, json: unknown): Response => {
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

export const responseWithBuffer = (url: string, buffer: ArrayBuffer): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(buffer)),
  blob: vi.fn(() => Promise.resolve(new Blob([buffer], { type: "application/octet-stream" }))),
  ok: true,
  status: 200,
  statusText: "OK",
  url,
}) as unknown as Response;

export const responseWithText = (url: string, text: string, type = "text/plain"): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(new TextEncoder().encode(text).buffer)),
  blob: vi.fn(() => Promise.resolve(new Blob([text], { type }))),
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(() => Promise.resolve(text)),
  url,
}) as unknown as Response;

export const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if ("url" in input && typeof input.url === "string") return input.url;

  return Object.prototype.toString.call(input);
};

export const installStagedGltfLoader = () => {
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

export const installCanvasImageMimeTypeSupport = (supported: readonly string[]): void => {
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

export const installCanvas2d = (): {
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

export const settleDocumentAndBuffer = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
): Promise<void> => {
  expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
    responseWithJson(url, triangleDocument()))).toBe(true);
  await flushMicrotasks();
  expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
    responseWithBuffer(url, triangleBin()))).toBe(true);
  await flushMicrotasks();
};

export const settleLodDocumentAndBuffer = async (
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

export const resetGltfSceneTestState = (): void => {
  for (const root of activeRoots) root.dispose();
  activeRoots.clear();
  latestAnimationFrames.splice(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  decodeBasisuMock.mockReset();
  ControlledImage.instances.splice(0);
  ControlledResizeObserver.instances.splice(0);
};
