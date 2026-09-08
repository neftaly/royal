import { createAutomaticSvgPageSource } from '../../packages/renderer-webgl/src/virtual-texture/automatic-page-source.ts';
import { parseSvgTextureSource } from '../../packages/renderer-webgl/src/texture/svg-source.ts';
import { SvgRasterCache } from '../../packages/renderer-webgl/src/virtual-texture/svg-raster-cache.ts';
import { decodeBrowserImageElement } from '../../packages/renderer-webgl/src/texture/browser-image-element.ts';

/** Native browser pixels: non-square text, shared decoding, and all gutter wraps. */
export async function runTargetRasterProbe(scale = 1) {
  const width = 512 * scale, height = 280 * scale;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="280" viewBox="0 0 64 35">'
    + '<defs><linearGradient id="g"><stop stop-color="#e42637"/><stop offset="1" stop-color="#218bca"/></linearGradient></defs>'
    + '<rect width="64" height="35" fill="url(#g)"/><rect x="8" y="8" width="40" height="15" fill="white"/>'
    + '<text x="9" y="13" font-size="3" fill="black">Readable target text</text>'
    + '<path d="M0 0H64V35H0Z" stroke="#19df32" stroke-width="1" fill="none"/></svg>';
  const blob = new Blob([svg.replace('width="512" height="280"', `width="${width}" height="${height}"`)], { type: 'image/svg+xml' });
  const encoded = { blob, byteLength: blob.size, parsed: parseSvgTextureSource(svg) };
  const referenceImage = await decodeBrowserImageElement(blob, new AbortController().signal, { output: 'canvas' });
  const reference = document.createElement('canvas');
  reference.width = width; reference.height = height;
  const referenceContext = reference.getContext('2d');
  referenceContext.drawImage(referenceImage.source, 0, 0);
  const pixels = referenceContext.getImageData(0, 0, width, height).data;
  referenceImage.close();
  const originalDecode = window.createImageBitmap;
  let decodes = 0;
  window.createImageBitmap = (...args) => { decodes++; return originalDecode(...args); };
  const cache = new SvgRasterCache();
  const results = [];
  try {
    for (const wrap of (scale === 1 ? ['clamp-to-edge', 'repeat', 'mirrored-repeat'] : ['clamp-to-edge'])) {
      const source = createAutomaticSvgPageSource(encoded, 64, 35,
        { magFilter: 'linear', minFilter: 'linear-mipmap-linear', wrapS: wrap, wrapT: wrap }, 'srgb', cache);
      const mip = Math.log2(source.manifest.width / width);
      const pageSize = source.manifest.pageSize, storedSize = pageSize + 4;
      const pages = Array.from({ length: Math.ceil(width / pageSize) * Math.ceil(height / pageSize) }, (_, i) => ({ mip, x: i % (width / pageSize), y: Math.floor(i / (width / pageSize)) }));
      source.setDemand(pages);
      const before = decodes;
      let maxError = 0, maxErrorAt;
      const wrapPixel = (pixel, extent) => {
        if (wrap === 'clamp-to-edge') return Math.max(0, Math.min(extent - 1, pixel));
        const period = Math.floor(pixel / extent);
        const local = pixel - period * extent;
        return wrap === 'mirrored-repeat' && Math.abs(period % 2) === 1 ? extent - 1 - local : local;
      };
      try {
        for (const id of pages) {
          const page = await source.read(id, new AbortController().signal);
          try {
            const canvas = document.createElement('canvas'); canvas.width = storedSize; canvas.height = storedSize;
            const context = canvas.getContext('2d'); context.drawImage(page.source, 0, 0);
            const actual = context.getImageData(0, 0, storedSize, storedSize).data;
            for (let y = 0; y < storedSize; y++) for (let x = 0; x < storedSize; x++) {
              const sx = wrapPixel(id.x * pageSize + x - 2, width);
              const sy = wrapPixel(id.y * pageSize + y - 2, height);
              for (let channel = 0; channel < 4; channel++) {
                const difference = Math.abs(actual[(y * storedSize + x) * 4 + channel] - pixels[(sy * width + sx) * 4 + channel]);
                if (difference > maxError) { maxError = difference; maxErrorAt = { id, x, y, sx, sy, channel, actual: actual[(y * storedSize + x) * 4 + channel], expected: pixels[(sy * width + sx) * 4 + channel] }; }
              }
            }
          } finally { page.close(); }
        }
        if (maxError > 2) throw new Error(`${wrap}: pixel error ${maxError} at ${JSON.stringify(maxErrorAt)}`);
        const expected = Math.ceil(width / (pageSize * 2)) * Math.ceil(height / pageSize);
        if (decodes - before !== expected) throw new Error(`${wrap}: expected ${expected} decodes, got ${decodes - before}`);
        results.push({ wrap, pages: pages.length, decodes: decodes - before, maxError, retainedBytes: cache.byteLength });
      } finally { source.close(); }
      if (cache.byteLength !== 0) throw new Error('Raster storage leaked after source disposal');
    }
    return results;
  } finally {
    window.createImageBitmap = originalDecode;
    cache.clear();
  }
}
