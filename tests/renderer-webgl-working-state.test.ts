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
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_SIZE: 0x0D33,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    STATIC_DRAW: 0x88E4,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
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
    pixelStorei: record("pixelStorei"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    uniform1i: record("uniform1i"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
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
