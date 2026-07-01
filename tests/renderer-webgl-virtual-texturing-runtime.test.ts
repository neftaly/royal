import { afterEach, describe, expect, it, vi } from "vitest";
import {
  directionalLight,
  mesh,
  orthographicCamera,
  pass,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
  virtualTexture,
  type Material,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import {
  createVirtualTextureRuntimeManifest,
  encodeVirtualTexturePageTableRgba8,
  firstVirtualTexturePageUri,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  VirtualTextureRuntimeResource,
  virtualTexturePageUri,
} from "../packages/renderer-webgl/src/virtual-texturing";

describe("WebGL virtual texturing runtime model", () => {
  it("parses explicit page-entry manifests into a normalized resource model", () => {
    const result = parseVirtualTextureManifest({
      colorSpace: "srgb",
      fallbackColor: [0.08, 0.1, 0.12, 1],
      id: "terrain",
      mipCount: 2,
      pageSize: 128,
      pages: {
        entries: {
          "m0/0/0": "pages/mip-0/x0-y0.png",
          "m1/0/0": { height: 64, uri: "pages/mip-1/x0-y0.png", width: 64 },
        },
      },
      physicalSlots: 4,
      virtualSize: [512, 256],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      colorSpace: "srgb",
      fallbackColor: [0.08, 0.1, 0.12, 1],
      height: 256,
      id: "terrain",
      mipCount: 2,
      pageSize: 128,
      physicalSlots: 4,
      width: 512,
    }));
    expect(result.manifest?.pages).toEqual([
      { id: "m0/0/0", mip: 0, uri: "pages/mip-0/x0-y0.png", x: 0, y: 0 },
      { height: 64, id: "m1/0/0", mip: 1, uri: "pages/mip-1/x0-y0.png", width: 64, x: 0, y: 0 },
    ]);
    expect(result.manifest === undefined ? undefined : firstVirtualTexturePageUri(result.manifest))
      .toBe("pages/mip-0/x0-y0.png");
  });

  it("derives runtime manifest lookup data, padded pages, budgets, and base-relative page uris", () => {
    const result = parseVirtualTextureManifest({
      borderTexels: 2,
      pageSize: 64,
      pages: {
        entries: {
          "m0/0/0": "pages/0.png",
          "m1/0/0": "pages/1.png",
        },
      },
      physicalByteBudget: 80 * 80 * 4 * 3,
      virtualSize: [256, 128],
    });

    expect(result.diagnostics).toEqual([]);
    const manifest = createVirtualTextureRuntimeManifest(result.manifest!, {
      manifestUri: "assets/terrain/manifest.json",
    });

    expect(manifest).toEqual(expect.objectContaining({
      baseUri: "assets/terrain",
      borderTexels: 2,
      manifestUri: "assets/terrain/manifest.json",
      mipCount: 3,
      paddedPageSize: 68,
      physicalSlots: 4,
    }));
    expect(manifest.pageByteSize).toBe(68 * 68 * 4);
    expect(manifest.pagesByKey.get("0/0/0")).toEqual(expect.objectContaining({
      key: "0/0/0",
      uri: "assets/terrain/pages/0.png",
    }));
  });

  it("parses nested research manifests and resolves URI templates", () => {
    const result = parseVirtualTextureManifest({
      assetId: "royal.generated-terrain-material.vt-demo",
      demoBudget: { cacheSlots: 12 },
      variants: [{ format: "png-rgba8", uriTemplate: "pages/mip-{mip}/x{x}-y{y}.png" }],
      virtualTexture: {
        colorSpace: "srgb",
        dimensions: [128, 128],
        mipCount: 3,
        usableTileSize: 32,
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      height: 128,
      id: "royal.generated-terrain-material.vt-demo",
      pageSize: 32,
      physicalSlots: 12,
      uriTemplate: "pages/mip-{mip}/x{x}-y{y}.png",
      width: 128,
    }));
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 2, x: 3, y: 1 }))
      .toBe("pages/mip-2/x3-y1.png");
  });

  it("accepts explicit texture width and height fields", () => {
    const result = parseVirtualTextureManifest({
      height: 128,
      pageSize: 64,
      pages: { uriTemplate: "pages/{page}.png" },
      width: 256,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      height: 128,
      pageSize: 64,
      width: 256,
    }));
    expect(result.manifest === undefined ? undefined : firstVirtualTexturePageUri(result.manifest))
      .toBe("pages/m0/0/0.png");
  });

  it("parses generated/debug manifests as unsupported metadata instead of uploadable pages", () => {
    const result = parseVirtualTextureManifest({
      format: "rgba8",
      id: "generated-virtual-texture-surface",
      mipCount: 3,
      pageSize: 128,
      pages: {
        generator: "debug-rgba",
        kind: "generated",
      },
      physicalSlots: 9,
      virtualSize: [512, 512],
    });

    expect(result.manifest).toEqual(expect.objectContaining({
      height: 512,
      id: "generated-virtual-texture-surface",
      pageSize: 128,
      width: 512,
    }));
    expect(result.manifest?.pages).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "vt.pages.generated", severity: "unsupported" }),
      expect.objectContaining({ code: "vt.pages.empty", severity: "unsupported" }),
    ]);
    expect(result.manifest === undefined ? undefined : firstVirtualTexturePageUri(result.manifest)).toBeUndefined();
  });

  it("tracks page to atlas slot mappings and dirty page-table updates incrementally", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };

    expect(table.ensureResident(first)).toEqual(expect.objectContaining({ pageKey: "0/0/0", slot: 0 }));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: "0/0/0", slot: 0 },
    ]);

    table.ensureResident(first);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);

    expect(table.ensureResident(second)).toEqual(expect.objectContaining({ pageKey: "0/1/0", slot: 1 }));
    expect(table.residentSlot(first)).toBe(0);
    expect(table.residentSlot(second)).toBe(1);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: second, pageKey: "0/1/0", slot: 1 },
    ]);
  });

  it("selects the nearest resident parent fallback for missing pages", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 4 });
    const parent = { mip: 1, x: 1, y: 1 };
    table.ensureResident(parent);
    table.takeDirtyPageTableUpdates();

    expect(table.resolveResidentFallback({ mip: 0, x: 3, y: 2 }, { maxMip: 3 })).toEqual(
      expect.objectContaining({ page: parent, pageKey: "1/1/1", slot: 0 }),
    );
    expect(table.resolveResidentFallback({ mip: 0, x: 0, y: 0 }, { maxMip: 1 })).toBeUndefined();
  });

  it("evicts with a bounded clock policy and records invalidated page-table entries", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const third = { mip: 0, x: 2, y: 0 };
    const fourth = { mip: 0, x: 3, y: 0 };

    table.ensureResident(first);
    table.ensureResident(second);
    table.takeDirtyPageTableUpdates();

    expect(table.ensureResident(third)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: first, slot: 0 }),
      page: third,
      slot: 0,
    }));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: "0/0/0" },
      { page: third, pageKey: "0/2/0", slot: 0 },
    ]);

    expect(table.ensureResident(fourth)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: second, slot: 1 }),
      page: fourth,
      slot: 1,
    }));
    expect(table.residentSlot(first)).toBeUndefined();
    expect(table.residentSlot(second)).toBeUndefined();
    expect(table.residentSlot(third)).toBe(0);
    expect(table.residentSlot(fourth)).toBe(1);
  });

  it("plans uploads with state transitions, caps, priority ordering, stale drops, and missing-page failures", () => {
    const manifest = createVirtualTextureRuntimeManifest({
      height: 256,
      pageSize: 64,
      pages: [
        { id: "near", mip: 0, uri: "near.png", x: 0, y: 0 },
        { id: "far", mip: 1, uri: "far.png", x: 0, y: 0 },
      ],
      physicalSlots: 4,
      width: 256,
    }, { baseUri: "/vt" });
    const resource = new VirtualTextureRuntimeResource(manifest);

    resource.demand([
      { frame: 1, page: { mip: 0, x: 0, y: 0 }, priority: 10 },
      { frame: 1, page: { mip: 1, x: 0, y: 0 }, priority: 20 },
      { frame: 0, page: { mip: 0, x: 9, y: 9 }, priority: 30 },
      { frame: 4, page: { mip: 0, x: 8, y: 8 }, priority: 40 },
    ]);

    const plan = resource.planUploads({
      currentFrame: 4,
      maxPageUploads: 2,
      maxStaleFrames: 3,
      maxUploadBytes: manifest.pageByteSize * 2,
    });

    expect(plan.droppedStale).toEqual(["0/9/9"]);
    expect(plan.skippedMissing).toEqual(["0/8/8"]);
    expect(plan.uploads.map((upload) => upload.pageKey)).toEqual(["1/0/0", "0/0/0"]);
    expect(plan.uploads.map((upload) => upload.uri)).toEqual(["/vt/far.png", "/vt/near.png"]);
    expect(resource.stats()).toEqual({
      failedPages: 1,
      loadingPages: 2,
      requestedPages: 0,
      residentPages: 0,
    });

    resource.markUploaded({ mip: 1, x: 0, y: 0 });
    resource.markUploaded({ mip: 0, x: 0, y: 0 });

    expect(resource.stats()).toEqual({
      failedPages: 1,
      loadingPages: 0,
      requestedPages: 0,
      residentPages: 2,
    });
  });

  it("applies page and byte upload caps without changing queued requested state", () => {
    const manifest = createVirtualTextureRuntimeManifest({
      height: 128,
      pageSize: 32,
      pages: [
        { id: "a", mip: 0, uri: "a.png", x: 0, y: 0 },
        { id: "b", mip: 0, uri: "b.png", x: 1, y: 0 },
        { id: "c", mip: 0, uri: "c.png", x: 2, y: 0 },
      ],
      physicalSlots: 4,
      width: 128,
    });
    const resource = new VirtualTextureRuntimeResource(manifest);

    resource.demand([
      { frame: 7, page: { mip: 0, x: 0, y: 0 }, priority: 1 },
      { frame: 7, page: { mip: 0, x: 1, y: 0 }, priority: 2 },
      { frame: 7, page: { mip: 0, x: 2, y: 0 }, priority: 3 },
    ]);

    const plan = resource.planUploads({
      currentFrame: 7,
      maxPageUploads: 3,
      maxUploadBytes: manifest.pageByteSize,
    });

    expect(plan.uploads.map((upload) => upload.pageKey)).toEqual(["0/2/0"]);
    expect(resource.stats()).toEqual({
      failedPages: 0,
      loadingPages: 1,
      requestedPages: 2,
      residentPages: 0,
    });
  });

  it("protects resident parents during child uploads and downgrades evicted children to parent fallback entries", () => {
    const manifest = createVirtualTextureRuntimeManifest({
      height: 256,
      mipCount: 3,
      pageSize: 64,
      pages: [],
      physicalSlots: 2,
      uriTemplate: "page-{mip}-{x}-{y}.png",
      width: 256,
    });
    const resource = new VirtualTextureRuntimeResource(manifest);

    resource.markUploaded({ mip: 1, x: 0, y: 0 });
    resource.pageTable.takeDirtyPageTableUpdates();
    resource.markUploaded({ mip: 0, x: 0, y: 0 });
    resource.pageTable.takeDirtyPageTableUpdates();
    const assignment = resource.markUploaded({ mip: 0, x: 1, y: 0 });

    expect(assignment.evicted).toEqual(expect.objectContaining({ pageKey: "0/0/0" }));
    expect(resource.pageTable.residentSlot({ mip: 1, x: 0, y: 0 })).toBe(0);
    expect(resource.pageTable.takeDirtyPageTableUpdates()).toEqual([
      expect.objectContaining({
        fallbackMipOffset: 1,
        fallbackPageKey: "1/0/0",
        pageKey: "0/0/0",
        slot: 0,
      }),
      expect.objectContaining({ pageKey: "0/1/0", slot: 1 }),
    ]);
  });

  it("encodes RGBA8 page-table entries and keeps dirty updates incremental after init", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };

    expect(encodeVirtualTexturePageTableRgba8({ slot: 0 })).toEqual([1, 0, 0, 255]);
    expect(encodeVirtualTexturePageTableRgba8({ fallbackMipOffset: 2, slot: 256 })).toEqual([1, 1, 2, 255]);
    expect(encodeVirtualTexturePageTableRgba8({})).toEqual([0, 0, 0, 0]);

    table.ensureResident(page);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page, pageKey: "0/0/0", slot: 0 },
    ]);
    table.ensureResident(page);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);
  });
});

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
  readonly result?: unknown;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type FetchRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: Response) => void;
  readonly url: string;
};

const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  size: CanvasSize = { height: 128, width: 128 },
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

  if (gl !== null) {
    (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;
  }

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (options: { readonly maxTextureImageUnits?: number; readonly maxTextureSize?: number } = {}): FakeGl => {
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
    calls.push(result === undefined ? { args, name } : { args, name, result });
    return result;
  });

  const glTarget = {
    ...constants,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindTexture: record("bindTexture"),
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => handle<WebGLBuffer>("buffer")),
    createProgram: record("createProgram", () => handle<WebGLProgram>("program")),
    createShader: record("createShader", () => handle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => handle<WebGLTexture>("texture")),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    depthFunc: record("depthFunc"),
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
    texSubImage2D: record("texSubImage2D"),
    uniform1i: record("uniform1i"),
    uniform2fv: record("uniform2fv"),
    uniform3fv: record("uniform3fv"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
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
}

const installFetchQueue = (): FetchRequest[] => {
  const requests: FetchRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve, reject) => {
    requests.push({
      reject,
      resolve,
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input),
    });
  })));
  return requests;
};

const responseJson = (body: unknown): Response => ({
  json: vi.fn(() => Promise.resolve(body)),
  ok: true,
  status: 200,
  statusText: "OK",
}) as unknown as Response;

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

const renderScene = (material: Material) => scene({
  children: [
    pass({
      camera: camera(),
      children: [
        directionalLight({
          color: [1, 1, 1, 1],
          direction: [0, 0, -1],
        }),
        mesh({
          geometry: planeGeometry([2, 2]),
          material,
        }),
      ],
      clearColor: [0, 0, 0, 0],
    }),
  ],
});

const vtManifest = (physicalSlots = 2) => ({
  fallbackColor: [1, 0, 1, 1],
  pageSize: 4,
  pages: {
    entries: {
      "m0/0/0": "pages/0-0.png",
      "m0/1/0": "pages/1-0.png",
      "m0/2/0": "pages/2-0.png",
    },
  },
  physicalSlots,
  virtualSize: [12, 4],
});

const vtParentFallbackManifest = (physicalSlots = 3) => ({
  fallbackColor: [1, 0, 1, 1],
  mipCount: 2,
  pageSize: 4,
  pages: {
    entries: {
      "m1/0/0": "pages/m1-0-0.png",
      "m0/0/0": "pages/m0-0-0.png",
      "m0/1/0": "pages/m0-1-0.png",
      "m0/2/0": "pages/m0-2-0.png",
    },
  },
  physicalSlots,
  virtualSize: [12, 4],
});

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const textureAllocations = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" && call.args.length >= 9);

const pageUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && call.args[4] === 4
    && call.args[5] === 4);

const pageTableUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && call.args[4] === 1
    && call.args[5] === 1);

const texParameterTriples = (calls: readonly GlCall[]): readonly (readonly unknown[])[] =>
  calls
    .filter((call) => call.name === "texParameteri")
    .map((call) => call.args.slice(0, 3));

const texParameterGroups = (calls: readonly GlCall[]): readonly (readonly (readonly unknown[])[])[] => {
  const triples = texParameterTriples(calls);
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

const imageBySrc = (fragment: string): ControlledImage | undefined =>
  ControlledImage.instances.find((image) => image.src.includes(fragment));

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
});

describe("WebGL renderer virtual texturing integration", () => {
  it("fetches and parses a VT manifest without treating the manifest as an ordinary image texture", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/manifest.json"]);
    expect(ControlledImage.instances).toHaveLength(0);
    expect(textureAllocations(calls)).toEqual([]);
    expect(root.snapshot().virtualTexturing.manifestRequests).toBe(1);

    fetchRequests[0]!.resolve(responseJson(vtManifest()));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/0-0.png",
      "/vt/pages/1-0.png",
    ]);
    expect(root.snapshot().virtualTexturing.manifestsReady).toBe(1);
  });

  it("allocates private atlas and page-table textures after manifest parse", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest()));
    await flushMicrotasks();

    expect(textureAllocations(calls).map((call) => call.args.slice(2, 7))).toEqual(expect.arrayContaining([
      [gl.RGBA8, 8, 4, 0, gl.RGBA],
      [gl.RGBA8, 3, 1, 0, gl.RGBA],
    ]));
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      atlasTextures: 1,
      pageTableTextures: 1,
      requestedPages: 2,
    }));
  });

  it("keeps VT physical textures clamped, collapses atlas mip filters, and never generates atlas mipmaps", async () => {
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

  it("collapses nearest mipmap min filters to nearest for the VT atlas", async () => {
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

  it("uploads requested VT pages through atlas texSubImage2D within the physical-slot budget", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(2)));
    await flushMicrotasks();

    const initialBatch = ControlledImage.instances.slice();
    expect(initialBatch).toHaveLength(2);
    for (const image of initialBatch) image.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(2);
    expect(pageUploads(calls).every((call) => call.args[0] === gl.TEXTURE_2D)).toBe(true);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      pageTableUpdates: 2,
      residentPages: 2,
      uploadedPages: 2,
    }));
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
      "/vt/pages/m0-0-0.png",
      "/vt/pages/m0-1-0.png",
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

    const writes = pageTableUploads(calls);
    expect(writes.map((call) => [call.args[2], call.args[3], uploadPayload(call)])).toEqual([
      [0, 0, [1, 0, 1, 255]],
      [1, 0, [1, 0, 1, 255]],
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

    const writes = pageTableUploads(calls).map((call) => [call.args[2], call.args[3], uploadPayload(call)]);
    expect(writes).toEqual([
      [0, 0, [1, 0, 1, 255]],
      [1, 0, [1, 0, 1, 255]],
      [0, 0, [2, 0, 0, 255]],
    ]);
  });

  it("uses the shared page-table encoding path for eviction downgrades to resident parents", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(2)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    imageBySrc("m0-0-0")?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    expect(imageBySrc("m0-1-0")).toBeDefined();
    imageBySrc("m0-1-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map((call) => [call.args[2], call.args[3], uploadPayload(call)]);
    expect(writes).toEqual(expect.arrayContaining([
      [0, 0, [1, 0, 1, 255]],
      [1, 0, [1, 0, 1, 255]],
      [0, 0, [2, 0, 0, 255]],
      [0, 0, [1, 0, 1, 255]],
      [1, 0, [2, 0, 0, 255]],
    ]));
  });

  it("binds VT shader resources instead of the ordinary u_texture sampler after page upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(calls.some((call) =>
      call.name === "shaderSource"
      && typeof call.args[1] === "string"
      && call.args[1].includes("u_vtPageTable"))).toBe(true);
    expect(calls.some((call) =>
      call.name === "shaderSource"
      && typeof call.args[1] === "string"
      && call.args[1].includes("tableEntry.g")
      && call.args[1].includes("fallbackMipOffset")
      && call.args[1].includes("residentPageTableSize"))).toBe(true);
    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
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
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
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

    expect(calls.some((call) =>
      call.name === "shaderSource"
      && typeof call.args[1] === "string"
      && call.args[1].includes("wrapVirtualTextureUv")
      && call.args[1].includes("u_vtWrapS")
      && call.args[1].includes("u_vtWrapT"))).toBe(true);
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
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtWrapS: expect.arrayContaining([0]),
      u_vtWrapT: expect.arrayContaining([0]),
    }));
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

  it("records unsupported capability fallback and rejects WebGL1 contexts explicitly", async () => {
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

  it("uses fixed fallback diagnostics for VT materials outside the first supported path", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(standardMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(root.snapshot().virtualTexturing.unsupportedDraws).toBeGreaterThan(0);
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/only unlit base-color virtual textures/i);
    expect(consoleWarn).toHaveBeenCalled();
  });
});
