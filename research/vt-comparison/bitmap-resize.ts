/** Browser bitmap operation cost; no renderer policy is changed by this probe. */
export async function runBitmapResize() {
  const results = [];
  const options = { colorSpaceConversion: 'none', imageOrientation: 'none', premultiplyAlpha: 'none' } as const;
  const resize = { ...options, resizeWidth: 3547, resizeHeight: 3547, resizeQuality: 'high' } as const;
  for (const pattern of ['solid', 'checker']) {
    const art = new OffscreenCanvas(4096, 4096);
    const context = art.getContext('2d')!;
    context.fillStyle = 'red'; context.fillRect(0, 0, 4096, 4096);
    if (pattern === 'checker') {
      context.clearRect(0, 0, 4096, 4096);
      for (let y = 0; y < 4096; y += 32) for (let x = 0; x < 4096; x += 32) {
        context.fillStyle = ((x + y) / 32) % 2 ? 'rgba(255, 0, 0, 0.5)' : 'blue';
        context.fillRect(x, y, 32, 32);
      }
    }
    const png = await art.convertToBlob({ type: 'image/png' });
    art.width = art.height = 1;
    const orders = [
      ['plain', 'direct', 'staged'], ['direct', 'staged', 'plain'], ['staged', 'plain', 'direct'],
      ['plain', 'staged', 'direct'], ['staged', 'direct', 'plain'], ['direct', 'plain', 'staged'],
    ];
    for (let round = -1; round < orders.length; round++) {
      const modes = orders[Math.max(0, round)]!;
      for (const mode of modes) {
        let bitmap: ImageBitmap | undefined, original: ImageBitmap | undefined;
        try {
          const start = performance.now();
          let decodeMs: number | undefined;
          if (mode === 'staged') {
            original = await createImageBitmap(png, options);
            decodeMs = performance.now() - start;
            bitmap = await createImageBitmap(original, resize);
          } else bitmap = await createImageBitmap(png, mode === 'direct' ? resize : options);
          const totalMs = performance.now() - start;
          const exposedBitmapBytes = 4 * (bitmap.width * bitmap.height + (original ? original.width * original.height : 0));
          // Hash the full canvas readback outside timing; compare requested
          // output behavior without retaining many full-resolution snapshots.
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
          let hash = 2166136261;
          for (let index = 0; index < pixels.length; index++) hash = Math.imul(hash ^ pixels[index]!, 16777619);
          canvas.width = canvas.height = 1;
          if (round >= 0) results.push({ name: `bitmap-resize-${pattern}-${round}`, minFilter: mode,
            round, totalMs, decodeMs, resizeMs: decodeMs === undefined ? undefined : totalMs - decodeMs,
            width: bitmap.width, height: bitmap.height, exposedBitmapBytes, pngBytes: png.size, pixelHash: hash >>> 0 });
        } finally { bitmap?.close(); original?.close(); }
      }
    }
  }
  return { results, note: 'One discarded warm-up and six balanced-order rounds per pattern. PNG encoding, canvas readback and full pixel hashing are outside timing. Direct and staged request the same 3547px high-quality resize. Exposed bitmap bytes count returned bitmap dimensions, not peak process or browser decoder memory. Staged decoding simultaneously exposes original and resized bitmaps. Full-canvas hashes are a diagnostic, not an image-quality metric.' };
}
