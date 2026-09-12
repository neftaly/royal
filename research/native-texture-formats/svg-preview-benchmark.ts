import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { createTextureAssetReader } from "../../packages/renderer-webgl/src/gltf/static-material";
import { TextureGpuOwner } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import { canonicalTextureSampler, canonicalTextureSamplerKey } from "../../packages/renderer-webgl/src/texture/sampler";
import { createKtx2Fixture } from "../../tests/replacement/support/ktx2-fixture";

/** Isolates source selection, decode and upload submission; no network or GPU draw timing. */
export const runSvgPreviewBenchmark = async () => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2")!;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const raster = document.createElement("canvas");
  raster.width = raster.height = 1024;
  const context = raster.getContext("2d")!;
  context.fillStyle = "red";
  context.fillRect(0, 0, 1024, 1024);
  const png = new Uint8Array(await (await new Promise<Blob>(resolve => raster.toBlob(blob => resolve(blob!)))) .arrayBuffer());
  const rows = [];
  for (const vk of [166, 172]) {
    const astc = createKtx2Fixture(vk, 128, 128, 8);
    const document = {
      extensionsUsed: ["EXT_texture_astc", "GS_texture_svg"],
      images: [{ uri: "image.png" }, { uri: "image.svg" }, { uri: "image.ktx2" }],
      textures: [{ source: 0, extensions: { GS_texture_svg: { source: 1 }, EXT_texture_astc: { source: 2 } } }],
    };
    const asset = createTextureAssetReader(document, new Uint8Array(), 0, [], "bench", "https://example.test/model.gltf", "bench")(
      0, "texture", "srgb", true,
    );
    for (const supported of [true, false]) {
      const counts = { astc: 0, png: 0, svg: 0 };
      const selectionGl = supported ? gl : {
        isContextLost: () => false, getExtension: () => null,
      } as unknown as WebGL2RenderingContext;
      const decoder = createBrowserTextureDecoder(1, true, async (ref) => {
        if (ref.src.endsWith(".ktx2")) { counts.astc++; return astc; }
        if (ref.src.endsWith(".png")) { counts.png++; return png; }
        counts.svg++;
        throw new Error("SVG must stay deferred");
      }, undefined, undefined, selectionGl);
      const owner = new TextureGpuOwner(gl);
      const decodeMs: number[] = [], uploadSubmissionMs: number[] = [];
      let payloadBytes = 0;
      for (let sample = 0; sample < 40; sample++) {
        const signal = new AbortController().signal;
        const start = performance.now();
        decoder.preload(asset, signal);
        const decoded = await decoder.decode(asset, signal);
        const end = performance.now();
        const sampler = canonicalTextureSampler(asset);
        const uploadStart = performance.now();
        const binding = owner.retain({ decoded, colorSpace: "srgb", storageKey: `preview-${sample}`,
          sampler, samplerKey: canonicalTextureSamplerKey(sampler) });
        const uploadEnd = performance.now();
        if (binding.texture === null || gl.getError() !== gl.NO_ERROR) throw new Error("Preview upload failed");
        payloadBytes = decoded.kind === undefined ? decoded.width * decoded.height * 4
          : decoded.levels.reduce((sum, level) => sum + level.blocks.byteLength, 0);
        if (sample >= 10) { decodeMs.push(end - start); uploadSubmissionMs.push(uploadEnd - uploadStart); }
        owner.dispose();
        decoded.close?.();
      }
      const median = (samples: number[]) => samples.sort((a, b) => a - b)[samples.length >> 1];
      rows.push({ vk, supported, requests: counts, payloadBytes,
        medianDecodeMs: median(decodeMs), medianUploadSubmissionMs: median(uploadSubmissionMs) });
    }
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { renderer, userAgent: navigator.userAgent, rows,
    note: "40 iterations, first 10 warmup. Encoded bytes supplied in memory; decode includes scheduling, Blob and format selection. Upload measures submission, not GPU completion. Unsupported ASTC is simulated. Solid-red 128px ASTC and 1024px PNG share artwork; PNG is fitted to the 128px preview budget. No SVG requests." };
};
