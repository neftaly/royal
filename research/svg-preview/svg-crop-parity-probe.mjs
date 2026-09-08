/** Browser regression: SVG pages retain full-image layout, not per-tile fitting. */
export async function runSvgCropParityProbe() {
  const { parseSvgTextureSource } = await import('../../packages/renderer-webgl/src/texture/svg-source.ts');
  const { createAutomaticSvgPageSource } = await import('../../packages/renderer-webgl/src/virtual-texture/automatic-page-source.ts');
  const fixtures = [
    { name: 'rounded-preview', attrs: 'width="297mm" height="210mm" viewBox="0 0 297 210"', dims: [152, 107], opaque: true },
    { name: 'offset-viewbox', attrs: 'width="200" height="100" viewBox="-20 -10 200 100"', dims: [103, 52] },
    ...['xMidYMid meet', 'xMaxYMin meet', 'xMinYMax slice', 'none'].map(mode => ({
      name: mode, attrs: `width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="${mode}"`, dims: [103, 52],
    })),
  ];
  const results = [];
  for (const fixture of fixtures) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${fixture.attrs}><rect width="100%" height="100%" fill="#cc6644"/><rect x="35%" y="30%" width="20%" height="40%" fill="#33bbdd"/></svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const reference = new Image();
    reference.src = url;
    await reference.decode();
    const referenceCanvas = document.createElement('canvas');
    referenceCanvas.width = 512; referenceCanvas.height = 512;
    const referenceContext = referenceCanvas.getContext('2d');
    referenceContext.drawImage(reference, 0, 0, 512, 512);
    const referencePixels = referenceContext.getImageData(0, 0, 512, 512).data;
    URL.revokeObjectURL(url);
    for (const cached of [false, true]) for (const mip of [3, 4, 5, 6]) {
      const source = createAutomaticSvgPageSource({ blob, byteLength: blob.size, parsed: parseSvgTextureSource(svg) },
        ...fixture.dims, { magFilter: 'linear', minFilter: 'linear-mipmap-linear', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' }, 'srgb');
      try {
        const m = source.manifest, width = m.width / 2 ** mip, height = m.height / 2 ** mip;
        const pages = [];
        for (let y = 0; y < Math.ceil(height / m.pageSize); y++) for (let x = 0; x < Math.ceil(width / m.pageSize); x++) pages.push({ mip, x, y });
        if (cached) source.setDemand(pages);
        let samples = 0, minAlpha = 255, minAlphaAt;
        for (const page of pages) {
          const tile = await source.read(page, new AbortController().signal);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = m.pageSize + 2 * m.borderTexels;
          const context = canvas.getContext('2d'); context.drawImage(tile.source, 0, 0); tile.close();
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const innerWidth = Math.min(m.pageSize, width - page.x * m.pageSize);
          const innerHeight = Math.min(m.pageSize, height - page.y * m.pageSize);
          for (let y = 0; y < Math.floor(innerHeight); y++) for (let x = 0; x < Math.floor(innerWidth); x++) {
            const index = ((y + m.borderTexels) * canvas.width + x + m.borderTexels) * 4;
            if (pixels[index + 3] < minAlpha) { minAlpha = pixels[index + 3]; minAlphaAt = { page, x, y }; }
            if (x % 37 || y % 37) continue;
            const rx = Math.min(508, Math.max(3, Math.floor((page.x * m.pageSize + x + .5) / width * 512)));
            const ry = Math.min(508, Math.max(3, Math.floor((page.y * m.pageSize + y + .5) / height * 512)));
            const expected = referencePixels.slice((ry * 512 + rx) * 4, (ry * 512 + rx) * 4 + 4);
            // Ignore antialiasing around authored boundaries; test solid regions.
            if ([-3, 0, 3].some(dy => [-3, 0, 3].some(dx => expected.some((v, c) => Math.abs(v - referencePixels[((ry + dy) * 512 + rx + dx) * 4 + c]) > 1)))) continue;
            if (expected.some((v, c) => Math.abs(v - pixels[index + c]) > 2)) throw new Error(JSON.stringify({ fixture: fixture.name, cached, mip, page, x, y, expected: [...expected], actual: [...pixels.slice(index, index + 4)] }));
            samples++;
          }
        }
        // Canvas filtering may round alpha down by one byte on region copies.
        if (!samples || (fixture.opaque && minAlpha < 254)) throw new Error(JSON.stringify({ fixture: fixture.name, cached, mip, samples, minAlpha, minAlphaAt }));
        results.push({ fixture: fixture.name, cached, mip, samples, minAlpha });
      } finally { source.close(); }
    }
  }
  return results;
}
