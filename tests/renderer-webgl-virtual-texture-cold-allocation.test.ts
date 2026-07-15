import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
  type Material,
} from "@royal/renderer-core";
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "../packages/renderer-webgl/src/resource-governor";
import { createWebGlRootWithResourcePolicy as createWebGlRoot } from "../packages/renderer-webgl/src/root";
import { preloadVirtualTextureFeature } from "../packages/renderer-webgl/src/virtual-texture/lazy-feature";

await preloadVirtualTextureFeature();

type GlCall = { readonly args: readonly unknown[]; readonly name: string };
type FetchRequest = { readonly resolve: (response: Response) => void; readonly url: string };

const roots = new Set<ReturnType<typeof createWebGlRoot>>();

class PendingImage {
  static readonly instances: PendingImage[] = [];
  static readonly startedSrcs: string[] = [];

  complete = false;
  crossOrigin: string | null = null;
  height = 6;
  naturalHeight = 6;
  naturalWidth = 6;
  onerror: OnErrorEventHandler = null;
  onload: ((this: HTMLImageElement, event: Event) => unknown) | null = null;
  width = 6;
  #src = "";

  constructor() {
    PendingImage.instances.push(this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    if (value !== "") PendingImage.startedSrcs.push(value);
  }

  addEventListener(): void {}
  close(): void {}
  decode(): Promise<void> { return new Promise(() => undefined); }
  removeEventListener(): void {}
}

const responseJson = (body: unknown): Response => ({
  json: vi.fn(() => Promise.resolve(body)),
  ok: true,
  status: 200,
  statusText: "OK",
}) as unknown as Response;

const installFetchQueue = (): FetchRequest[] => {
  const requests: FetchRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve) => {
    requests.push({
      resolve,
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input),
    });
  })));
  return requests;
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const manifest = (physicalSlots = 1) => ({
  borderTexels: 1,
  contractVersion: 2,
  pageSize: 4,
  pages: { entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }] },
  physicalSlots,
  virtualSize: [4, 4],
});

const largeManifest = () => ({
  ...manifest(),
  virtualSize: [32, 32],
});

const constrainedPolicy = (virtualTextureBytes: number): ResourceGovernorPolicy => {
  const classPolicy = () => ({
    cpuDecodedBytes: { mandatoryFloor: 0 },
    persistentGpuBytes: { mandatoryFloor: 0 },
  });
  return {
    ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
    classes: {
      "asset-decode": classPolicy(),
      geometry: classPolicy(),
      "ordinary-texture": classPolicy(),
      "render-target": classPolicy(),
      "virtual-texture": {
        ...classPolicy(),
        persistentGpuBytes: {
          hardLimit: virtualTextureBytes,
          mandatoryFloor: 0,
        },
      },
    },
  };
};

const fakeGl = (deleteFailure?: { enabled: boolean }): {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
} => {
  const calls: GlCall[] = [];
  let nextHandle = 1;
  const constants: Record<string, number> = {
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
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    NEAREST: 0x2600,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    RGBA8: 0x8058,
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
  };
  const target: Record<PropertyKey, unknown> = {};
  const record = (name: string, implementation?: (...args: readonly unknown[]) => unknown) =>
    (...args: readonly unknown[]) => {
      const captured = args.map((arg) => ArrayBuffer.isView(arg) ? new Uint8Array(
        arg.buffer.slice(arg.byteOffset, arg.byteOffset + arg.byteLength),
      ) : arg);
      calls.push({ args: captured, name });
      return implementation?.(...args);
    };
  const methods = new Map<string, (...args: readonly unknown[]) => unknown>();
  const method = (name: string): ((...args: readonly unknown[]) => unknown) => {
    const existing = methods.get(name);
    if (existing !== undefined) return existing;
    const implementation = name.startsWith("create")
      ? () => ({ id: nextHandle++, kind: name.slice(6) })
      : name === "checkFramebufferStatus"
        ? () => constants.FRAMEBUFFER_COMPLETE
        : name === "getAttribLocation"
          ? (_program: unknown, attribute: unknown) => String(attribute).toLowerCase().includes("uv") ? 2 : 0
          : name === "getContextAttributes"
            ? () => ({ alpha: true, antialias: true })
            : name === "getExtension"
              ? (extension: unknown) => extension === "EXT_color_buffer_float" ? {} : null
              : name === "getParameter"
                ? (parameter: unknown) => parameter === constants.MAX_TEXTURE_IMAGE_UNITS
                  ? 8
                  : parameter === constants.MAX_TEXTURE_SIZE ? 4096 : 0
                : name === "getProgramInfoLog" || name === "getShaderInfoLog"
                  ? () => ""
                  : name === "getProgramParameter"
                    ? (_program: unknown, parameter: unknown) =>
                      parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS ? 0 : true
                    : name === "getShaderParameter"
                      ? () => true
                      : name === "getUniformLocation"
                        ? (_program: unknown, uniformName: unknown) => ({ name: uniformName })
                        : name === "deleteTexture" && deleteFailure !== undefined
                          ? () => {
                            if (deleteFailure.enabled) throw new Error("delete texture failure");
                          }
                          : undefined;
    const created = record(name, implementation);
    methods.set(name, created);
    return created;
  };
  const gl = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      if (typeof property === "string" && property in constants) return constants[property];
      return typeof property === "string" ? method(property) : undefined;
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as WebGL2RenderingContext;
  return { calls, gl };
};

const fakeCanvas = (
  gl: WebGL2RenderingContext,
  size: { height: number; width: number } = { height: 128, width: 128 },
): HTMLCanvasElement & {
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): void;
} => {
  const events = new EventTarget();
  const canvas = {
    addEventListener: events.addEventListener.bind(events),
    get clientHeight() { return size.height; },
    get clientWidth() { return size.width; },
    dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored") {
      events.dispatchEvent(new Event(type, { cancelable: true }));
    },
    getBoundingClientRect: () => ({
      bottom: size.height,
      height: size.height,
      left: 0,
      right: size.width,
      top: 0,
      width: size.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    getContext: (kind: string) => kind === "webgl2" ? gl : null,
    height: 0,
    removeEventListener: events.removeEventListener.bind(events),
    width: 0,
  } as unknown as HTMLCanvasElement & {
    dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): void;
  };
  (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas;
  return canvas;
};

const camera = () => orthographicCamera({
  bottom: -1, far: 10, left: -1, near: 0.1, position: [0, 0, 4], right: 1, top: 1,
});

const graph = (...materials: readonly Material[]) => scene({
  camera: camera(),
  clearColor: [0, 0, 0, 0],
  nodes: materials.map((material) => mesh({ geometry: planeGeometry([1, 1]), material })),
});

const positionedGraph = (
  entries: readonly { readonly material: Material; readonly x: number }[],
) => scene({
  camera: camera(),
  clearColor: [0, 0, 0, 0],
  nodes: entries.map(({ material, x }) => mesh({
    geometry: planeGeometry([1, 1]),
    material,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0] },
  })),
});

const createRoot = (
  gl: WebGL2RenderingContext,
  virtualTextureBytes: number,
): ReturnType<typeof createWebGlRoot> => {
  const root = createWebGlRoot(fakeCanvas(gl), {
    resourceGovernorPolicy: constrainedPolicy(virtualTextureBytes),
  });
  roots.add(root);
  return root;
};

const preparePair = async (
  root: ReturnType<typeof createWebGlRoot>,
  requests: FetchRequest[],
  first: Material,
  second: Material,
  secondManifest: unknown = manifest(),
): Promise<void> => {
  const bothVisible = positionedGraph([
    { material: first, x: 0 },
    { material: second, x: 0 },
  ]);
  root.render(bothVisible);
  expect(requests.length).toBeGreaterThan(0);
  requests[0]!.resolve(responseJson(manifest()));
  await flushMicrotasks();
  if (requests.length < 2) root.render(bothVisible);
  expect(requests).toHaveLength(2);
  requests[1]!.resolve(responseJson(secondManifest));
  await flushMicrotasks();
  root.render(bothVisible);
  await flushMicrotasks();
};

const prepareMaterials = async (
  root: ReturnType<typeof createWebGlRoot>,
  requests: FetchRequest[],
  materials: readonly Material[],
  manifests: readonly unknown[] = materials.map(() => manifest()),
): Promise<void> => {
  const allVisible = positionedGraph(materials.map((material) => ({ material, x: 0 })));
  root.render(allVisible);
  for (let index = 0; index < materials.length; index += 1) {
    if (requests[index] === undefined) {
      await flushMicrotasks();
      root.render(allVisible);
    }
    requests[index]!.resolve(responseJson(manifests[index]));
    await flushMicrotasks();
  }
  root.render(allVisible);
  await flushMicrotasks();
};

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

beforeEach(() => {
  vi.stubGlobal("Image", PendingImage);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
});

afterEach(() => {
  for (const root of roots) root.dispose();
  roots.clear();
  PendingImage.instances.splice(0);
  PendingImage.startedSrcs.splice(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL virtual-texture cold allocation reclamation", () => {
  it("reclaims one oldest cold allocation after its two-frame grace", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createRoot(gl, 160);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const second = unlitMaterial({ texture: virtualTexture("/second/manifest.json") });

    await preparePair(root, requests, first, second);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1, physicalAllocatedBytes: 148 });

    const secondVisible = positionedGraph([
      { material: first, x: 100 },
      { material: second, x: 0 },
    ]);
    root.render(secondVisible);
    expect(root.snapshot().virtualTexturing.atlasTextures).toBe(1);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);

    root.render(secondVisible);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
    root.render(secondVisible);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1, physicalAllocatedBytes: 148 });
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(2);
    expect(PendingImage.instances.at(-1)?.src).toContain("/second/pages/0-0.png");
  });

  it("does not evict or time-slice when every allocation is visible", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createRoot(gl, 160);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const second = unlitMaterial({ texture: virtualTexture("/second/manifest.json") });

    root.render(graph(first, second));
    for (const request of requests) request.resolve(responseJson(manifest()));
    await flushMicrotasks();
    for (let frame = 0; frame < 6; frame += 1) root.render(graph(first, second));

    expect(root.snapshot().virtualTexturing.atlasTextures).toBe(1);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
    expect(PendingImage.instances).toHaveLength(1);
  });

  it("protects demand unioned across both stereo views", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createRoot(gl, 160);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const second = unlitMaterial({ texture: virtualTexture("/second/manifest.json") });
    await preparePair(root, requests, first, second);
    const split = positionedGraph([
      { material: first, x: -2 },
      { material: second, x: 2 },
    ]);

    for (let frame = 0; frame < 6; frame += 1) {
      root.renderViews(split, { views: [stereoView(2, 0), stereoView(-2, 128)] });
    }

    expect(root.snapshot().virtualTexturing.atlasTextures).toBe(1);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
  });

  it("keeps a warm allocation through a one-frame offscreen resize jitter", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const size = { height: 128, width: 128 };
    const root = createWebGlRoot(fakeCanvas(gl, size), {
      resourceGovernorPolicy: constrainedPolicy(160),
    });
    roots.add(root);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const second = unlitMaterial({ texture: virtualTexture("/second/manifest.json") });
    await preparePair(root, requests, first, second);

    size.height = 141;
    size.width = 173;
    root.render(positionedGraph([
      { material: first, x: 100 },
      { material: second, x: 0 },
    ]));
    size.height = 128;
    size.width = 128;
    root.render(positionedGraph([
      { material: first, x: 0 },
      { material: second, x: 100 },
    ]));

    expect(root.snapshot().virtualTexturing.atlasTextures).toBe(1);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
    expect(PendingImage.startedSrcs.every((src) => src === "/first/pages/0-0.png")).toBe(true);
  });

  it("gives three repeatedly competing resources a stable chance without starvation", async () => {
    const requests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createRoot(gl, 160);
    const materials = ["a", "b", "c"].map((name) => unlitMaterial({
      texture: virtualTexture(`/${name}/manifest.json`),
    }));
    await prepareMaterials(root, requests, materials);
    const admitted = new Set(PendingImage.startedSrcs.map((src) => src.split("/")[1]));

    for (let cycle = 0; cycle < 9 && admitted.size < 3; cycle += 1) {
      const incumbent = PendingImage.startedSrcs.at(-1)?.split("/")[1];
      const contenders = positionedGraph(materials.map((material, index) => ({
        material,
        x: ["a", "b", "c"][index] === incumbent ? 100 : 0,
      })));
      for (let frame = 0; frame < 4; frame += 1) root.render(contenders);
      for (const src of PendingImage.startedSrcs) admitted.add(src.split("/")[1]);
    }

    expect(admitted).toEqual(new Set(["a", "b", "c"]));
  });

  it("reclaims at most one cold allocation per frame until a large target fits", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createRoot(gl, 460);
    const materials = ["a", "b", "c", "target"].map((name) => unlitMaterial({
      texture: virtualTexture(`/${name}/manifest.json`),
    }));
    await prepareMaterials(root, requests, materials, [manifest(), manifest(), manifest(), largeManifest()]);
    expect(root.snapshot().virtualTexturing.physicalAllocatedBytes).toBe(444);
    const targetVisible = positionedGraph(materials.map((material, index) => ({
      material,
      x: index === 3 ? 0 : 100,
    })));

    root.render(targetVisible);
    root.render(targetVisible);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
    root.render(targetVisible);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(2);
    root.render(targetVisible);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(4);
    root.render(targetVisible);

    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(6);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1, physicalAllocatedBytes: 400 });
    expect(PendingImage.startedSrcs.at(-1)).toContain("/target/pages/0-0.png");
  });

  it("retains cold allocations when admission fits without pressure", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createRoot(gl, 300);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const second = unlitMaterial({ texture: virtualTexture("/second/manifest.json") });

    await preparePair(root, requests, first, second);
    root.render(positionedGraph([
      { material: first, x: 100 },
      { material: second, x: 0 },
    ]));

    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 2, physicalAllocatedBytes: 296 });
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
  });

  it("does not evict a resident allocation for an intrinsically oversized VT", async () => {
    const requests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createRoot(gl, 160);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const oversized = unlitMaterial({ texture: virtualTexture("/oversized/manifest.json") });

    await preparePair(root, requests, first, oversized, {
      ...manifest(),
      physicalByteBudget: 147,
    });
    const oversizedVisible = positionedGraph([
      { material: first, x: 100 },
      { material: oversized, x: 0 },
    ]);
    for (let frame = 0; frame < 4; frame += 1) root.render(oversizedVisible);

    expect(root.snapshot().virtualTexturing.atlasTextures).toBe(1);
    expect(calls.filter(({ name }) => name === "deleteTexture")).toHaveLength(0);
    expect(root.snapshot().virtualTexturing.unsupportedDraws).toBeGreaterThan(0);
  });

  it("quarantines a failed cold release and clears it on context loss", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requests = installFetchQueue();
    const deleteFailure = { enabled: false };
    const { gl } = fakeGl(deleteFailure);
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { resourceGovernorPolicy: constrainedPolicy(160) });
    roots.add(root);
    const first = unlitMaterial({ texture: virtualTexture("/first/manifest.json") });
    const second = unlitMaterial({ texture: virtualTexture("/second/manifest.json") });

    await preparePair(root, requests, first, second);
    const secondVisible = positionedGraph([
      { material: first, x: 100 },
      { material: second, x: 0 },
    ]);
    root.render(secondVisible);
    root.render(secondVisible);
    deleteFailure.enabled = true;
    expect(() => root.render(secondVisible)).toThrow("delete texture failure");

    expect(root.snapshot().virtualTexturing.physicalQuarantinedBytes).toBe(148);
    expect(
      root.snapshot().resourcePressure.byClass["virtual-texture"].persistentGpuBytes,
    ).toBe(148);
    deleteFailure.enabled = false;
    canvas.dispatchContextEvent("webglcontextlost");
    expect(root.snapshot().virtualTexturing.physicalQuarantinedBytes).toBe(0);
    expect(
      root.snapshot().resourcePressure.byClass["virtual-texture"].persistentGpuBytes,
    ).toBe(0);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(secondVisible);
    expect(root.snapshot().virtualTexturing.atlasTextures).toBe(1);
    expect(PendingImage.instances.at(-1)?.src).toContain("/second/pages/0-0.png");
  });
});
