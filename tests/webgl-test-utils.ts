import { vi } from 'vitest';
import { makeTriangleFixture } from './gltf-fixture';

export type FakeGlCounts = {
  createBuffer: number;
  createTexture: number;
  deleteBuffer: number;
  deleteTexture: number;
  drawElements: number;
  texImage2D?: number;
};

export const fakeCanvas = (gl: WebGLRenderingContext): HTMLCanvasElement => ({
  height: 600,
  width: 800,
  getBoundingClientRect: () => ({ height: 600, width: 800 }),
  getContext: () => gl
}) as unknown as HTMLCanvasElement;

export const fakeGl = (): {
  readonly counts: FakeGlCounts;
  readonly gl: WebGLRenderingContext;
} => {
  const counts: FakeGlCounts = {
    createBuffer: 0,
    createTexture: 0,
    deleteBuffer: 0,
    deleteTexture: 0,
    drawElements: 0,
    texImage2D: 0
  };
  const uniform = {} as WebGLUniformLocation;

  return {
    counts,
    gl: {
      ARRAY_BUFFER: 0x8892,
      BACK: 0x0405,
      BLEND: 0x0be2,
      COLOR_BUFFER_BIT: 0x4000,
      COMPILE_STATUS: 0x8b81,
      CULL_FACE: 0x0b44,
      DEPTH_BUFFER_BIT: 0x0100,
      DEPTH_TEST: 0x0b71,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      FLOAT: 0x1406,
      FRAGMENT_SHADER: 0x8b30,
      LINEAR: 0x2601,
      LINEAR_MIPMAP_LINEAR: 0x2703,
      LINK_STATUS: 0x8b82,
      ONE: 1,
      ONE_MINUS_SRC_ALPHA: 0x0303,
      RGBA: 0x1908,
      STATIC_DRAW: 0x88e4,
      TEXTURE0: 0x84c0,
      TEXTURE_2D: 0x0de1,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_MIN_FILTER: 0x2801,
      TRIANGLES: 0x0004,
      UNPACK_FLIP_Y_WEBGL: 0x9240,
      UNSIGNED_BYTE: 0x1401,
      UNSIGNED_SHORT: 0x1403,
      VERTEX_SHADER: 0x8b31,
      activeTexture() {},
      attachShader() {},
      bindBuffer() {},
      bindTexture() {},
      blendFunc() {},
      bufferData() {},
      clear() {},
      clearColor() {},
      clearDepth() {},
      compileShader() {},
      createBuffer: () => {
        counts.createBuffer += 1;
        return {} as WebGLBuffer;
      },
      createProgram: () => ({} as WebGLProgram),
      createShader: () => ({} as WebGLShader),
      createTexture: () => {
        counts.createTexture += 1;
        return {} as WebGLTexture;
      },
      cullFace() {},
      deleteBuffer() {
        counts.deleteBuffer += 1;
      },
      deleteProgram() {},
      deleteShader() {},
      deleteTexture() {
        counts.deleteTexture += 1;
      },
      depthMask() {},
      disable() {},
      drawElements() {
        counts.drawElements += 1;
      },
      enable() {},
      enableVertexAttribArray() {},
      generateMipmap() {},
      getAttribLocation: () => 0,
      getProgramInfoLog: () => null,
      getProgramParameter: () => true,
      getShaderInfoLog: () => null,
      getShaderParameter: () => true,
      getUniformLocation: () => uniform,
      linkProgram() {},
      pixelStorei() {},
      shaderSource() {},
      texImage2D() {
        counts.texImage2D = (counts.texImage2D ?? 0) + 1;
      },
      texParameteri() {},
      uniform1i() {},
      uniform3fv() {},
      uniform4fv() {},
      uniformMatrix4fv() {},
      useProgram() {},
      vertexAttribPointer() {},
      viewport() {}
    } as unknown as WebGLRenderingContext
  };
};

export const installGltfFixture = (options: {
  readonly createImageBitmap?: () => Promise<ImageBitmap>;
} = {}): void => {
  const fixture = makeTriangleFixture();
  const responses = new Map<string, Response>([
    ['https://example.test/triangle.gltf', Response.json(fixture.json)],
    ['https://example.test/triangle.bin', new Response(fixture.bin)],
    ['https://example.test/triangle.png', new Response(new Blob(['image']))]
  ]);

  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const response = responses.get(url);
    if (response === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(response.clone());
  }));
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(options.createImageBitmap ?? (() => Promise.resolve({} as ImageBitmap)))
  );
};

export const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
};
