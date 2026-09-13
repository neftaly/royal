import { readVirtualTexturePage } from '../../packages/renderer-webgl/src/virtual-texture/browser-page-source';
import { parseVirtualTextureManifest } from '../../packages/renderer-webgl/src/virtual-texture/manifest';

export async function runImagePageCancellation() {
  const baseline = new URLSearchParams(location.search).has('baseline');
  const originalFetch = window.fetch, originalDecode = window.createImageBitmap;
  const manifest = parseVirtualTextureManifest({ contractVersion: 2, pageSize: 128, borderTexels: 8,
    virtualSize: [128, 128], pages: { uriTemplate: '{page}.png' } });
  const results = [];
  try {
    for (const size of [128, 144, 2048]) {
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#369'; context.fillRect(0, 0, size, size);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      canvas.width = canvas.height = 1;
      for (let round = 0; round < 3; round++) for (const cancelled of [false, true]) {
        const controller = new AbortController();
        let calls = 0, closes = 0, decodedPixels = 0;
        const bitmaps: ImageBitmap[] = [];
        window.fetch = async () => new Response(blob);
        window.createImageBitmap = (async (image: ImageBitmapSource, options?: ImageBitmapOptions) => {
          calls++;
          const pending = originalDecode(image, options);
          // Cancellation arrives after the browser decode starts, before it resolves.
          if (cancelled && calls === 1) controller.abort();
          const bitmap = await pending;
          decodedPixels += bitmap.width * bitmap.height;
          bitmaps.push(bitmap);
          const close = bitmap.close.bind(bitmap);
          bitmap.close = () => { closes++; close(); };
          return bitmap;
        }) as typeof createImageBitmap;
        let outcome = 'ready', leaked = false;
        const start = performance.now();
        try {
          const page = await readVirtualTexturePage(location.href, manifest, { mip: 0, x: 0, y: 0 }, controller.signal);
          if (page?.kind !== 'image') throw new Error('Missing image page');
          const source = page.source as ImageBitmap;
          if (source.width !== 144 || source.height !== 144) throw new Error('Incorrect page dimensions');
          page.close();
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
          outcome = 'aborted';
        } finally {
          leaked = bitmaps.some(bitmap => bitmap.width !== 0);
          for (const bitmap of bitmaps) if (bitmap.width !== 0) bitmap.close();
        }
        const elapsedMs = performance.now() - start;
        const expectedAbort = cancelled && !baseline;
        const expectedCalls = expectedAbort || size === 144 ? 1 : 2;
        if (leaked || outcome !== (expectedAbort ? 'aborted' : 'ready') || calls !== expectedCalls || closes !== calls) {
          throw new Error(JSON.stringify({ size, cancelled, outcome, calls, closes, expectedCalls }));
        }
        results.push({ size, round, cancelled, outcome, calls, closes, decodedPixels, elapsedMs });
      }
    }
  } finally { window.fetch = originalFetch; window.createImageBitmap = originalDecode; }
  return { results, baseline, note: 'Real PNG bitmap decoding with controlled cancellation immediately after decode submission. Fetch uses a prepared Blob. Instrumentation and promise scheduling affect elapsed time; bitmap output pixels are not peak memory. No frame-time or GPU-upload measurement.' };
}
