import { gltf, orthographicCamera, scene } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';
import { staticTexturedTriangleGlb } from '../../tests/replacement/support/static-glb.ts';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture.ts';

/** Local-blob first presentation, separate from later full-raster refinement. */
export async function runFirstPresentation() {
  const results = [];
  const decodeAudit = new URLSearchParams(location.search).has('decode-audit');
  const art = new OffscreenCanvas(4096, 4096);
  const context = art.getContext('2d')!;
  context.fillStyle = 'red'; context.fillRect(0, 0, 4096, 4096);
  const png = await art.convertToBlob({ type: 'image/png' });
  art.width = art.height = 1;
  const nativeFetch = globalThis.fetch;
  const nativeBitmap = globalThis.createImageBitmap;
  // Discard one pair to warm shared renderer/worker code, then alternate order.
  for (let round = -1; round < 4; round++) for (const vk of round < 0 ? [166] : [166, 172]) {
    for (const preview of round % 2 === 0 ? [true, false] : [false, true]) {
      const urls: string[] = [], reads: string[] = [];
      const url = (blob: Blob) => { const value = URL.createObjectURL(blob); urls.push(value); return value; };
      const raster = url(png);
      const blocks = createKtx2Fixture(vk, 32, 32, 6) as Uint8Array<ArrayBuffer>;
      const astc = url(new Blob([blocks], { type: 'image/ktx2' }));
      const bytes = staticTexturedTriangleGlb(undefined, raster, document => {
        document.nodes = [{ mesh: 0 }]; document.scenes = [{ nodes: [0] }];
        document.images = [{ uri: raster, mimeType: 'image/png' }, { uri: astc, mimeType: 'image/ktx2' }];
        document.extensionsUsed = ['KHR_materials_unlit', ...(preview ? ['EXT_texture_astc'] : [])];
        document.samplers = [{ minFilter: 9987, magFilter: 9729, wrapS: 33071, wrapT: 33071 }];
        document.textures = [{ source: 0, sampler: 0, ...(preview ? {
          extras: { royal: { astcPreview: { width: 4096, height: 4096 } } },
          extensions: { EXT_texture_astc: { source: 1 } },
        } : {}) }];
        document.materials = [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
      });
      const src = url(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }));
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const gl = canvas.getContext('webgl2', { antialias: false })!;
      if (!gl.getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC support required');
      const root = createRendererRoot(canvas, { antialias: false });
      const pixel = new Uint8Array(4);
      const decodedBitmaps: { width: number; height: number; durationMs: number }[] = [];
      if (decodeAudit) globalThis.createImageBitmap = ((...args: Parameters<typeof nativeBitmap>) => {
        const start = performance.now();
        const pending = Reflect.apply(nativeBitmap, globalThis, args) as Promise<ImageBitmap>;
        if (!(args[0] instanceof Blob) || args[0].type !== 'image/png') return pending;
        return pending.then(bitmap => {
          decodedBitmaps.push({ width: bitmap.width, height: bitmap.height, durationMs: performance.now() - start });
          return bitmap;
        });
      }) as typeof nativeBitmap;
      globalThis.fetch = (input, init) => {
        const uri = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (uri === raster || uri === astc) reads.push(uri === raster ? 'raster' : 'astc');
        return nativeFetch(input, init);
      };
      try {
        root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
        const node = gltf(src);
        const show = (half: number) => root.setScene(scene({
          camera: orthographicCamera({ left: -half, right: half, top: half, bottom: -half, position: [0, 0, 3] }),
          nodes: [node], clearColor: [0, 0, 0, 1],
        }));
        const tick = async () => {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          root.invalidate(); root.flushInvalidated();
          const state = root.getSnapshot();
          if (state.lastFrameFailure || state.resources.virtualTextures.failedPages || gl.getError() !== gl.NO_ERROR) throw new Error('First-presentation render failed');
          gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return state.resources.virtualTextures;
        };
        const start = performance.now(); show(16);
        let frames = 0;
        while (frames++ < 600) { await tick(); if (pixel[0]! > 250 && pixel[1]! < 3 && pixel[2]! < 3) break; }
        if (frames > 600) throw new Error('No first texture presentation');
        const firstMs = performance.now() - start;
        const firstReads = [...reads];
        const firstBitmapCount = decodedBitmaps.length;
        if (firstReads.join() !== (preview ? 'astc' : 'raster')) throw new Error(`Unexpected initial reads: ${reads}`);
        const first = root.getSnapshot().resources.virtualTextures;
        const refinementStart = performance.now(); show(4);
        let detail = first, refinementFrames = 0;
        while (refinementFrames++ < 600) {
          detail = await tick();
          if (reads.includes('raster') && detail.residentPages > 0 && detail.pendingPages === 0 && detail.unresidentPages === 0) break;
        }
        if (refinementFrames > 600 || reads.join() !== (preview ? 'astc,raster' : 'raster')) throw new Error('Raster refinement did not settle');
        const refinementMs = performance.now() - refinementStart;
        if (decodeAudit && (decodedBitmaps.length !== 1 || firstBitmapCount !== (preview ? 0 : 1))) throw new Error('Unexpected PNG bitmap decode count');
        if (round >= 0) results.push({ name: `first-presentation-${vk}-${round}`, minFilter: preview ? 'astc-preview' : 'full-png',
          round, frames, firstMs, refinementFrames, refinementMs, firstReads, reads, first, final: detail,
          pngBytes: png.size, astcBytes: blocks.byteLength, pixel: [...pixel],
          ...(decodeAudit ? { firstBitmapCount, decodedBitmaps } : {}) });
      } finally {
        root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext();
        globalThis.fetch = nativeFetch; globalThis.createImageBitmap = nativeBitmap;
        for (const uri of urls) URL.revokeObjectURL(uri);
      }
    }
  }
  return { results, note: 'Four alternating rounds after one discarded warm-up pair. New glTF/blob identities and renderer roots; fixture encoding and root creation excluded. Time from scene submission to observed red center pixel includes RAF quantization, worker/renderer work and diagnostic readback. Uniform red 4096px PNG and matching red 32px ASTC full mip pyramid; local blobs, no network latency or photographic quality comparison. Full-raster refinement timed separately after zoom.' };
}
