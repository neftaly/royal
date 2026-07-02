import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  imageTexture,
  mesh,
  orthographicCamera,
  pass,
  scene,
  text,
  unlitMaterial,
  type RenderNode,
  type Rgba,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import { loadTestTextFont } from "./text-font-fixture";

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly result?: unknown;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type DrawCall = GlCall & {
  readonly name: "drawArrays" | "drawElements";
};

type BufferUpload = {
  readonly index: number;
  readonly length: number;
  readonly target: unknown;
};

const defaultCanvasSize: CanvasSize = { width: 320, height: 180 };

const fakeCanvas = (
  gl: WebGL2RenderingContext,
  size: CanvasSize = defaultCanvasSize,
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

  (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniforms = new Map<string, WebGLUniformLocation>();
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    BROWSER_DEFAULT_WEBGL: 0x9244,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LESS: 0x0201,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINK_STATUS: 0x8B82,
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
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
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
    calls.push(result === undefined ? { name, args } : { name, args, result });

    return result;
  });

  const glTarget = {
    ...constants,
    drawingBufferHeight: defaultCanvasSize.height,
    drawingBufferWidth: defaultCanvasSize.width,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
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
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    detachShader: record("detachShader"),
    disable: record("disable"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    frontFace: record("frontFace"),
    generateMipmap: record("generateMipmap"),
    getActiveAttrib: record("getActiveAttrib", () => null),
    getActiveUniform: record("getActiveUniform", () => null),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("normal")) return 1;
      if (normalized.includes("uv") || normalized.includes("texcoord")) return 2;

      return 0;
    }),
    getContextAttributes: record("getContextAttributes", () => ({
      alpha: true,
      antialias: true,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "default",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    })),
    getError: record("getError", () => constants.NO_ERROR),
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
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) => {
      if (parameter === constants.COMPILE_STATUS) return true;

      return true;
    }),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniform(name)),
    isContextLost: record("isContextLost", () => false),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    polygonOffset: record("polygonOffset"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    texSubImage2D: record("texSubImage2D"),
    uniform1f: record("uniform1f"),
    uniform1i: record("uniform1i"),
    uniform2fv: record("uniform2fv"),
    uniform3f: record("uniform3f"),
    uniform3fv: record("uniform3fv"),
    uniform4f: record("uniform4f"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix3fv: record("uniformMatrix3fv"),
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
    this.dispatch("load");
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
  }

  private dispatch(type: "load"): void {
    const event = new Event(type);
    this.onload?.call(this as unknown as HTMLImageElement, event);

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

const renderScene = (
  children: readonly RenderNode[],
  clearColor: Rgba = [0, 0, 0, 0],
) => scene({
  children: [
    pass({
      camera: camera(),
      children,
      clearColor,
    }),
  ],
});

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
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

const flushAnimationFrames = async (callbacks: FrameRequestCallback[]): Promise<void> => {
  const queued = callbacks.splice(0);
  for (const [index, callback] of queued.entries()) callback(16 + index);
  await flushMicrotasks();
};

const isNumericArrayLike = (value: unknown): value is ArrayLike<number> =>
  ArrayBuffer.isView(value)
  && !(value instanceof DataView)
  && typeof (value as { readonly length?: unknown }).length === "number";

const dataLength = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (isNumericArrayLike(value)) return value.length;

  return 0;
};

const bufferUploads = (calls: readonly GlCall[]): readonly BufferUpload[] =>
  calls.flatMap((call, index) => {
    if (call.name !== "bufferData" && call.name !== "bufferSubData") return [];

    const payload = call.name === "bufferSubData" ? call.args[2] : call.args[1];

    return [{
      index,
      length: dataLength(payload),
      target: call.args[0],
    }];
  });

const drawCalls = (calls: readonly GlCall[]): readonly DrawCall[] =>
  calls.filter((call): call is DrawCall => call.name === "drawArrays" || call.name === "drawElements");

const drawCount = (call: DrawCall): number =>
  call.name === "drawArrays" ? Number(call.args[2]) : Number(call.args[1]);

const texturePixelUploadIndexes = (calls: readonly GlCall[]): readonly number[] => {
  const textureStorageIndex = calls.findIndex((call) => call.name === "texStorage2D");

  return calls.flatMap((call, index) => {
    if (call.name === "texImage2D") return [index];
    if (call.name === "texSubImage2D" && textureStorageIndex >= 0 && textureStorageIndex < index) return [index];

    return [];
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
});

describe("WebGL texture, box UV, and text geometry regressions", () => {
  it("generates mipmaps after uploading a default imageTexture asset", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const animationFrames = installAnimationFrameQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ texture: imageTexture("/textures/checker.png") }),
      }),
    ]));

    expect(ControlledImage.instances[0]?.src).toContain("/textures/checker.png");

    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(animationFrames);

    const pixelUploadIndexes = texturePixelUploadIndexes(calls);
    const mipmapIndex = calls.findIndex((call) =>
      call.name === "generateMipmap"
      && call.args[0] === gl.TEXTURE_2D);

    expect(pixelUploadIndexes.length, "loaded image textures should upload pixels").toBeGreaterThan(0);
    expect(mipmapIndex, "default mipmapped image textures should generate TEXTURE_2D mipmaps").toBeGreaterThan(
      pixelUploadIndexes.at(-1) ?? -1,
    );
  });

  it("uploads per-face box positions and UVs for textured cube sampling", () => {
    vi.stubGlobal("Image", ControlledImage);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ texture: imageTexture("/textures/checker.png") }),
      }),
    ]));

    const arrayUploads = bufferUploads(calls).filter((upload) => upload.target === gl.ARRAY_BUFFER);
    const positionUpload = arrayUploads.find((upload) => upload.length >= 72);
    const uvUpload = arrayUploads.find((upload) =>
      upload.length >= 48
      && upload.index !== positionUpload?.index);

    expect(positionUpload, "a textured box should upload at least 24 position vertices").toBeDefined();
    expect(uvUpload, "a textured box should upload at least 24 UV coordinates").toBeDefined();
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 2
      && call.args[1] === 2)).toBe(true);
  });

  it("draws text from glyph mesh geometry instead of a single layout quad", async () => {
    const font = await loadTestTextFont();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      text({
        color: [0.95, 0.2, 0.1, 1],
        font,
        fontSize: 0.75,
        origin: [-0.5, -0.25, 0],
        text: "A",
      }),
    ]));

    const uploads = bufferUploads(calls);
    const positionUpload = uploads.find((upload) => upload.target === gl.ARRAY_BUFFER && upload.length > 12);
    const indexUpload = uploads.find((upload) => upload.target === gl.ELEMENT_ARRAY_BUFFER && upload.length > 6);
    const glyphDraw = drawCalls(calls).find((call) =>
      call.args[0] === gl.TRIANGLES
      && drawCount(call) > 6
      && drawCount(call) % 3 === 0);

    expect(positionUpload, "text glyph meshes should upload more than one quad worth of positions").toBeDefined();
    expect(indexUpload, "text glyph meshes should upload more than one quad worth of indices").toBeDefined();
    expect(glyphDraw, "text glyph meshes should draw more than the six indices used by a layout quad").toBeDefined();
  });
});
