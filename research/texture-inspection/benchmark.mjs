// Development-only integration benchmark; uses Probability's existing browser tooling/model.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const probabilityRoot = fileURLToPath(new URL('../../../probability/', import.meta.url));
const royalRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(`${probabilityRoot}/apps/play/package.json`);
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket(/^wss:\/\//u, socket => socket.close());
  await page.goto(`${process.argv[2] ?? 'http://localhost:3000'}/play/`);
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  const result = await page.evaluate(async royalPath => {
    const { createClassifier } = await import('/play/src/content-filter/classifier.ts');
    const { TextureInspectionOwner } = await import(`/play/@fs/${royalPath}packages/renderer-webgl/src/texture/inspection.ts`);
    const classifier = createClassifier();
    const signal = new AbortController().signal;
    const start = performance.now();
    await classifier.ready;
    const initializationMs = performance.now() - start;
    const records = [];
    const sample = index => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      const image = context.createImageData(256, 256);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = (i / 4 + index * 17) % 256;
        image.data[i + 1] = (i / 1024 + index * 29) % 256;
        image.data[i + 2] = index * 13;
        image.data[i + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      return canvas;
    };
    try {
      for (const concurrency of [1, 2, 2, 1, 1, 2]) {
        let calls = 0, active = 0, peak = 0;
        const owner = new TextureInspectionOwner({ key: 'benchmark', concurrency, allow: async (image, signal) => {
          calls++; active++; peak = Math.max(peak, active);
          try { return await classifier.allow(image.getContext('2d').getImageData(0, 0, image.width, image.height), signal); }
          finally { active--; }
        } });
        try {
          const begin = performance.now();
          const results = await Promise.allSettled(Array.from({length: 16}, (_, i) => owner.inspectPixels(`asset-${i}`, async () => sample(i), signal)));
          const batchMs = performance.now() - begin;
          const cachedStart = performance.now();
          await Promise.allSettled(Array.from({length: 16}, (_, i) => owner.inspectPixels(`alias-${i}`, async () => sample(i), signal)));
          records.push({concurrency, batchMs, aliasMs: performance.now() - cachedStart, calls, peak, rejected: results.filter(result => result.status === 'rejected').length});
        } finally { owner.dispose(); }
      }
    } finally { await classifier.dispose(); }
    return { initializationMs, records };
  }, royalRoot);
  for (const record of result.records) {
    if (record.calls !== 16 || record.peak !== record.concurrency) errors.push(`Unexpected scheduling/cache behavior: ${JSON.stringify(record)}`);
  }
  const output = { ...result, errors };
  console.log(JSON.stringify(output, null, 2));
  await writeFile('/tmp/royal-inspection-benchmark.json', JSON.stringify(output, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
