import { parseKtx2Native } from "../../packages/renderer-webgl/src/texture/ktx2-native";
import { nativeTextureAvailable, nativeWebGlFormat } from "../../packages/renderer-webgl/src/texture/native-storage";
import { TextureGpuOwner } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";
import type { CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { createKtx2Fixture } from "../../tests/replacement/support/ktx2-fixture";

const median = (samples: number[]): number => samples.sort((a, b) => a - b)[samples.length >> 1]!;
const measure = (iterations: number, operation: () => void): number => {
  const samples: number[] = [];
  for (let batch = 0; batch < 11; batch++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) operation();
    if (batch > 1) samples.push((performance.now() - start) / iterations);
  }
  return median(samples);
};
const sampler = { magFilter: "linear", minFilter: "linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" } as const;

/** No payload reads in the timed parse loop: output consists of typed-array views. */
export const runNativeTextureBenchmark = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext("webgl2", { antialias: false })!;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const results = [];
  for (const extent of [136, 1024]) {
    for (const vk of [152, 166, 172, 134, 138, 146]) {
      const payload = createKtx2Fixture(vk, extent, extent);
      const parsed = parseKtx2Native(payload);
      const parseMs = measure(5000, () => { parseKtx2Native(payload); });
      const supported = nativeTextureAvailable(gl, parsed.format, "srgb");
      let uploadMs: number | null = null;
      let retainMs: number | null = null;
      let pageUploadMs: number | null = null;
      const budget = new PersistentGpuBudgetOwner(64 * 1024 * 1024);
      const uploads = new FrameUploadBudgetOwner(64 * 1024 * 1024);
      const owner = new TextureGpuOwner(gl, budget, uploads);
      const binding: CanonicalTextureBinding = {
        colorSpace: "srgb", sampler, samplerKey: "linear", storageKey: parsed.format,
        decoded: parsed.format === "etc2-rgba" ? { ...parsed, kind: "ktx2-etc2" }
          : { ...parsed, format: parsed.format, kind: "ktx2-native" },
      };
      if (supported) {
        uploadMs = measure(5, () => {
          owner.dispose(); uploads.beginFrame();
          owner.retain(binding); gl.finish();
          if (gl.getError() !== gl.NO_ERROR) throw new Error(`Upload failed: ${parsed.format}`);
        });
        retainMs = measure(100000, () => { owner.retain(binding); });
        // Use a block-aligned stored extent for ASTC 6x6 atlas subimages.
        const pageExtent = parsed.format === "astc-6x6" ? 132 : 136;
        const page = parseKtx2Native(createKtx2Fixture(vk, pageExtent, pageExtent));
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const format = nativeWebGlFormat(page.format, "srgb");
        gl.texStorage2D(gl.TEXTURE_2D, 1, format, pageExtent * 8, pageExtent * 8);
        pageUploadMs = measure(10, () => {
          gl.compressedTexSubImage2D(gl.TEXTURE_2D, 0, pageExtent, pageExtent, pageExtent, pageExtent, format, page.levels[0]!.blocks);
          gl.finish();
          if (gl.getError() !== gl.NO_ERROR) throw new Error(`Page upload failed: ${parsed.format}`);
        });
        gl.deleteTexture(texture);
      }
      owner.dispose();
      results.push({ extent, format: parsed.format, bytes: parsed.levels[0]!.blocks.byteLength, parseMs, supported, uploadMs, retainMs, pageUploadMs });
    }
    const image = new ImageData(extent, extent);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    const uploadMs = measure(5, () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.finish();
      if (gl.getError() !== gl.NO_ERROR) throw new Error("RGBA upload failed");
    });
    gl.deleteTexture(texture);
    results.push({ extent, format: "rgba8", bytes: extent * extent * 4, uploadMs });
  }
  // Verify ASTC sampling, not just driver acceptance, using known opaque-red blocks.
  const vertex = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vertex, "#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}"); gl.compileShader(vertex);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fragment, "#version 300 es\nprecision highp float;uniform sampler2D t;out vec4 c;void main(){c=texture(t,vec2(.5));}"); gl.compileShader(fragment);
  const program = gl.createProgram()!; gl.attachShader(program,vertex); gl.attachShader(program,fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
  gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program,"t"),0);
  const pixels = [];
  for (const vk of [166,172]) {
    const source = parseKtx2Native(createKtx2Fixture(vk,16,16));
    if (!nativeTextureAvailable(gl,source.format,"srgb")) continue;
    const texture=gl.createTexture(); gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(0,null);
    gl.compressedTexImage2D(gl.TEXTURE_2D,0,nativeWebGlFormat(source.format,"srgb"),16,16,0,source.levels[0]!.blocks);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.drawArrays(gl.TRIANGLES,0,3);
    const pixel=new Uint8Array(4);gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    if (pixel[0]!==255 || pixel[1]!==0 || pixel[2]!==0 || pixel[3]!==255) throw new Error(`ASTC sample mismatch: ${pixel}`);
    pixels.push({format:source.format,pixel:Array.from(pixel)});gl.deleteTexture(texture);
  }
  gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { renderer, userAgent: navigator.userAgent, results, pixels, note: "Median warmed wall time with gl.finish; software-driver results are not native GPU timings. Parsing uses structural fixtures and creates views, not payload copies." };
};
