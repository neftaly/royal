import { afterEach, beforeEach, vi } from "vitest";
import {
  directionalLight,
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
  type Material,
} from "@royal/renderer-core";
import {
  createWebGlRoot as createRendererWebGlRoot,
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "@royal/renderer-webgl";
import type { SurfaceMaterial } from "../packages/renderer-webgl/src/webgl/materials";

type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

export type FakeCanvas = HTMLCanvasElement & {
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): Event;
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly args: readonly unknown[];
  readonly name: string;
  readonly result?: unknown;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type FetchRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: Response) => void;
  readonly signal?: AbortSignal;
  readonly url: string;
};

const createdRoots = new Set<ReturnType<typeof createRendererWebGlRoot>>();

export const createWebGlRoot = (
  ...args: Parameters<typeof createRendererWebGlRoot>
): ReturnType<typeof createRendererWebGlRoot> => {
  const root = createRendererWebGlRoot(...args);
  createdRoots.add(root);
  return root;
};

export const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  size: CanvasSize = { height: 128, width: 128 },
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
    dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored") {
      const event = new Event(type, { cancelable: true });
      target.dispatchEvent(event);
      return event;
    },
    height: 0,
    removeEventListener: target.removeEventListener.bind(target),
    width: 0,
  };

  if (gl !== null) {
    (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;
  }

  return canvas as unknown as FakeCanvas;
};

export const fakeGl = (options: {
  readonly atlasUploadFailure?: { enabled: boolean };
  readonly beforeUniform1i?: (name: string) => void;
  readonly maxTextureImageUnits?: number;
  readonly maxTextureSize?: number;
  readonly pageTableUploadFailure?: { enabled: boolean; error?: unknown };
} = {}): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniforms = new Map<string, WebGLUniformLocation>();
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
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
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    NEAREST_MIPMAP_NEAREST: 0x2700,
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
    const capturedArgs = args.map((arg) => arg instanceof Uint8Array ? arg.slice() : arg) as unknown as Arguments;
    calls.push(result === undefined ? { args: capturedArgs, name } : { args: capturedArgs, name, result });
    return result;
  });

  const glTarget = {
    ...constants,
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
    deleteBuffer: record("deleteBuffer"),
    deleteFramebuffer: record("deleteFramebuffer"),
    deleteProgram: record("deleteProgram"),
    deleteRenderbuffer: record("deleteRenderbuffer"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    detachShader: record("detachShader"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    framebufferRenderbuffer: record("framebufferRenderbuffer"),
    framebufferTexture2D: record("framebufferTexture2D"),
    generateMipmap: record("generateMipmap"),
    checkFramebufferStatus: record("checkFramebufferStatus", () => constants.FRAMEBUFFER_COMPLETE),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("normal")) return 1;
      if (normalized.includes("uv")) return 2;
      return 0;
    }),
    getContextAttributes: record("getContextAttributes", () => ({ alpha: true, antialias: true })),
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    getParameter: record<[number]>("getParameter", (parameter) => {
      if (parameter === constants.MAX_TEXTURE_IMAGE_UNITS) return options.maxTextureImageUnits ?? 8;
      if (parameter === constants.MAX_TEXTURE_SIZE) return options.maxTextureSize ?? 4096;
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
      parameter === constants.COMPILE_STATUS),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniform(name)),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    renderbufferStorage: record("renderbufferStorage"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    texSubImage2D: record<readonly unknown[]>("texSubImage2D", (...args) => {
      const payload = args[8];
      const pageTableUpload = ArrayBuffer.isView(payload) && !(payload instanceof DataView);
      if (pageTableUpload && options.pageTableUploadFailure?.enabled === true) {
        throw "error" in options.pageTableUploadFailure
          ? options.pageTableUploadFailure.error
          : new Error("page table upload failure");
      }
      if (!pageTableUpload && options.atlasUploadFailure?.enabled === true) {
        throw new Error("atlas upload failure");
      }
    }),
    uniform1f: record("uniform1f"),
    uniform1i: record<readonly [WebGLUniformLocation, number]>("uniform1i", (location) => {
      const name = (location as unknown as { readonly name?: unknown }).name;
      if (typeof name === "string") options.beforeUniform1i?.(name);
    }),
    uniform2f: record("uniform2f"),
    uniform2fv: record("uniform2fv"),
    uniform3fv: record("uniform3fv"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    vertexAttrib4f: record("vertexAttrib4f"),
    vertexAttribDivisor: record("vertexAttribDivisor"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  };

  return {
    calls,
    gl: glTarget as unknown as WebGL2RenderingContext,
  };
};

export class ControlledImage {
  static readonly instances: ControlledImage[] = [];
  static closeCalls = 0;
  static closeError: unknown;

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

  close(): void {
    ControlledImage.closeCalls += 1;
    if (ControlledImage.closeError !== undefined) throw ControlledImage.closeError;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  settleLoad(): void {
    this.complete = true;
    this.onload?.call(this as unknown as HTMLImageElement, new Event("load"));
    for (const listener of this.#listeners.get("load") ?? []) {
      if (typeof listener === "function") {
        listener.call(this, new Event("load"));
      } else {
        listener.handleEvent(new Event("load"));
      }
    }
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
  }

  settleError(): void {
    this.onerror?.call(this as unknown as HTMLImageElement, new Event("error"));
    for (const listener of this.#listeners.get("error") ?? []) {
      if (typeof listener === "function") {
        listener.call(this, new Event("error"));
      } else {
        listener.handleEvent(new Event("error"));
      }
    }
  }
}

export const installFetchQueue = (): FetchRequest[] => {
  const requests: FetchRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({
      reject,
      resolve,
      ...(init?.signal === undefined || init.signal === null ? {} : { signal: init.signal }),
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input),
    });
  })));
  return requests;
};

export const installCanvas2d = (): {
  readonly canvases: Array<{
    height: number;
    readonly getContext: ReturnType<typeof vi.fn>;
    width: number;
  }>;
  readonly contexts: Array<{
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    putImageData: ReturnType<typeof vi.fn>;
  }>;
} => {
  const canvases: Array<{
    height: number;
    readonly getContext: ReturnType<typeof vi.fn>;
    width: number;
  }> = [];
  const contexts: Array<{
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    putImageData: ReturnType<typeof vi.fn>;
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
      const canvas = {
        height: 0,
        getContext: vi.fn((kind: string) => kind === "2d" ? context : null),
        width: 0,
      };
      contexts.push(context);
      canvases.push(canvas);
      return canvas;
    }),
  });

  return { canvases, contexts };
};

export const responseJson = (body: unknown): Response => ({
  json: vi.fn(() => Promise.resolve(body)),
  ok: true,
  status: 200,
  statusText: "OK",
}) as unknown as Response;

export const responseText = (url: string, text: string): Response => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(() => Promise.resolve(text)),
  url,
}) as unknown as Response;

export const camera = (positionX = 0) => orthographicCamera({
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [positionX, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

export const renderScene = (
  material: Material,
  options: {
    readonly exposureEv100?: number;
    readonly cameraX?: number;
    readonly planeSize?: readonly [number, number];
    readonly toneMapping?: "aces-fitted" | "linear-clamp" | "pbr-neutral";
  } = {},
) => scene({
  camera: camera(options.cameraX),
  nodes: [
    ...(material.kind === "standard"
      ? [directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      })]
      : []),
    mesh({
      geometry: planeGeometry(options.planeSize ?? [2, 2]),
      material,
    }),
  ],
  clearColor: [0, 0, 0, 0],
  ...(options.exposureEv100 === undefined ? {} : { exposureEv100: options.exposureEv100 }),
  ...(options.toneMapping === undefined ? {} : { toneMapping: options.toneMapping }),
});

export const renderVirtualTextureMaterials = (materials: readonly Material[]) => scene({
  camera: camera(),
  nodes: materials.map((material) => mesh({ geometry: planeGeometry([1, 1]), material })),
  clearColor: [0, 0, 0, 0],
});

export const renderGeometryPressure = (material: Material, extraCount: number) => scene({
  camera: camera(),
  nodes: Array.from({ length: extraCount + 1 }, (_value, index) => mesh({
    geometry: planeGeometry([1 + index / 100, 1]),
    material: index === 0 ? material : unlitMaterial({ color: [1, 1, 1, 1] }),
  })),
  clearColor: [0, 0, 0, 0],
});

export const renderOrdinaryTexturePressure = (vtMaterial: Material, pressureMaterial: Material) => scene({
  camera: camera(),
  nodes: [
    mesh({ geometry: planeGeometry([1.5, 1]), material: pressureMaterial }),
    mesh({ geometry: planeGeometry([1, 1]), material: vtMaterial }),
  ],
  clearColor: [0, 0, 0, 0],
});

export const vtManifest = (physicalSlots = 2) => ({
  contractVersion: 1,
  pageSize: 4,
  pages: {
    entries: [0, 1, 2].map((x) => ({ mip: 0, uri: `pages/${x}-0.png`, x, y: 0 })),
  },
  physicalSlots,
  virtualSize: [12, 4],
});

export const vtSinglePageManifest = () => ({
  contractVersion: 1,
  pageSize: 4,
  pages: {
    entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }],
  },
  physicalSlots: 1,
  virtualSize: [4, 4],
});

export const constrainedPolicy = (
  limits: Partial<ResourceGovernorPolicy["limits"]>,
): ResourceGovernorPolicy => {
  const persistentGpuBytes = limits.persistentGpuBytes
    ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.persistentGpuBytes;
  const cpuDecodedBytes = limits.cpuDecodedBytes
    ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.cpuDecodedBytes;
  const classPolicy = () => ({
    cpuDecodedBytes: { mandatoryFloor: 0, softLimit: cpuDecodedBytes },
    persistentGpuBytes: { mandatoryFloor: 0, softLimit: persistentGpuBytes },
  });
  return {
    classes: {
      "asset-decode": classPolicy(),
      geometry: classPolicy(),
      "ordinary-texture": classPolicy(),
      "render-target": classPolicy(),
      "virtual-texture": classPolicy(),
    },
    limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, ...limits },
  };
};

export const vtPersistentGpuHardLimitPolicy = (hardLimit: number): ResourceGovernorPolicy => {
  const base = constrainedPolicy({});
  return {
    ...base,
    classes: {
      ...base.classes,
      "virtual-texture": {
        ...base.classes["virtual-texture"],
        persistentGpuBytes: { hardLimit, mandatoryFloor: 0, softLimit: hardLimit },
      },
    },
  };
};

export const vtParentFallbackManifest = (physicalSlots = 3) => ({
  contractVersion: 1,
  mipCount: 2,
  pageSize: 4,
  pages: {
    entries: [
      { mip: 1, uri: "pages/m1-0-0.png", x: 0, y: 0 },
      ...[0, 1, 2].map((x) => ({ mip: 0, uri: `pages/m0-${x}-0.png`, x, y: 0 })),
    ],
  },
  physicalSlots,
  virtualSize: [12, 4],
});

export const vtStereoManifest = () => ({
  contractVersion: 1,
  mipCount: 3,
  pageSize: 4,
  pages: {
    entries: [
      { mip: 2, uri: "pages/m2-0-0.png", x: 0, y: 0 },
      { mip: 0, uri: "pages/m0-0-0.png", x: 0, y: 0 },
      { mip: 0, uri: "pages/m0-3-0.png", x: 3, y: 0 },
    ],
  },
  physicalSlots: 3,
  virtualSize: [16, 4],
});

export const stereoVirtualTextureMaterial = (
  texture: ReturnType<typeof virtualTexture>,
  offsetU: number,
): SurfaceMaterial => ({
  ...unlitMaterial({ texture }),
  textureCoordinates: {
    baseColorTexture: {
      row0: [0.25, 0, offsetU, 0],
      row1: [0, 1, 0, 0],
      set: 0,
    },
  },
});

export const stereoVirtualTextureScene = (texture: ReturnType<typeof virtualTexture>) =>
  scene({
    camera: camera(),
    clearColor: [0, 0, 0, 0],
    nodes: [
      mesh({
        geometry: planeGeometry([1, 2]),
        material: stereoVirtualTextureMaterial(texture, 0),
        transform: { position: [-2, 0, 0], rotation: [0, 0, 0] },
      }),
      mesh({
        geometry: planeGeometry([1, 2]),
        material: stereoVirtualTextureMaterial(texture, 0.75),
        transform: { position: [2, 0, 0], rotation: [0, 0, 0] },
      }),
    ],
  });

const stereoView = (translationX: number, viewportX: number) => ({
  projectionMatrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as const,
  viewMatrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    translationX, 0, 0, 1,
  ] as const,
  viewport: { height: 128, width: 128, x: viewportX, y: 0 },
});

export const leftStereoView = () => stereoView(2, 0);
export const rightStereoView = () => stereoView(-2, 128);

export const vtDenseMipManifest = (physicalSlots = 4) => ({
  contractVersion: 1,
  mipCount: 5,
  pageSize: 4,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots,
  virtualSize: [64, 64],
});

export const vtZoomCycleManifest = () => ({
  contractVersion: 1,
  mipCount: 4,
  pageSize: 256,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots: 3,
  virtualSize: [2048, 2048],
});

export const vtTerrainManifest = () => ({
  contractVersion: 1,
  mipCount: 4,
  pageSize: 512,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots: 24,
  virtualSize: [4096, 4096],
});

export const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

export const flushVirtualTextureManifest = async (
  root: ReturnType<typeof createRendererWebGlRoot>,
): Promise<void> => {
  await flushMicrotasks();
  root.flushInvalidated();
  await flushMicrotasks();
};

export const textureAllocations = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" && call.args.length >= 9);

export const textureDataUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" || call.name === "texSubImage2D");

export const textureResourceBinds = (calls: readonly GlCall[], textureTarget: number): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "bindTexture"
    && call.args[0] === textureTarget
    && call.args[1] !== null
    && call.args[1] !== undefined);

export const pageUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && !ArrayBuffer.isView(call.args.at(-1)));

export const pageTableUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && ArrayBuffer.isView(call.args[8])
    && !(call.args[8] instanceof DataView));

export const texParameterTriples = (calls: readonly GlCall[]): readonly (readonly unknown[])[] =>
  calls
    .filter((call) => call.name === "texParameteri")
    .map((call) => call.args.slice(0, 3));

export const texParameterGroups = (calls: readonly GlCall[]): readonly (readonly (readonly unknown[])[])[] => {
  const triples = texParameterTriples(calls)
    .filter((triple) => triple[0] === 0x0DE1);
  const groups: Array<readonly (readonly unknown[])[]> = [];
  for (let index = 0; index < triples.length; index += 4) {
    groups.push(triples.slice(index, index + 4));
  }
  return groups;
};

const uploadPayload = (call: GlCall): readonly number[] => {
  const payload = call.args[8];
  return ArrayBuffer.isView(payload) && !(payload instanceof DataView)
    ? Array.from(payload as Uint8Array)
    : [];
};

export const pageTableUploadSummary = (call: GlCall): readonly unknown[] => [
  call.args[2],
  call.args[3],
  call.args[4],
  call.args[5],
  uploadPayload(call),
];

export const imageBySrc = (fragment: string): ControlledImage | undefined =>
  ControlledImage.instances.find((image) => image.src.includes(fragment));

export const settleIncompleteImages = async (size = 4): Promise<void> => {
  for (const image of ControlledImage.instances) {
    if (!image.complete) {
      image.naturalHeight = size;
      image.height = size;
      image.naturalWidth = size;
      image.width = size;
      image.settleLoad();
    }
  }
  await flushMicrotasks();
};

export const uniformNames = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "getUniformLocation")
    .map((call) => String(call.args[1]));

export const namedUniform1iValues = (calls: readonly GlCall[]): Record<string, number[]> => {
  const values: Record<string, number[]> = {};
  for (const call of calls) {
    if (call.name !== "uniform1i") continue;
    const location = call.args[0] as { readonly name?: unknown };
    if (typeof location.name !== "string") continue;
    values[location.name] = [...(values[location.name] ?? []), Number(call.args[1])];
  }
  return values;
};

export const namedUniform4fvValues = (calls: readonly GlCall[]): Record<string, number[][]> => {
  const values: Record<string, number[][]> = {};
  for (const call of calls) {
    if (call.name !== "uniform4fv") continue;
    const location = call.args[0] as { readonly name?: unknown };
    if (typeof location.name !== "string") continue;
    const payload = call.args[1];
    const vector = Array.isArray(payload) || ArrayBuffer.isView(payload)
      ? Array.from(payload as ArrayLike<number>, Number)
      : [];
    values[location.name] = [...(values[location.name] ?? []), vector];
  }
  return values;
};

beforeEach(() => {
  // Each root chooses its scheduling fallback from the ambient function at
  // construction time. Do not let a prior test's non-calling rAF stub suppress
  // the microtask fallback in a later test that did not opt into that stub.
  vi.stubGlobal("requestAnimationFrame", undefined);
});

afterEach(() => {
  ControlledImage.closeError = undefined;
  for (const root of createdRoots) root.dispose();
  createdRoots.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
  ControlledImage.closeCalls = 0;
});
