import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  imageTexture,
  mesh,
  orthographicCamera,
  pass,
  scene,
  unlitMaterial,
  type Material,
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

type FakeGlOptions = {
  readonly programLinkStatus?: boolean;
  readonly shaderCompileStatus?: boolean;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type FakeHandle = {
  readonly id: number;
  readonly kind: string;
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
const shaderCompileFailure = "synthetic shader compile failure";
const programLinkFailure = "synthetic program link failure";
const textureLoadFailure = "synthetic texture load failure";

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

const fakeGl = (options: FakeGlOptions = {}): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniform = { kind: "uniform", id: 0 } as unknown as WebGLUniformLocation;
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    BROWSER_DEFAULT_WEBGL: 0x9244,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
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
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    STATIC_DRAW: 0x88E4,
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
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
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
      ) {
        return 8;
      }
      if (parameter === constants.MAX_TEXTURE_SIZE) return 4096;

      return 0;
    }),
    getProgramInfoLog: record("getProgramInfoLog", () => programLinkFailure),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.LINK_STATUS) return options.programLinkStatus ?? true;
      if (parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS) return 0;

      return true;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => shaderCompileFailure),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) => {
      if (parameter === constants.COMPILE_STATUS) return options.shaderCompileStatus ?? true;

      return true;
    }),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record("getUniformLocation", () => uniform),
    isContextLost: record("isContextLost", () => false),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    polygonOffset: record("polygonOffset"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    texSubImage2D: record("texSubImage2D"),
    uniform1f: record("uniform1f"),
    uniform1i: record("uniform1i"),
    uniform2fv: record("uniform2fv"),
    uniform3fv: record("uniform3fv"),
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

  fail(reason: Error): void {
    for (const reject of this.#decodeRejectors.splice(0)) reject(reason);
    this.#decodeResolvers.splice(0);
    this.dispatch("error", reason);
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

  private dispatch(type: "error" | "load", reason?: Error): void {
    const event = new Event(type);
    if (reason !== undefined) {
      Object.defineProperty(event, "error", {
        configurable: true,
        value: reason,
      });
      Object.defineProperty(event, "message", {
        configurable: true,
        value: reason.message,
      });
    }

    if (type === "load") {
      this.onload?.call(this as unknown as HTMLImageElement, event);
    } else {
      this.onerror?.call(this as unknown as HTMLImageElement, event);
    }

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

const renderScene = (material: Material = unlitMaterial({ color: [1, 1, 1, 1] })) => scene({
  children: [
    pass({
      camera: camera(),
      children: [
        mesh({
          geometry: boxGeometry(1),
          material,
        }),
      ],
      clearColor: [0, 0, 0, 0],
    }),
  ],
});

const eventCount = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

const drawCount = (calls: readonly GlCall[]): number =>
  eventCount(calls, "drawArrays") + eventCount(calls, "drawElements");

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

const createdResources = (calls: readonly GlCall[], name: string): readonly unknown[] =>
  calls
    .filter((call) => call.name === name)
    .map((call) => call.result)
    .filter((resource): resource is FakeHandle => resource !== undefined);

const deletedResources = (calls: readonly GlCall[], name: string): readonly unknown[] =>
  calls
    .filter((call) => call.name === name)
    .map((call) => call.args[0]);

const expectCreatedResourcesDeleted = (
  calls: readonly GlCall[],
  createName: string,
  deleteName: string,
): void => {
  const created = createdResources(calls, createName);
  const deleted = deletedResources(calls, deleteName);

  expect(deleted, `${deleteName} should be called for every ${createName} result`).toHaveLength(created.length);
  for (const resource of created) {
    expect(deleted, `${deleteName} should include the created ${createName} handle`).toContain(resource);
  }
};

const texParameterTriples = (calls: readonly GlCall[]): readonly (readonly unknown[])[] =>
  calls
    .filter((call) => call.name === "texParameteri")
    .map((call) => call.args.slice(0, 3));

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

const installTextureLoaderStubs = () => {
  const fetchRequests: FetchRequest[] = [];
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
  };
};

const requestedTextureUrls = (loader: ReturnType<typeof installTextureLoaderStubs>): readonly string[] => [
  ...ControlledImage.instances.map((image) => image.src),
  ...loader.fetchRequests.map((request) => request.url),
];

const settleTextureLoad = async (loader: ReturnType<typeof installTextureLoaderStubs>): Promise<void> => {
  ControlledImage.instances[0]?.settleLoad();
  loader.fetchRequests[0]?.resolve(fakeImageResponse(loader.fetchRequests[0].url));
  await flushMicrotasks();

  for (const request of loader.bitmapRequests.splice(0)) {
    request.resolve(fakeImageBitmap());
  }
  await flushMicrotasks();
};

const failTextureLoad = async (
  loader: ReturnType<typeof installTextureLoaderStubs>,
  reason: Error,
): Promise<void> => {
  ControlledImage.instances[0]?.fail(reason);
  loader.fetchRequests[0]?.reject(reason);
  await flushMicrotasks();

  for (const request of loader.bitmapRequests.splice(0)) {
    request.reject(reason);
  }
  await flushMicrotasks();
};

const textFromUnknown = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === undefined) return "";

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const collectStrings = (value: unknown, seen = new Set<unknown>()): string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (value instanceof Error) return [value.message];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  return Object.values(value as Record<string, unknown>).flatMap((entry) => collectStrings(entry, seen));
};

const snapshotStrings = (root: { snapshot?: () => unknown }): readonly string[] => {
  if (typeof root.snapshot !== "function") return [];

  return collectStrings(root.snapshot());
};

const capturedThrow = (operation: () => void): unknown => {
  try {
    operation();
  } catch (error) {
    return error;
  }

  return undefined;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
});

describe("WebGL renderer error and texture contracts", () => {
  it("throws a clear shader compile error and cleans up created shader/program resources", () => {
    const { calls, gl } = fakeGl({ shaderCompileStatus: false });
    const root = createWebGlRoot(fakeCanvas(gl));

    const errorText = textFromUnknown(capturedThrow(() => root.render(renderScene())));

    expect(errorText).toMatch(/shader/i);
    expect(errorText).toMatch(/compile/i);
    expect(errorText).toContain(shaderCompileFailure);
    expect(createdResources(calls, "createShader").length, "a shader compile path should create shaders").toBeGreaterThan(0);
    expect(drawCount(calls), "failed shader compilation must not draw").toBe(0);
    expectCreatedResourcesDeleted(calls, "createShader", "deleteShader");
    expectCreatedResourcesDeleted(calls, "createProgram", "deleteProgram");
  });

  it("throws a clear program link error and cleans up created shader/program resources", () => {
    const { calls, gl } = fakeGl({ programLinkStatus: false });
    const root = createWebGlRoot(fakeCanvas(gl));

    const errorText = textFromUnknown(capturedThrow(() => root.render(renderScene())));

    expect(errorText).toMatch(/program/i);
    expect(errorText).toMatch(/link/i);
    expect(errorText).toContain(programLinkFailure);
    expect(createdResources(calls, "createProgram").length, "a program link path should create a program").toBeGreaterThan(0);
    expect(drawCount(calls), "failed program linking must not draw").toBe(0);
    expectCreatedResourcesDeleted(calls, "createShader", "deleteShader");
    expectCreatedResourcesDeleted(calls, "createProgram", "deleteProgram");
  });

  it("uploads image texture data and sampler parameters after load/decode", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const animationFrames = installAnimationFrameQueue();
    const loader = installTextureLoaderStubs();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const texturedMaterial = unlitMaterial({
      texture: imageTexture({
        sampler: {
          magFilter: "nearest",
          minFilter: "linear",
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/textures/checker.png",
      }),
    });

    root.render(renderScene(texturedMaterial));

    expect(requestedTextureUrls(loader).some((url) => url.includes("/textures/checker.png"))).toBe(true);
    const beforeLoadCallCount = calls.length;

    await settleTextureLoad(loader);
    await flushAnimationFrames(animationFrames);

    const afterLoadCalls = calls.slice(beforeLoadCallCount);
    expect(
      hasTexturePixelUploadAfter(calls, beforeLoadCallCount),
      "the texture upload should happen after the image load/decode settles via texImage2D or texStorage2D + texSubImage2D",
    ).toBe(true);
    expect(texParameterTriples(afterLoadCalls)).toEqual(expect.arrayContaining([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT],
    ]));
  });

  it("records or surfaces texture load failure without breaking unrelated subsequent renders", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installAnimationFrameQueue();
    const loader = installTextureLoaderStubs();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const failingScene = renderScene(unlitMaterial({
      texture: imageTexture({
        fallbackColor: [0.25, 0.25, 0.25, 1],
        src: "/textures/missing-texture.png",
      }),
    }));

    root.render(failingScene);
    expect(requestedTextureUrls(loader).some((url) => url.includes("/textures/missing-texture.png"))).toBe(true);

    await failTextureLoad(loader, new Error(textureLoadFailure));

    let surfacedError: unknown;
    try {
      root.render(failingScene);
    } catch (error) {
      surfacedError = error;
    }

    const beforeUnrelatedDraws = drawCount(calls);
    expect(() => root.render(renderScene())).not.toThrow();
    expect(drawCount(calls), "a later unrelated render should still draw").toBeGreaterThan(beforeUnrelatedDraws);

    const diagnosticText = [
      textFromUnknown(surfacedError),
      ...consoleError.mock.calls.flat().map(textFromUnknown),
      ...consoleWarn.mock.calls.flat().map(textFromUnknown),
      ...snapshotStrings(root),
    ];

    expect(
      diagnosticText.some((message) =>
        /(?:texture|image).*(?:load|decode|fetch|fail)/i.test(message)
        && /(?:missing-texture\.png|synthetic texture load failure)/i.test(message)),
      "texture load failures should be surfaced or recorded with deterministic context",
    ).toBe(true);
  });
});
