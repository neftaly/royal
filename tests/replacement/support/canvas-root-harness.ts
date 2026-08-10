import type { Scene } from "@royal/renderer-core";
import { perspectiveCamera } from "@royal/renderer-core";
import { vi } from "vitest";
import {
  CanvasRoot,
  type RendererRootOptions,
  type CanvasRootPlatform,
} from "../../../packages/renderer-webgl/src/runtime/canvas-root";

export type FakeGl = WebGL2RenderingContext & {
  readonly activeTexture: ReturnType<typeof vi.fn>;
  readonly blendFuncSeparate: ReturnType<typeof vi.fn>;
  readonly bindBuffer: ReturnType<typeof vi.fn>;
  readonly bindFramebuffer: ReturnType<typeof vi.fn>;
  readonly bindVertexArray: ReturnType<typeof vi.fn>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly clearColor: ReturnType<typeof vi.fn>;
  readonly compressedTexImage2D: ReturnType<typeof vi.fn>;
  readonly copyTexSubImage2D: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn<() => WebGLBuffer | null>>;
  readonly createFramebuffer: ReturnType<typeof vi.fn<() => WebGLFramebuffer | null>>;
  readonly createProgram: ReturnType<typeof vi.fn<() => WebGLProgram | null>>;
  readonly createSampler: ReturnType<typeof vi.fn<() => WebGLSampler | null>>;
  readonly createTexture: ReturnType<typeof vi.fn<() => WebGLTexture | null>>;
  readonly createVertexArray: ReturnType<
    typeof vi.fn<() => WebGLVertexArrayObject | null>
  >;
  readonly bufferData: ReturnType<typeof vi.fn>;
  readonly bufferSubData: ReturnType<typeof vi.fn>;
  readonly drawElements: ReturnType<typeof vi.fn>;
  readonly drawElementsInstanced: ReturnType<typeof vi.fn>;
  readonly drawArrays: ReturnType<typeof vi.fn>;
  readonly deleteBuffer: ReturnType<typeof vi.fn>;
  readonly deleteVertexArray: ReturnType<typeof vi.fn>;
  readonly depthFunc: ReturnType<typeof vi.fn>;
  readonly frontFace: ReturnType<typeof vi.fn>;
  readonly getProgramParameter: ReturnType<typeof vi.fn>;
  readonly invalidateFramebuffer: ReturnType<typeof vi.fn>;
  readonly isContextLost: ReturnType<typeof vi.fn<() => boolean>>;
  readonly scissor: ReturnType<typeof vi.fn>;
  readonly shaderSource: ReturnType<typeof vi.fn>;
  readonly texImage2D: ReturnType<typeof vi.fn>;
  readonly texSubImage2D: ReturnType<typeof vi.fn>;
  readonly uniform1i: ReturnType<typeof vi.fn>;
  readonly uniform1f: ReturnType<typeof vi.fn>;
  readonly uniform2f: ReturnType<typeof vi.fn>;
  readonly uniformMatrix4fv: ReturnType<typeof vi.fn>;
  readonly useProgram: ReturnType<typeof vi.fn>;
  readonly viewport: ReturnType<typeof vi.fn>;
};

export type FakeIndexedDraw = Readonly<{
  elementArrayBuffer: WebGLBuffer | null;
  instanceCount: number;
  vertexArray: WebGLVertexArrayObject | null;
}>;

export type SemanticFakeGl = FakeGl & Readonly<{
  vaoSemantics: Readonly<{
    currentVertexArray(): WebGLVertexArrayObject | null;
    elementArrayBuffer(vertexArray: WebGLVertexArrayObject | null): WebGLBuffer | null;
    readonly indexedDraws: FakeIndexedDraw[];
    readonly implicitElementArrayMutations: Array<Readonly<{
      after: WebGLBuffer | null;
      before: WebGLBuffer | null;
      vertexArray: WebGLVertexArrayObject | null;
    }>>;
    resetContext(): void;
  }>;
}>;

export const fakeGl = (): FakeGl => ({
  COLOR_BUFFER_BIT: 0x4000,
  COLOR_ATTACHMENT0: 0x8ce0,
  CLAMP_TO_EDGE: 0x812f,
  COMPRESSED_RGBA8_ETC2_EAC: 0x9278,
  COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9279,
  ARRAY_BUFFER: 0x8892,
  BACK: 0x0405,
  BLEND: 0x0be2,
  CCW: 0x0901,
  CW: 0x0900,
  COMPILE_STATUS: 0x8b81,
  CULL_FACE: 0x0b44,
  DEPTH_TEST: 0x0b71,
  DEPTH_BUFFER_BIT: 0x0100,
  DEPTH: 0x1801,
  DEPTH_ATTACHMENT: 0x8d00,
  DEPTH_COMPONENT24: 0x81a6,
  DYNAMIC_DRAW: 0x88e8,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  EQUAL: 0x0202,
  FLOAT: 0x1406,
  FRAGMENT_SHADER: 0x8b30,
  FRAMEBUFFER: 0x8d40,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  DRAW_FRAMEBUFFER: 0x8ca9,
  LEQUAL: 0x0203,
  LINES: 0x0001,
  LINEAR: 0x2601,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  R11F_G11F_B10F: 0x8c3a,
  R8: 0x8229,
  R8UI: 0x8232,
  R16UI: 0x8234,
  LINK_STATUS: 0x8b82,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_VIEWPORT_DIMS: 0x0d3a,
  MIRRORED_REPEAT: 0x8370,
  NEAREST: 0x2600,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  NONE: 0,
  ONE: 1,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  REPEAT: 0x2901,
  READ_FRAMEBUFFER: 0x8ca8,
  RGB: 0x1907,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  RED_INTEGER: 0x8d94,
  SCISSOR_TEST: 0x0c11,
  STATIC_DRAW: 0x88e4,
  SRGB8_ALPHA8: 0x8c43,
  SRC_ALPHA: 0x0302,
  TEXTURE0: 0x84c0,
  TEXTURE_2D: 0x0de1,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TEXTURE_WRAP_R: 0x8072,
  TRIANGLES: 0x0004,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_INT: 0x1405,
  UNSIGNED_INT_10F_11F_11F_REV: 0x8c3b,
  UNSIGNED_SHORT: 0x1403,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  UNPACK_ALIGNMENT: 0x0cf5,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  VERTEX_SHADER: 0x8b31,
  activeTexture: vi.fn(),
  attachShader: vi.fn(),
  bindSampler: vi.fn(),
  bindTexture: vi.fn(),
  bindFramebuffer: vi.fn(),
  bindBuffer: vi.fn(),
  bindVertexArray: vi.fn(),
  blendFuncSeparate: vi.fn(),
  bufferData: vi.fn(),
  bufferSubData: vi.fn(),
  clear: vi.fn(),
  clearColor: vi.fn(),
  clearDepth: vi.fn(),
  colorMask: vi.fn(),
  compileShader: vi.fn(),
  compressedTexImage2D: vi.fn(),
  createBuffer: vi.fn<() => WebGLBuffer | null>(() => ({} as WebGLBuffer)),
  createFramebuffer: vi.fn<() => WebGLFramebuffer | null>(
    () => ({} as WebGLFramebuffer),
  ),
  createProgram: vi.fn(() => ({})),
  createSampler: vi.fn(() => ({})),
  createShader: vi.fn(() => ({})),
  createVertexArray: vi.fn<() => WebGLVertexArrayObject | null>(
    () => ({} as WebGLVertexArrayObject),
  ),
  createTexture: vi.fn(() => ({})),
  cullFace: vi.fn(),
  deleteBuffer: vi.fn(),
  deleteFramebuffer: vi.fn(),
  deleteProgram: vi.fn(),
  deleteShader: vi.fn(),
  deleteSampler: vi.fn(),
  deleteTexture: vi.fn(),
  deleteVertexArray: vi.fn(),
  depthMask: vi.fn(),
  depthFunc: vi.fn(),
  disable: vi.fn(),
  disableVertexAttribArray: vi.fn(),
  drawElements: vi.fn(),
  drawElementsInstanced: vi.fn(),
  drawArrays: vi.fn(),
  enable: vi.fn(),
  enableVertexAttribArray: vi.fn(),
  frontFace: vi.fn(),
  generateMipmap: vi.fn(),
  checkFramebufferStatus: vi.fn(() => 0x8cd5),
  copyTexSubImage2D: vi.fn(),
  framebufferTexture2D: vi.fn(),
  getProgramInfoLog: vi.fn(() => ""),
  getProgramParameter: vi.fn(() => true),
  getShaderInfoLog: vi.fn(() => ""),
  getShaderParameter: vi.fn(() => true),
  getParameter: vi.fn((parameter: number) => parameter === 0x0d3a
    ? new Int32Array([4096, 4096])
    : 4096),
  getExtension: vi.fn(() => null),
  getUniformLocation: vi.fn(() => ({})),
  invalidateFramebuffer: vi.fn(),
  isContextLost: vi.fn(() => false),
  linkProgram: vi.fn(),
  pixelStorei: vi.fn(),
  samplerParameteri: vi.fn(),
  scissor: vi.fn(),
  shaderSource: vi.fn(),
  texImage2D: vi.fn(),
  texStorage2D: vi.fn(),
  texSubImage2D: vi.fn(),
  uniform4fv: vi.fn(),
  uniform1f: vi.fn(),
  uniform1i: vi.fn(),
  uniform2f: vi.fn(),
  uniformMatrix4fv: vi.fn(),
  useProgram: vi.fn(),
  vertexAttribPointer: vi.fn(),
  vertexAttribDivisor: vi.fn(),
  vertexAttrib3f: vi.fn(),
  viewport: vi.fn(),
} as unknown as FakeGl);

/** Models the VAO-owned state that call-count mocks cannot observe. */
export const semanticFakeGl = (): SemanticFakeGl => {
  const gl = fakeGl();
  let currentVertexArray: WebGLVertexArrayObject | null = null;
  const elementArrayBuffers = new Map<
    WebGLVertexArrayObject | null,
    WebGLBuffer | null
  >([[null, null]]);
  const bufferTargets = new Map<WebGLBuffer, number>();
  const submittedVertexArrays = new Set<WebGLVertexArrayObject | null>();
  let vertexArrayExplicitlyBound = false;
  const indexedDraws: FakeIndexedDraw[] = [];
  const implicitElementArrayMutations:
    SemanticFakeGl["vaoSemantics"]["implicitElementArrayMutations"] = [];

  vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
    currentVertexArray = vertexArray;
    vertexArrayExplicitlyBound = true;
    if (!elementArrayBuffers.has(vertexArray)) elementArrayBuffers.set(vertexArray, null);
  });
  vi.mocked(gl.bindBuffer).mockImplementation((target, buffer) => {
    if (
      buffer !== null
      && (target === gl.ARRAY_BUFFER || target === gl.ELEMENT_ARRAY_BUFFER)
    ) {
      const previousTarget = bufferTargets.get(buffer);
      if (previousTarget !== undefined && previousTarget !== target) {
        throw new Error("Semantic WebGL buffer cannot change binding target");
      }
      bufferTargets.set(buffer, target);
    }
    if (target !== gl.ELEMENT_ARRAY_BUFFER) return;
    const before = elementArrayBuffers.get(currentVertexArray) ?? null;
    if (
      submittedVertexArrays.has(currentVertexArray)
      && !vertexArrayExplicitlyBound
      && before !== buffer
    ) {
      implicitElementArrayMutations.push({
        after: buffer,
        before,
        vertexArray: currentVertexArray,
      });
    }
    elementArrayBuffers.set(currentVertexArray, buffer);
  });
  const recordSubmission = (): void => {
    submittedVertexArrays.add(currentVertexArray);
    vertexArrayExplicitlyBound = false;
  };
  const recordIndexedDraw = (instanceCount: number): void => {
    indexedDraws.push({
      elementArrayBuffer: elementArrayBuffers.get(currentVertexArray) ?? null,
      instanceCount,
      vertexArray: currentVertexArray,
    });
    recordSubmission();
  };
  vi.mocked(gl.drawArrays).mockImplementation(recordSubmission);
  vi.mocked(gl.drawElements).mockImplementation(() => recordIndexedDraw(1));
  vi.mocked(gl.drawElementsInstanced).mockImplementation((
    _mode,
    _count,
    _type,
    _offset,
    instanceCount,
  ) => recordIndexedDraw(instanceCount));
  vi.mocked(gl.deleteBuffer).mockImplementation((buffer) => {
    bufferTargets.delete(buffer);
    for (const [vertexArray, elementArrayBuffer] of elementArrayBuffers) {
      if (elementArrayBuffer !== buffer) continue;
      elementArrayBuffers.set(vertexArray, null);
    }
  });
  vi.mocked(gl.deleteVertexArray).mockImplementation((vertexArray) => {
    elementArrayBuffers.delete(vertexArray);
    submittedVertexArrays.delete(vertexArray);
    if (currentVertexArray === vertexArray) {
      currentVertexArray = null;
      vertexArrayExplicitlyBound = false;
    }
  });

  const resetContext = (): void => {
    currentVertexArray = null;
    elementArrayBuffers.clear();
    elementArrayBuffers.set(null, null);
    bufferTargets.clear();
    submittedVertexArrays.clear();
    vertexArrayExplicitlyBound = false;
    indexedDraws.length = 0;
    implicitElementArrayMutations.length = 0;
  };
  return Object.assign(gl, {
    vaoSemantics: {
      currentVertexArray: () => currentVertexArray,
      elementArrayBuffer: (vertexArray: WebGLVertexArrayObject | null) =>
        elementArrayBuffers.get(vertexArray) ?? null,
      implicitElementArrayMutations,
      indexedDraws,
      resetContext,
    },
  });
};

export class FakeCanvas extends EventTarget {
  height = 150;
  width = 300;
  contextAttributes: WebGLContextAttributes | undefined;
  readonly gl: FakeGl;

  constructor(gl = fakeGl()) {
    super();
    this.gl = gl;
  }

  getContext(
    kind: string,
    attributes?: WebGLContextAttributes,
  ): WebGL2RenderingContext | null {
    this.contextAttributes = attributes;
    return kind === "webgl2" ? this.gl : null;
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 220,
      height: 200,
      left: 10,
      right: 310,
      top: 20,
      width: 300,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    };
  }
}

export const canvasRootHarness = (
  platformOverrides: Partial<CanvasRootPlatform> = {},
  glOverrides: Partial<FakeGl> = {},
  options: RendererRootOptions = {},
) => {
  const callbacks: Array<() => void> = [];
  const gl = fakeGl();
  Object.assign(gl, glOverrides);
  const canvas = new FakeCanvas(gl);
  const listenerErrors: unknown[] = [];
  const scheduledFailures: unknown[] = [];
  const platform: CanvasRootPlatform = {
    onListenerError: (error) => listenerErrors.push(error),
    reportScheduledFailure: (error) => scheduledFailures.push(error),
    requestFrame: (callback) => callbacks.push(callback),
    ...platformOverrides,
  };
  const root = new CanvasRoot(canvas as unknown as HTMLCanvasElement, options, platform);
  const flushScheduledFrames = (): number => {
    let frameCount = 0;
    while (callbacks.length > 0) {
      if (frameCount === 1_000) {
        throw new Error("Royal canvas test scheduled more than 1,000 consecutive frames");
      }
      callbacks.shift()!();
      frameCount += 1;
    }
    return frameCount;
  };
  return {
    callbacks,
    canvas,
    flushScheduledFrames,
    listenerErrors,
    root,
    scheduledFailures,
  };
};

export const emptyScene = (
  clearColor: Scene["clearColor"] = [0, 0, 0, 0],
): Scene => ({
  camera: perspectiveCamera({}),
  clearColor,
  kind: "scene",
  nodes: [],
});
