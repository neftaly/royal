import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  imageTexture,
  mesh,
  orthographicCamera,
  scene,
  unlitMaterial,
  wireframeMaterial,
  type Geometry,
  type Material,
  type LinearRgba,
} from "@royal/renderer-core";
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "../packages/renderer-webgl/src/resource-governor";
import { createWebGlRootWithResourcePolicy as createWebGlRoot } from "../packages/renderer-webgl/src/root";

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

type FakeCanvas = HTMLCanvasElement & {
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): Event;
  getContext: ReturnType<typeof vi.fn>;
};

type GlEvent = {
  readonly name: string;
  readonly args: readonly unknown[];
};

type FakeGl = {
  readonly calls: readonly GlEvent[];
  readonly gl: WebGL2RenderingContext;
};

type ResourceCounts = {
  readonly createBuffer: number;
  readonly createProgram: number;
  readonly createShader: number;
  readonly createTexture: number;
  readonly deleteBuffer: number;
  readonly deleteProgram: number;
  readonly deleteShader: number;
  readonly deleteTexture: number;
  readonly draw: number;
};

type GpuHandle =
  | WebGLBuffer
  | WebGLProgram
  | WebGLShader
  | WebGLTexture
  | WebGLUniformLocation
  | WebGLVertexArrayObject;

const makeHandle = <Handle extends GpuHandle>(kind: string): Handle =>
  ({ kind, id: Symbol(kind) } as unknown as Handle);

const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  size: CanvasSize = { width: 320, height: 180 },
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

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (): FakeGl => {
  const calls: GlEvent[] = [];
  const uniform = makeHandle<WebGLUniformLocation>("uniform");
  const attribLocations = new Map<string, number>();

  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    calls.push({ name, args });
    return implementation?.(...args);
  });

  const attribLocation = (name: string): number => {
    const existing = attribLocations.get(name);
    if (existing !== undefined) return existing;
    const next = attribLocations.size;
    attribLocations.set(name, next);
    return next;
  };

  const gl = {
    ACTIVE_TEXTURE: 0x84E0,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0BE2,
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
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    REPEAT: 0x2901,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    SCISSOR_TEST: 0x0C11,
    SRC_ALPHA: 0x0302,
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
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindFramebuffer: record("bindFramebuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendEquationSeparate: record("blendEquationSeparate"),
    blendFuncSeparate: record("blendFuncSeparate"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => makeHandle<WebGLBuffer>("buffer")),
    createProgram: record("createProgram", () => makeHandle<WebGLProgram>("program")),
    createShader: record("createShader", () => makeHandle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => makeHandle<WebGLTexture>("texture")),
    createVertexArray: record("createVertexArray", () => makeHandle<WebGLVertexArrayObject>("vertexArray")),
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    detachShader: record("detachShader"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    generateMipmap: record("generateMipmap"),
    getAttribLocation: record("getAttribLocation", (_program: WebGLProgram, name: string) => attribLocation(name)),
    getContextAttributes: record("getContextAttributes", () => ({ alpha: true, antialias: true })),
    getError: record("getError", () => 0),
    getExtension: record("getExtension", () => null),
    getParameter: record("getParameter", () => 4096),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record("getProgramParameter", () => true),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record("getShaderParameter", () => true),
    getUniformLocation: record("getUniformLocation", () => uniform),
    isContextLost: record("isContextLost", () => false),
    linkProgram: record("linkProgram"),
    lineWidth: record("lineWidth"),
    pixelStorei: record("pixelStorei"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    uniform1i: record("uniform1i"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    validateProgram: record("validateProgram"),
    vertexAttrib2f: record("vertexAttrib2f"),
    vertexAttrib4f: record("vertexAttrib4f"),
    vertexAttribDivisor: record("vertexAttribDivisor"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  } as unknown as WebGL2RenderingContext;

  return { calls, gl };
};

class ControlledImage {
  static readonly instances: ControlledImage[] = [];
  static closeFailures = 2;

  complete = false;
  closeAttempts = 0;
  crossOrigin: string | null = null;
  height = 2;
  naturalHeight = 2;
  naturalWidth = 2;
  onerror: OnErrorEventHandler = null;
  onload: ((this: HTMLImageElement, event: Event) => unknown) | null = null;
  width = 2;
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
    this.closeAttempts += 1;
    if (this.closeAttempts <= ControlledImage.closeFailures) throw new Error("image close failed");
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  settleLoad(): void {
    this.complete = true;
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
    this.dispatch("load");
  }

  private dispatch(type: string): void {
    const event = new Event(type);
    if (type === "load") this.onload?.call(this as unknown as HTMLImageElement, event);

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

const material = (color: LinearRgba = [1, 1, 1, 1]): Material => unlitMaterial({ color });

const renderScene = (
  geometry: Geometry = boxGeometry(1),
  meshMaterial: Material = material(),
) => scene({
  camera: camera(),
  nodes: [
    mesh({
      geometry,
      material: meshMaterial,
    }),
  ],
  clearColor: [0, 0, 0, 0],
});

const countEvents = (events: readonly GlEvent[], name: string): number =>
  events.filter((event) => event.name === name).length;

const resourceCounts = (events: readonly GlEvent[]): ResourceCounts => ({
  createBuffer: countEvents(events, "createBuffer"),
  createProgram: countEvents(events, "createProgram"),
  createShader: countEvents(events, "createShader"),
  createTexture: countEvents(events, "createTexture"),
  deleteBuffer: countEvents(events, "deleteBuffer"),
  deleteProgram: countEvents(events, "deleteProgram"),
  deleteShader: countEvents(events, "deleteShader"),
  deleteTexture: countEvents(events, "deleteTexture"),
  draw: countEvents(events, "drawArrays") + countEvents(events, "drawElements"),
});

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
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

const flushAnimationFrames = (callbacks: FrameRequestCallback[]): void => {
  const queued = callbacks.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
  ControlledImage.closeFailures = 2;
});

describe("WebGL renderer resource lifetime contracts", () => {
  it("retries a CPU-denied decoded source after scene removal releases capacity", async () => {
    ControlledImage.closeFailures = 0;
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    const frames = installAnimationFrameQueue();
    const { gl } = fakeGl();
    const cpuBudget = 16;
    const resourceGovernorPolicy: ResourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      classes: Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
        ([key, value]) => [key, {
          ...value,
          cpuDecodedBytes: { mandatoryFloor: 0, softLimit: cpuBudget },
        }],
      )) as unknown as ResourceGovernorPolicy["classes"],
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, cpuDecodedBytes: cpuBudget },
    };
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy });
    const first = unlitMaterial({ texture: imageTexture("/textures/cpu-first.png") });
    const second = unlitMaterial({ texture: imageTexture("/textures/cpu-second.png") });
    const both = scene({
      camera: camera(),
      nodes: [
        mesh({ geometry: boxGeometry(1), material: first }),
        mesh({ geometry: boxGeometry(1), material: second }),
      ],
    });

    root.render(both);
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    expect(root.snapshot().resourceGovernor.byClass["ordinary-texture"].cpuDecodedBytes).toBe(16);
    expect(ControlledImage.instances).toHaveLength(2);

    root.render(renderScene(boxGeometry(1), second));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    ControlledImage.instances[2]!.settleLoad();
    await flushMicrotasks();
    flushAnimationFrames(frames);
    expect(root.snapshot().resourceGovernor.byClass["ordinary-texture"].cpuDecodedBytes).toBe(16);
    root.dispose();
  });
  it("bounds shader program initiation to one variant per rendered frame", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const multiVariantScene = scene({
      camera: camera(),
      nodes: [
            mesh({ geometry: boxGeometry(1), material: material([0.2, 0.6, 1, 1]) }),
            mesh({
              geometry: boxGeometry(1),
              material: wireframeMaterial({ color: [1, 0.8, 0.1, 1], width: 1 }),
            }),
      ],
      clearColor: [0, 0, 0, 0],
    });

    root.render(multiVariantScene);
    expect(resourceCounts(calls).createProgram, "the first frame should initiate one variant").toBe(1);

    root.render(multiVariantScene);
    expect(resourceCounts(calls).createProgram, "the next frame should drain one queued variant").toBe(2);

    root.dispose();
  });

  it("deletes owned programs, shaders, and buffers when disposed", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene());

    const created = resourceCounts(calls);
    expect(created.createProgram, "rendering a mesh should create at least one program").toBeGreaterThan(0);
    expect(created.createShader, "rendering a mesh should create shader resources").toBeGreaterThan(0);
    expect(created.createBuffer, "rendering a mesh should create geometry buffers").toBeGreaterThan(0);

    root.dispose();

    const disposed = resourceCounts(calls);
    expect(disposed.deleteProgram, "dispose should delete every program the root created").toBe(disposed.createProgram);
    expect(disposed.deleteShader, "dispose should delete every shader the root created").toBe(disposed.createShader);
    expect(disposed.deleteBuffer, "dispose should delete every buffer the root created").toBe(disposed.createBuffer);
    const firstBufferDelete = calls.findIndex((call) => call.name === "deleteBuffer");
    let lastVertexArrayDelete = -1;
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      if (calls[index]?.name !== "deleteVertexArray") continue;
      lastVertexArrayDelete = index;
      break;
    }
    expect(lastVertexArrayDelete, "rendering geometry should create a vertex array to dispose").toBeGreaterThanOrEqual(0);
    expect(firstBufferDelete, "vertex arrays must be deleted before their backing buffers").toBeGreaterThan(
      lastVertexArrayDelete,
    );
  });

  it("reuses existing GPU programs and buffers for stable repeated renders", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const stableScene = renderScene(boxGeometry(1), material([0.2, 0.6, 1, 1]));

    root.render(stableScene);
    const afterFirstRender = resourceCounts(calls);

    root.render(stableScene);
    const afterSecondRender = resourceCounts(calls);

    expect(afterFirstRender.draw, "the first render should draw the scene").toBeGreaterThan(0);
    expect(afterSecondRender.draw, "the second render should draw the scene again").toBeGreaterThan(afterFirstRender.draw);
    expect(afterSecondRender.createProgram, "stable renders should not create replacement programs").toBe(afterFirstRender.createProgram);
    expect(afterSecondRender.createShader, "stable renders should not create replacement shaders").toBe(afterFirstRender.createShader);
    expect(afterSecondRender.createBuffer, "stable renders should not create replacement buffers").toBe(afterFirstRender.createBuffer);
  });

  it("releases replaced buffer resources when rendered geometry changes", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const sharedMaterial = material([1, 0.8, 0.1, 1]);

    root.render(renderScene(boxGeometry(1), sharedMaterial));
    const afterInitialGeometry = resourceCounts(calls);

    root.render(renderScene(boxGeometry([2, 1, 1]), sharedMaterial));
    const afterChangedGeometry = resourceCounts(calls);

    expect(afterInitialGeometry.createBuffer, "initial geometry should allocate buffers").toBeGreaterThan(0);
    expect(afterChangedGeometry.createBuffer, "changed geometry should allocate replacement buffers").toBeGreaterThan(
      afterInitialGeometry.createBuffer,
    );
    expect(afterChangedGeometry.deleteBuffer, "buffers for replaced geometry should be released").toBeGreaterThan(
      afterInitialGeometry.deleteBuffer,
    );

    root.dispose();

    const afterDispose = resourceCounts(calls);
    expect(afterDispose.deleteBuffer, "dispose should release any replacement buffers still alive").toBe(
      afterDispose.createBuffer,
    );
  });

  it("finishes pending geometry cleanup during disposal after a driver deletion fails", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const sharedMaterial = material([1, 0.8, 0.1, 1]);
    root.render(renderScene(boxGeometry(1), sharedMaterial));
    const deleteBuffer = Reflect.get(gl, "deleteBuffer") as ReturnType<typeof vi.fn>;
    deleteBuffer.mockImplementationOnce(() => {
      throw new Error("injected deleteBuffer failure");
    });

    expect(() => root.render(renderScene(boxGeometry([2, 1, 1]), sharedMaterial)))
      .toThrow(/injected deleteBuffer failure/);
    expect(() => root.dispose()).not.toThrow();
    expect(() => root.dispose()).not.toThrow();
  });

  it("makes dispose idempotent and rejects render after disposal with a clear error", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const drawableScene = renderScene();

    root.render(drawableScene);
    root.dispose();
    const afterFirstDispose = resourceCounts(calls);

    expect(() => root.dispose()).not.toThrow();
    expect(resourceCounts(calls), "a second dispose should not delete resources twice").toEqual(afterFirstDispose);
    expect(() => root.render(drawableScene)).toThrow(/disposed/i);
    expect(resourceCounts(calls), "render after dispose should not allocate or draw").toEqual(afterFirstDispose);
  });

  it("settles async image textures with a follow-up render signal and releases texture resources", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    const animationFrames = installAnimationFrameQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const texturedMaterial = unlitMaterial({
      texture: imageTexture("/textures/checker.png"),
    });

    root.render(renderScene(boxGeometry(1), texturedMaterial));
    const beforeSettle = resourceCounts(calls);
    const requestedImage = ControlledImage.instances[0];

    expect(
      beforeSettle.createTexture,
      "an undecoded image must not allocate GPU storage before governor admission",
    ).toBe(0);
    expect(requestedImage, "image texture render should request an image").toBeDefined();
    expect(requestedImage?.src, "image texture render should request the configured URI").toContain("/textures/checker.png");

    const scheduledBeforeSettle = animationFrames.length;
    requestedImage?.settleLoad();
    await flushMicrotasks();

    const scheduledByImageSettle = animationFrames.length > scheduledBeforeSettle;
    const drewImmediately = resourceCounts(calls).draw > beforeSettle.draw;
    flushAnimationFrames(animationFrames);
    await flushMicrotasks();

    const afterSettle = resourceCounts(calls);
    expect(afterSettle.createTexture, "settling the image should admit and allocate its texture").toBeGreaterThan(0);
    const settledSnapshot = root.snapshot();
    expect(settledSnapshot.resourceGovernor.byClass["ordinary-texture"].cpuDecodedBytes)
      .toBe(settledSnapshot.textureResidency.preparedBytes);
    expect(settledSnapshot.textureResidency.preparedBytes).toBe(2 * 2 * 4);
    expect(
      scheduledByImageSettle || drewImmediately || afterSettle.draw > beforeSettle.draw,
      "loaded image textures should schedule or cause a follow-up render",
    ).toBe(true);

    expect(() => root.dispose()).toThrow("image close failed");
    expect(root.snapshot().resourceGovernor.byClass["ordinary-texture"].cpuDecodedBytes)
      .toBe(2 * 2 * 4);
    expect(() => root.dispose()).not.toThrow();

    const afterDispose = resourceCounts(calls);
    expect(afterDispose.deleteTexture, "dispose should delete every texture the root created").toBe(
      afterDispose.createTexture,
    );
    expect(root.snapshot().resourceGovernor.byClass["ordinary-texture"].cpuDecodedBytes).toBe(0);
  });

  it.each([
    {
      label: "default policy",
      policy: undefined,
      size: 2_049,
      uploadLimit: DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.uploadBytes,
    },
    {
      label: "custom policy",
      policy: {
        ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
        limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, uploadBytes: 1_024 },
      } satisfies ResourceGovernorPolicy,
      size: 17,
      uploadLimit: 1_024,
    },
  ])("quiesces an ordinary upload larger than the $label frame limit", async ({
    policy,
    size,
    uploadLimit,
  }) => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    const animationFrames = installAnimationFrameQueue();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, policy === undefined ? undefined : {
      resourceGovernorPolicy: policy,
    });
    const texturedScene = renderScene(boxGeometry(1), unlitMaterial({
      texture: imageTexture(`/textures/oversized-${size}.png`),
    }));

    root.render(texturedScene);
    const requestedImage = ControlledImage.instances[0]!;
    requestedImage.width = size;
    requestedImage.height = size;
    requestedImage.naturalWidth = size;
    requestedImage.naturalHeight = size;
    requestedImage.settleLoad();
    await flushMicrotasks();
    flushAnimationFrames(animationFrames);
    await flushMicrotasks();

    expect(countEvents(calls, "createTexture")).toBe(0);
    expect(countEvents(calls, "texImage2D")).toBe(0);
    expect(animationFrames).toHaveLength(0);
    expect(root.snapshot().diagnostics).toContainEqual(expect.stringMatching(
      new RegExp(`requires \\d+ upload bytes, exceeding the per-frame limit ${uploadLimit}`),
    ));
    expect(warning).toHaveBeenCalledTimes(1);
    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    flushAnimationFrames(animationFrames);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    expect(countEvents(calls, "createTexture")).toBe(0);
    expect(animationFrames).toHaveLength(0);
    expect(root.snapshot().resourceGovernor.byClass["ordinary-texture"].cpuDecodedBytes).toBe(0);
    expect(() => root.dispose()).not.toThrow();
  });

  it("terminally rejects an ordinary allocation above its mandatory-floor-adjusted maximum", async () => {
    ControlledImage.closeFailures = 0;
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    const frames = installAnimationFrameQueue();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const persistentLimit = DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.persistentGpuBytes;
    const floor = persistentLimit - 15;
    const classes = Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
      ([key, value]) => [key, {
        ...value,
        persistentGpuBytes: key === "geometry"
          ? { mandatoryFloor: floor, softLimit: floor }
          : { mandatoryFloor: 0, softLimit: value.persistentGpuBytes.softLimit },
      }],
    )) as unknown as ResourceGovernorPolicy["classes"];
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl), {
      resourceGovernorPolicy: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY, classes },
    });
    const graph = renderScene(boxGeometry(1), unlitMaterial({
      texture: imageTexture("/textures/floor-impossible.png"),
    }));

    root.render(graph);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    flushAnimationFrames(frames);
    await flushMicrotasks();

    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/requires 20 persistent GPU bytes, exceeding the limit 15/);
    expect(frames).toHaveLength(0);
    expect(warning).toHaveBeenCalledTimes(1);
    root.dispose();
  });

  it("recovers an at-maximum ordinary allocation when a peer releases floor-adjusted capacity", async () => {
    ControlledImage.closeFailures = 0;
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    installAnimationFrameQueue();
    const { calls, gl } = fakeGl();
    const persistentLimit = DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.persistentGpuBytes;
    const floor = persistentLimit - 20;
    const classes = Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
      ([key, value]) => [key, {
        ...value,
        persistentGpuBytes: key === "geometry"
          ? { mandatoryFloor: floor, softLimit: floor }
          : { mandatoryFloor: 0, softLimit: value.persistentGpuBytes.softLimit },
      }],
    )) as unknown as ResourceGovernorPolicy["classes"];
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY, classes },
    });
    const first = unlitMaterial({ texture: imageTexture("/textures/gpu-first.png") });
    const second = unlitMaterial({ texture: imageTexture("/textures/gpu-second.png") });
    const both = scene({
      camera: camera(),
      nodes: [
        mesh({ geometry: boxGeometry(1), material: first }),
        mesh({ geometry: boxGeometry(1), material: second }),
      ],
    });

    root.render(both);
    ControlledImage.instances[0]!.settleLoad();
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    root.render(both);
    root.render(both);
    expect(countEvents(calls, "createTexture")).toBe(1);
    expect(root.snapshot().diagnostics.join("\n")).not.toContain("gpu-second");

    root.render(renderScene(boxGeometry(1), second));
    expect(countEvents(calls, "createTexture")).toBe(2);
    root.dispose();
  });
});
