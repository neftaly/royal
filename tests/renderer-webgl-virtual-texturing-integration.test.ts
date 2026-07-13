import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  directionalLight,
  imageTexture,
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  standardMaterial,
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
import {
  VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS,
  VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
} from "../packages/renderer-webgl/src/virtual-texture-runtime";

type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

type FakeCanvas = HTMLCanvasElement & {
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

const createWebGlRoot = (
  ...args: Parameters<typeof createRendererWebGlRoot>
): ReturnType<typeof createRendererWebGlRoot> => {
  const root = createRendererWebGlRoot(...args);
  createdRoots.add(root);
  return root;
};

const fakeCanvas = (
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

const fakeGl = (options: {
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
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
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
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
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
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendEquationSeparate: record("blendEquationSeparate"),
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
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
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    detachShader: record("detachShader"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    generateMipmap: record("generateMipmap"),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("normal")) return 1;
      if (normalized.includes("uv")) return 2;
      return 0;
    }),
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

class ControlledImage {
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

const installFetchQueue = (): FetchRequest[] => {
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

const installCanvas2d = (): {
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

const responseJson = (body: unknown): Response => ({
  json: vi.fn(() => Promise.resolve(body)),
  ok: true,
  status: 200,
  statusText: "OK",
}) as unknown as Response;

const responseText = (url: string, text: string): Response => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(() => Promise.resolve(text)),
  url,
}) as unknown as Response;

const camera = (positionX = 0) => orthographicCamera({
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [positionX, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

const renderScene = (
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
    directionalLight({
      color: [1, 1, 1, 1],
      direction: [0, 0, -1],
    }),
    mesh({
      geometry: planeGeometry(options.planeSize ?? [2, 2]),
      material,
    }),
  ],
  clearColor: [0, 0, 0, 0],
  ...(options.exposureEv100 === undefined ? {} : { exposureEv100: options.exposureEv100 }),
  ...(options.toneMapping === undefined ? {} : { toneMapping: options.toneMapping }),
});

const renderVirtualTextureMaterials = (materials: readonly Material[]) => scene({
  camera: camera(),
  nodes: materials.map((material) => mesh({ geometry: planeGeometry([1, 1]), material })),
  clearColor: [0, 0, 0, 0],
});

const renderGeometryPressure = (material: Material, extraCount: number) => scene({
  camera: camera(),
  nodes: Array.from({ length: extraCount + 1 }, (_value, index) => mesh({
    geometry: planeGeometry([1 + index / 100, 1]),
    material: index === 0 ? material : unlitMaterial({ color: [1, 1, 1, 1] }),
  })),
  clearColor: [0, 0, 0, 0],
});

const renderOrdinaryTexturePressure = (vtMaterial: Material, pressureMaterial: Material) => scene({
  camera: camera(),
  nodes: [
    mesh({ geometry: planeGeometry([1.5, 1]), material: pressureMaterial }),
    mesh({ geometry: planeGeometry([1, 1]), material: vtMaterial }),
  ],
  clearColor: [0, 0, 0, 0],
});

const vtManifest = (physicalSlots = 2) => ({
  contractVersion: 1,
  pageSize: 4,
  pages: {
    entries: [0, 1, 2].map((x) => ({ mip: 0, uri: `pages/${x}-0.png`, x, y: 0 })),
  },
  physicalSlots,
  virtualSize: [12, 4],
});

const vtSinglePageManifest = () => ({
  contractVersion: 1,
  pageSize: 4,
  pages: {
    entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }],
  },
  physicalSlots: 1,
  virtualSize: [4, 4],
});

const constrainedPolicy = (
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

const vtPersistentGpuHardLimitPolicy = (hardLimit: number): ResourceGovernorPolicy => {
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

const vtParentFallbackManifest = (physicalSlots = 3) => ({
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

const vtStereoManifest = () => ({
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

const stereoVirtualTextureMaterial = (
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

const stereoVirtualTextureScene = (texture: ReturnType<typeof virtualTexture>) =>
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

const leftStereoView = () => stereoView(2, 0);
const rightStereoView = () => stereoView(-2, 128);

const vtDenseMipManifest = (physicalSlots = 4) => ({
  contractVersion: 1,
  mipCount: 5,
  pageSize: 4,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots,
  virtualSize: [64, 64],
});

const vtZoomCycleManifest = () => ({
  contractVersion: 1,
  mipCount: 4,
  pageSize: 256,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots: 3,
  virtualSize: [2048, 2048],
});

const vtTerrainManifest = () => ({
  contractVersion: 1,
  mipCount: 4,
  pageSize: 512,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots: 24,
  virtualSize: [4096, 4096],
});

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const textureAllocations = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" && call.args.length >= 9);

const textureDataUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" || call.name === "texSubImage2D");

const textureResourceBinds = (calls: readonly GlCall[], textureTarget: number): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "bindTexture"
    && call.args[0] === textureTarget
    && call.args[1] !== null
    && call.args[1] !== undefined);

const pageUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && !ArrayBuffer.isView(call.args.at(-1)));

const pageTableUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && ArrayBuffer.isView(call.args[8])
    && !(call.args[8] instanceof DataView));

const texParameterTriples = (calls: readonly GlCall[]): readonly (readonly unknown[])[] =>
  calls
    .filter((call) => call.name === "texParameteri")
    .map((call) => call.args.slice(0, 3));

const texParameterGroups = (calls: readonly GlCall[]): readonly (readonly (readonly unknown[])[])[] => {
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

const pageTableUploadSummary = (call: GlCall): readonly unknown[] => [
  call.args[2],
  call.args[3],
  call.args[4],
  call.args[5],
  uploadPayload(call),
];

const imageBySrc = (fragment: string): ControlledImage | undefined =>
  ControlledImage.instances.find((image) => image.src.includes(fragment));

const settleIncompleteImages = async (size = 4): Promise<void> => {
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

const uniformNames = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "getUniformLocation")
    .map((call) => String(call.args[1]));

const namedUniform1iValues = (calls: readonly GlCall[]): Record<string, number[]> => {
  const values: Record<string, number[]> = {};
  for (const call of calls) {
    if (call.name !== "uniform1i") continue;
    const location = call.args[0] as { readonly name?: unknown };
    if (typeof location.name !== "string") continue;
    values[location.name] = [...(values[location.name] ?? []), Number(call.args[1])];
  }
  return values;
};

const namedUniform4fvValues = (calls: readonly GlCall[]): Record<string, number[][]> => {
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

describe("WebGL renderer virtual texturing integration", () => {
  it("does not let a pending high-priority material texture suppress a ready lower-priority map", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));
    const material: SurfaceMaterial = {
      ...standardMaterial({ color: [1, 1, 1, 1] }),
      emissiveTexture: imageTexture("/textures/pending-emissive.png"),
      metallicRoughnessTexture: imageTexture("/textures/ready-metallic-roughness.png"),
    };
    const graph = renderScene(material);

    root.render(graph);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/textures/pending-emissive.png",
      "/textures/ready-metallic-roughness.png",
    ]);
    imageBySrc("ready-metallic-roughness")!.settleLoad();
    await flushMicrotasks();

    root.render(graph);
    const uniforms = namedUniform1iValues(calls);

    expect(imageBySrc("pending-emissive")?.complete).toBe(false);
    expect(uniforms.u_useMetallicRoughnessTexture).toContain(1);
    expect(uniforms.u_metallicRoughnessTexture).toContain(0);
  });

  it("keeps an intrinsically oversized decoded page terminal without fetching it", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({ cpuDecodedBytes: 63 }),
    });
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/cpu-impossible.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(0);
    const denied = root.snapshot().resourceGovernor.denials;

    root.render(graph);
    root.render(graph);
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().resourceGovernor.denials).toBe(denied);
    expect(root.snapshot().diagnostics.join("\n")).toContain("requires 64 decoded CPU bytes");
    root.dispose();
  });

  it("wakes a CPU-capacity-blocked page without fetching it before capacity releases", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({ cpuDecodedBytes: 64 }),
    });
    const materials = ["first", "second"].map((name) =>
      unlitMaterial({ texture: virtualTexture(`/vt/cpu-${name}.json`) }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);

    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(2);
    expect(root.snapshot().resourceGovernor.denialsByReason["cpu-decoded-capacity"])
      .toBeGreaterThan(0);
    root.dispose();
  });

  it("retries governed VT admission after cross-class geometry capacity is released", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const probe = createWebGlRoot(fakeCanvas(fakeGl().gl));
    probe.render(renderGeometryPressure(unlitMaterial({ color: [1, 1, 1, 1] }), 12));
    const geometryBytes = probe.snapshot().resourceGovernor.byClass.geometry.persistentGpuBytes;
    probe.dispose();

    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({ persistentGpuBytes: geometryBytes + 67 }),
    });
    const vtMaterial = unlitMaterial({ texture: virtualTexture("/vt/geometry-release.json") });
    root.render(renderGeometryPressure(vtMaterial, 12));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, gpuAdmissionFailures: 1 });

    root.render(renderGeometryPressure(vtMaterial, 0));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1 });
    root.dispose();
  });

  it("retries governed VT admission after an ordinary texture releases GPU capacity", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const ordinaryMaterial = unlitMaterial({ texture: imageTexture("/ordinary-pressure.png") });
    const plainMaterial = unlitMaterial({ color: [1, 1, 1, 1] });
    const probe = createWebGlRoot(fakeCanvas(fakeGl().gl));
    probe.render(renderOrdinaryTexturePressure(plainMaterial, ordinaryMaterial));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    probe.render(renderOrdinaryTexturePressure(plainMaterial, ordinaryMaterial));
    const probeGovernor = probe.snapshot().resourceGovernor;
    const geometryBytes = probeGovernor.byClass.geometry.persistentGpuBytes;
    const ordinaryBytes = probeGovernor.byClass["ordinary-texture"].persistentGpuBytes;
    expect(ordinaryBytes).toBeGreaterThan(0);
    probe.dispose();

    const fetchRequests = installFetchQueue();
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl), {
      resourceGovernorPolicy: constrainedPolicy({
        persistentGpuBytes: geometryBytes + ordinaryBytes + 67,
      }),
    });
    const vtMaterial = unlitMaterial({ texture: virtualTexture("/vt/ordinary-release.json") });
    root.render(renderOrdinaryTexturePressure(vtMaterial, ordinaryMaterial));
    await flushMicrotasks();
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    root.render(renderOrdinaryTexturePressure(vtMaterial, ordinaryMaterial));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, gpuAdmissionFailures: 1 });

    root.render(renderOrdinaryTexturePressure(vtMaterial, plainMaterial));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1 });
    root.dispose();
  });

  it("admits a sparse explicit VT using its exact reachable page-table update bound", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({
        persistentGpuBytes: 8 * 1024 * 1024,
        uploadBytes: 1_024,
      }),
    });

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/sparse.json") })));
    const textureCreatesBeforeManifest = calls.filter(({ name }) => name === "createTexture").length;
    fetchRequests[0]!.resolve(responseJson({
      contractVersion: 1,
      pageSize: 4,
      pages: { entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }] },
      physicalSlots: 1,
      virtualSize: [4_096, 4_096],
    }));
    await flushMicrotasks();

    expect(calls.filter(({ name }) => name === "createTexture")).toHaveLength(
      textureCreatesBeforeManifest + 2,
    );
    expect(ControlledImage.instances).toHaveLength(1);
    expect(root.snapshot().diagnostics.join("\n")).not.toMatch(/configured per-frame upload limit/);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1, gpuAdmissionFailures: 0 });
    root.dispose();
  });

  it.each([
    {
      expected: /page or page-table upload requires up to 262144 bytes.*upload limit 1024/,
      label: "upload",
      policy: constrainedPolicy({ uploadBytes: 1_024 }),
    },
    {
      expected: /resource allocation requires 262148 persistent GPU bytes.*limit 65536/,
      label: "persistent GPU",
      policy: constrainedPolicy({ persistentGpuBytes: 64 * 1024 }),
    },
    {
      expected: /resource allocation requires 262148 persistent GPU bytes.*limit 65536/,
      label: "mandatory-floor",
      policy: (() => {
        const policy = constrainedPolicy({});
        const maximum = 64 * 1024;
        const floor = policy.limits.persistentGpuBytes - maximum;
        return {
          ...policy,
          classes: {
            ...policy.classes,
            geometry: {
              ...policy.classes.geometry,
              persistentGpuBytes: { mandatoryFloor: floor, softLimit: floor },
            },
          },
        };
      })(),
    },
  ])("terminally rejects a VT exceeding a small mobile $label limit without a wake loop", async ({
    expected,
    policy,
  }) => {
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy: policy });
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/mobile-limit.json") }));

    root.render(graph);
    const textureCreatesBeforeManifest = calls.filter(({ name }) => name === "createTexture").length;
    fetchRequests[0]!.resolve(responseJson({
      contractVersion: 1,
      pageSize: 256,
      pages: { entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }] },
      physicalSlots: 1,
      virtualSize: [256, 256],
    }));
    await flushMicrotasks();

    expect(calls.filter(({ name }) => name === "createTexture")).toHaveLength(textureCreatesBeforeManifest);
    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().diagnostics.join("\n")).toMatch(expected);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      atlasTextures: 0,
      gpuAdmissionFailures: 1,
      pendingPages: 0,
    });
    let frames = 0;
    while (scheduledFrames.length > 0 && frames < 4) {
      scheduledFrames.shift()!(frames);
      frames += 1;
      await flushMicrotasks();
    }
    expect(scheduledFrames).toHaveLength(0);
    root.dispose();
  });

  it("keeps manifest transport, JSON, parse, and GPU failures distinct", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();

    const transportRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    transportRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/transport.json") })));
    fetchRequests[0]!.reject(new Error("offline"));
    await flushMicrotasks();

    const jsonRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    jsonRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/json.json") })));
    fetchRequests[1]!.resolve({
      json: vi.fn(() => Promise.reject(new SyntaxError("bad JSON"))),
      ok: true,
    } as unknown as Response);
    await flushMicrotasks();

    const parseRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    parseRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/parse.json") })));
    fetchRequests[2]!.resolve(responseJson({ contractVersion: 1 }));
    await flushMicrotasks();

    const { gl: gpuGl } = fakeGl();
    const gpuRoot = createWebGlRoot(fakeCanvas(gpuGl));
    gpuRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/gpu.json") })));
    vi.mocked(gpuGl.texImage2D).mockImplementation(() => {
      throw new Error("allocation rejected");
    });
    fetchRequests[3]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();

    expect(transportRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest transport failed: offline/);
    expect(jsonRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest JSON decode failed: bad JSON/);
    expect(parseRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest parse failed/);
    expect(gpuRoot.snapshot().diagnostics.join("\n")).toMatch(/GPU resource admission failed: allocation rejected/);
    expect(gpuRoot.snapshot().resourceGovernor.outstandingReservations).toBe(0);
    expect(transportRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(jsonRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(parseRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(gpuRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 0, gpuAdmissionFailures: 1 });
  });

  it("aborts an abandoned authored manifest request on root disposal", () => {
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/pending.json") })));
    expect(fetchRequests[0]?.signal?.aborted).toBe(false);

    root.dispose();
    expect(fetchRequests[0]?.signal?.aborted).toBe(true);
  });

  it("uses the shared ceil-derived mip grid for NPOT root demand", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/npot.json") })));
    fetchRequests[0]!.resolve(responseJson({
      contractVersion: 1,
      pageSize: 4,
      pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
      physicalSlots: 1,
      virtualSize: [12, 4],
    }));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual(["/vt/pages/m2-0-0.png"]);
    root.dispose();
  });

  it.each([
    ["undersized", 3, 4],
    ["oversized", 5, 4],
  ])("rejects and closes an %s authored page before WebGL upload", async (_label, width, height) => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    const page = ControlledImage.instances[0]!;
    page.naturalWidth = width;
    page.width = width;
    page.naturalHeight = height;
    page.height = height;
    page.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(0);
    expect(ControlledImage.closeCalls).toBe(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, residentPages: 0 });
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/has \dx\d pixels; expected 4x4/);
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.closeCalls).toBe(1);
    root.dispose();
  });

  it("fills a working set after an invalid authored page becomes terminal", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/invalid-convergence.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushMicrotasks();
    const invalid = ControlledImage.instances[0]!;
    const invalidSrc = invalid.src;
    invalid.naturalWidth = 5;
    invalid.width = 5;
    invalid.settleLoad();
    await flushMicrotasks();

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const image of ControlledImage.instances) {
        if (!image.complete && image.src !== invalidSrc) image.settleLoad();
      }
      await flushMicrotasks();
      root.render(graph);
      await flushMicrotasks();
    }

    expect(ControlledImage.instances.filter((image) => image.src === invalidSrc)).toHaveLength(1);
    expect(new Set(
      ControlledImage.instances.filter((image) => image.src !== invalidSrc).map((image) => image.src),
    ).size).toBeGreaterThanOrEqual(3);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 0,
      pageLoadFailures: 1,
      pendingPages: 0,
      residentPages: 3,
    });
    const settledRequests = ControlledImage.instances.length;
    for (let frame = 0; frame < 4; frame += 1) root.render(graph);
    expect(ControlledImage.instances).toHaveLength(settledRequests);
    root.dispose();
  });

  it("keeps an invalid-size authored page terminal across context restoration", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    const invalidPage = ControlledImage.instances[0]!;
    invalidPage.naturalWidth = 5;
    invalidPage.width = 5;
    invalidPage.settleLoad();
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(1);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(1);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    root.render(graph);
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(1);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(1);
    root.dispose();
  });

  it("keeps retained pending pages dormant without physical resources and uploads once after explicit restore", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    expect(pageUploads(calls)).toHaveLength(0);
    const admittedSnapshot = root.snapshot();
    expect(admittedSnapshot.resourceGovernor).toMatchObject({
      byClass: {
        "virtual-texture": {
          cpuDecodedBytes: 4 * 4 * 4,
          persistentGpuBytes: admittedSnapshot.virtualTexturing.physicalAllocatedBytes,
        },
      },
    });

    canvas.dispatchContextEvent("webglcontextlost");
    const wakesWhileBlocked = requestAnimationFrame.mock.calls.length;
    root.render(graph);
    root.render(graph);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesWhileBlocked);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, residentPages: 0 });
    expect(root.snapshot().resourceGovernor).toMatchObject({
      byClass: { "virtual-texture": { cpuDecodedBytes: 4 * 4 * 4 } },
      total: { persistentGpuBytes: 0 },
    });

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(requestAnimationFrame.mock.calls.length).toBeGreaterThan(wakesWhileBlocked);
    root.render(graph);
    expect(pageUploads(calls)).toHaveLength(1);
    const restoredSnapshot = root.snapshot();
    expect(restoredSnapshot.virtualTexturing).toMatchObject({ atlasTextures: 1, residentPages: 1 });
    expect(restoredSnapshot.resourceGovernor.byClass["virtual-texture"].persistentGpuBytes)
      .toBe(restoredSnapshot.virtualTexturing.physicalAllocatedBytes);
    expect(restoredSnapshot.resourceGovernor.byClass["virtual-texture"].cpuDecodedBytes).toBe(0);
    root.render(graph);
    expect(pageUploads(calls)).toHaveLength(1);
  });

  it("aborts an in-flight VT page and releases its global job slot on context loss", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/abort-page.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(1);
    expect(root.snapshot().resourceGovernor.total.jobs).toBe(1);
    canvas.dispatchContextEvent("webglcontextlost");
    await flushMicrotasks();

    expect(root.snapshot().resourceGovernor.total.jobs).toBe(0);
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(0);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/abort-page.json") })));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/abort-page.json") })));
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(0);
    expect(root.snapshot().virtualTexturing.residentPages).toBe(1);
    root.dispose();
  });

  it.each(["resolved", "abort-rejected"] as const)(
    "does not let an obsolete %s page settlement corrupt a rapid same-page rebound",
    async (oldSettlement) => {
      vi.stubGlobal("Image", ControlledImage);
      vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
      const fetchRequests = installFetchQueue();
      const { gl } = fakeGl();
      const root = createWebGlRoot(fakeCanvas(gl));
      const material = unlitMaterial({ texture: virtualTexture("/vt/rebound-page.json") });
      const visible = renderScene(material);

      root.render(visible);
      fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
      await flushMicrotasks();
      expect(ControlledImage.instances).toHaveLength(1);
      const obsolete = ControlledImage.instances[0]!;

      if (oldSettlement === "resolved") {
        // Resolve the inner decode, but resume this test before the pageImage
        // continuation consumes it. Removal below can then replace ownership
        // while the old successful continuation is already queued.
        obsolete.settleLoad();
        await Promise.resolve();
      }
      root.render(renderScene(material, { cameraX: 100 }));
      root.render(visible);
      await flushMicrotasks();

      expect(ControlledImage.instances).toHaveLength(2);
      expect(root.snapshot().resourceGovernor.total.jobs).toBe(1);
      expect(root.snapshot().virtualTexturing).toMatchObject({
        outstandingPageRequests: 1,
        pageLoadFailures: 0,
      });

      // The stale continuation must not release the rebound's loading
      // lifecycle and thereby grant a duplicate third request.
      root.render(visible);
      root.render(visible);
      expect(ControlledImage.instances).toHaveLength(2);

      ControlledImage.instances[1]!.settleLoad();
      await flushMicrotasks();
      root.render(visible);
      expect(root.snapshot().resourceGovernor.total.jobs).toBe(0);
      expect(root.snapshot().virtualTexturing).toMatchObject({
        outstandingPageRequests: 0,
        pageLoadFailures: 0,
        residentPages: 1,
      });
      root.dispose();
    },
  );

  it("does not spin while transition pages load and aborts work removed by exact demand", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/obsolete-page.json") });
    const visible = renderScene(material);

    root.render(visible);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushMicrotasks();

    expect(ControlledImage.instances.length).toBeGreaterThan(0);
    expect(root.snapshot().resourceGovernor.total.jobs).toBeGreaterThan(0);
    const wakesWhileLoading = requestAnimationFrame.mock.calls.length;
    root.render(visible);
    root.render(visible);
    root.render(visible);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesWhileLoading);

    const obsoleteImages = [...ControlledImage.instances];
    root.render(renderScene(material, { cameraX: 100 }));
    await flushMicrotasks();

    expect(obsoleteImages.every((image) => image.src === "")).toBe(true);
    expect(root.snapshot().resourceGovernor.total.jobs).toBe(0);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      activePages: 0,
      outstandingPageRequests: 0,
      pageLoadFailures: 0,
      pendingPages: 0,
    });
    root.dispose();
  });

  it("wakes render-on-demand exactly once after final VT settlement", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/settlement-wake.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);

    // Merely waiting on decode must not create a self-invalidating frame loop.
    scheduledFrames.shift()?.(0);
    await flushMicrotasks();
    expect(scheduledFrames).toHaveLength(0);

    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    expect(scheduledFrames).toHaveLength(1);

    // This frame performs the final atlas/page-table settlement. Even though
    // no GPU action remains, settlement schedules one demand-convergence pass.
    scheduledFrames.shift()!(1);
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({
      activePages: 1,
      outstandingPageRequests: 0,
      pendingPages: 0,
      residentPages: 1,
    });
    expect(scheduledFrames).toHaveLength(1);

    // The convergence pass observes physical residency, publishes the exact
    // working set, and quiesces instead of scheduling another frame.
    scheduledFrames.shift()!(2);
    await flushMicrotasks();
    expect(scheduledFrames).toHaveLength(0);
    root.dispose();
  });

  it("uses the opted-in generated raster VT policy without manifest requests", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { canvases, contexts } = installCanvas2d();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedImageVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/generated.png") });

    root.render(renderScene(material));
    ControlledImage.instances[0]!.height = 512;
    ControlledImage.instances[0]!.naturalHeight = 512;
    ControlledImage.instances[0]!.naturalWidth = 512;
    ControlledImage.instances[0]!.width = 512;
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPagesTarget: 5,
    }));
    expect(root.snapshot().virtualTexturing.generatedPageRequests).toBeGreaterThan(0);
    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_texture: expect.arrayContaining([0]),
      u_useTexture: expect.arrayContaining([1]),
    }));
    expect(contexts[0]?.drawImage).toHaveBeenCalled();
    expect(contexts[0]?.drawImage.mock.calls[0]).toEqual([
      ControlledImage.instances[0],
      0,
      0,
      512,
      512,
      0,
      0,
      256,
      256,
    ]);

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
    }

    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedPageFailures: 0,
      generatedPagesTarget: 5,
      manifestFailures: 0,
      manifestRequests: 0,
      manifestsReady: 1,
      residentPages: expect.any(Number),
      uploadedPages: expect.any(Number),
    }));
    expect(root.snapshot().virtualTexturing.generatedPageRequests).toBeGreaterThanOrEqual(1);
    expect(root.snapshot().virtualTexturing.residentPages).toBeGreaterThanOrEqual(1);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.uploadedPageBytes).toBeGreaterThanOrEqual(256 * 256 * 4);
    expect(root.snapshot().virtualTexturing.uploadedPages).toBeGreaterThanOrEqual(1);
    expect(canvases[0]).toEqual(expect.objectContaining({ height: 256, width: 256 }));
    expect(uniformNames(calls)).toEqual(expect.arrayContaining(["u_vtAtlas", "u_vtPageTable"]));
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("binds the ordinary defensive fallback when generated VT becomes invalid after planning", async () => {
    vi.stubGlobal("Image", ControlledImage);
    installCanvas2d();
    let invalidateAfterPlan = false;
    let canvas: FakeCanvas;
    const { calls, gl } = fakeGl({
      beforeUniform1i: (name) => {
        if (!invalidateAfterPlan || name !== "u_unlit") return;
        invalidateAfterPlan = false;
        canvas.dispatchContextEvent("webglcontextlost");
      },
    });
    canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { generatedImageVirtualTextures: true });
    const texture = imageTexture("/textures/defensive-fallback.png");
    const material = unlitMaterial({ texture });
    const graph = renderScene(material);

    root.render(graph);
    const source = ControlledImage.instances[0]!;
    source.height = 512;
    source.naturalHeight = 512;
    source.naturalWidth = 512;
    source.width = 512;
    source.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      root.render(graph);
      await flushMicrotasks();
    }
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);

    const invalidatedDrawStart = calls.length;
    invalidateAfterPlan = true;
    expect(() => root.render(renderScene(standardMaterial({ texture }))))
      .toThrow(/Vertex-input context was dropped/);
    const uniforms = namedUniform1iValues(calls.slice(invalidatedDrawStart));

    expect(invalidateAfterPlan).toBe(false);
    expect(uniforms.u_texture).toEqual([0]);
    expect(uniforms.u_useTexture).toEqual([1]);
    expect(uniforms.u_useVirtualTexture).toEqual([0]);
    expect(uniforms.u_vtAtlas).toBeUndefined();
  });

  it("uses the opted-in generated VT policy for direct imageTexture SVG", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();
    const objectUrlBlobs: Blob[] = [];
    let nextObjectUrl = 0;
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-texture-${nextObjectUrl += 1}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        throw new Error("unexpected 2D canvas raster fallback");
      }),
    });
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { generatedImageVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/plain.svg") });
    const svgText = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" onload=\"alert(1)\">",
      "<script>alert(1)</script>",
      "<image href=\"javascript:alert(1)\" width=\"1\" height=\"1\"/>",
      "<rect width=\"512\" height=\"512\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene(material));
    expect(fetchRequests.some((request) => request.url === "/textures/plain.svg")).toBe(true);
    fetchRequests.find((request) => request.url === "/textures/plain.svg")!
      .resolve(responseText("/textures/plain.svg", svgText));
    await flushMicrotasks();

    expect(objectUrlBlobs).toHaveLength(1);
    const normalizedSvgText = await objectUrlBlobs[0]!.text();
    expect(normalizedSvgText).not.toContain("<script");
    expect(normalizedSvgText).not.toContain("onload=");
    expect(normalizedSvgText).not.toContain("javascript:");
    expect(ControlledImage.instances[0]?.src).toBe("blob:royal-svg-texture-1");
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));
    expect(fetchRequests.map((request) => request.url)).toEqual(["/textures/plain.svg"]);

    for (let frame = 0; frame < 8 && objectUrlBlobs.length < 2; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
    }
    expect(ControlledImage.instances.some((image) => image.src === "blob:royal-svg-texture-2")).toBe(true);
    canvas.dispatchContextEvent("webglcontextlost");
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing.generatedPageFailures).toBe(0);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(renderScene(material));

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
      const generatedPageImage = ControlledImage.instances.find((image) => image.src === "blob:royal-svg-texture-3");
      generatedPageImage?.settleLoad();
      await flushMicrotasks();
    }

    expect(objectUrlBlobs.length).toBeGreaterThan(2);
    expect(await objectUrlBlobs[1]?.text()).toContain("<image href=\"data:image/svg+xml;base64,");
    expect(globalThis.document?.createElement).not.toHaveBeenCalled();
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPageFailures: 0,
      generatedPageRequests: 2,
      generatedPagesTarget: 341,
      manifestsReady: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses generated SVG VT for direct imageTexture SVG data URIs", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const objectUrlBlobs: Blob[] = [];
    let nextObjectUrl = 0;
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-data-texture-${nextObjectUrl += 1}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        throw new Error("unexpected 2D canvas raster fallback");
      }),
    });
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedImageVirtualTextures: true });
    const svgText = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" fill=\"#0af\"/></svg>";
    const svgUri = `data:image/svg+xml,${encodeURIComponent(svgText)}`;
    const material = unlitMaterial({ texture: imageTexture(svgUri) });

    root.render(renderScene(material));
    expect(fetchRequests.map((request) => request.url)).toEqual([svgUri]);
    fetchRequests[0]!.resolve(responseText(svgUri, svgText));
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
      const generatedPageImage = ControlledImage.instances.find((image) => image.src === "blob:royal-svg-data-texture-2");
      generatedPageImage?.settleLoad();
      await flushMicrotasks();
    }

    expect(fetchRequests.map((request) => request.url)).toEqual([svgUri]);
    expect(objectUrlBlobs.length).toBeGreaterThan(1);
    expect(globalThis.document?.createElement).not.toHaveBeenCalled();
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPagesTarget: 341,
      manifestsReady: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("bounds large generated VT page preparation work per frame", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { canvases, contexts } = installCanvas2d();
    installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedImageVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/large-generated.png") });

    root.render(renderScene(material));
    ControlledImage.instances[0]!.height = 4096;
    ControlledImage.instances[0]!.naturalHeight = 4096;
    ControlledImage.instances[0]!.naturalWidth = 4096;
    ControlledImage.instances[0]!.width = 4096;
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));

    const generatedPageRequests = root.snapshot().virtualTexturing.generatedPageRequests;
    expect(generatedPageRequests).toBeGreaterThan(0);
    expect(generatedPageRequests).toBeLessThanOrEqual(VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME);
    expect(generatedPageRequests).toBeLessThanOrEqual(VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS);
    expect(canvases).toHaveLength(generatedPageRequests);
    expect(contexts).toHaveLength(generatedPageRequests);
    for (const canvas of canvases) {
      expect(canvas).toEqual(expect.objectContaining({ height: 256, width: 256 }));
    }
    for (const context of contexts) {
      expect(context.clearRect).toHaveBeenCalledTimes(1);
      expect(context.drawImage).toHaveBeenCalledTimes(1);
    }
  });

  it("resolves explicit virtualTexture base color through prepared VT residency without ordinary image loads", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const manifestUrl = "/vt/manifest.json";

    root.render(renderScene(unlitMaterial({ texture: virtualTexture(manifestUrl) })));

    expect(fetchRequests.map((request) => request.url)).toEqual([manifestUrl]);
    expect(ControlledImage.instances).toHaveLength(0);
    expect(textureAllocations(calls)).toEqual([]);
    expect(textureDataUploads(calls)).toEqual([]);
    expect(textureResourceBinds(calls, gl.TEXTURE_2D)).toEqual([]);
    expect([
      ...fetchRequests.map((request) => request.url),
      ...ControlledImage.instances.map((image) => image.src),
    ]).not.toContain("/vt/pages/0-0.png");
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      manifestRequests: 1,
      preparedResidencyResolutions: 1,
    }));

    fetchRequests[0]!.resolve(responseJson(vtManifest()));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/0-0.png",
      "/vt/pages/1-0.png",
    ]);
    expect(root.snapshot().virtualTexturing.manifestsReady).toBe(1);
  });

  it("defaults manifest and ref-unspecified VT base color to sRGB", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = standardMaterial({
      texture: virtualTexture({ src: "/vt/manifest.json" }),
    });
    const graph = renderScene(material, { exposureEv100: 1.75, toneMapping: "aces-fitted" });

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(graph);
    await flushMicrotasks();
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();

    root.render(graph);
    const uniform1i = namedUniform1iValues(calls);
    const uniform4fv = namedUniform4fvValues(calls);

    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_surfaceLightCount",
      "u_toneMappingSettings",
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
      "u_vtAtlasTexelSize",
      "u_vtPageSize",
      "u_vtVirtualSize",
    ]));
    expect(uniform1i).toEqual(expect.objectContaining({
      u_surfaceLightCount: expect.arrayContaining([1]),
      u_unlit: expect.arrayContaining([0]),
      u_useTexture: expect.arrayContaining([0]),
      u_useVirtualTexture: expect.arrayContaining([1]),
      u_vtAtlas: expect.arrayContaining([0]),
      u_vtPageTable: expect.arrayContaining([1]),
    }));
    expect(uniform4fv).toEqual(expect.objectContaining({
      u_color: expect.arrayContaining([[1, 1, 1, 1]]),
      u_toneMappingSettings: expect.arrayContaining([[1, 1 / (1.2 * (2 ** 1.75)), 0, 0]]),
    }));
    expect(uniform4fv.u_color?.at(-1)).toEqual([1, 1, 1, 1]);
    expect(textureAllocations(calls).map((call) => call.args.slice(2, 7))).toEqual(expect.arrayContaining([
      [gl.SRGB8_ALPHA8, 4, 4, 0, gl.RGBA],
      [gl.RGBA8, 1, 1, 0, gl.RGBA],
    ]));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("uses a mipmapped filter's leading component on the single-level VT atlas", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          magFilter: "nearest",
          minFilter: "linear-mipmap-linear",
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(texParameterGroups(calls)[0]).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(texParameterGroups(calls)[1]).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(texParameterTriples(calls).filter((triple) =>
      triple[0] === gl.TEXTURE_2D
      && (triple[1] === gl.TEXTURE_WRAP_S || triple[1] === gl.TEXTURE_WRAP_T)
      && triple[2] === gl.CLAMP_TO_EDGE)).toHaveLength(4);
    expect(calls.some((call) => call.name === "generateMipmap")).toBe(false);
  });

  it("uses nearest within-page filtering for nearest-prefixed logical min filters", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: { minFilter: "nearest-mipmap-linear" },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(texParameterGroups(calls)[0]).toContainEqual([gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST]);
    expect(calls.some((call) => call.name === "generateMipmap")).toBe(false);
  });

  it("rotates global request grants so fixed draw order cannot starve later virtual textures", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const materials = Array.from({ length: 5 }, (_unused, index) =>
      unlitMaterial({ texture: virtualTexture(`/vt/${index}.json`) }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    expect(fetchRequests).toHaveLength(5);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(4);
    for (const page of ControlledImage.instances) page.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 4 && ControlledImage.instances.length < 5; frame += 1) {
      scheduledFrames.shift()?.(frame);
      await flushMicrotasks();
    }
    expect(ControlledImage.instances).toHaveLength(5);
    ControlledImage.instances[4]!.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 3; frame += 1) root.render(graph);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 5, uploadedPages: 5 });
    root.dispose();
  });

  it("backs off rejected VT pages with an explicit wake and a bounded retry cap", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    const wakesBeforeFailure = requestAnimationFrame.mock.calls.length;

    ControlledImage.instances[0]!.settleError();
    await flushMicrotasks();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesBeforeFailure);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, manifestFailures: 0 });

    root.render(graph);
    expect(ControlledImage.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]!.settleError();
    await flushMicrotasks();
    root.render(graph);
    expect(ControlledImage.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    ControlledImage.instances[2]!.settleError();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10_000);
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 3, manifestFailures: 0 });
    root.dispose();
    vi.useRealTimers();
  });

  it("replaces a retry-exhausted page with later healthy demand and then stays quiescent", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/terminal-convergence.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushMicrotasks();
    const failedSrc = ControlledImage.instances[0]!.src;

    for (const retryDelay of [50, 100, undefined]) {
      const failedAttempt = ControlledImage.instances.filter((image) => image.src === failedSrc).at(-1)!;
      failedAttempt.settleError();
      await flushMicrotasks();
      if (retryDelay !== undefined) {
        await vi.advanceTimersByTimeAsync(retryDelay);
        await flushMicrotasks();
      }
    }
    expect(ControlledImage.instances.filter((image) => image.src === failedSrc)).toHaveLength(3);

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const image of ControlledImage.instances) {
        if (!image.complete && image.src !== failedSrc) image.settleLoad();
      }
      await flushMicrotasks();
      root.render(graph);
      await flushMicrotasks();
    }

    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 0,
      pageLoadFailures: 3,
      pendingPages: 0,
      residentPages: 3,
    });
    expect(new Set(
      ControlledImage.instances.filter((image) => image.src !== failedSrc).map((image) => image.src),
    ).size).toBeGreaterThanOrEqual(3);

    const settledAdmissions = root.snapshot().virtualTexturing.demandAdmissions;
    const settledRequests = ControlledImage.instances.length;
    for (let frame = 0; frame < 4; frame += 1) root.render(graph);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBe(settledAdmissions);
    expect(ControlledImage.instances).toHaveLength(settledRequests);
    root.dispose();
    vi.useRealTimers();
  });

  it("keeps the per-frame VT request-start budget monotonic after a rejection", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const materials = Array.from({ length: 5 }, (_value, index) =>
      unlitMaterial({ texture: virtualTexture(`/vt/${index}.json`) }));

    root.render(renderVirtualTextureMaterials(materials));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(4);

    ControlledImage.instances[0]!.settleError();
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(4);
    root.render(renderVirtualTextureMaterials(materials));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(5);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, manifestFailures: 0 });
    root.dispose();
  });

  it("wakes root demand draining when budget release admits a dormant VT", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(80),
    });
    const first = unlitMaterial({ texture: virtualTexture("/vt/first.json") });
    const second = unlitMaterial({ texture: virtualTexture("/vt/second.json") });

    root.render(renderVirtualTextureMaterials([first, second]));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    root.render(renderScene(second));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    root.dispose();
  });

  it("preserves governed retry identity through denied deletion and insertion churn", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, {
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(80),
    });
    const materials = ["a", "b", "c"].map((name) => unlitMaterial({
      texture: virtualTexture(`/${name}/manifest.json`),
    }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances[0]?.src).toContain("/a/pages/0-0.png");
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances.at(-1)?.src).toContain("/a/pages/0-0.png");
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    root.render(graph);

    canvas.dispatchContextEvent("webglcontextlost");
    const inserted = unlitMaterial({ texture: virtualTexture("/d/manifest.json") });
    const churnGraph = renderVirtualTextureMaterials([materials[1]!, materials[2]!, inserted]);
    // Remove A before the anchored B and insert D after the surviving denied
    // candidates while capacity is unavailable. Neither change may transfer
    // B's first chance to C.
    root.render(churnGraph);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(churnGraph);
    await flushMicrotasks();
    expect(ControlledImage.instances.at(-1)?.src).toContain("/b/pages/0-0.png");
    root.dispose();
  });

  it("contains and reports a dormant allocation fault triggered by another VT's release", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(80),
    });
    const first = unlitMaterial({ texture: virtualTexture("/vt/first.json") });
    const second = unlitMaterial({ texture: virtualTexture("/vt/second.json") });

    root.render(renderVirtualTextureMaterials([first, second]));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    vi.mocked(gl.texImage2D).mockImplementation(() => {
      throw new Error("dormant allocation rejected");
    });

    expect(() => root.render(renderScene(second))).not.toThrow();
    await flushMicrotasks();
    const wakesAfterFailure = requestAnimationFrame.mock.calls.length;
    expect(root.snapshot().virtualTexturing).toMatchObject({ gpuAdmissionFailures: 1 });
    expect(root.snapshot().diagnostics.join("\n")).toMatch(
      /GPU resource admission failed: dormant allocation rejected/,
    );
    root.render(renderScene(second));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesAfterFailure);
  });

  it("withholds VT visibility and image close until dirty page-table retry succeeds", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const pageTableUploadFailure: { enabled: boolean; error?: unknown } = { enabled: false };
    const { calls, gl } = fakeGl({ pageTableUploadFailure });
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    // Replace the context-free bootstrap with the page selected by the real
    // draw before exercising upload failure. The bootstrap image is stale once
    // frame demand commits and should not be the page under retry.
    root.render(graph);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    const demandedPage = ControlledImage.instances.at(-1)!;
    const closesBeforeDemandedUpload = ControlledImage.closeCalls;
    pageTableUploadFailure.enabled = true;
    pageTableUploadFailure.error = undefined;
    ControlledImage.closeError = new Error("close failure");
    demandedPage.settleLoad();
    await flushMicrotasks();

    let threw = false;
    let caught: unknown = "not-thrown";
    try {
      root.render(graph);
    } catch (error) {
      threw = true;
      caught = error;
    }
    expect(threw).toBe(true);
    expect(caught).toBeUndefined();
    expect(ControlledImage.closeCalls).toBe(closesBeforeDemandedUpload);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      activePages: 0,
      cachedPages: 1,
      residentPages: 1,
      uploadedPages: 0,
    });

    pageTableUploadFailure.enabled = false;
    expect(() => root.render(graph)).toThrow(ControlledImage.closeError);
    expect(ControlledImage.closeCalls).toBe(closesBeforeDemandedUpload + 1);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 1, uploadedPages: 1 });
  });

  it("does not let an eviction outcome clear a newer request for the evicted page", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const pageTableUploadFailure: { enabled: boolean } = { enabled: false };
    const { gl } = fakeGl({ pageTableUploadFailure });
    const root = createWebGlRoot(fakeCanvas(gl));
    const texture = virtualTexture("/vt/manifest.json");
    const centreMaterial: SurfaceMaterial = {
      ...unlitMaterial({ texture }),
      textureCoordinates: {
        baseColorTexture: {
          row0: [2 / 3, 0, 1 / 3, 0],
          row1: [0, 1, 0, 0],
          set: 0,
        },
      },
    };
    const replacementMaterial: SurfaceMaterial = {
      ...unlitMaterial({ texture }),
      textureCoordinates: {
        baseColorTexture: {
          row0: [1 / 3, 0, 0, 0],
          row1: [0, 1, 0, 0],
          set: 0,
        },
      },
    };
    const graph = renderScene(centreMaterial);
    const replacementGraph = renderScene(replacementMaterial);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(2)));
    await flushMicrotasks();

    // Replace context-free bootstrap demand with two pages selected by the
    // ordinary view, then fill both physical slots.
    root.render(graph);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    const residentPages = ControlledImage.instances.slice(1);
    expect(residentPages.map((image) => image.src).sort()).toEqual([
      "/vt/pages/1-0.png",
      "/vt/pages/2-0.png",
    ]);
    for (const image of residentPages) image.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 2, uploadedPages: 2 });

    // Shift the UV window onto the left-hand page and queue it as the replacement
    // for the one physical slot.
    root.render(replacementGraph);
    await flushMicrotasks();
    const replacementPage = ControlledImage.instances.at(-1)!;
    expect(replacementPage.src).toContain("/vt/pages/0-0.png");
    replacementPage.settleLoad();
    await flushMicrotasks();

    // Start the replacement transaction and fail after it has withdrawn the
    // old visible mapping. A following centre-demand frame retries the same
    // in-flight upload, and its final drain can start a newer request for the
    // evicted key while the replacement still owns its pending outcome.
    pageTableUploadFailure.enabled = true;
    expect(() => root.render(replacementGraph)).toThrow();
    expect(() => root.render(graph)).toThrow();
    await flushMicrotasks();
    const newerEvictedPage = ControlledImage.instances.at(-1)!;
    expect(newerEvictedPage).not.toBe(replacementPage);
    expect(residentPages.map((image) => image.src)).toContain(newerEvictedPage.src);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(2);

    pageTableUploadFailure.enabled = false;
    root.render(graph);

    // Settling the replacement upload must clear only its own claim. Its
    // evicted key now belongs to the newer network request above.
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(1);
    newerEvictedPage.settleLoad();
    await flushMicrotasks();
    root.dispose();
  });

  it("retains the last committed VT demand when a frame fails before drawing", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    // Commit draw-derived demand, then retire the now-stale context-free
    // bootstrap so the selected page becomes the active request.
    root.render(graph);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    const demandedPage = ControlledImage.instances.at(-1)!;
    expect(demandedPage.src).toContain("/vt/pages/1-0.png");

    const renderFailure = new Error("frame setup failure");
    vi.mocked(gl.clear).mockImplementationOnce(() => {
      throw renderFailure;
    });
    expect(() => root.render(graph)).toThrow(renderFailure);

    demandedPage.settleLoad();
    await flushMicrotasks();
    root.render(graph);

    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 0,
      residentPages: 1,
      uploadedPages: 1,
    });
  });

  it("unions disjoint stereo VT demand and preserves view-order request priority", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const renderOrder = async (
      views: readonly [ReturnType<typeof leftStereoView>, ReturnType<typeof rightStereoView>],
    ): Promise<readonly string[]> => {
      const firstImage = ControlledImage.instances.length;
      const { gl } = fakeGl();
      const root = createWebGlRoot(fakeCanvas(gl));
      const texture = virtualTexture("/vt/stereo.json");
      const graph = stereoVirtualTextureScene(texture);

      root.render(renderScene(unlitMaterial({ texture })));
      fetchRequests.at(-1)!.resolve(responseJson(vtStereoManifest()));
      await flushMicrotasks();
      root.renderViews(graph, { views });

      const urls = ControlledImage.instances.slice(firstImage).map((image) => image.src);
      root.dispose();
      return urls;
    };

    const leftFirst = await renderOrder([leftStereoView(), rightStereoView()]);
    const rightFirst = await renderOrder([rightStereoView(), leftStereoView()]);

    expect(leftFirst).toEqual([
      "/vt/pages/m2-0-0.png",
      "/vt/pages/m0-0-0.png",
      "/vt/pages/m0-3-0.png",
    ]);
    expect(rightFirst).toEqual([
      "/vt/pages/m2-0-0.png",
      "/vt/pages/m0-3-0.png",
      "/vt/pages/m0-0-0.png",
    ]);
    expect(new Set(leftFirst)).toEqual(new Set(rightFirst));
  });

  it("rolls back VT demand collected by an earlier view when a later view fails", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const texture = virtualTexture("/vt/stereo.json");
    const graph = stereoVirtualTextureScene(texture);

    root.render(renderScene(unlitMaterial({ texture })));
    fetchRequests[0]!.resolve(responseJson(vtStereoManifest()));
    await flushMicrotasks();
    root.renderViews(graph, { views: [leftStereoView()] });
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/m2-0-0.png",
      "/vt/pages/m0-0-0.png",
    ]);

    const frameFailure = new Error("second stereo view failed");
    vi.mocked(gl.clear)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw frameFailure;
      });
    expect(() => root.renderViews(graph, {
      views: [rightStereoView(), leftStereoView()],
    })).toThrow(frameFailure);
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).not.toContain(
      "/vt/pages/m0-3-0.png",
    );
    imageBySrc("m0-0-0")!.settleLoad();
    await flushMicrotasks();
    root.renderViews(graph, { views: [leftStereoView()] });

    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 1, uploadedPages: 1 });
  });

  it("clears outstanding ownership when demand discards a queued page even if image close throws", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const visibleGraph = renderScene(material);

    root.render(visibleGraph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    root.render(visibleGraph);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    const demandedPage = ControlledImage.instances.at(-1)!;
    demandedPage.settleLoad();
    await flushMicrotasks();
    const imagesBeforeDiscard = ControlledImage.instances.length;
    expect(demandedPage.src).toContain("/vt/pages/1-0.png");
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(1);

    ControlledImage.closeError = new Error("discard close failure");
    expect(() => root.renderViews(visibleGraph, {
      views: [{
        projectionMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
        viewMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          10, 0, 0, 1,
        ],
        viewport: { height: 256, width: 256, x: 0, y: 0 },
      }],
    })).not.toThrow();
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(0);

    ControlledImage.closeError = undefined;
    root.render(visibleGraph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(imagesBeforeDiscard + 1);
    expect(ControlledImage.instances.at(-1)?.src).toBe(demandedPage.src);
  });

  it("commits every resource demand and fairness cursor when discarded image closes throw", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const textures = [
      virtualTexture("/vt/first/stereo.json"),
      virtualTexture("/vt/second/stereo.json"),
    ] as const;
    const graph = scene({
      camera: camera(),
      clearColor: [0, 0, 0, 0],
      nodes: textures.flatMap((texture) => [
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
      ]),
    });
    const manifest = {
      contractVersion: 1,
      pageSize: 4,
      pages: {
        entries: [
          { mip: 0, uri: "pages/0-0.png", x: 0, y: 0 },
          { mip: 0, uri: "pages/3-0.png", x: 3, y: 0 },
        ],
      },
      physicalSlots: 1,
      virtualSize: [16, 4],
    };

    root.render(renderVirtualTextureMaterials(textures.map((texture) => unlitMaterial({ texture }))));
    expect(fetchRequests).toHaveLength(2);
    for (const request of fetchRequests) request.resolve(responseJson(manifest));
    await flushMicrotasks();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/first/pages/0-0.png",
      "/vt/second/pages/0-0.png",
    ]);

    // Establish submission zero (the left eye) as the committed selection for
    // both resources. The next identical stereo frame must rotate both to the
    // right eye and discard both queued left-eye images.
    root.renderViews(graph, { views: [leftStereoView(), rightStereoView()] });
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    ControlledImage.closeError = new Error("discard close failure");
    expect(() => root.renderViews(graph, {
      views: [leftStereoView(), rightStereoView()],
    })).toThrow(ControlledImage.closeError);

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/first/pages/0-0.png",
      "/vt/second/pages/0-0.png",
      "/vt/first/pages/3-0.png",
      "/vt/second/pages/3-0.png",
    ]);
    expect(ControlledImage.closeCalls).toBe(2);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(2);

    // Cursor state is intentionally private. Alternating request URLs are its
    // black-box contract: both cursors advanced despite the first close error,
    // so neither resource may replay the half-committed right-eye demand.
    ControlledImage.closeError = undefined;
    for (const image of ControlledImage.instances.slice(2)) image.settleLoad();
    await flushMicrotasks();
    root.renderViews(graph, { views: [leftStereoView(), rightStereoView()] });
    expect(ControlledImage.instances.slice(4).map((image) => image.src)).toEqual([
      "/vt/first/pages/0-0.png",
      "/vt/second/pages/0-0.png",
    ]);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(2);
    root.dispose();
  });

  it("requests coarsest resident parent pages before mip-0 children", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/m1-0-0.png",
      "/vt/pages/m0-1-0.png",
      "/vt/pages/m0-0-0.png",
    ]);

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      residentPages: 1,
      shaderBinds: expect.any(Number),
      uploadedPages: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("keeps tiny screen-footprint VT demand on coarse visible mips", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }), {
      planeSize: [0.25, 0.25],
    });

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(4)));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toContain("/vt/pages/m4-0-0.png");
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await settleIncompleteImages();
      root.render(graph);
    }

    const pageRequests = ControlledImage.instances.map((image) => image.src);
    expect(pageRequests.some((src) => src.includes("/vt/pages/m3-"))).toBe(true);
    expect(pageRequests.some((src) => (
      src.includes("/vt/pages/m2-") || src.includes("/vt/pages/m1-") || src.includes("/vt/pages/m0-")
    ))).toBe(false);
  });

  it("converges an oversubscribed visible working set without stable-camera eviction churn", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const fullView = renderScene(material);

    root.render(fullView);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages();
      root.render(fullView);
    }
    expect(root.snapshot().virtualTexturing.residentPages).toBe(3);
    const stableRequests = ControlledImage.instances.length;
    const stableUpdates = root.snapshot().virtualTexturing.pageTableUpdates;
    for (let frame = 0; frame < 8; frame += 1) root.render(fullView);
    expect(ControlledImage.instances).toHaveLength(stableRequests);
    expect(root.snapshot().virtualTexturing.pageTableUpdates).toBe(stableUpdates);
    expect(root.snapshot().virtualTexturing.residentPages).toBe(3);

    root.render(renderScene(material, { planeSize: [0.25, 0.25] }));
    expect(root.snapshot().virtualTexturing.residentPages).toBeLessThanOrEqual(3);
  });

  it("keeps camera jitter sticky and bounds refinement admissions during a slow pan", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(4)));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 6; cycle += 1) {
      await settleIncompleteImages();
      root.render(renderScene(material));
    }
    const stableRequests = ControlledImage.instances.length;
    const stableAdmissions = root.snapshot().virtualTexturing.demandAdmissions;
    for (const cameraX of [0.002, -0.002, 0.001, 0]) {
      root.render(renderScene(material, { cameraX }));
    }
    expect(ControlledImage.instances).toHaveLength(stableRequests);
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBe(stableAdmissions);

    for (const cameraX of [0.8, 1, 1.2, 1.4]) {
      await settleIncompleteImages();
      const requestsBeforePanStep = ControlledImage.instances.length;
      root.render(renderScene(material, { cameraX }));
      expect(ControlledImage.instances.length - requestsBeforePanStep).toBeLessThanOrEqual(2);
    }
    expect(root.snapshot().virtualTexturing.demandAdmissions - stableAdmissions).toBeLessThanOrEqual(8);
    await settleIncompleteImages();
    const requestsBeforeDirectionChange = ControlledImage.instances.length;
    root.render(renderScene(material, { cameraX: -1.4 }));
    expect(ControlledImage.instances.length - requestsBeforeDirectionChange).toBeLessThanOrEqual(2);
    expect(root.snapshot().virtualTexturing.demandRetentions).toBeGreaterThan(0);
  });

  it("fills free 24-slot terrain capacity beyond the replacement churn allowance", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/terrain.json") });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtTerrainManifest()));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 16; cycle += 1) {
      await settleIncompleteImages(512);
      root.render(renderScene(material));
    }
    await settleIncompleteImages(512);

    const pageRequests = ControlledImage.instances.map((image) => image.src);
    expect(pageRequests.some((src) => src.includes("/pages/m3-"))).toBe(true);
    expect(new Set(pageRequests).size).toBeGreaterThan(3);
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBeGreaterThan(2);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(0);
    const convergedAdmissions = root.snapshot().virtualTexturing.demandAdmissions;
    const convergedRequests = ControlledImage.instances.length;
    for (let frame = 0; frame < 4; frame += 1) root.render(renderScene(material));
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBe(convergedAdmissions);
    expect(ControlledImage.instances).toHaveLength(convergedRequests);
  });

  it("retains a bounded coherent hierarchy across a coarse zoom cycle", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/zoom.json") });
    const fineView = renderScene(material);
    const coarseView = renderScene(material, { planeSize: [1, 1] });

    root.render(fineView);
    fetchRequests[0]!.resolve(responseJson(vtZoomCycleManifest()));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(fineView);
    }

    const refinedRequestsBeforeZoomOut = ControlledImage.instances
      .filter((image) => image.src.includes("/pages/m2-"))
      .length;
    expect(refinedRequestsBeforeZoomOut).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.residentPages).toBe(3);

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(coarseView);
    }
    const requestsAfterCoarseSettle = ControlledImage.instances.length;
    const updatesAfterCoarseSettle = root.snapshot().virtualTexturing.pageTableUpdates;

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(fineView);
    }

    expect(ControlledImage.instances).toHaveLength(requestsAfterCoarseSettle);
    expect(ControlledImage.instances.filter((image) => image.src.includes("/pages/m2-")).length)
      .toBe(refinedRequestsBeforeZoomOut);
    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/zoom.json"]);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      cachedPages: 3,
      residentPages: 3,
    }));
    expect(root.snapshot().virtualTexturing.cachedPagesByMip)
      .toEqual(root.snapshot().virtualTexturing.residentPagesByMip);
    expect(root.snapshot().virtualTexturing.cachedPagesByMip.reduce((sum, count) => sum + count, 0))
      .toBe(root.snapshot().virtualTexturing.cachedPages);
    expect(root.snapshot().virtualTexturing.activePagesByMip.reduce((sum, count) => sum + count, 0))
      .toBe(root.snapshot().virtualTexturing.activePages);
    expect(root.snapshot().virtualTexturing.pageTableUpdates).toBe(updatesAfterCoarseSettle);

    root.render(renderScene(material, { cameraX: 100 }));
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      activePages: 0,
      activePagesByMip: [],
      cachedPages: 3,
      residentPages: 3,
    }));
  });

  it("expands resident parent page-table updates over covered mip-0 cells with encoded fallback offsets", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
    ]);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(pageUploads(calls)[0]?.args[0]).toBe(gl.TEXTURE_2D);
  });

  it("replaces parent mappings with exact child page-table entries as children upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();
    imageBySrc("m0-0-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
      [0, 0, 1, 1, [2, 0, 0, 255]],
    ]);
  });

  it("does not oversubscribe a stable parent-and-child working set", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(2)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    imageBySrc("m0-1-0")?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    expect(imageBySrc("m0-0-0")).toBeUndefined();
    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
      [1, 0, 1, 1, [2, 0, 0, 255]],
    ]);
  });

  it("binds VT shader resources instead of the ordinary u_texture sampler after page upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
      "u_vtAtlasTexelSize",
      "u_vtPageSize",
      "u_vtVirtualSize",
    ]));
    expect(uniformNames(calls)).not.toContain("u_texture");
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [gl.TEXTURE0], name: "activeTexture" }),
      expect.objectContaining({ args: [gl.TEXTURE0 + 1], name: "activeTexture" }),
    ]));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("honors logical virtual texture UV wrap modes in the VT shader uniforms", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtWrapS: expect.arrayContaining([1]),
      u_vtWrapT: expect.arrayContaining([2]),
    }));
  });

  it("defaults logical virtual texture UV wrapping to clamp-to-edge", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtFlipY: expect.arrayContaining([1]),
      u_vtWrapS: expect.arrayContaining([0]),
      u_vtWrapT: expect.arrayContaining([0]),
    }));
  });

  it("preserves explicit flipY false in virtual-texture shader orientation", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = unlitMaterial({
      texture: virtualTexture({ flipY: false, src: "/vt/manifest.json" }),
    });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(material));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(material));
    expect(namedUniform1iValues(calls).u_vtFlipY).toContain(0);
  });

  it("ignores async VT page completions after dispose", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    const beforeDisposeUploads = pageUploads(calls).length;

    root.dispose();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(beforeDisposeUploads);
    expect(calls.filter((call) => call.name === "deleteTexture")).toHaveLength(2);
    expect(root.snapshot().disposed).toBe(true);
  });

  it("retries retained VT image close ownership on repeated dispose", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    root.render(graph);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    expect(ControlledImage.instances.length).toBeGreaterThan(1);
    const demandedPage = ControlledImage.instances.at(-1)!;
    expect(demandedPage.src).toContain("/vt/pages/1-0.png");
    demandedPage.settleLoad();
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 1,
      pendingPages: 1,
    });

    const closesBeforeDispose = ControlledImage.closeCalls;
    ControlledImage.closeError = new Error("dispose close failure");
    expect(() => root.dispose()).toThrow(ControlledImage.closeError);
    expect(ControlledImage.closeCalls).toBeGreaterThan(closesBeforeDispose);
    const closesAfterFailedDispose = ControlledImage.closeCalls;
    expect(root.snapshot().disposed).toBe(true);

    ControlledImage.closeError = undefined;
    expect(() => root.dispose()).not.toThrow();
    expect(ControlledImage.closeCalls).toBeGreaterThan(closesAfterFailedDispose);
    const closesAfterSuccessfulRetry = ControlledImage.closeCalls;

    root.dispose();
    expect(ControlledImage.closeCalls).toBe(closesAfterSuccessfulRetry);
  });

  it("falls back to diagnostic material color when explicit VT lacks sampler budget", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = standardMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    root.render(graph);

    expect(ControlledImage.instances).toHaveLength(0);
    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_useTexture: expect.arrayContaining([0]),
      u_useVirtualTexture: expect.arrayContaining([0]),
    }));
    expect(namedUniform4fvValues(calls)).toEqual(expect.objectContaining({
      u_color: expect.arrayContaining([[1, 0, 1, 1]]),
    }));
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/requires at least two fragment texture units/i);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBe(0);
    expect(consoleWarn).toHaveBeenCalled();
  });

  it("records unsupported capability diagnostics and rejects WebGL1 contexts explicitly", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      atlasTextures: 0,
      manifestRequests: 1,
      unsupportedDraws: expect.any(Number),
    }));
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/requires at least two fragment texture units/i);
    expect(consoleWarn).toHaveBeenCalled();

    expect(() => createWebGlRoot(fakeCanvas(null))).toThrow(/webgl2/i);
  });

  it("accepts explicit standardMaterial virtualTexture as a surface base color while it loads", () => {
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(standardMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/manifest.json"]);
    expect(root.snapshot().virtualTexturing.unsupportedDraws).toBe(0);
    expect(root.snapshot().virtualTexturing.preparedResidencyResolutions).toBe(1);
    expect(root.snapshot().diagnostics.join("\n")).not.toMatch(/only unlit base-color virtual textures/i);
  });

  it("freezes normalized root options", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 8,
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(123_456),
    });

    expect(Object.isFrozen(root.options)).toBe(true);
    expect(root.options).toMatchObject({
      alpha: true,
      antialias: true,
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 8,
      resourceGovernorPolicy: expect.objectContaining({
        classes: expect.objectContaining({
          "virtual-texture": expect.objectContaining({
            persistentGpuBytes: {
              hardLimit: 123_456,
              mandatoryFloor: 0,
              softLimit: 123_456,
            },
          }),
        }),
      }),
    });
    expect(root.snapshot()).toMatchObject({
      resourceGovernor: {
        maximumDurableBytesByClass: {
          "virtual-texture": { persistentGpuBytes: 123_456 },
        },
      },
      virtualTexturing: { physicalBudgetBytes: 123_456 },
    });
    root.dispose();
  });

  it("reports invalid VT root options with their units, range, and received value", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);

    expect(() => createWebGlRoot(canvas, { generatedSvgVirtualTextureRasterDensity: 17 }))
      .toThrow(new RangeError(
        "generatedSvgVirtualTextureRasterDensity must be finite and in (0, 16] logical texels per authored SVG CSS pixel, received 17",
      ));
  });
});
