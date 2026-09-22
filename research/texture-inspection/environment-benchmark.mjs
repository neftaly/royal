import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../probability/apps/play/package.json', import.meta.url));
const browsers = require('@playwright/test');
const browser = await browsers[process.env.BROWSER ?? 'chromium'].launch();
try {
  const page = await browser.newPage();
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5190'}/tests/browser/texture-inspection.html`);
  await page.evaluate(() => window.textureInspectionTest);
  console.log(JSON.stringify(await page.evaluate(async () => {
    const { environmentInspectionSample } = await import('/packages/renderer-webgl/src/environment/inspection-sample.ts');
    const records = [];
    for (const size of [64, 128, 256]) {
      const words = new Uint32Array(size * size * 6);
      for (let i = 0; i < words.length; i++) words[i] = Math.imul(i, 2654435761) >>> 0;
      const source = { size, source: words.buffer, metadata: {}, levels: [{ size, level: 0, faces: Array.from({length:6}, (_,face) => ({face,byteOffset:face*size*size*4,byteLength:size*size*4})) }] };
      const trials = [];
      for (let i = -3; i < 7; i++) {
        const start = performance.now();
        const image = environmentInspectionSample(source);
        if (i >= 0) trials.push(performance.now()-start);
        image.width = image.height = 1;
      }
      records.push({size,trials});
    }
    return records;
  })));
} finally { await browser.close(); }
