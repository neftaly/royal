import { readFileSync } from "node:fs";
import { expect, vi } from "vitest";
import { preloadVirtualTextureFeature } from "../packages/renderer-webgl/src/virtual-texture/lazy-feature";
import { preloadImageBasedLightingFeature } from "../packages/renderer-webgl/src/lazy-image-based-lighting-feature";
import { preloadClusteredLightingFeature } from "../packages/renderer-webgl/src/lazy-clustered-lighting-feature";

const hoistedMocks = vi.hoisted(() => ({
  decodeBasisu: vi.fn(),
}));
export const decodeBasisuMock = hoistedMocks.decodeBasisu;

vi.mock("../packages/renderer-webgl/src/gltf/codecs/basisu", () => ({
  decodeGltfBasisuTexture: decodeBasisuMock,
}));

import {
  orthographicCamera,
  scene,
  type RenderNode,
  type RenderRoot as SceneRenderRoot,
} from "@royal/renderer-core";
import type { WebGlGltfInstancingSnapshot, WebGlRoot } from "@royal/renderer-webgl";

await preloadVirtualTextureFeature();
await preloadImageBasedLightingFeature();
await preloadClusteredLightingFeature();

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
    COLOR_ATTACHMENT0: 0x8CE0,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    CCW: 0x0901,
    CW: 0x0900,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_ATTACHMENT: 0x8D00,
    DEPTH_COMPONENT24: 0x81A6,
    DEPTH_TEST: 0x0B71,
    DYNAMIC_DRAW: 0x88E8,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8D40,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    FRAGMENT_SHADER: 0x8B30,
    HALF_FLOAT: 0x140B,
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
    RGBA16F: 0x881A,
    RGBA32F: 0x8814,
    SRGB8_ALPHA8: 0x8C43,
    SRC_ALPHA: 0x0302,
    SCISSOR_TEST: 0x0C11,
    STATIC_DRAW: 0x88E4,
    RENDERBUFFER: 0x8D41,
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
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    checkFramebufferStatus: record("checkFramebufferStatus", () => constants.FRAMEBUFFER_COMPLETE),
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
    renderbufferStorage: record("renderbufferStorage"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texSubImage2D: record("texSubImage2D"),
    uniform1i: record("uniform1i"),
    uniform2f: record("uniform2f"),
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

export const waitForModuleLoad = async (ready: () => boolean): Promise<void> => {
  for (let index = 0; index < 80; index += 1) {
    if (ready()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await flushMicrotasks();
  }
  throw new Error("Timed out waiting for dynamically loaded renderer work");
};

export const fakeImageBitmap = (size: number): ImageBitmap => ({
  close: vi.fn(),
  height: size,
  width: size,
}) as unknown as ImageBitmap;

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
  calls.filter((call, index) =>
    call.name === "drawElements"
    || (call.name === "drawArrays"
      && !(calls[index - 1]?.name === "bindVertexArray" && calls[index - 1]?.args[0] === null))
  );

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
  calls.filter((call) =>
    call.name === name
    && !(name === "texImage2D" && call.args[2] === 0x881A)
  ).length;

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
    .filter((call) =>
      (call.name === "uniform4f" || call.name === "uniform4fv")
      && uniformLocationName(call.args[0]) === name
    )
    .map((call) => {
      if (call.name === "uniform4f") {
        return call.args.slice(1, 5).map((value) => typeof value === "number" ? value : NaN);
      }
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
    .filter((call) => (call.name === "uniform2fv" || call.name === "uniform2f")
      && uniformLocationName(call.args[0]) === name)
    .map((call) => {
      if (call.name === "uniform2f") return [Number(call.args[1]), Number(call.args[2])];
      const values = numericArray(call.args[1]);
      const offset = typeof call.args[2] === "number" ? call.args[2] : 0;
      const length = typeof call.args[3] === "number" ? call.args[3] : 2;

      return values.slice(offset, offset + length).slice(0, 2);
    });

export const textureParameterCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texParameteri");

export const texturePixelStoreCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "pixelStorei");

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
