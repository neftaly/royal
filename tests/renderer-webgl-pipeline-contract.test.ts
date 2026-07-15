import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  directionalLight,
  mesh,
  orthographicCamera,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
  studioEnvironment,
  unlitMaterial,
  type Geometry,
  type RenderNode,
  type LinearRgba,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import { preloadImageBasedLightingFeature } from "../packages/renderer-webgl/src/lazy-image-based-lighting-feature";
import { vertexShaderSource } from "../packages/renderer-webgl/src/webgl/shaders";
import { VERTEX_ATTRIBUTE } from "../packages/renderer-webgl/src/vertex-input/attribute-abi";

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

type FakeGlOptions = {
  readonly drawingBufferSize?: CanvasSize;
  readonly maxTextureImageUnits?: number;
};

type GlCall = {
  readonly name: string;
  readonly args: readonly unknown[];
};

type FakeGl = {
  readonly gl: WebGL2RenderingContext;
  readonly calls: readonly GlCall[];
};

type BufferUpload = {
  readonly target: unknown;
  readonly length: number;
};

const drawCallNames = new Set(["drawArrays", "drawElements"]);

const defaultCanvasSize: CanvasSize = { width: 200, height: 100 };
const baselineTextureUnitCount = 16;
const iblBrdfLutSize = 64;
const iblSpecularTextureUnit = 2;

const roundNumber = (value: number): number => {
  const rounded = Number(value.toFixed(6));

  return Object.is(rounded, -0) ? 0 : rounded;
};

const roundVector = (values: readonly number[]): readonly number[] =>
  values.map(roundNumber);

const isNumericArrayLike = (value: unknown): value is ArrayLike<number> =>
  ArrayBuffer.isView(value)
    && !(value instanceof DataView)
    && typeof (value as { readonly length?: unknown }).length === "number";

const numericArray = (value: unknown): readonly number[] => {
  if (Array.isArray(value)) return value.map(Number);
  if (isNumericArrayLike(value)) return Array.from(value, Number);

  throw new Error("Expected a numeric WebGL uniform payload");
};

const dataLength = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (isNumericArrayLike(value)) return value.length;

  return 0;
};

const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  size: CanvasSize = defaultCanvasSize,
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
    height: 0,
    removeEventListener: target.removeEventListener.bind(target),
    width: 0,
  };

  if (gl !== null) {
    (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;
  }

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (options: FakeGlOptions = {}): FakeGl => {
  const calls: GlCall[] = [];
  const drawingBufferSize = options.drawingBufferSize ?? defaultCanvasSize;
  let nextHandleId = 1;
  const uniformLocations = new Map<string, WebGLUniformLocation>();
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CLAMP_TO_EDGE: 0x812F,
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
    LESS: 0x0201,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    RGBA16F: 0x881A,
    RGBA8: 0x8058,
    SCISSOR_TEST: 0x0C11,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88E4,
    RENDERBUFFER: 0x8D41,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MAX_LEVEL: 0x813D,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
  } as const;

  const handle = <Handle>(kind: string): Handle =>
    ({ id: nextHandleId++, kind }) as Handle;

  const uniformHandle = (name: string): WebGLUniformLocation => {
    const existing = uniformLocations.get(name);
    if (existing !== undefined) return existing;

    const location = { kind: "uniform", name } as unknown as WebGLUniformLocation;
    uniformLocations.set(name, location);

    return location;
  };

  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    calls.push({ name, args });
    return implementation?.(...args);
  });

  const glTarget = {
    ...constants,
    drawingBufferHeight: drawingBufferSize.height,
    drawingBufferWidth: drawingBufferSize.width,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindFramebuffer: record("bindFramebuffer"),
    bindRenderbuffer: record("bindRenderbuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendFuncSeparate: record("blendFuncSeparate"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
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
    disable: record("disable"),
    drawArrays: record("drawArrays"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    framebufferRenderbuffer: record("framebufferRenderbuffer"),
    framebufferTexture2D: record("framebufferTexture2D"),
    frontFace: record("frontFace"),
    getActiveAttrib: record("getActiveAttrib", () => null),
    getActiveUniform: record("getActiveUniform", () => null),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      if (name === "a_position") return 0;
      if (name === "a_normal") return 1;
      if (name === "a_uv0") return 10;
      if (name === "a_uv1") return 11;
      if (name === "a_tangent") return 2;
      if (name === "a_color") return 12;
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
    getError: record("getError", () => 0),
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    checkFramebufferStatus: record("checkFramebufferStatus", () => constants.FRAMEBUFFER_COMPLETE),
    getParameter: record<[number]>("getParameter", (parameter) => {
      if (parameter === constants.MAX_TEXTURE_IMAGE_UNITS) {
        return options.maxTextureImageUnits ?? baselineTextureUnitCount;
      }
      if (parameter === constants.MAX_TEXTURE_SIZE) return 4096;
      return 0;
    }),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.LINK_STATUS) return true;
      if (parameter === constants.ACTIVE_ATTRIBUTES) return 0;
      if (parameter === constants.ACTIVE_UNIFORMS) return 0;
      return 0;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) => {
      if (parameter === constants.COMPILE_STATUS) return true;
      return 0;
    }),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniformHandle(name)),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    polygonOffset: record("polygonOffset"),
    renderbufferStorage: record("renderbufferStorage"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    uniform1f: record("uniform1f"),
    uniform1i: record("uniform1i"),
    uniform2f: record("uniform2f"),
    uniform2fv: record("uniform2fv"),
    uniform3fv: record("uniform3fv"),
    uniform4f: record("uniform4f"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix3fv: record("uniformMatrix3fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
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

const matrixUniformPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "uniformMatrix4fv")
    .map((call) => {
      expect(call.args[1]).toBe(false);

      const values = numericArray(call.args[2]);
      const offset = typeof call.args[3] === "number" ? call.args[3] : 0;
      const length = typeof call.args[4] === "number" ? call.args[4] : 16;

      return values.slice(offset, offset + length).slice(0, 16);
    });

const expectMatrixUniform = (
  calls: readonly GlCall[],
  expected: readonly number[],
): void => {
  const actual = matrixUniformPayloads(calls).map(roundVector);

  expect(actual).toContainEqual(roundVector(expected));
};

const uniform4fvPayloads = (calls: readonly GlCall[]): readonly (readonly number[])[] =>
  calls
    .filter((call) => call.name === "uniform4f" || call.name === "uniform4fv")
    .map((call) => {
      if (call.name === "uniform4f") {
        return call.args.slice(1, 5).map((value) => typeof value === "number" ? value : Number.NaN);
      }
      const values = numericArray(call.args[1]);
      const offset = typeof call.args[2] === "number" ? call.args[2] : 0;
      const length = typeof call.args[3] === "number" ? call.args[3] : 4;

      return values.slice(offset, offset + length).slice(0, 4);
    });

const uniformLocationName = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "name" in value
    ? String((value as { readonly name: unknown }).name)
    : undefined;

const matrixUniformPayloadsByName = (calls: readonly GlCall[], name: string): readonly (readonly number[])[] =>
  matrixUniformPayloads(calls.filter((call) => uniformLocationName(call.args[0]) === name));

const uniform4fvPayloadsByName = (calls: readonly GlCall[], name: string): readonly (readonly number[])[] =>
  uniform4fvPayloads(calls.filter((call) => uniformLocationName(call.args[0]) === name));

const uniform1iPayloadsByName = (calls: readonly GlCall[], name: string): readonly number[] =>
  calls
    .filter((call) => call.name === "uniform1i" && uniformLocationName(call.args[0]) === name)
    .map((call) => typeof call.args[1] === "number" ? call.args[1] : Number.NaN);

const bufferUploads = (calls: readonly GlCall[]): readonly BufferUpload[] =>
  calls
    .filter((call) => call.name === "bufferData" || call.name === "bufferSubData")
    .map((call) => {
      const payload = call.name === "bufferSubData" ? call.args[2] : call.args[1];

      return {
        target: call.args[0],
        length: dataLength(payload),
      };
    });

const previousVertexArrayBind = (
  calls: readonly GlCall[],
  beforeIndex: number,
): GlCall | undefined => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call?.name === "bindVertexArray") return call;
  }

  return undefined;
};

const shaderSources = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "shaderSource")
    .map((call) => String(call.args[1]));

const isValidElementIndexType = (
  gl: WebGL2RenderingContext,
  value: unknown,
): boolean =>
  value === gl.UNSIGNED_BYTE
  || value === gl.UNSIGNED_SHORT
  || value === gl.UNSIGNED_INT;

const isPositiveTriangleCount = (value: unknown): boolean =>
  typeof value === "number" && value > 0 && value % 3 === 0;

const isValidTriangleDraw = (
  gl: WebGL2RenderingContext,
  call: GlCall,
): boolean => {
  if (call.args[0] !== gl.TRIANGLES) return false;

  if (call.name === "drawArrays") {
    return typeof call.args[1] === "number" && isPositiveTriangleCount(call.args[2]);
  }

  if (call.name === "drawElements") {
    return isPositiveTriangleCount(call.args[1])
      && isValidElementIndexType(gl, call.args[2])
      && typeof call.args[3] === "number";
  }

  return false;
};

const unlitBox = (color: LinearRgba = [1, 1, 1, 1]) =>
  mesh({
    geometry: boxGeometry(1),
    material: unlitMaterial({ color }),
  });

const testCamera = () =>
  orthographicCamera({
    bottom: -1,
    far: 10,
    left: -1,
    near: 0.1,
    position: [0, 0, 4],
    right: 1,
    rotation: [0, 0, 0],
    top: 1,
  });

const singleScene = (nodes: readonly RenderNode[]) =>
  scene({
    camera: testCamera(),
    nodes,
  });

const iblEnvironmentScene = () =>
  scene({
    camera: orthographicCamera({
          bottom: -1,
          far: 10,
          left: -1,
          near: 0.1,
          position: [0, 0, 4],
          right: 1,
          rotation: [0, 0, 0],
          top: 1,
    }),
    nodes: [
          mesh({
            geometry: boxGeometry(1),
            material: standardMaterial({
              color: [1, 1, 1, 1],
              metallic: 1,
              roughness: 0.4,
            }),
          }),
    ],
    environment: studioEnvironment({
      radianceScaleNits: 80,
    }),
    exposureEv100: 0.9,
    toneMapping: "pbr-neutral",
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL renderer pipeline contracts", () => {
  it("sets stable model/view/projection matrices for an orthographic scene", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10.5,
            left: -2,
            near: 0.5,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 3,
      }),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              transform: {
                position: [1, 2, -3],
                rotation: [0, 0, 0],
                scale: [2, 3, 4],
              },
            }),
      ],
    }));

    expectMatrixUniform(calls, [
      0.5, 0, 0, 0,
      0, 0.5, 0, 0,
      0, 0, -0.2, 0,
      0, -0.5, -1.1, 1,
    ]);
    expectMatrixUniform(calls, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -4, 1,
    ]);
    expectMatrixUniform(calls, [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      1, 2, -3, 1,
    ]);
  });

  it("sets stable projection and view matrices for a perspective scene", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: perspectiveCamera({
            far: 101,
            fovY: Math.PI / 2,
            near: 1,
            position: [0, 0, 5],
            rotation: [0, 0, 0],
      }),
      nodes: [unlitBox()],
    }));

    expectMatrixUniform(calls, [
      0.5, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -1.02, -1,
      0, 0, -2.02, 0,
    ]);
    expectMatrixUniform(calls, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -5, 1,
    ]);
  });

  it("sends an unlit solid color through uniform4fv", () => {
    const color: LinearRgba = [0.125, 0.5, 0.875, 0.75];
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -1,
            near: 0.1,
            position: [0, 0, 4],
            right: 1,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [unlitBox(color)],
    }));

    expect(uniform4fvPayloads(calls).map(roundVector)).toContainEqual(color);
  });

  it("skips redundant uniform and program uploads across repeated renders without skipping draws", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = singleScene([unlitBox([0.2, 0.4, 0.6, 1])]);

    root.render(renderGraph);
    const callsBeforeSecondRender = calls.length;
    root.render(renderGraph);
    const firstRenderCalls = calls.slice(0, callsBeforeSecondRender);
    const secondRenderCalls = calls.slice(callsBeforeSecondRender);

    expect(firstRenderCalls.some((call) => call.name.startsWith("uniform"))).toBe(true);
    expect(firstRenderCalls.some((call) => call.name === "useProgram")).toBe(true);
    expect(firstRenderCalls.some((call) => call.name === "vertexAttrib4f")).toBe(true);
    expect(secondRenderCalls.some((call) => call.name.startsWith("uniform"))).toBe(false);
    expect(secondRenderCalls.some((call) => call.name === "useProgram")).toBe(false);
    expect(secondRenderCalls.some((call) => call.name === "vertexAttrib2f" || call.name === "vertexAttrib4f")).toBe(false);
    expect(secondRenderCalls.some((call) => drawCallNames.has(call.name))).toBe(true);
  });

  it("uses the fixed vertex attribute ABI without program-dependent binding or lookup", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(singleScene([unlitBox()]));

    expect(calls.some((call) => call.name === "bindAttribLocation" || call.name === "getAttribLocation")).toBe(false);
    const surface = vertexShaderSource("surface");
    const instanced = vertexShaderSource("surface-instanced-split");
    const wireframe = vertexShaderSource("wireframe");
    for (const source of [surface, instanced, wireframe]) {
      expect(source).toContain(`layout(location = ${VERTEX_ATTRIBUTE.position}) in vec3 a_position;`);
    }
    expect(surface).toContain(`layout(location = ${VERTEX_ATTRIBUTE.normal}) in vec3 a_normal;`);
    expect(surface).toContain(`layout(location = ${VERTEX_ATTRIBUTE.tangent}) in vec4 a_tangent;`);
    expect(surface).toContain(`layout(location = ${VERTEX_ATTRIBUTE.texCoord0}) in vec2 a_uv0;`);
    expect(surface).toContain(`layout(location = ${VERTEX_ATTRIBUTE.texCoord1}) in vec2 a_uv1;`);
    expect(surface).toContain(`layout(location = ${VERTEX_ATTRIBUTE.color}) in vec4 a_color;`);
    expect(instanced).toContain(
      `layout(location = ${VERTEX_ATTRIBUTE.instanceLocalModelFirstColumn}) in mat4 a_instanceLocalModel;`,
    );
    expect(instanced).toContain(`layout(location = ${VERTEX_ATTRIBUTE.instancePosition}) in vec3 a_instancePosition;`);
    expect(instanced).toContain(`layout(location = ${VERTEX_ATTRIBUTE.instanceRotation}) in vec3 a_instanceRotation;`);
    expect(instanced).toContain(`layout(location = ${VERTEX_ATTRIBUTE.instanceScale}) in vec3 a_instanceScale;`);
  });

  it("uploads material uniform changes after a previous render cached different values", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(singleScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1], metallic: 0.1, roughness: 0.25 }),
      }),
    ]));
    const callsBeforeSecondRender = calls.length;

    root.render(singleScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1], metallic: 0.1, roughness: 0.75 }),
      }),
    ]));
    const secondRenderCalls = calls.slice(callsBeforeSecondRender);

    expect(uniform4fvPayloadsByName(secondRenderCalls, "u_materialPbrFactors").map(roundVector))
      .toContainEqual([0.1, 0.75, 0, 0]);
  });

  it("uploads light uniform changes after a previous render cached different values", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(singleScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      }),
    ]));
    const callsBeforeSecondRender = calls.length;

    root.render(singleScene([
      directionalLight({ color: [0.25, 0.5, 0.75, 1], direction: [0, 0, -1] }),
      mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      }),
    ]));
    const secondRenderCalls = calls.slice(callsBeforeSecondRender);

    expect(uniform4fvPayloadsByName(secondRenderCalls, "u_surfaceLightColor[0]").map(roundVector))
      .toContainEqual([0.25, 0.5, 0.75, 1]);
  });

  it("uploads model matrix changes after a previous render cached a different matrix", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(singleScene([
      mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      }),
    ]));
    const callsBeforeSecondRender = calls.length;

    root.render(singleScene([
      mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        transform: {
          position: [0.25, 0.5, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      }),
    ]));
    const secondRenderCalls = calls.slice(callsBeforeSecondRender);

    expect(matrixUniformPayloadsByName(secondRenderCalls, "u_model").map(roundVector))
      .toContainEqual([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0.25, 0.5, 0, 1,
      ]);
  });

  it("uploads box vertex data before issuing a triangle draw", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -1,
            near: 0.1,
            position: [0, 0, 4],
            right: 1,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [unlitBox()],
    }));

    const uploads = bufferUploads(calls);
    const bindTargets = calls
      .filter((call) => call.name === "bindBuffer")
      .map((call) => call.args[0]);
    const drawCalls = calls.filter((call) => drawCallNames.has(call.name));
    const indexedDraws = drawCalls.filter((call) => call.name === "drawElements");

    expect(calls.filter((call) => call.name === "createBuffer").length).toBeGreaterThanOrEqual(1);
    expect(bindTargets).toContain(gl.ARRAY_BUFFER);
    expect(uploads.some((upload) => upload.target === gl.ARRAY_BUFFER && upload.length >= 24)).toBe(true);
    expect(calls.some((call) => call.name === "vertexAttribPointer")).toBe(true);
    expect(drawCalls.some((call) => isValidTriangleDraw(gl, call))).toBe(true);

    if (indexedDraws.length > 0) {
      expect(bindTargets).toContain(gl.ELEMENT_ARRAY_BUFFER);
      expect(uploads.some((upload) => upload.target === gl.ELEMENT_ARRAY_BUFFER && upload.length > 0)).toBe(true);
    }
  });

  it("uploads element buffers with the null vertex array bound", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(singleScene([
      unlitBox(),
      mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ color: [0.2, 0.4, 0.7, 1] }),
        transform: { position: [1.2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      }),
    ]));

    const elementUploadIndexes = calls.flatMap((call, index) =>
      call.name === "bufferData" && call.args[0] === gl.ELEMENT_ARRAY_BUFFER ? [index] : []);

    expect(elementUploadIndexes.length).toBeGreaterThanOrEqual(2);
    for (const uploadIndex of elementUploadIndexes) {
      expect(previousVertexArrayBind(calls, uploadIndex)?.args[0]).toBe(null);
    }
  });

  it("binds box normals and shades standard meshes from light direction", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -1,
            near: 0.1,
            position: [0, 0, 4],
            right: 1,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [
            directionalLight({
              color: [0.8, 0.9, 1, 1],
              direction: [0.25, -0.5, -1],
            }),
            mesh({
              geometry: boxGeometry(1),
              material: standardMaterial({ color: [1, 1, 1, 1] }),
            }),
      ],
    }));

    expect(calls.some((call) => call.name === "getAttribLocation")).toBe(false);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 1
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(bufferUploads(calls).filter((upload) => upload.target === gl.ARRAY_BUFFER && upload.length === 72).length)
      .toBeGreaterThanOrEqual(2);

    const sources = shaderSources(calls).join("\n");
    expect(sources).toMatch(/\ba_normal\b/);
    expect(sources).toMatch(/\bu_surfaceLightDirection\b/);
    expect(sources).toMatch(/dot\s*\(\s*normalize/);
    expect(sources).not.toContain("baseColor * u_surfaceLightColor");
  });

  it("sends standard material metallic and roughness factors to the shader", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -1,
            near: 0.1,
            position: [0, 0, 4],
            right: 1,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [
            directionalLight({
              color: [1, 1, 1, 1],
              direction: [0, 0, -1],
            }),
            mesh({
              geometry: boxGeometry(1),
              material: standardMaterial({
                color: [1, 1, 1, 1],
                metallic: 0.65,
                roughness: 0.35,
              }),
            }),
      ],
    }));

    expect(uniform4fvPayloadsByName(calls, "u_materialPbrFactors").map(roundVector))
      .toContainEqual([0.65, 0.35, 0, 0]);
    const sources = shaderSources(calls).join("\n");
    expect(sources).toContain("uniform vec4 u_materialPbrFactors;");
    expect(sources).toContain("uniform vec4 u_toneMappingSettings;");
    expect(sources).toContain("uniform bool u_useIblBrdfLut;");
    expect(sources).toContain("materialGgxDistribution");
    expect(sources).toContain("toneMapPbrNeutral");
    expect(sources).toContain("linearToSrgb");
    expect(sources).toContain("if (!u_useIblIrradiance) {\n    return vec3(0.0);");
    expect(sources).not.toContain("uniform sampler2D u_iblBrdfLut;");
    expect(sources).not.toContain("texture(u_iblBrdfLut");
    expect(sources).toContain("return vec2(-1.04, 1.04) * a004 + r.zw;");
    expect(sources).toContain("return 0.5 / max(lambdaV + lambdaL, 0.0001);");
    expect(sources).toContain(
      "vec3 diffuse = diffuseColor * (1.0 - diffuseTransmissionFactor) * (lambert / PI) * lightColor",
    );
    expect(sources).toContain("? vec4(lit, baseColor.a)");
    expect(sources).not.toContain("uniform bool u_unlit;");
    expect(sources).not.toContain("pow(roughness + 1.0, 2.0) / 8.0");
    expect(sources).not.toContain("pow(NdotH, 32.0)");

    expect(uniform1iPayloadsByName(calls, "u_useIblSpecular")).toContain(0);
    expect(uniform1iPayloadsByName(calls, "u_iblSpecularCube")).toEqual([]);
    expect(uniform4fvPayloadsByName(calls, "u_toneMappingSettings").map(roundVector))
      .toContainEqual([1, 0.833333, 1, 0]);
    expect(calls.some((call) => call.name === "bindTexture" && call.args[0] === gl.TEXTURE_CUBE_MAP)).toBe(false);
    expect(calls.some((call) =>
      call.name === "texStorage2D"
      && call.args[0] === gl.TEXTURE_CUBE_MAP
      && call.args[1] === 1
      && call.args[2] === gl.RGBA8
      && call.args[3] === 1
      && call.args[4] === 1)).toBe(false);
  });

  it("loads pass environment specular and its BRDF LUT after an eager diffuse frame", async () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(iblEnvironmentScene());

    expect(uniform1iPayloadsByName(calls, "u_useIblIrradiance")).toContain(1);
    expect(uniform1iPayloadsByName(calls, "u_useIblSpecular")).toEqual([0]);
    expect(calls.some((call) => call.name === "bindTexture" && call.args[0] === gl.TEXTURE_CUBE_MAP)).toBe(false);

    await preloadImageBasedLightingFeature();
    await Promise.resolve();
    root.render(iblEnvironmentScene());

    expect(uniform1iPayloadsByName(calls, "u_surfaceLightCount")).toContain(0);
    expect(uniform1iPayloadsByName(calls, "u_useIblIrradiance")).toContain(1);
    expect(uniform1iPayloadsByName(calls, "u_useIblSpecular")).toContain(1);
    expect(uniform1iPayloadsByName(calls, "u_iblSpecularCube")).toContain(iblSpecularTextureUnit);
    expect(uniform1iPayloadsByName(calls, "u_useIblBrdfLut")).toContain(1);
    const brdfLutUnits = uniform1iPayloadsByName(calls, "u_iblBrdfLut");
    const brdfLutUnit = brdfLutUnits.find((unit) =>
      unit > 0
      && unit < baselineTextureUnitCount
      && unit !== iblSpecularTextureUnit);
    if (brdfLutUnit === undefined) {
      throw new Error(`Expected BRDF LUT sampler to use a non-conflicting unit; got ${brdfLutUnits.join(", ")}`);
    }
    expect(uniform4fvPayloadsByName(calls, "u_iblIrradianceSettings").map(roundVector))
      .toContainEqual([1, 80, 0, 0]);
    expect(uniform4fvPayloadsByName(calls, "u_iblSpecularSettings").map(roundVector))
      .toContainEqual([1, 80, 6, 0]);
    expect(uniform4fvPayloadsByName(calls, "u_toneMappingSettings").map(roundVector))
      .toContainEqual([1, 0.446572, 1, 0]);
    const cubeFaceUploads = calls.filter((call) =>
      call.name === "texImage2D"
      && Number(call.args[0]) >= gl.TEXTURE_CUBE_MAP_POSITIVE_X
      && Number(call.args[0]) < gl.TEXTURE_CUBE_MAP_POSITIVE_X + 6);

    expect(cubeFaceUploads).toHaveLength(36);
    expect(calls.some((call) => call.name === "bindTexture" && call.args[0] === gl.TEXTURE_CUBE_MAP)).toBe(true);
    expect(calls.some((call) =>
      call.name === "texImage2D"
      && call.args[0] === gl.TEXTURE_2D
      && call.args[3] === iblBrdfLutSize
      && call.args[4] === iblBrdfLutSize
      && dataLength(call.args[8]) === iblBrdfLutSize * iblBrdfLutSize * 4)).toBe(true);
    const brdfLutActiveIndex = calls.findIndex((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + brdfLutUnit);
    expect(brdfLutActiveIndex).toBeGreaterThanOrEqual(0);
    expect(calls.slice(brdfLutActiveIndex).some((call) =>
      call.name === "bindTexture"
      && call.args[0] === gl.TEXTURE_2D)).toBe(true);
  });

  it("disables environment specular and its BRDF LUT when no planned texture unit is available", () => {
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(iblEnvironmentScene());

    expect(uniform1iPayloadsByName(calls, "u_useIblIrradiance")).toContain(1);
    expect(uniform1iPayloadsByName(calls, "u_useIblSpecular")).toContain(0);
    expect(uniform1iPayloadsByName(calls, "u_iblSpecularCube")).toEqual([]);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + iblSpecularTextureUnit)).toBe(false);
    expect(uniform1iPayloadsByName(calls, "u_useIblBrdfLut")).toContain(0);
    expect(uniform1iPayloadsByName(calls, "u_iblBrdfLut")).toEqual([]);
    expect(calls.some((call) =>
      call.name === "texImage2D"
      && call.args[0] === gl.TEXTURE_2D
      && call.args[3] === iblBrdfLutSize
      && call.args[4] === iblBrdfLutSize)).toBe(false);
    const sources = shaderSources(calls).join("\n");
    expect(sources).not.toContain("uniform samplerCube u_iblSpecularCube;");
    expect(sources).not.toContain("uniform sampler2D u_iblBrdfLut;");
    expect(sources).toContain("return vec2(-1.04, 1.04) * a004 + r.zw;");
  });

  it("rejects unknown geometry kinds before renderer planning", () => {
    const unsupportedGeometry = { kind: "custom-pyramid" } as unknown as Geometry;

    expect(() => mesh({
      geometry: unsupportedGeometry,
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
    })).toThrow("mesh geometry must be a boxGeometry or planeGeometry descriptor");
  });
});
