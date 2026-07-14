import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  imageTexture,
  mesh,
  orthographicCamera,
  scene,
  textureAsset,
  unlitMaterial,
  wireframeMaterial,
  type Geometry,
  type Material,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import {
  probeWebGlCapabilities,
  type RendererCapabilityProbeRow,
  type WebGlCapabilityProbeContext,
} from "@royal/renderer-webgl/capabilities";

type GlCall = {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly result?: unknown;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type FakeCanvas = HTMLCanvasElement & {
  readonly getContext: ReturnType<typeof vi.fn>;
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

const canvasSize = { height: 180, width: 320 };
const uvLocations = [10, 11] as const;

const handle = <Handle>(kind: string, id: number): Handle =>
  ({ id, kind }) as Handle;

const fakeCanvas = (gl: WebGL2RenderingContext): FakeCanvas => {
  const target = new EventTarget();
  return ({
    addEventListener: target.addEventListener.bind(target),
    get clientHeight() {
      return canvasSize.height;
    },
    get clientWidth() {
      return canvasSize.width;
    },
    getBoundingClientRect: vi.fn(() => ({
      bottom: canvasSize.height,
      height: canvasSize.height,
      left: 0,
      right: canvasSize.width,
      top: 0,
      width: canvasSize.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })),
    getContext: vi.fn((contextId: string) => (contextId === "webgl2" ? gl : null)),
    height: 0,
    removeEventListener: target.removeEventListener.bind(target),
    width: 0,
  }) as unknown as FakeCanvas;
};

const fakeGl = (): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniform = handle<WebGLUniformLocation>("uniform", 0);
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
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8D40,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINK_STATUS: 0x8B82,
    LINES: 0x0001,
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
    SRGB8_ALPHA8: 0x8C43,
    SCISSOR_TEST: 0x0C11,
    SRC_ALPHA: 0x0302,
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

  const makeHandle = <Handle,>(kind: string): Handle =>
    handle<Handle>(kind, nextHandleId++);

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
    drawingBufferHeight: canvasSize.height,
    drawingBufferWidth: canvasSize.width,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindFramebuffer: record("bindFramebuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendFuncSeparate: record("blendFuncSeparate"),
    bufferData: record("bufferData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => makeHandle<WebGLBuffer>("buffer")),
    createProgram: record("createProgram", () => makeHandle<WebGLProgram>("program")),
    createShader: record("createShader", () => makeHandle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => makeHandle<WebGLTexture>("texture")),
    createVertexArray: record("createVertexArray", () => makeHandle<WebGLVertexArrayObject>("vertex-array")),
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      if (name === "a_uv0") return uvLocations[0];
      if (name === "a_uv1") return uvLocations[1];
      if (name === "a_position") return 0;

      return 1;
    }),
    getError: record("getError", () => constants.NO_ERROR),
    getContextAttributes: record("getContextAttributes", () => ({ alpha: true, antialias: true })),
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
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.LINK_STATUS) return true;
      if (parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS) return 0;

      return true;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) =>
      parameter === constants.COMPILE_STATUS ? true : true),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record("getUniformLocation", () => uniform),
    isContextLost: record("isContextLost", () => false),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    uniform1i: record("uniform1i"),
    uniform3fv: record("uniform3fv"),
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

    return new Promise((resolve) => {
      this.#decodeResolvers.push(resolve);
    });
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  settleLoad(): void {
    this.complete = true;
    const event = new Event("load");
    this.onload?.call(this as unknown as HTMLImageElement, event);
    for (const listener of this.#listeners.get("load") ?? []) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
  }
}

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

const installTextureLoaders = () => {
  const fetchRequests: FetchRequest[] = [];
  const bitmapRequests: BitmapRequest[] = [];

  vi.stubGlobal("Image", ControlledImage);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve, reject) => {
    fetchRequests.push({ reject, resolve, url: requestUrl(input) });
  })));
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise<ImageBitmap>((resolve, reject) => {
    bitmapRequests.push({ reject, resolve });
  })));

  return { bitmapRequests, fetchRequests };
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

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const flushAnimationFrames = async (frames: FrameRequestCallback[]): Promise<void> => {
  const queued = frames.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
  await flushMicrotasks();
};

const settleTextureLoads = async (
  loader: ReturnType<typeof installTextureLoaders>,
  frames: FrameRequestCallback[],
): Promise<void> => {
  for (const image of ControlledImage.instances) image.settleLoad();
  for (const request of loader.fetchRequests.splice(0)) request.resolve(fakeImageResponse(request.url));
  await flushMicrotasks();
  for (const request of loader.bitmapRequests.splice(0)) request.resolve(fakeImageBitmap());
  await flushMicrotasks();
  await flushAnimationFrames(frames);
};

const requestedUrls = (loader: ReturnType<typeof installTextureLoaders>): readonly string[] => [
  ...ControlledImage.instances.map((image) => image.src),
  ...loader.fetchRequests.map((request) => request.url),
];

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

const singleMeshScene = (
  material: Material,
  geometry: Geometry = boxGeometry(1),
) => scene({
  camera: camera(),
  nodes: [mesh({ geometry, material })],
  clearColor: [0, 0, 0, 0],
});

const twoMeshScene = (left: Material, right: Material) => scene({
  camera: camera(),
  nodes: [
        mesh({
          geometry: boxGeometry(1),
          material: left,
          transform: { position: [-0.4, 0, 0], rotation: [0, 0, 0] },
        }),
        mesh({
          geometry: boxGeometry(1),
          material: right,
          transform: { position: [0.4, 0, 0], rotation: [0, 0, 0] },
        }),
  ],
  clearColor: [0, 0, 0, 0],
});

const callsNamed = (calls: readonly GlCall[], name: string): readonly GlCall[] =>
  calls.filter((call) => call.name === name);

const countCalls = (calls: readonly GlCall[], name: string): number =>
  callsNamed(calls, name).length;

const drawCallIndices = (calls: readonly GlCall[]): readonly number[] =>
  calls.flatMap((call, index) =>
    call.name === "drawArrays" || call.name === "drawElements" ? [index] : []);

const texParameterTriples = (calls: readonly GlCall[]): readonly (readonly unknown[])[] =>
  callsNamed(calls, "texParameteri").map((call) => call.args.slice(0, 3));

const textureUploadInternalFormats = (calls: readonly GlCall[]): readonly unknown[] =>
  callsNamed(calls, "texImage2D")
    .filter((call) => call.args[0] === 0x0DE1)
    .map((call) => call.args[2]);

const hasSafeUvCleanupBeforeDraw = (calls: readonly GlCall[], start: number, end: number): boolean => {
  const betweenDraws = calls.slice(start + 1, end);

  if (betweenDraws.some((call) =>
    call.name === "bindVertexArray" && call.args[0] !== null && call.args[0] !== undefined)) return true;

  return uvLocations.every((location) => betweenDraws.some((call) =>
    (call.name === "disableVertexAttribArray" || call.name === "vertexAttribPointer")
    && call.args[0] === location));
};

const missingCapabilityText = (value: unknown): readonly string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value !== "object") return [];

  return Object.values(value as Record<string, unknown>).flatMap(missingCapabilityText);
};

const isRendererCapabilityRow = (
  row: RendererCapabilityProbeRow,
): row is Extract<RendererCapabilityProbeRow, { readonly kind: "renderer_capability" }> =>
  row.kind === "renderer_capability";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
});

describe("WebGL renderer state and capability regressions", () => {
  it("keeps texture cache identity distinct for matching contentKey/version with different sampler or colorSpace", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const frames = installAnimationFrameQueue();
    const loader = installTextureLoaders();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const textureCreatesBefore = countCalls(calls, "createTexture");
    const textureUploadsBefore = countCalls(calls, "texImage2D");
    const sharedSource = "/textures/shared-albedo.png";
    const sharedContentKey = "sha256:shared-albedo";
    const nearestSrgb = unlitMaterial({
      texture: textureAsset({
        colorSpace: "srgb",
        contentKey: sharedContentKey,
        sampler: {
          magFilter: "nearest",
          minFilter: "nearest",
          wrapS: "repeat",
          wrapT: "repeat",
        },
        src: sharedSource,
        version: "same-version",
      }),
    });
    const linearLinear = unlitMaterial({
      texture: textureAsset({
        colorSpace: "linear",
        contentKey: sharedContentKey,
        sampler: {
          magFilter: "linear",
          minFilter: "linear",
          wrapS: "clamp-to-edge",
          wrapT: "clamp-to-edge",
        },
        src: sharedSource,
        version: "same-version",
      }),
    });

    root.render(twoMeshScene(nearestSrgb, linearLinear));
    await settleTextureLoads(loader, frames);
    await flushAnimationFrames(frames);

    expect(
      requestedUrls(loader).filter((url) => url.includes(sharedSource)),
      "upload variants should share one decoded source job",
    ).toHaveLength(1);
    expect(
      countCalls(calls, "createTexture") - textureCreatesBefore,
      "different sampler/colorSpace descriptors need separate texture resources",
    ).toBe(2);
    expect(
      countCalls(calls, "texImage2D") - textureUploadsBefore,
      "both texture descriptors should upload their image data",
    ).toBe(2);
    expect(textureUploadInternalFormats(calls)).toEqual(expect.arrayContaining([gl.SRGB8_ALPHA8, gl.RGBA]));
    expect(calls).toContainEqual({
      args: [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0],
      name: "pixelStorei",
    });
    expect(texParameterTriples(calls)).toEqual(expect.arrayContaining([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT],
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    ]));
  });

  it("shares texture resources for matching content keys across different source URLs", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const frames = installAnimationFrameQueue();
    const loader = installTextureLoaders();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const textureCreatesBefore = countCalls(calls, "createTexture");
    const textureUploadsBefore = countCalls(calls, "texImage2D");
    const sharedContentKey = "sha256:shared-content";
    const sampler = {
      magFilter: "linear" as const,
      minFilter: "linear" as const,
      wrapS: "clamp-to-edge" as const,
      wrapT: "clamp-to-edge" as const,
    };
    const leftSource = "/textures/content-a.png";
    const rightSource = "/textures/content-b.png";
    const left = unlitMaterial({
      texture: textureAsset({
        colorSpace: "srgb",
        contentKey: sharedContentKey,
        sampler,
        src: leftSource,
        version: "same-version",
      }),
    });
    const right = unlitMaterial({
      texture: textureAsset({
        colorSpace: "srgb",
        contentKey: sharedContentKey,
        sampler,
        src: rightSource,
        version: "same-version",
      }),
    });

    root.render(twoMeshScene(left, right));
    await settleTextureLoads(loader, frames);

    expect(requestedUrls(loader).filter((url) => url === leftSource || url === rightSource)).toEqual([leftSource]);
    expect(countCalls(calls, "createTexture") - textureCreatesBefore).toBe(1);
    expect(countCalls(calls, "texImage2D") - textureUploadsBefore).toBe(1);
    expect(textureUploadInternalFormats(calls)).toEqual(expect.arrayContaining([gl.SRGB8_ALPHA8]));
  });

  it("clears or safely rebinds stale UV attributes before drawing no-UV wireframe geometry", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installTextureLoaders();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(singleMeshScene(unlitMaterial({
      texture: imageTexture("/textures/uv-grid.png"),
    })));
    expect(calls).toContainEqual(expect.objectContaining({
      args: expect.arrayContaining([uvLocations[0]]),
      name: "enableVertexAttribArray",
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      args: expect.arrayContaining([uvLocations[1]]),
      name: "disableVertexAttribArray",
    }));

    root.render(singleMeshScene(wireframeMaterial({ color: [1, 1, 1, 1] }), boxGeometry(1)));
    const draws = drawCallIndices(calls);
    const firstDraw = draws[0];
    const secondDraw = draws[1];

    expect(firstDraw).toBeDefined();
    expect(secondDraw).toBeDefined();
    expect(
      hasSafeUvCleanupBeforeDraw(calls, firstDraw ?? 0, secondDraw ?? calls.length),
      "wireframe/no-UV draws should reset both raw UV sets or switch to isolated VAO state before drawing",
    ).toBe(true);
  });

  it("keeps probed capability diagnostics or details for missing optional WebGL capability gates", () => {
    const gl: WebGlCapabilityProbeContext = {
      COMPRESSED_TEXTURE_FORMATS: 0x86A3,
      MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
      MAX_TEXTURE_IMAGE_UNITS: 0x8872,
      MAX_TEXTURE_SIZE: 0x0D33,
      RENDERER: 0x1F01,
      SHADING_LANGUAGE_VERSION: 0x8B8C,
      VENDOR: 0x1F00,
      VERSION: 0x1F02,
      getExtension: () => null,
      getParameter: (parameter: number) => {
        switch (parameter) {
          case 0x1F02:
            return "WebGL 2.0 Royal missing capability test";
          case 0x1F01:
            return "Royal fake renderer";
          case 0x8B8C:
            return "WebGL GLSL ES 3.00 Royal";
          case 0x1F00:
            return "Royal tests";
          case 0x0D33:
            return 4096;
          case 0x8872:
            return 8;
          case 0x8B4D:
            return 16;
          case 0x86A3:
            return new Uint32Array();
          default:
            return undefined;
        }
      },
      getSupportedExtensions: () => [],
    };

    const result = probeWebGlCapabilities(gl);
    const rendererRows = result.rows.filter(isRendererCapabilityRow);
    const coreNames = rendererRows
      .filter((row) => row.supported && row.source === "webgl2-core")
      .map((row) => row.capability);
    const missingRows = result.rows.filter(isRendererCapabilityRow).filter((row) =>
      !row.supported
      && row.source === "missing");
    const missingNames = missingRows.map((row) => row.capability);
    const detailOrDiagnosticText = [
      ...missingRows.flatMap((row) => missingCapabilityText(row.detail)),
      ...result.diagnostics.flatMap(missingCapabilityText),
    ].join("\n");

    expect(missingNames).toEqual(expect.arrayContaining([
      "anisotropy",
      "compressed_texture",
      "lose_context",
    ]));
    expect(coreNames).toEqual(expect.arrayContaining([
      "float_texture",
      "half_float_texture",
    ]));
    expect(detailOrDiagnosticText).toMatch(/anisotropy|compressed_texture|lose_context/i);
  });
});
