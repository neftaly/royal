import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  createCameraViewResource,
  createGltfInstanceTransforms,
  gltfInstances,
  mesh,
  orthographicCamera,
  pointLight,
  scene,
  standardMaterial,
  studioEnvironment,
  unlitMaterial,
  virtualTexture,
  type GltfInstanceTransforms,
  type RenderObjectHandle,
  type RenderRoot,
  type Rgba,
} from "@royal/renderer-core";
import {
  createWebGlRoot,
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "@royal/renderer-webgl";
import {
  createWebXrSessionRenderer,
  type WebGlXrFrameSnapshot,
  type WebGlXrLayerConstructor,
  type WebGlXrReferenceSpace,
  type WebGlXrSession,
  type WebGlXrView,
} from "@royal/renderer-webgl/webxr";
import { forEachFuzzCase } from "./fuzz";

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

type FakeCanvas = HTMLCanvasElement & {
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): Event;
  invokeContextEvent(type: "webglcontextlost" | "webglcontextrestored"): {
    readonly event: Event;
    readonly failure: unknown;
    readonly failurePresent: boolean;
  };
  setCssSize(size: CanvasSize): void;
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly name: string;
  readonly args: readonly unknown[];
};

type FakeGl = {
  readonly gl: WebGL2RenderingContext;
  readonly calls: readonly GlCall[];
};

const makeHandle = <Handle>(): Handle => ({} as Handle);

const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  initialSize: CanvasSize = { width: 320, height: 180 },
): FakeCanvas => {
  let cssSize = initialSize;
  const target = new EventTarget();
  const contextListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  const canvas = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      target.addEventListener(type, listener);
      const listeners = contextListeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      contextListeners.set(type, listeners);
    },
    get clientHeight() {
      return cssSize.height;
    },
    get clientWidth() {
      return cssSize.width;
    },
    getBoundingClientRect: vi.fn(() => ({
      bottom: cssSize.height,
      height: cssSize.height,
      left: 0,
      right: cssSize.width,
      top: 0,
      width: cssSize.width,
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
    invokeContextEvent(type: "webglcontextlost" | "webglcontextrestored") {
      const event = new Event(type, { cancelable: true });
      let failure: unknown;
      let failurePresent = false;
      for (const listener of contextListeners.get(type) ?? []) {
        try {
          if (typeof listener === "function") listener.call(canvas, event);
          else listener.handleEvent(event);
        } catch (value) {
          failure = value;
          failurePresent = true;
          break;
        }
      }
      return { event, failure, failurePresent };
    },
    height: 0,
    setCssSize(size: CanvasSize) {
      cssSize = size;
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      target.removeEventListener(type, listener);
      contextListeners.get(type)?.delete(listener);
    },
    width: 0,
  };

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (): FakeGl => {
  const calls: GlCall[] = [];
  const uniform = makeHandle<WebGLUniformLocation>();
  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    calls.push({ name, args });
    return implementation?.(...args);
  });

  const gl = {
    ACTIVE_TEXTURE: 0x84E0,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
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
    MAX_TEXTURE_SIZE: 0x0D33,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    R32UI: 0x8236,
    RED_INTEGER: 0x8D94,
    RENDERBUFFER: 0x8D41,
    RG32UI: 0x823C,
    RG_INTEGER: 0x8228,
    RGBA: 0x1908,
    RGBA16F: 0x881A,
    RGBA32F: 0x8814,
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
    UNSIGNED_INT: 0x1405,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
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
    checkFramebufferStatus: record("checkFramebufferStatus", () => 0x8CD5),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => makeHandle<WebGLBuffer>()),
    createFramebuffer: record("createFramebuffer", () => makeHandle<WebGLFramebuffer>()),
    createProgram: record("createProgram", () => makeHandle<WebGLProgram>()),
    createRenderbuffer: record("createRenderbuffer", () => makeHandle<WebGLRenderbuffer>()),
    createShader: record("createShader", () => makeHandle<WebGLShader>()),
    createTexture: record("createTexture", () => makeHandle<WebGLTexture>()),
    createVertexArray: record("createVertexArray", () => makeHandle<WebGLVertexArrayObject>()),
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
    depthRange: record("depthRange"),
    detachShader: record("detachShader"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    framebufferRenderbuffer: record("framebufferRenderbuffer"),
    framebufferTexture2D: record("framebufferTexture2D"),
    getAttribLocation: record("getAttribLocation", () => 0),
    getContextAttributes: record("getContextAttributes", () => ({ alpha: true, antialias: true })),
    getError: record("getError", () => 0),
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    getParameter: record("getParameter", () => 4096),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record("getProgramParameter", () => true),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record("getShaderParameter", () => true),
    getUniformLocation: record("getUniformLocation", () => uniform),
    linkProgram: record("linkProgram"),
    makeXRCompatible: record("makeXRCompatible", async () => undefined),
    pixelStorei: record("pixelStorei"),
    renderbufferStorage: record("renderbufferStorage"),
    shaderSource: record("shaderSource"),
    scissor: record("scissor"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    texSubImage2D: record("texSubImage2D"),
    uniform1i: record("uniform1i"),
    uniform2fv: record("uniform2fv"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    vertexAttrib2f: record("vertexAttrib2f"),
    vertexAttrib4f: record("vertexAttrib4f"),
    vertexAttribDivisor: record("vertexAttribDivisor"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  } as unknown as WebGL2RenderingContext;

  return { calls, gl };
};

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

const cube = (color: Rgba) => mesh({
  geometry: boxGeometry(1),
  material: unlitMaterial({ color }),
});

const drawableScene = (clearColor: Rgba, color: Rgba = [1, 1, 1, 1]) => scene({
  camera: camera(),
  nodes: [cube(color)],
  clearColor,
});

const clusteredScene = () => scene({
  camera: camera(),
  nodes: [
    pointLight({ intensityCandela: 100, position: [0, 0, 2], range: 10 }),
    mesh({
      geometry: boxGeometry(1),
      material: standardMaterial({ color: [1, 1, 1, 1] }),
    }),
  ],
});

const drawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArrays" || call.name === "drawElements");

const countCalls = (calls: readonly GlCall[], name: string): number =>
  calls.filter((call) => call.name === name).length;

const expectMatricesToContainClose = (
  matrices: readonly (readonly number[])[],
  expected: readonly number[],
) => {
  const hasMatrix = matrices.some((matrix) =>
    matrix.length === expected.length
    && matrix.every((value, index) => Math.abs(value - expected[index]!) < 0.00001));
  expect(hasMatrix).toBe(true);
};

const xrSessionEventMethods = (target: EventTarget) => ({
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root working state contracts", () => {
  it("enforces a zero clustered-light CPU budget without observational overshoot", () => {
    const { gl } = fakeGl();
    const classPolicy = () => ({
      cpuDecodedBytes: { mandatoryFloor: 0, softLimit: 0 },
      persistentGpuBytes: { mandatoryFloor: 0, softLimit: 512 * 1024 * 1024 },
    });
    const resourceGovernorPolicy = {
      classes: {
        "asset-decode": classPolicy(),
        geometry: classPolicy(),
        "ordinary-texture": classPolicy(),
        "render-target": classPolicy(),
        "virtual-texture": classPolicy(),
      },
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, cpuDecodedBytes: 0 },
    } satisfies ResourceGovernorPolicy;
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy });

    expect(() => root.render(clusteredScene())).toThrow("Clustered-light CPU update denied");
    expect(root.snapshot().resourceGovernor).toMatchObject({
      denialsByReason: { "cpu-decoded-capacity": 1 },
      limits: { cpuDecodedBytes: 0 },
      total: { cpuDecodedBytes: 0 },
    });
    expect(root.snapshot().resourceGovernor.highWater.cpuDecodedBytes).toBe(0);
    root.dispose();
  });

  it("rejects a zero-job resource policy before requesting a WebGL context", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const resourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, jobs: 0 },
    };

    expect(() => createWebGlRoot(canvas, { resourceGovernorPolicy }))
      .toThrow("jobs capacity must be at least 1");
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it("terminally degrades oversized studio IBL under a tiny custom upload policy", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const resourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, uploadBytes: 50_000 },
    };
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { resourceGovernorPolicy });
    const graph = scene({
      camera: camera(),
      environment: studioEnvironment(),
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    });

    root.render(graph);

    expect(root.snapshot().diagnostics).toContainEqual(expect.stringMatching(
      /Studio IBL specular texture is disabled.*upload bytes exceed the absolute limit/,
    ));
    // The HDR surface remains required for physical rendering; only the
    // over-budget studio IBL textures are suppressed.
    expect(countCalls(calls, "createTexture")).toBe(1);
    expect(scheduled).toHaveLength(1);
    expect(warning).toHaveBeenCalledTimes(1);
    const occurrencesBeforeRestore = root.snapshot().diagnosticStats.occurrences;
    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    expect(root.snapshot().diagnosticStats.occurrences).toEqual(occurrencesBeforeRestore);
    expect(warning).toHaveBeenCalledTimes(1);
    root.dispose();
  });
  it("invalidates every root sharing a committed camera resource and catches up after context restore", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const first = fakeGl();
    const second = fakeGl();
    const firstCanvas = fakeCanvas(first.gl);
    const secondCanvas = fakeCanvas(second.gl);
    const firstRoot = createWebGlRoot(firstCanvas);
    const secondRoot = createWebGlRoot(secondCanvas);
    const cameraResource = createCameraViewResource(camera());
    const renderScene = scene({ camera: cameraResource, nodes: [cube([1, 1, 1, 1])] });
    firstRoot.render(renderScene);
    secondRoot.render(renderScene);
    expect(firstRoot.snapshot().planning).toEqual({
      compileNodeVisits: 1,
      planCompiles: 1,
      planRevision: 1,
      sceneCommits: 1,
    });

    cameraResource.position[0] = 1;
    cameraResource.commit();
    expect(scheduled).toHaveLength(2);
    for (const callback of scheduled.splice(0)) callback(16);
    expect(firstRoot.frame).toBe(2);
    expect(secondRoot.frame).toBe(2);

    firstCanvas.dispatchContextEvent("webglcontextlost");
    cameraResource.position[0] = 2;
    cameraResource.commit();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(32);
    expect(firstRoot.frame).toBe(2);
    expect(secondRoot.frame).toBe(3);

    firstCanvas.dispatchContextEvent("webglcontextrestored");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(48);
    expect(firstRoot.frame).toBe(3);
    expect(secondRoot.frame).toBe(3);
    expect(firstRoot.snapshot().planning.planCompiles).toBe(1);
    expect(secondRoot.snapshot().planning.planCompiles).toBe(1);
    firstRoot.dispose();
    secondRoot.dispose();
    cameraResource.position[0] = 3;
    cameraResource.commit();
    expect(scheduled).toHaveLength(0);
  });

  it("invalidates GPU handles without GL calls and lazily redraws after context restoration", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const observerErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    root.observeContextLifecycle((snapshot) => {
      if (snapshot.lifecycle === "lost") throw new Error("observer failure");
    });
    let stopSelfObserver = (): void => undefined;
    stopSelfObserver = root.observeContextLifecycle((snapshot) => {
      if (snapshot.lifecycle === "lost") stopSelfObserver();
    });
    const contextTransitions: unknown[] = [];
    const stopObservingContext = root.observeContextLifecycle((snapshot) => {
      contextTransitions.push(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);
    });
    const firstScene = drawableScene([0, 0, 0, 0]);
    const retainedScene = scene({
      camera: camera(),
      clearColor: [0.1, 0.2, 0.3, 1],
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ texture: virtualTexture("/lost-context.vt.json") }),
      })],
    });

    root.render(firstScene);
    expect(root.snapshot().planning.planRevision).toBe(1);
    const programsBeforeLoss = countCalls(calls, "createProgram");
    const callsBeforeLoss = calls.length;
    const loss = canvas.dispatchContextEvent("webglcontextlost");
    const callsAtLoss = calls.length;

    expect(loss.defaultPrevented).toBe(true);
    expect(callsAtLoss).toBe(callsBeforeLoss);
    expect(root.snapshot().context).toMatchObject({ generation: 2, lifecycle: "lost", losses: 1 });
    root.render(retainedScene);
    expect(root.snapshot().planning).toEqual({
      compileNodeVisits: 2,
      planCompiles: 2,
      planRevision: 2,
      sceneCommits: 2,
    });
    root.invalidate();
    expect(root.pick({ clientX: 1, clientY: 1 })).toBeUndefined();
    expect(calls).toHaveLength(callsAtLoss);
    expect(root.snapshot().resourceLifetime.sceneLeaseAcquires).toBe(2);

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(root.snapshot().context).toMatchObject({ generation: 2, lifecycle: "active", restores: 1 });
    expect(root.latestScene).toBe(retainedScene);
    expect(root.snapshot().planning.planCompiles).toBe(2);
    const restoreFrame = scheduled.at(-1);
    expect(restoreFrame).toBeDefined();
    restoreFrame?.(16);

    expect(countCalls(calls, "createProgram")).toBeGreaterThan(programsBeforeLoss);
    expect(drawCalls(calls)).toHaveLength(2);
    expect(contextTransitions).toEqual([
      expect.objectContaining({ generation: 1, lifecycle: "active" }),
      expect.objectContaining({ generation: 2, lifecycle: "lost" }),
      expect.objectContaining({ generation: 2, lifecycle: "restoring" }),
      expect.objectContaining({ generation: 2, lifecycle: "active", restores: 1 }),
    ]);
    expect(observerErrors).toHaveBeenCalledTimes(1);
    stopObservingContext();
  });

  it("publishes a terminal restore failure without reacquiring a different context", () => {
    const first = fakeGl();
    const replacement = fakeGl();
    const canvas = fakeCanvas(first.gl);
    const root = createWebGlRoot(canvas);
    const transitions: unknown[] = [];
    root.observeContextLifecycle((snapshot) => transitions.push(snapshot));
    canvas.getContext.mockImplementationOnce(() => replacement.gl);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");

    expect(root.contextSnapshot()).toMatchObject({
      generation: 2,
      lastError: expect.stringMatching(/renderer-owned WebGL2 context/i),
      lifecycle: "lost",
    });
    expect(transitions).toEqual([
      expect.objectContaining({ lifecycle: "active" }),
      expect.objectContaining({ lifecycle: "lost" }),
      expect.objectContaining({ lifecycle: "restoring" }),
      expect.objectContaining({ lastError: expect.any(String), lifecycle: "lost" }),
    ]);
  });

  it("publishes context loss exactly once and preserves opaque cleanup failure", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const transitions: string[] = [];
    root.observeContextLifecycle((snapshot) => transitions.push(snapshot.lifecycle));
    const originalClear = Set.prototype.clear;
    let injectFailure = true;
    let clearCalls = 0;
    vi.spyOn(Set.prototype, "clear").mockImplementation(function (this: Set<unknown>) {
      clearCalls += 1;
      originalClear.call(this);
      if (injectFailure) {
        injectFailure = false;
        throw undefined;
      }
    });

    const firstLoss = canvas.invokeContextEvent("webglcontextlost");

    expect(firstLoss.event.defaultPrevented).toBe(true);
    expect(firstLoss.failurePresent).toBe(true);
    expect(firstLoss.failure).toBeUndefined();
    expect(root.contextLifecycle).toBe("lost");
    expect(transitions).toEqual(["active", "lost"]);
    expect(clearCalls).toBeGreaterThan(1);

    const duplicateLoss = canvas.invokeContextEvent("webglcontextlost");
    expect(duplicateLoss.failurePresent).toBe(false);
    expect(transitions).toEqual(["active", "lost"]);
  });

  it("reports actual default context attributes and rejects explicit mismatches", () => {
    const defaults = fakeGl();
    (defaults.gl as WebGL2RenderingContext & {
      getContextAttributes: () => WebGLContextAttributes;
    }).getContextAttributes = vi.fn(() => ({ alpha: false, antialias: false }));
    const root = createWebGlRoot(fakeCanvas(defaults.gl));
    expect(root.options).toMatchObject({ alpha: false, antialias: false });

    const explicit = fakeGl();
    (explicit.gl as WebGL2RenderingContext & {
      getContextAttributes: () => WebGLContextAttributes;
    }).getContextAttributes = vi.fn(() => ({ alpha: true, antialias: false }));
    expect(() => createWebGlRoot(fakeCanvas(explicit.gl), { antialias: true }))
      .toThrow(/requested antialias=true.*received antialias=false/i);
  });

  it("rejects unavailable context attributes during construction", () => {
    const { gl } = fakeGl();
    vi.mocked(gl.getContextAttributes).mockReturnValue(null);

    expect(() => createWebGlRoot(fakeCanvas(gl)))
      .toThrow("Royal WebGL context attributes are unavailable");
  });

  it("publishes unavailable restored context attributes as a restore failure", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    vi.mocked(gl.getContextAttributes).mockReturnValue(null);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");

    expect(root.contextSnapshot()).toMatchObject({
      lastError: "Royal WebGL context attributes are unavailable",
      lifecycle: "lost",
      restores: 0,
    });
    root.dispose();
  });

  it("uses extension support structurally when deciding whether physical lighting can render", () => {
    const supported = fakeGl();
    const supportedRoot = createWebGlRoot(fakeCanvas(supported.gl));
    expect(() => supportedRoot.render(clusteredScene())).not.toThrow();
    supportedRoot.dispose();

    const unsupported = fakeGl();
    vi.mocked(unsupported.gl.getExtension).mockReturnValue(null);
    const unsupportedRoot = createWebGlRoot(fakeCanvas(unsupported.gl));
    expect(() => unsupportedRoot.render(clusteredScene()))
      .toThrow("Royal physical lighting requires EXT_color_buffer_float");
    unsupportedRoot.dispose();
  });

  it("keeps context lifecycle safe under generated loss, restore, demand, and stale-frame sequences", () => {
    forEachFuzzCase({ cases: 48, seed: 0x63b77a21 }, ({ random }) => {
      const scheduled: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
        scheduled.push(callback);
        return scheduled.length;
      }));
      const { calls, gl } = fakeGl();
      const canvas = fakeCanvas(gl);
      const root = createWebGlRoot(canvas);
      const renderScene = drawableScene([0, 0, 0, 0]);
      root.render(renderScene);
      let lifecycle: "active" | "lost" = "active";

      for (let step = 0; step < 64; step += 1) {
        const action = random.int(0, 6);
        if (action === 0 && lifecycle === "active") {
          const event = canvas.dispatchContextEvent("webglcontextlost");
          expect(event.defaultPrevented).toBe(true);
          lifecycle = "lost";
        } else if (action === 1 && lifecycle === "lost") {
          canvas.dispatchContextEvent("webglcontextrestored");
          lifecycle = "active";
        } else if (action === 2) {
          const before = calls.length;
          root.render(renderScene);
          if (lifecycle === "lost") expect(calls).toHaveLength(before);
        } else if (action === 3) {
          root.invalidate();
        } else if (action === 4 && scheduled.length > 0) {
          const before = calls.length;
          scheduled.shift()?.(step * 16);
          if (lifecycle === "lost") expect(calls).toHaveLength(before);
        } else if (action === 5) {
          const before = calls.length;
          root.pick({ clientX: 2, clientY: 2 });
          if (lifecycle === "lost") expect(calls).toHaveLength(before);
        }
        expect(root.contextLifecycle).toBe(lifecycle);
      }

      const callsBeforeDispose = calls.length;
      root.dispose();
      if (lifecycle === "lost") expect(calls).toHaveLength(callsBeforeDispose);
      canvas.dispatchContextEvent("webglcontextrestored");
      for (const callback of scheduled) callback(2_000);
      expect(root.snapshot().context.lifecycle).toBe("disposed");
    });
  });

  it("rejects canvases that cannot provide a WebGL2 context with a clear error", () => {
    const canvas = fakeCanvas(null);

    expect(() => createWebGlRoot(canvas)).toThrow(/WebGL2 context/i);
    expect(canvas.getContext.mock.calls.some((call) => call[0] === "webgl2")).toBe(true);
  });

  it("preserves a primary render failure while completing the logical epilogue and every GL normalization", () => {
    const { gl } = fakeGl();
    const primaryFailure = new Error("primary render failure");
    vi.mocked(gl.clear).mockImplementation(() => {
      throw primaryFailure;
    });
    vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
      if (vertexArray === null) throw undefined;
    });
    vi.mocked(gl.bindBuffer).mockImplementation((_target, buffer) => {
      if (buffer === null) throw new Error("secondary normalization failure");
    });
    const root = createWebGlRoot(fakeCanvas(gl));

    let thrownPresent = false;
    let thrown: unknown;
    try {
      root.render(drawableScene([0, 0, 0, 0]));
    } catch (value) {
      thrownPresent = true;
      thrown = value;
    }

    expect(thrownPresent).toBe(true);
    expect(thrown).toBe(primaryFailure);
    expect(root.frame).toBe(1);
    expect(gl.bindVertexArray).toHaveBeenCalledWith(null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ARRAY_BUFFER, null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ELEMENT_ARRAY_BUFFER, null);
  });

  it("preserves an opaque undefined GL normalization failure", () => {
    const { gl } = fakeGl();
    vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
      if (vertexArray === null) throw undefined;
    });
    const root = createWebGlRoot(fakeCanvas(gl));
    let thrownPresent = false;
    let thrown: unknown = "not thrown";

    try {
      root.render(drawableScene([0, 0, 0, 0]));
    } catch (value) {
      thrownPresent = true;
      thrown = value;
    }

    expect(thrownPresent).toBe(true);
    expect(thrown).toBeUndefined();
  });

  it("attempts later epilogue and normalization phases after body and early-epilogue failures", () => {
    const { gl } = fakeGl();
    const primaryFailure = new Error("baseline preparation failed");
    vi.mocked(gl.clearDepth).mockImplementation(() => {
      throw primaryFailure;
    });
    let nullFramebufferBindings = 0;
    vi.mocked(gl.bindFramebuffer).mockImplementation((_target, framebuffer) => {
      if (framebuffer === null && ++nullFramebufferBindings > 1) {
        throw new Error("framebuffer normalization failed");
      }
    });
    vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
      if (vertexArray === null) throw undefined;
    });
    vi.mocked(gl.bindBuffer).mockImplementation((_target, buffer) => {
      if (buffer === null) throw new Error("buffer normalization failed");
    });
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => root.render(drawableScene([0, 0, 0, 0]))).toThrow(primaryFailure);
    // Baseline preparation failed before the instance-buffer frame began, so
    // unused-batch release also fails. The later frame/budget advance and all
    // GL normalization operations must nevertheless still run.
    expect(root.frame).toBe(1);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.bindVertexArray).toHaveBeenLastCalledWith(null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ARRAY_BUFFER, null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ELEMENT_ARRAY_BUFFER, null);
  });

  it("preserves an opaque dispose failure while attempting later GPU authorities", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(drawableScene([0, 0, 0, 0]));
    vi.mocked(gl.deleteBuffer).mockImplementation(() => {
      throw undefined;
    });
    vi.mocked(gl.deleteProgram).mockImplementation(() => {
      throw new Error("later program cleanup failed");
    });
    let failurePresent = false;
    let failure: unknown = "not thrown";

    try {
      root.dispose();
    } catch (value) {
      failurePresent = true;
      failure = value;
    }

    expect(failurePresent).toBe(true);
    expect(failure).toBeUndefined();
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(root.disposed).toBe(true);
    expect(root.contextLifecycle).toBe("disposed");
  });

  it("retries an opaque program deletion failure on repeated root disposal", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(drawableScene([0, 0, 0, 0]));
    let attempts = 0;
    vi.mocked(gl.deleteProgram).mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) throw undefined;
    });

    let firstFailurePresent = false;
    try {
      root.dispose();
    } catch (error) {
      firstFailurePresent = true;
      expect(error).toBeUndefined();
    }
    expect(firstFailurePresent).toBe(true);
    expect(attempts).toBe(1);

    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(2);
  });

  it("retries glTF instance-transform unsubscription on repeated root disposal", () => {
    const { gl } = fakeGl();
    const base = createGltfInstanceTransforms({ count: 1 });
    const unsubscribeFailure = new Error("instance unsubscribe failed");
    let activeSubscriptions = 0;
    let unsubscribeAttempts = 0;
    const instances: GltfInstanceTransforms = {
      commitPose: base.commitPose,
      commitScale: base.commitScale,
      count: base.count,
      get poseVersion() {
        return base.poseVersion;
      },
      positions: base.positions,
      rotations: base.rotations,
      get scaleVersion() {
        return base.scaleVersion;
      },
      scales: base.scales,
      subscribe(listener) {
        activeSubscriptions += 1;
        const unsubscribe = base.subscribe(listener);
        return () => {
          unsubscribeAttempts += 1;
          if (unsubscribeAttempts === 1) throw unsubscribeFailure;
          activeSubscriptions -= 1;
          unsubscribe();
        };
      },
    };
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(scene({
      camera: camera(),
      clearColor: [0, 0, 0, 0],
      nodes: [gltfInstances({
        instances,
        src: "data:application/json,%7B%22asset%22%3A%7B%22version%22%3A%222.0%22%7D%7D",
      })],
    }));
    expect(activeSubscriptions).toBe(1);

    expect(() => root.dispose()).toThrow(unsubscribeFailure);
    expect(activeSubscriptions).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(activeSubscriptions).toBe(0);
    expect(unsubscribeAttempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(unsubscribeAttempts).toBe(2);
  });

  it("retains an HDR target lease across an opaque delete failure and releases it on retry", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(clusteredScene());
    expect(gl.createTexture).toHaveBeenCalledTimes(4);
    let attempts = 0;
    vi.mocked(gl.deleteTexture).mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) throw undefined;
    });

    let firstFailurePresent = false;
    try {
      root.dispose();
    } catch (error) {
      firstFailurePresent = true;
      expect(error).toBeUndefined();
    }

    expect(firstFailurePresent).toBe(true);
    expect(attempts).toBe(4);
    // The failed HDR texture retains its target lease until deletion retries;
    // the clustered-light resources completed their independent cleanup.
    expect(root.snapshot().resourceGovernor.outstandingLeases).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(5);
    expect(root.snapshot().resourceGovernor.outstandingLeases).toBe(0);
    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(5);
  });

  it("drops clustered-light handles and accounting without GL calls on genuine context loss", () => {
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    root.render(clusteredScene());
    expect(root.snapshot().resourceGovernor.outstandingLeases).toBeGreaterThan(0);
    const callsBeforeLoss = calls.length;

    canvas.dispatchContextEvent("webglcontextlost");

    expect(calls).toHaveLength(callsBeforeLoss);
    expect(root.snapshot().resourceGovernor.outstandingLeases).toBe(0);
    expect(() => root.dispose()).not.toThrow();
  });

  it("preserves listener-removal precedence while completing later disposal phases", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    root.render(drawableScene([0, 0, 0, 0]));
    const primaryFailure = new Error("listener removal failed");
    let removalCount = 0;
    vi.spyOn(canvas, "removeEventListener").mockImplementation(() => {
      removalCount += 1;
      if (removalCount === 1) throw primaryFailure;
    });
    vi.mocked(gl.deleteProgram).mockImplementation(() => {
      throw new Error("later program cleanup failed");
    });

    expect(() => root.dispose()).toThrow(primaryFailure);
    expect(removalCount).toBe(2);
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(root.disposed).toBe(true);
  });

  it("updates the canvas backing store and viewport from CSS size and DPR each frame", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl, { width: 320, height: 180 });
    const root = createWebGlRoot(canvas);
    const renderScene = drawableScene([0, 0, 0, 0]);

    root.render(renderScene);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(calls).toContainEqual({ name: "viewport", args: [0, 0, 640, 360] });

    vi.stubGlobal("devicePixelRatio", 1.5);
    canvas.setCssSize({ width: 240, height: 120 });
    root.render(renderScene);

    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(180);
    expect(calls).toContainEqual({ name: "viewport", args: [0, 0, 360, 180] });
  });

  it("uses fixed attributes and caches uniform locations across repeated draws", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = drawableScene([0, 0, 0, 0]);

    root.render(renderScene);
    const firstAttribLookups = countCalls(calls, "getAttribLocation");
    const firstUniformLookups = countCalls(calls, "getUniformLocation");

    expect(firstAttribLookups).toBe(0);
    expect(firstUniformLookups).toBeGreaterThan(0);

    root.render(renderScene);

    expect(countCalls(calls, "getAttribLocation")).toBe(firstAttribLookups);
    expect(countCalls(calls, "getUniformLocation")).toBe(firstUniformLookups);
    expect(drawCalls(calls)).toHaveLength(2);
  });

  it("keeps regular mesh draws non-blended by default", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 0, 0, 0.35] }),
            }),
      ],
    }));

    const drawIndex = calls.findIndex((call) => call.name === "drawArrays" || call.name === "drawElements");
    const lastBlendStateBeforeDraw = calls
      .slice(0, drawIndex)
      .filter((call) => (call.name === "enable" || call.name === "disable") && call.args[0] === gl.BLEND)
      .at(-1);

    expect(drawIndex).toBeGreaterThan(-1);
    expect(lastBlendStateBeforeDraw).toEqual({ name: "disable", args: [gl.BLEND] });
    expect(calls).not.toContainEqual({ name: "enable", args: [gl.BLEND] });
    expect(calls).not.toContainEqual({ name: "depthMask", args: [false] });
  });

  it("accepts a scene with no nodes without issuing draw calls", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => {
      root.render(scene({
        camera: camera(),
        nodes: [],
      }));
    }).not.toThrow();

    expect(drawCalls(calls)).toHaveLength(0);
    expect(root.snapshot()).toMatchObject({
      disposed: false,
      frame: 1,
      resourceGovernor: {
        frame: 1,
        limits: {
          cpuDecodedBytes: 512 * 1024 * 1024,
          jobs: 8,
          persistentGpuBytes: 512 * 1024 * 1024,
          transientPeakBytes: 192 * 1024 * 1024,
          uploadBytes: 16 * 1024 * 1024,
        },
      },
    });
  });

  it("redraws after imperative render object ref transform updates", async () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
              },
            }),
      ],
    });

    root.render(renderScene);
    const handle = ref.current;
    if (handle === null) throw new Error("Expected mesh ref to be attached");
    const initialDraws = drawCalls(calls).length;

    handle.rotation.y = Math.PI / 2;
    await Promise.resolve();

    expect(handle.rotation.y).toBe(Math.PI / 2);
    expect(root.frame).toBe(2);
    expect(drawCalls(calls)).toHaveLength(initialDraws + 1);

    root.render(scene({
      camera: camera(),
      nodes: [],
    }));

    expect(ref.current).toBeNull();
  });

  it("keeps a shared render object ref attached to and invalidating every live root", async () => {
    const first = fakeGl();
    const second = fakeGl();
    const firstRoot = createWebGlRoot(fakeCanvas(first.gl));
    const secondRoot = createWebGlRoot(fakeCanvas(second.gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const sharedScene = scene({
      camera: camera(),
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        ref,
      })],
    });

    firstRoot.render(sharedScene);
    const sharedHandle = ref.current;
    if (sharedHandle === null) throw new Error("Expected shared ref to be attached");
    secondRoot.render(sharedScene);
    expect(ref.current).toBe(sharedHandle);

    sharedHandle.position.x = 3;
    await Promise.resolve();
    expect(firstRoot.frame).toBe(2);
    expect(secondRoot.frame).toBe(2);

    firstRoot.dispose();
    expect(ref.current).toBe(sharedHandle);
    sharedHandle.position.y = 4;
    await Promise.resolve();
    expect(secondRoot.frame).toBe(3);

    secondRoot.dispose();
    expect(ref.current).toBeNull();
  });

  it("does not invalidate again while syncing declarative ref transforms", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = (x: number) => scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
              transform: {
                position: [x, 0, 0],
                rotation: [0, 0, 0],
              },
            }),
      ],
    });

    root.render(renderScene(0));
    const movedScene = renderScene(1);
    root.render(movedScene);

    expect(frameCallbacks).toHaveLength(0);
    expect(ref.current?.position.x).toBe(1);
    expect(root.snapshot().planning).toEqual({
      compileNodeVisits: 2,
      planCompiles: 2,
      planRevision: 2,
      sceneCommits: 2,
    });

    root.render(movedScene);
    expect(root.snapshot().planning.planCompiles).toBe(2);

    ref.current?.position.set([2, 0, 0]);

    expect(frameCallbacks).toHaveLength(1);
  });

  it("finishes a retained-plan reconciliation after one ref callback throws", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let failFirstAttachment = true;
    let firstHandle: RenderObjectHandle | null = null;
    let secondHandle: RenderObjectHandle | null = null;
    const firstRef = (handle: RenderObjectHandle | null): void => {
      if (handle !== null && failFirstAttachment) {
        failFirstAttachment = false;
        throw new Error("first ref attachment failed");
      }
      firstHandle = handle;
    };
    const committedScene = scene({
      camera: camera(),
      nodes: [
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 0, 0, 1] }), ref: firstRef }),
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [0, 1, 0, 1] }), ref: (handle) => {
          secondHandle = handle;
        } }),
      ],
    });

    expect(() => root.render(committedScene)).toThrow("first ref attachment failed");
    expect(secondHandle).not.toBeNull();
    expect(root.snapshot().planning.planCompiles).toBe(1);

    expect(() => root.render(committedScene)).not.toThrow();
    expect(firstHandle).not.toBeNull();
    expect(root.snapshot().planning).toEqual({
      compileNodeVisits: 2,
      planCompiles: 1,
      planRevision: 1,
      sceneCommits: 1,
    });
  });

  it("retries a failed final callback-ref detach without stale invalidation or attachment state", async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let handle: RenderObjectHandle | null = null;
    let clearAttempts = 0;
    let successfulClears = 0;
    const ref = (next: RenderObjectHandle | null): void => {
      if (next === null) {
        clearAttempts += 1;
        if (clearAttempts === 1) throw new Error("ref clear failed");
        successfulClears += 1;
      }
      handle = next;
    };
    const populated = scene({
      camera: camera(),
      nodes: [mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 1, 1, 1] }), ref })],
    });
    const empty = scene({ camera: camera(), nodes: [] });

    root.render(populated);
    const attachedHandle = handle as RenderObjectHandle | null;
    if (attachedHandle === null) throw new Error("Expected callback ref to be attached");
    expect(() => root.render(empty)).toThrow("ref clear failed");
    attachedHandle.position.set([2, 0, 0]);
    await Promise.resolve();
    expect(frameCallbacks).toHaveLength(0);

    expect(() => root.render(empty)).not.toThrow();
    expect(clearAttempts).toBe(2);
    expect(successfulClears).toBe(1);
    expect(handle).toBeNull();
    expect(() => root.render(populated)).not.toThrow();
    expect(handle).not.toBe(attachedHandle);
  });

  it("best-effort disposal clears later refs and retains a failed detach for retry", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let firstClearAttempts = 0;
    let secondCleared = false;
    const firstRef = (handle: RenderObjectHandle | null): void => {
      if (handle === null && ++firstClearAttempts === 1) throw new Error("dispose clear failed");
    };
    const secondRef = (handle: RenderObjectHandle | null): void => {
      if (handle === null) secondCleared = true;
    };
    root.render(scene({
      camera: camera(),
      nodes: [
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 0, 0, 1] }), ref: firstRef }),
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [0, 1, 0, 1] }), ref: secondRef }),
      ],
    }));

    expect(() => root.dispose()).toThrow("dispose clear failed");
    expect(secondCleared).toBe(true);
    expect(firstClearAttempts).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(firstClearAttempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(firstClearAttempts).toBe(2);
  });

  it("retries failed resource release effects without applying the scene delta twice", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const populated = drawableScene([0, 0, 0, 0]);
    const empty = scene({ camera: camera(), clearColor: [0, 0, 0, 0], nodes: [] });
    root.render(populated);
    const releaseFailure = new Error("buffer release failed");
    let failRelease = true;
    vi.mocked(gl.deleteBuffer).mockImplementation(() => {
      if (failRelease) {
        failRelease = false;
        throw releaseFailure;
      }
    });

    expect(() => root.render(empty)).toThrow(releaseFailure);
    expect(root.latestScene, "the arena and frame plan must publish one authoritative generation").toBe(empty);
    expect(root.snapshot().planning).toMatchObject({ planCompiles: 2, planRevision: 2, sceneCommits: 2 });

    const drawsBeforeRetry = drawCalls(calls).length;
    expect(() => root.render(empty)).not.toThrow();
    expect(drawCalls(calls)).toHaveLength(drawsBeforeRetry);
    expect(root.snapshot().planning, "the retry must drain effect debt without recompiling or reapplying the delta")
      .toMatchObject({ planCompiles: 2, planRevision: 2, sceneCommits: 2 });

    expect(() => root.render(populated)).not.toThrow();
    expect(drawCalls(calls)).toHaveLength(drawsBeforeRetry + 1);
    expect(root.snapshot().planning).toMatchObject({ planCompiles: 3, planRevision: 3, sceneCommits: 3 });
  });

  it("preserves opaque ref failures while completing later reconciliation work", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let secondHandle: RenderObjectHandle | null = null;
    const committedScene = scene({
      camera: camera(),
      nodes: [
        mesh({
          geometry: boxGeometry(1),
          material: unlitMaterial({ color: [1, 0, 0, 1] }),
          ref: (handle) => {
            if (handle !== null) throw undefined;
          },
        }),
        mesh({
          geometry: boxGeometry(1),
          material: unlitMaterial({ color: [0, 1, 0, 1] }),
          ref: (handle) => {
            secondHandle = handle;
          },
        }),
      ],
    });
    let failurePresent = false;
    let failure: unknown = "not thrown";

    try {
      root.render(committedScene);
    } catch (value) {
      failurePresent = true;
      failure = value;
    }

    expect(failurePresent).toBe(true);
    expect(failure).toBeUndefined();
    expect(secondHandle).not.toBeNull();
  });

  it("rejects reentrant rendering from a ref callback and retries attachment", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let attachmentAttempts = 0;
    let attachedHandle: RenderObjectHandle | null = null;
    let committedScene!: RenderRoot;
    const ref = (handle: RenderObjectHandle | null): void => {
      attachmentAttempts += 1;
      if (handle !== null && attachmentAttempts === 1) root.render(committedScene);
      attachedHandle = handle;
    };
    committedScene = scene({
      camera: camera(),
      nodes: [mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 1, 1, 1] }), ref })],
    });

    expect(() => root.render(committedScene)).toThrow(
      "Cannot render while Royal is reconciling render-object refs",
    );
    expect(root.snapshot().planning.planCompiles).toBe(1);
    expect(() => root.render(committedScene)).not.toThrow();
    expect(attachedHandle).not.toBeNull();
    expect(attachmentAttempts).toBe(2);
    expect(root.snapshot().planning.planCompiles).toBe(1);
  });

  it("coalesces imperative render object mutations before the scheduled render", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
            }),
      ],
    });

    root.render(renderScene);
    const handle = ref.current;
    if (handle === null) throw new Error("Expected mesh ref to be attached");
    const initialDraws = drawCalls(calls).length;

    handle.position.set([1, 0, 0]);
    handle.rotation.set([0, 1, 0]);
    handle.scale.set([2, 2, 2]);

    expect(frameCallbacks).toHaveLength(1);
    expect(drawCalls(calls)).toHaveLength(initialDraws);

    frameCallbacks[0]?.(16);
    expect(drawCalls(calls)).toHaveLength(initialDraws + 1);

    handle.position.set([2, 0, 0]);
    expect(frameCallbacks).toHaveLength(2);
  });

  it("coalesces explicit invalidations to one animation frame", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = drawableScene([0, 0, 0, 0]);

    root.render(renderScene);
    const initialDraws = drawCalls(calls).length;

    root.invalidate();
    root.invalidate();

    expect(frameCallbacks).toHaveLength(1);
    expect(root.frame).toBe(1);
    expect(drawCalls(calls)).toHaveLength(initialDraws);

    frameCallbacks[0]?.(16);

    expect(root.frame).toBe(2);
    expect(drawCalls(calls)).toHaveLength(initialDraws + 1);
  });

  it("renders caller-owned views with supplied matrices and scissored viewports", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const framebuffer = makeHandle<WebGLFramebuffer>();
    const projection = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, -1, -1,
      0, 0, -0.1, 0,
    ];
    const view = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.25, -0.5, -2, 1,
    ];

    root.renderViews(drawableScene([0, 0, 0, 0]), {
      framebuffer,
      views: [
        { projectionMatrix: projection, viewMatrix: view, viewport: { height: 80, width: 100, x: 0, y: 0 } },
        { projectionMatrix: projection, viewMatrix: view, viewport: { height: 80, width: 100, x: 100, y: 0 } },
      ],
    });

    const framebufferBinds = calls.filter((call) => call.name === "bindFramebuffer");
    expect(framebufferBinds[0]?.args).toEqual([gl.FRAMEBUFFER, framebuffer]);
    expect(framebufferBinds.at(-1)?.args).toEqual([gl.FRAMEBUFFER, null]);
    expect(calls.filter((call) => call.name === "viewport").map((call) => call.args)).toEqual([
      [0, 0, 100, 80],
      [100, 0, 100, 80],
    ]);
    expect(calls.filter((call) => call.name === "scissor").map((call) => call.args)).toEqual([
      [0, 0, 100, 80],
      [100, 0, 100, 80],
    ]);
    expect(drawCalls(calls)).toHaveLength(2);

    const uniformMatrices = calls
      .filter((call) => call.name === "uniformMatrix4fv")
      .map((call) => Array.from(call.args[2] as ArrayLike<number>));
    expectMatricesToContainClose(uniformMatrices, projection);
    expectMatricesToContainClose(uniformMatrices, view);
  });

  it("rejects a public WebGlRoot-shaped value without private XR capabilities", async () => {
    const publicOnlyRoot = {
      contextLifecycle: "active",
    } as Parameters<typeof createWebXrSessionRenderer>[0];
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(),
      updateRenderState: vi.fn(),
    };

    await expect(createWebXrSessionRenderer(publicOnlyRoot, session)).rejects.toThrow(
      "requires a Royal WebGL root with renderer-owned context and frame-view capabilities",
    );
    expect(session.updateRenderState).not.toHaveBeenCalled();
  });

  it("rejects WebXR setup when the WebGL context cannot become XR-compatible", async () => {
    const { gl } = fakeGl();
    const xrGl = gl as WebGL2RenderingContext & {
      makeXRCompatible?: () => Promise<void>;
    };
    delete xrGl.makeXRCompatible;
    const root = createWebGlRoot(fakeCanvas(gl));
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(),
      updateRenderState: vi.fn(),
    };

    await expect(createWebXrSessionRenderer(root, session)).rejects.toThrow(
      "requires WebGL makeXRCompatible support",
    );
    expect(session.requestReferenceSpace).not.toHaveBeenCalled();
    expect(session.updateRenderState).not.toHaveBeenCalled();
    root.dispose();
  });

  it("creates a WebXR session renderer that renders the latest scene through XR views", async () => {
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const framebuffer = makeHandle<WebGLFramebuffer>();
    const referenceSpace: WebGlXrReferenceSpace = {};
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => referenceSpace),
      updateRenderState: vi.fn(),
    };
    let layerContext: WebGL2RenderingContext | undefined;
    const xrWebGLLayerConstructor: WebGlXrLayerConstructor = class {
      readonly framebuffer = framebuffer;
      constructor(
        readonly session: WebGlXrSession,
        readonly context: WebGL2RenderingContext,
        readonly options?: unknown,
      ) {
        layerContext = context;
      }
      getViewport(view: WebGlXrView) {
        return (view as WebGlXrView & {
          readonly viewport: { readonly height: number; readonly width: number; readonly x: number; readonly y: number };
        }).viewport;
      }
    };
    const projectionMatrix = [
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, -1, -1,
      0, 0, -0.1, 0,
    ];
    const viewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, -1, -3, 1,
    ];
    const xrViewport = { height: 90, width: 110, x: 4, y: 8 };
    const snapshots: WebGlXrFrameSnapshot[] = [];
    const onFrameSnapshot = vi.fn((snapshot: WebGlXrFrameSnapshot) => {
      snapshots.push(snapshot);
    });

    const cameraResource = createCameraViewResource(camera());
    root.render(scene({
      camera: cameraResource,
      clearColor: [0, 0, 0, 0],
      nodes: [cube([1, 1, 1, 1])],
    }));
    const contextAcquisitionsBeforeXr = canvas.getContext.mock.calls.length;
    const renderer = await createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor },
      onFrameSnapshot,
      referenceSpacePreference: ["local"],
    });
    expect(canvas.getContext).toHaveBeenCalledTimes(contextAcquisitionsBeforeXr);
    expect(layerContext).toBe(gl);
    cameraResource.position[0] = 10_000;
    cameraResource.commit();
    const callsBeforeXrFrame = calls.length;
    const rendered = renderer.renderFrame({
      getViewerPose: (space) => {
        expect(space).toBe(referenceSpace);
        return {
          views: [{
            projectionMatrix,
            transform: { inverse: { matrix: viewMatrix } },
            viewport: xrViewport,
          }],
        };
      },
    });
    const xrCalls = calls.slice(callsBeforeXrFrame);

    expect(rendered).toBe(true);
    expect((gl as WebGL2RenderingContext & {
      readonly makeXRCompatible: ReturnType<typeof vi.fn>;
    }).makeXRCompatible).toHaveBeenCalled();
    expect(session.updateRenderState).toHaveBeenCalledWith({ baseLayer: renderer.layer });
    expect(session.requestReferenceSpace).toHaveBeenCalledWith("local");
    expect(onFrameSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshots).toEqual([{
      frameIndex: 0,
      viewCount: 1,
      viewports: [xrViewport],
    }]);
    expect(snapshots[0]?.viewports[0]).not.toBe(xrViewport);
    expect(xrCalls.filter((call) => call.name === "bindFramebuffer")[0]?.args).toEqual([gl.FRAMEBUFFER, framebuffer]);
    expect(xrCalls.filter((call) => call.name === "viewport").map((call) => call.args)).toEqual([[4, 8, 110, 90]]);
    expect(drawCalls(xrCalls)).toHaveLength(1);
    const xrMatrices = xrCalls
      .filter((call) => call.name === "uniformMatrix4fv")
      .map((call) => Array.from(call.args[2] as ArrayLike<number>));
    expectMatricesToContainClose(xrMatrices, projectionMatrix);
    expectMatricesToContainClose(xrMatrices, viewMatrix);
    expect(renderer.disposed).toBe(false);

    canvas.dispatchContextEvent("webglcontextlost");
    const callsWhileLost = calls.length;
    expect(renderer.renderFrame({
      getViewerPose: () => ({
        views: [{
          projectionMatrix,
          transform: { inverse: { matrix: viewMatrix } },
          viewport: xrViewport,
        }],
      }),
    })).toBe(false);
    expect(calls).toHaveLength(callsWhileLost);
    expect(onFrameSnapshot).toHaveBeenCalledTimes(1);

    renderer.dispose();
    renderer.dispose();

    expect(renderer.disposed).toBe(true);
    expect(renderer.renderFrame({ getViewerPose: () => null })).toBe(false);
    expect(calls.filter((call) => call.name === "deleteFramebuffer" && call.args[0] === framebuffer)).toHaveLength(0);
  });

  it("releases the XR renderer automatically when its session ends", async () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const referenceSpace: WebGlXrReferenceSpace = {};
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => referenceSpace),
      updateRenderState: vi.fn(),
    };
    const xrWebGLLayerConstructor: WebGlXrLayerConstructor = class {
      readonly framebuffer = null;
      getViewport() {
        return null;
      }
    };
    const renderer = await createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor },
    });

    events.dispatchEvent(new Event("end"));

    expect(renderer.disposed).toBe(true);
    expect(renderer.renderFrame({ getViewerPose: () => null })).toBe(false);
    expect(() => renderer.dispose()).not.toThrow();
  });

  it("rejects XR setup when the session ends during an asynchronous setup step", async () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const events = new EventTarget();
    let finishCompatibility: (() => void) | undefined;
    (gl as WebGL2RenderingContext & {
      readonly makeXRCompatible: ReturnType<typeof vi.fn>;
    }).makeXRCompatible.mockImplementation(() => new Promise<void>((resolve) => {
      finishCompatibility = resolve;
    }));
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => ({})),
      updateRenderState: vi.fn(),
    };
    const creation = createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor: class {
        readonly framebuffer = null;
        getViewport() {
          return null;
        }
      } },
    });

    events.dispatchEvent(new Event("end"));
    finishCompatibility?.();

    await expect(creation).rejects.toThrow("session ended during renderer setup");
    expect(session.updateRenderState).not.toHaveBeenCalled();
  });

  it("makes dispose idempotent while keeping render-after-dispose rejected", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = scene({ camera: camera(), nodes: [] });

    root.dispose();

    expect(() => root.dispose()).not.toThrow();
    expect(root.disposed).toBe(true);
    expect(() => root.render(renderScene)).toThrow(/disposed Royal renderer root/i);
  });

  it("reports renderer-owned scheduled failures without an uncaught async throw", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(scene({ camera: camera(), nodes: [] }));
    const failure = new Error("scheduled draw failed");
    const observed: unknown[] = [];
    const observerErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stopThrowing = root.observeRenderFailures(() => {
      throw new Error("observer failed");
    });
    const stop = root.observeRenderFailures((value) => observed.push(value));
    vi.mocked(gl.clear).mockImplementationOnce(() => { throw failure; });

    root.invalidate();
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled.shift()?.(16)).not.toThrow();
    expect(observed).toEqual([failure]);
    expect(observerErrors).toHaveBeenCalledWith(
      "Royal WebGL render failure observer failed",
      expect.any(Error),
    );

    stop();
    stopThrowing();
    vi.mocked(gl.clear).mockImplementationOnce(() => { throw undefined; });
    root.invalidate();
    expect(() => scheduled.shift()?.(32)).not.toThrow();
    expect(observed).toEqual([failure]);
    root.dispose();
  });
});
