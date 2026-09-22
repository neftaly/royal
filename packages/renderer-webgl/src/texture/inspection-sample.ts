import { inspectionArea } from "./inspection-area";
import type { DecodedImageTextureSource, DecodedTextureSource } from "./source";
import { nativeTextureAvailable, nativeWebGlFormat, validateNativeBaseDimensions } from "./native-storage";

const SIZE = 256;
const canvas = (width: number, height: number): HTMLCanvasElement => {
  const value = document.createElement("canvas");
  value.width = width; value.height = height;
  return value;
};

/** Freeze mutable/vector-capable browser sources before either inspection or display. */
export const freezeInspectionSource = (source: DecodedImageTextureSource): DecodedImageTextureSource => {
  if (typeof ImageBitmap !== "undefined" && source.source instanceof ImageBitmap) return source;
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width * source.height * 4 > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection raster exceeds its 64 MiB limit");
  const image = canvas(source.width, source.height);
  try {
    const context = image.getContext("2d");
    if (context === null) throw new Error("Royal texture inspection could not freeze image pixels");
    if (typeof ImageData !== "undefined" && source.source instanceof ImageData) context.putImageData(source.source, 0, 0);
    else context.drawImage(source.source as CanvasImageSource, 0, 0, source.width, source.height);
    context.getImageData(0, 0, 1, 1);
    source.close?.();
    return { ...source, source: image, close: () => { image.width = 1; image.height = 1; } };
  } catch (error) { image.width = 1; image.height = 1; throw error; }
};

/** Private offscreen RGB sampling; never touches the renderer's presentation state. */
export class TextureInspectionSampler {
  #native: HTMLCanvasElement | undefined;
  #gl: WebGL2RenderingContext | undefined;
  #program: WebGLProgram | undefined;

  sample(source: DecodedTextureSource, mip = 0): HTMLCanvasElement {
    const images = this.samples(source, mip);
    for (const extra of images.slice(1)) { extra.width = 1; extra.height = 1; }
    return images[0]!;
  }

  samples(source: DecodedTextureSource, mip = 0): HTMLCanvasElement[] {
    const dimensions = source.kind === undefined ? source : source.levels[mip];
    if (dimensions === undefined || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
      || dimensions.width < 1 || dimensions.height < 1) throw new TypeError("Royal texture inspection requires positive image dimensions");
    const { width: inputWidth, height: inputHeight } = dimensions;
    if (inputWidth * inputHeight * 4 > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection raster exceeds its 64 MiB limit");
    const scale = Math.min(1, SIZE / Math.max(inputWidth, inputHeight));
    const width = Math.max(1, Math.round(inputWidth * scale)), height = Math.max(1, Math.round(inputHeight * scale));
    const rgba = this.#readPixels(source, mip, inputWidth, inputHeight);
    let transparent = false;
    const reduced = inspectionArea(inputWidth, inputHeight, width, height, 7, (x, y, values) => {
      const offset = (y * inputWidth + x) * 4, alpha = rgba[offset + 3]! / 255;
      if (alpha < 1) transparent = true;
      for (let c = 0; c < 3; c++) {
        values[c] = rgba[offset + c]!;
        values[c + 3] = rgba[offset + c]! * alpha;
      }
      values[6] = 255 * (1 - alpha);
    });
    // Keep raw RGB (opaque materials) and black/white composites (blended materials).
    const images: HTMLCanvasElement[] = [];
    try {
      for (let view = 0; view < (transparent ? 3 : 1); view++) {
        const image = canvas(width, height); images.push(image);
        const context = image.getContext("2d");
        if (context === null) throw new Error("Royal texture inspection could not create a sample canvas");
        const pixels = context.createImageData(width, height);
        for (let i = 0; i < width * height; i++) {
          for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = reduced[i * 7 + c + (view === 0 ? 0 : 3)]! + (view === 2 ? reduced[i * 7 + 6]! : 0);
          pixels.data[i * 4 + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
      }
      return images;
    } catch (error) {
      for (const image of images) { image.width = 1; image.height = 1; }
      throw error;
    }
  }

  #readPixels(source: DecodedTextureSource, mip: number, width: number, height: number): Uint8Array {
    if (this.#gl?.isContextLost()) this.dispose();
    if (this.#gl === undefined) {
      this.#native = canvas(1, 1);
      const gl = this.#native.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
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
in vec2 uv;
out vec4 color;
void main() { color = texture(image, uv); }`]] as const) {
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
    const level = source.kind === undefined ? undefined : source.levels[mip];
    const bytes = source.kind === undefined ? source.width * source.height * 4 : level?.blocks.byteLength;
    if (bytes === undefined) throw new Error("Royal texture inspection requires a mip level");
    if (bytes > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection sampling storage exceeds its 64 MiB limit");
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
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, mip);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, mip);
      if (source.kind === undefined) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source.source);
      } else {
        const format = source.kind === "ktx2-etc2" ? "etc2-rgba" : source.format;
        if (!nativeTextureAvailable(gl, format, "linear")) throw new Error("Royal texture inspection cannot sample this compressed format");
        // BC's block alignment applies to mip zero, not the 2x2/1x1 tail levels.
        if (mip === 0) validateNativeBaseDimensions(format, level!.width, level!.height);
        gl.compressedTexImage2D(gl.TEXTURE_2D, mip, nativeWebGlFormat(format, "linear"), level!.width, level!.height, 0, level!.blocks);
      }
      gl.viewport(0, 0, width, height); gl.useProgram(this.#program!);
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

/** Cache the actual inspected pixels, including dimensions, rather than trusting a URI alone. */
export const inspectionSampleKey = async (image: HTMLCanvasElement): Promise<string> => {
  const context = image.getContext("2d");
  if (context === null) throw new Error("Royal texture inspection could not read sample pixels");
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pixels));
  return `${image.width}x${image.height}:` + Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
};
