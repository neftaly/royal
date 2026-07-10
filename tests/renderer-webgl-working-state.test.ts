import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  mesh,
  orthographicCamera,
  pass,
  scene,
  unlitMaterial,
  type RenderObjectHandle,
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

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

type FakeCanvas = HTMLCanvasElement & {
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

  const canvas = {
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
    height: 0,
    setCssSize(size: CanvasSize) {
      cssSize = size;
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
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
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

const drawablePass = (clearColor: Rgba, color: Rgba = [1, 1, 1, 1]) => pass({
  camera: camera(),
  children: [cube(color)],
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

const frameEvents = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "clearColor" || call.name === "drawArrays" || call.name === "drawElements")
    .map((call) => {
      if (call.name !== "clearColor") return "draw";
      return `clearColor(${call.args.join(",")})`;
    });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root working state contracts", () => {
  it("rejects canvases that cannot provide a WebGL2 context with a clear error", () => {
    const canvas = fakeCanvas(null);

    expect(() => createWebGlRoot(canvas)).toThrow(/WebGL2 context/i);
    expect(canvas.getContext.mock.calls.some((call) => call[0] === "webgl2")).toBe(true);
  });

  it("updates the canvas backing store and viewport from CSS size and DPR each frame", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl, { width: 320, height: 180 });
    const root = createWebGlRoot(canvas);
    const renderScene = scene({ children: [drawablePass([0, 0, 0, 0])] });

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

  it("caches GL program locations across repeated draws with the same program", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = scene({ children: [drawablePass([0, 0, 0, 0])] });

    root.render(renderScene);
    const firstAttribLookups = countCalls(calls, "getAttribLocation");
    const firstUniformLookups = countCalls(calls, "getUniformLocation");

    expect(firstAttribLookups).toBeGreaterThan(0);
    expect(firstUniformLookups).toBeGreaterThan(0);

    root.render(renderScene);

    expect(countCalls(calls, "getAttribLocation")).toBe(firstAttribLookups);
    expect(countCalls(calls, "getUniformLocation")).toBe(firstUniformLookups);
    expect(drawCalls(calls)).toHaveLength(2);
  });

  it("applies each pass clearColor and draws passes in scene order", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      children: [
        drawablePass([0.05, 0.1, 0.15, 1], [1, 0, 0, 1]),
        drawablePass([0.8, 0.7, 0.6, 1], [0, 0, 1, 1]),
      ],
    }));

    expect(drawCalls(calls)).toHaveLength(2);
    expect(frameEvents(calls)).toEqual([
      "clearColor(0.05,0.1,0.15,1)",
      "draw",
      "clearColor(0.8,0.7,0.6,1)",
      "draw",
    ]);
  });

  it("keeps regular mesh draws non-blended by default", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      children: [
        pass({
          camera: camera(),
          children: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 0, 0, 0.35] }),
            }),
          ],
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

  it("allows non-clearing overlay passes with depth testing disabled", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      children: [
        drawablePass([0.05, 0.1, 0.15, 1], [1, 0, 0, 1]),
        pass({
          camera: camera(),
          children: [cube([0, 1, 1, 1])],
          clear: "none",
          depthTest: false,
        }),
      ],
    }));

    expect(drawCalls(calls)).toHaveLength(2);
    expect(calls.filter((call) => call.name === "clear")).toEqual([
      {
        name: "clear",
        args: [gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT],
      },
    ]);
    expect(calls).toContainEqual({ name: "disable", args: [gl.DEPTH_TEST] });
    expect(frameEvents(calls)).toEqual([
      "clearColor(0.05,0.1,0.15,1)",
      "draw",
      "draw",
    ]);
  });

  it("accepts empty scenes and empty passes without issuing draw calls", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => {
      root.render(scene({ children: [] }));
      root.render(scene({
        children: [
          pass({
            camera: camera(),
            children: [],
          }),
        ],
      }));
    }).not.toThrow();

    expect(drawCalls(calls)).toHaveLength(0);
    expect(root.snapshot()).toMatchObject({
      disposed: false,
      frame: 2,
    });
  });

  it("redraws after imperative render object ref transform updates", async () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = scene({
      children: [
        pass({
          camera: camera(),
          children: [
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
      children: [
        pass({
          camera: camera(),
          children: [],
        }),
      ],
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
      children: [
        pass({
          camera: camera(),
          children: [
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
        }),
      ],
    });

    root.render(renderScene(0));
    root.render(renderScene(1));

    expect(frameCallbacks).toHaveLength(0);
    expect(ref.current?.position.x).toBe(1);

    ref.current?.position.set([2, 0, 0]);

    expect(frameCallbacks).toHaveLength(1);
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
      children: [
        pass({
          camera: camera(),
          children: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
            }),
          ],
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
    const renderScene = scene({ children: [drawablePass([0, 0, 0, 0])] });

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

    root.renderViews(scene({ children: [drawablePass([0, 0, 0, 0])] }), {
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

  it("creates a WebXR session renderer that renders the latest scene through XR views", async () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const framebuffer = makeHandle<WebGLFramebuffer>();
    const referenceSpace: WebGlXrReferenceSpace = {};
    const session: WebGlXrSession = {
      requestReferenceSpace: vi.fn(async () => referenceSpace),
      updateRenderState: vi.fn(),
    };
    const xrWebGLLayerConstructor: WebGlXrLayerConstructor = class {
      readonly framebuffer = framebuffer;
      constructor(
        readonly session: WebGlXrSession,
        readonly context: WebGL2RenderingContext,
        readonly options?: unknown,
      ) {}
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

    root.render(scene({ children: [drawablePass([0, 0, 0, 0])] }));
    const renderer = await createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor },
      onFrameSnapshot,
      referenceSpacePreference: ["local"],
    });
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
    expect(renderer.disposed).toBe(false);

    renderer.dispose();
    renderer.dispose();

    expect(renderer.disposed).toBe(true);
    expect(renderer.renderFrame({ getViewerPose: () => null })).toBe(false);
  });

  it("makes dispose idempotent while keeping render-after-dispose rejected", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = scene({ children: [] });

    root.dispose();

    expect(() => root.dispose()).not.toThrow();
    expect(root.disposed).toBe(true);
    expect(() => root.render(renderScene)).toThrow(/disposed Royal renderer root/i);
  });
});
