import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  createCameraViewResource,
  mesh,
  orthographicCamera,
  scene,
  unlitMaterial,
  virtualTexture,
  type RenderObjectHandle,
  type RenderRoot,
  type Rgba,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
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
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_SIZE: 0x0D33,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    SCISSOR_TEST: 0x0C11,
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
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => makeHandle<WebGLBuffer>()),
    createProgram: record("createProgram", () => makeHandle<WebGLProgram>()),
    createShader: record("createShader", () => makeHandle<WebGLShader>()),
    createTexture: record("createTexture", () => makeHandle<WebGLTexture>()),
    createVertexArray: record("createVertexArray", () => makeHandle<WebGLVertexArrayObject>()),
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    getAttribLocation: record("getAttribLocation", () => 0),
    getError: record("getError", () => 0),
    getParameter: record("getParameter", () => 4096),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record("getProgramParameter", () => true),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record("getShaderParameter", () => true),
    getUniformLocation: record("getUniformLocation", () => uniform),
    linkProgram: record("linkProgram"),
    makeXRCompatible: record("makeXRCompatible", async () => undefined),
    pixelStorei: record("pixelStorei"),
    shaderSource: record("shaderSource"),
    scissor: record("scissor"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    uniform1i: record("uniform1i"),
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root working state contracts", () => {
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
    const session: WebGlXrSession = {
      requestReferenceSpace: vi.fn(),
      updateRenderState: vi.fn(),
    };

    await expect(createWebXrSessionRenderer(publicOnlyRoot, session)).rejects.toThrow(
      "requires a Royal WebGL root with renderer-owned context and frame-view capabilities",
    );
    expect(session.updateRenderState).not.toHaveBeenCalled();
  });

  it("creates a WebXR session renderer that renders the latest scene through XR views", async () => {
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const framebuffer = makeHandle<WebGLFramebuffer>();
    const referenceSpace: WebGlXrReferenceSpace = {};
    const session: WebGlXrSession = {
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
            viewMatrix,
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
        views: [{ projectionMatrix, viewMatrix, viewport: xrViewport }],
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

  it("makes dispose idempotent while keeping render-after-dispose rejected", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = scene({ camera: camera(), nodes: [] });

    root.dispose();

    expect(() => root.dispose()).not.toThrow();
    expect(root.disposed).toBe(true);
    expect(() => root.render(renderScene)).toThrow(/disposed Royal renderer root/i);
  });
});
