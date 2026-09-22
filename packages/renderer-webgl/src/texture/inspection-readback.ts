import { nativeTextureAvailable, nativeWebGlFormat, validateNativeBaseDimensions, type NativeTextureFormat } from "./native-storage";

export type InspectionReadbackSource = Readonly<{ width: number; height: number }> & (
  | Readonly<{ source: TexImageSource; format?: never; mip?: never; blocks?: never }>
  | Readonly<{ source?: never; format: NativeTextureFormat; mip: number; blocks: Uint8Array }>
);
export const INSPECTION_CONTEXT_OPTIONS = {
  alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
} as const;

/** Identical native pixel interpretation on the worker and compatibility path. */
export class InspectionReadback {
  readonly #createCanvas: () => HTMLCanvasElement | OffscreenCanvas;
  #native: HTMLCanvasElement | OffscreenCanvas | undefined;
  #gl: WebGL2RenderingContext | undefined;
  #program: WebGLProgram | undefined;

  constructor(createCanvas: () => HTMLCanvasElement | OffscreenCanvas) { this.#createCanvas = createCanvas; }

  read(source: InspectionReadbackSource): Uint8Array {
    const { width, height } = source;
    const mip = source.source === undefined ? source.mip : 0;
    if (this.#gl?.isContextLost()) this.dispose();
    if (this.#gl === undefined) {
      this.#native = this.#createCanvas();
      const gl = this.#native.getContext("webgl2", INSPECTION_CONTEXT_OPTIONS) as WebGL2RenderingContext | null;
      if (gl === null) throw new Error("Royal texture inspection requires WebGL2 for image sampling");
      this.#gl = gl;
      const program = gl.createProgram();
      if (program === null) throw new Error("Royal texture inspection could not create a sampling program");
      try {
        for (const [type, text] of [[gl.VERTEX_SHADER, `#version 300 es
out vec2 uv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); uv = p; gl_Position = vec4(p*2.0-1.0,0,1); }`],
          [gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec2 imageScale;
in vec2 uv;
out vec4 color;
void main() { color = texture(image, uv * imageScale); }`]] as const) {
          const shader = gl.createShader(type);
          if (shader === null) throw new Error("Royal texture inspection could not create a shader");
          try {
            gl.shaderSource(shader, text); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Royal texture inspection shader compilation failed");
            gl.attachShader(program, shader);
          } finally { gl.deleteShader(shader); }
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Royal texture inspection program linking failed");
        this.#program = program;
      } catch (error) { gl.deleteProgram(program); this.dispose(); throw error; }
    }
    const gl = this.#gl;
    const bytes = source.source !== undefined ? width * height * 4 : source.blocks.byteLength;
    if (bytes > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection sampling storage exceeds its 64 MiB limit");
    // A standalone mip is a complete level-zero texture. Some WebKit drivers
    // crash on an isolated 1x1 ETC2 level at level two. BC base dimensions must
    // be block aligned, so pad storage and crop the valid texels in the shader.
    if (source.source === undefined && mip === 0) validateNativeBaseDimensions(source.format, width, height);
    const padded = source.source === undefined && source.format.startsWith("bc");
    const storageWidth = padded ? Math.ceil(width / 4) * 4 : width;
    const storageHeight = padded ? Math.ceil(height / 4) * 4 : height;
    const texture = gl.createTexture();
    if (texture === null) throw new Error("Royal texture inspection could not allocate native storage");
    try {
      this.#native!.width = width; this.#native!.height = height;
      if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) throw new Error("Royal texture inspection cannot allocate full image readback");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
      if (source.source !== undefined) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source.source);
      } else {
        const format = source.format;
        if (!nativeTextureAvailable(gl, format, "linear")) throw new Error("Royal texture inspection cannot sample this compressed format");
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, nativeWebGlFormat(format, "linear"), storageWidth, storageHeight, 0, source.blocks);
      }
      gl.viewport(0, 0, width, height); gl.useProgram(this.#program!);
      gl.uniform2f(gl.getUniformLocation(this.#program!, "imageScale"), width / storageWidth, height / storageHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error("Royal texture inspection image sampling failed");
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error("Royal texture inspection readback failed");
      return pixels;
    } finally {
      gl.deleteTexture(texture);
      // Keep the context, not a full-resolution framebuffer, between inspections.
      this.#native!.width = 1; this.#native!.height = 1;
    }
  }

  dispose(): void {
    if (this.#program !== undefined) this.#gl?.deleteProgram(this.#program);
    this.#gl?.getExtension("WEBGL_lose_context")?.loseContext();
    if (this.#native !== undefined) { this.#native.width = 1; this.#native.height = 1; }
    this.#gl = undefined; this.#native = undefined; this.#program = undefined;
  }
}
