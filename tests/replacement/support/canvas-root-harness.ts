import type { RenderRoot } from "@royal/renderer-core";
import { perspectiveCamera } from "@royal/renderer-core";
import { vi } from "vitest";
import {
  CanvasRoot,
  type CanvasRootPlatform,
} from "../../../packages/renderer-webgl/src/runtime/canvas-root";

export type FakeGl = WebGL2RenderingContext & {
  readonly blendFuncSeparate: ReturnType<typeof vi.fn>;
  readonly bindFramebuffer: ReturnType<typeof vi.fn>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly clearColor: ReturnType<typeof vi.fn>;
  readonly bufferData: ReturnType<typeof vi.fn>;
  readonly bufferSubData: ReturnType<typeof vi.fn>;
  readonly drawElements: ReturnType<typeof vi.fn>;
  readonly drawElementsInstanced: ReturnType<typeof vi.fn>;
  readonly frontFace: ReturnType<typeof vi.fn>;
  readonly shaderSource: ReturnType<typeof vi.fn>;
  readonly texImage2D: ReturnType<typeof vi.fn>;
  readonly uniform1i: ReturnType<typeof vi.fn>;
  readonly uniform1f: ReturnType<typeof vi.fn>;
  readonly uniformMatrix4fv: ReturnType<typeof vi.fn>;
  readonly useProgram: ReturnType<typeof vi.fn>;
  readonly viewport: ReturnType<typeof vi.fn>;
};

export const fakeGl = (): FakeGl => ({
  COLOR_BUFFER_BIT: 0x4000,
  CLAMP_TO_EDGE: 0x812f,
  ARRAY_BUFFER: 0x8892,
  BACK: 0x0405,
  BLEND: 0x0be2,
  CCW: 0x0901,
  CW: 0x0900,
  COMPILE_STATUS: 0x8b81,
  CULL_FACE: 0x0b44,
  DEPTH_TEST: 0x0b71,
  DEPTH_BUFFER_BIT: 0x0100,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  FLOAT: 0x1406,
  FRAGMENT_SHADER: 0x8b30,
  FRAMEBUFFER: 0x8d40,
  LEQUAL: 0x0203,
  LINEAR: 0x2601,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  LINEAR_MIPMAP_NEAREST: 0x2701,
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
  RGBA: 0x1908,
  RGBA8: 0x8058,
  SCISSOR_TEST: 0x0c11,
  STATIC_DRAW: 0x88e4,
  STENCIL_TEST: 0x0b90,
  STENCIL_BUFFER_BIT: 0x0400,
  SRGB8_ALPHA8: 0x8c43,
  SRC_ALPHA: 0x0302,
  TEXTURE0: 0x84c0,
  TEXTURE_2D: 0x0de1,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TRIANGLES: 0x0004,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_INT: 0x1405,
  UNSIGNED_SHORT: 0x1403,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
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
  clearStencil: vi.fn(),
  colorMask: vi.fn(),
  compileShader: vi.fn(),
  createBuffer: vi.fn(() => ({})),
  createProgram: vi.fn(() => ({})),
  createSampler: vi.fn(() => ({})),
  createShader: vi.fn(() => ({})),
  createVertexArray: vi.fn(() => ({})),
  createTexture: vi.fn(() => ({})),
  cullFace: vi.fn(),
  deleteBuffer: vi.fn(),
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
  enable: vi.fn(),
  enableVertexAttribArray: vi.fn(),
  frontFace: vi.fn(),
  generateMipmap: vi.fn(),
  getProgramInfoLog: vi.fn(() => ""),
  getProgramParameter: vi.fn(() => true),
  getShaderInfoLog: vi.fn(() => ""),
  getShaderParameter: vi.fn(() => true),
  getParameter: vi.fn((parameter: number) => parameter === 0x0d3a
    ? new Int32Array([4096, 4096])
    : 4096),
  getUniformLocation: vi.fn(() => ({})),
  linkProgram: vi.fn(),
  pixelStorei: vi.fn(),
  samplerParameteri: vi.fn(),
  scissor: vi.fn(),
  shaderSource: vi.fn(),
  stencilMask: vi.fn(),
  texImage2D: vi.fn(),
  uniform4fv: vi.fn(),
  uniform1f: vi.fn(),
  uniform1i: vi.fn(),
  uniformMatrix4fv: vi.fn(),
  useProgram: vi.fn(),
  vertexAttribPointer: vi.fn(),
  vertexAttribDivisor: vi.fn(),
  vertexAttrib3f: vi.fn(),
  viewport: vi.fn(),
} as unknown as FakeGl);

export class FakeCanvas extends EventTarget {
  height = 150;
  width = 300;
  readonly gl: FakeGl;

  constructor(gl = fakeGl()) {
    super();
    this.gl = gl;
  }

  getContext(kind: string): WebGL2RenderingContext | null {
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
  const root = new CanvasRoot(canvas as unknown as HTMLCanvasElement, {}, platform);
  return { callbacks, canvas, listenerErrors, root, scheduledFailures };
};

export const emptyScene = (
  clearColor: RenderRoot["clearColor"] = [0, 0, 0, 0],
): RenderRoot => ({
  camera: perspectiveCamera({}),
  clearColor,
  kind: "scene",
  nodes: [],
});
