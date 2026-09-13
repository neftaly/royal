import { createAutomaticRasterPageSource } from '../../packages/renderer-webgl/src/virtual-texture/automatic-page-source.ts';

/** Exercise the real canvas page adapter with independent coordinate-coded art. */
export async function runRectangularPageCrops() {
  const results = [];
  const wraps = ['clamp-to-edge', 'repeat', 'mirrored-repeat'] as const;
  const wrap = (value: number, mode: typeof wraps[number]) => {
    if (mode === 'clamp-to-edge') return Math.max(0, Math.min(1, value));
    const tile = Math.floor(value), fraction = value - tile;
    return mode === 'mirrored-repeat' && Math.abs(tile) % 2 === 1 ? 1 - fraction : fraction;
  };
  for (const tall of [false, true]) {
    const width = tall ? 2508 : 5017, height = tall ? 5017 : 2508;
    const logical = { width: tall ? 4096 : 8192, height: tall ? 8192 : 4096 };
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    const context = source.getContext('2d')!;
    const pixels = context.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels.data[offset] = Math.round(255 * x / (width - 1));
      pixels.data[offset + 1] = Math.round(255 * y / (height - 1));
      pixels.data[offset + 2] = 64; pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    try {
      for (const wrapS of wraps) for (const wrapT of wraps) {
        const adapter = createAutomaticRasterPageSource({ source, width, height },
          { wrapS, wrapT, minFilter: 'linear-mipmap-linear', magFilter: 'linear' }, 'srgb', logical);
        let samples = 0, maxError = 0, pages = 0;
        for (const mip of [0, 3, adapter.manifest.mipCount - 1]) {
          const layout = adapter.manifest.mipLayouts[mip]!;
          const cells = layout.width === 1 && layout.height === 1 ? [[0, 0]]
            : [[0, 0], [layout.width - 1, layout.height - 1], [Math.floor(layout.width / 2), Math.floor(layout.height / 2)]];
          for (const [x, y] of cells) {
            const page = await adapter.read({ mip, x: x!, y: y! }, new AbortController().signal);
            if (page?.kind !== 'image') throw new Error('Expected raster page');
            try {
              const canvas = page.source as HTMLCanvasElement;
              const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
              for (const py of [0, 1, 2, 65, 129, 130, 131]) for (const px of [0, 1, 2, 65, 129, 130, 131]) {
                const offset = (py * canvas.width + px) * 4;
                const expected = [
                  255 * wrap((x! * 128 + px - 2 + .5) * 2 ** mip / logical.width, wrapS),
                  255 * wrap((y! * 128 + py - 2 + .5) * 2 ** mip / logical.height, wrapT), 64, 255,
                ];
                for (let channel = 0; channel < 4; channel++) {
                  const error = Math.abs(data[offset + channel]! - expected[channel]!);
                  maxError = Math.max(maxError, error);
                  if (error > 3) throw new Error(`Crop mismatch ${tall}/${wrapS}/${wrapT} mip ${mip} page ${x},${y} pixel ${px},${py} channel ${channel}: ${data[offset + channel]} vs ${expected[channel]}`);
                }
                samples++;
              }
              pages++;
            } finally { page.close(); }
          }
        }
        results.push({ name: `rectangular-crops-${tall ? 'tall' : 'wide'}`, minFilter: `${wrapS}/${wrapT}`, pages, samples, maxError, logical, fitted: { width, height } });
      }
    } finally { source.width = source.height = 1; }
  }
  return { results, note: 'Production raster-page canvas adapter with coordinate-coded fitted artwork. Independent normalized-coordinate checks cover portrait/landscape, all nine wrap pairs, mip levels, edge/interior pages and gutters. Three-level RGBA tolerance allows 8-bit quantization/filtering. Not a renderer shader, screenshot-quality or timing benchmark.' };
}
