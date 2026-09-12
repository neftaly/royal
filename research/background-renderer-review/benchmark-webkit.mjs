import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const repo = path.resolve(process.env.PROBABILITY_PATH ?? '../probability');
const buildRoot = process.env.REVIEW_BUILD;
const require = createRequire(repo + '/apps/onboarding/package.json');
const { webkit } = require('@playwright/test');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx': 'application/octet-stream',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    );
    for (const app of ['onboarding', 'play'])
      if (name === `/${app}` || name === `/${app}/`)
        name = `/${app}/index.html`;
    const app = ['onboarding', 'play'].find((app) =>
      name.startsWith(`/${app}/`),
    );
    const base = app ? buildRoot + `/${app}` : repo + '/apps/site/public';
    const file = path.join(base, app ? name.slice(app.length + 2) : name);
    if (!file.startsWith(base + path.sep)) throw new Error('Outside assets');
    const bytes = await readFile(file);
    res.setHeader(
      'Content-Type',
      types[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4187, '127.0.0.1', r));
const b = await webkit.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.addInitScript(({ attribute, split }) => {
    window.attributeUploads = attribute;
    window.splitUploads = split;
  }, { attribute: process.env.ATTRIBUTE_UPLOADS === '1', split: process.env.SPLIT_UPLOADS === '1' });
  await p.addInitScript(() => {
    window.rendererCalls = {};
    for (const name of ['getProgramParameter', 'getUniformLocation', 'texImage2D', 'texSubImage2D', 'bufferData']) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function(...args) {
        const start = performance.now();
        try {
          const bitmap = args.at(-1);
          if (window.splitUploads && name === 'texSubImage2D' && args.length === 7 && bitmap instanceof ImageBitmap && bitmap.width * bitmap.height > 1024 * 1024) {
            const chunks = window.rendererCalls.uploadStrips ??= { count: 0, total: 0, max: 0, over50: 0 };
            try {
              for (let row = 0; row < bitmap.height; row += 128) {
                this.pixelStorei(this.UNPACK_SKIP_ROWS, row);
                const at = performance.now();
                original.call(this, args[0], args[1], args[2], args[3] + row, bitmap.width, Math.min(128, bitmap.height - row), args[4], args[5], bitmap);
                const ms = performance.now() - at;
                chunks.count++; chunks.total += ms; chunks.max = Math.max(chunks.max, ms); chunks.over50 += Math.max(0, ms - 50);
              }
            } finally { this.pixelStorei(this.UNPACK_SKIP_ROWS, 0); }
            const error = this.getError();
            if (error !== this.NO_ERROR) throw new Error('Strip upload GL error ' + error);
            return;
          }
          return original.apply(this, args);
        }
        finally {
          const source = args.at(-1);
          const key = name === 'getProgramParameter' ? name + ':' + args[1] : window.attributeUploads && name === 'texSubImage2D' ? name + ':' + source?.constructor?.name + ':' + source?.width + 'x' + source?.height : name;
          const sample = window.rendererCalls[key] ??= { count: 0, total: 0, max: 0, over50: 0 };
          const elapsed = performance.now() - start;
          sample.count++; sample.total += elapsed;
          sample.max = Math.max(sample.max, elapsed);
          sample.over50 += Math.max(0, elapsed - 50);
        }
      };
    }
    window.longTasks = [];
    window.frameGaps = [];
    let previousFrame;
    const frame = (now) => {
      if (previousFrame !== undefined && now - previousFrame > 34)
        window.frameGaps.push({
          start: previousFrame,
          duration: now - previousFrame,
        });
      previousFrame = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    document.addEventListener(
      'change',
      (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'file')
          return;
        const files = Array.from(input.files ?? []);
        window.folderInput = {
          generationErrors: performance
            .getEntriesByName('onboarding:generation-error')
            .map((e) => e.detail),
          at: performance.now(),
          files: files.length,
          bytes: files.reduce((sum, file) => sum + file.size, 0),
          images: files.filter((file) =>
            /\.(svg|png|jpe?g|webp|avif)$/i.test(file.name),
          ).length,
        };
      },
      { capture: true },
    );
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver((l) =>
      window.longTasks.push(
        ...l
          .getEntries()
          .map((e) => ({ start: e.startTime, duration: e.duration })),
      ),
    ).observe({ type: 'longtask', buffered: true });
  });
  const folder = process.env.IMPORT_FOLDER;
  const mode = process.env.PREVIEW_MODE === 'play' ? 'play' : 'royal';
  await p.goto(
    `http://127.0.0.1:4187/onboarding?preview=${mode}` +
      (folder ? '&samples=none' : ''),
  );
  if (folder) {
    await p
      .locator('input[aria-label="Load folder"]')
      .waitFor({ state: 'attached' });
    const selectionStart = await p.evaluate(() => {
      performance.mark('onboarding:selection-start');
      return performance.now();
    });
    console.log(JSON.stringify({ selectionStart, folder }));
    await p
      .locator('input[aria-label="Load folder"]')
      .setInputFiles(path.resolve(folder));
  }
  let completed = false;
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(5000);
    const state = await p.evaluate(
      (mode) => ({
        generationErrors: performance
          .getEntriesByName('onboarding:generation-error')
          .map((e) => e.detail),
        at: performance.now(),
        firstFrame: performance.getEntriesByName(
          mode === 'play'
            ? 'onboarding:play-first-frame'
            : 'onboarding:preview-first-frame',
        )[0]?.duration,
        generated: performance.getEntriesByName('onboarding:generation').length,
        resident: performance.getEntriesByName('onboarding:resident').length,
        complete: (() => {
          const e = performance
            .getEntriesByName(
              mode === 'play'
                ? 'onboarding:play-complete'
                : 'onboarding:preview-complete',
            )
            .at(-1);
          return e ? { time: e.duration, snapshot: e.detail } : undefined;
        })(),
        longTasks: window.longTasks.length,
        maxTask: Math.max(0, ...window.longTasks.map((e) => e.duration)),
        heap: performance.memory?.usedJSHeapSize,
        last: performance.getEntriesByName('onboarding:generation').at(-1)
          ?.detail,
        playImports:
          mode === 'play'
            ? performance
                .getEntriesByName('onboarding:play-import')
                .map((e) => e.detail)
            : undefined,
        playErrors: performance
          .getEntriesByName('onboarding:play-error')
          .map((e) => e.detail),
      }),
      mode,
    );
    console.log(JSON.stringify(state));
    if (state.generationErrors.length) {
      errors.push(...state.generationErrors);
      break;
    }
    if (state.playErrors.length) {
      errors.push(...state.playErrors);
      break;
    }
    if (state.complete) {
      completed = true;
      if (state.complete.snapshot.failedSources)
        errors.push('Some selected sources failed to import');
      const input = await p.evaluate(() => window.folderInput);
      if (input && input.images !== state.complete.snapshot.sourceCount)
        errors.push(
          'Imported source count differs from the selected image files',
        );
      break;
    }
  }
  if (!completed) errors.push('Preview did not complete in 60 seconds');
  if (completed && mode === 'royal' && process.env.ZOOM_STEPS) {
    await p.locator('.ob-generated-preview').focus();
    const before = await p.evaluate((steps) => {
      const start = performance.now();
      const canvas = document.querySelector('.ob-generated-preview');
      for (let step = 0; step < steps; step++)
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
      return start;
    }, Number(process.env.ZOOM_STEPS));
    await p.waitForFunction(
      (start) =>
        performance
          .getEntriesByName('onboarding:preview-complete')
          .some((entry) => entry.duration > start),
      before,
      { timeout: 30000 },
    );
    const zoom = await p.evaluate(() => {
      const entry = performance
        .getEntriesByName('onboarding:preview-complete')
        .at(-1);
      return { time: entry.duration, resources: entry.detail.resources };
    });
    console.log(
      JSON.stringify({ zoom: { ...zoom, duration: zoom.time - before } }),
    );
  }
  const measuredLongTasks = await p.evaluate(() => window.longTasks.slice());
  const measuredFrameGaps = await p.evaluate(() => window.frameGaps.slice());
  const rendererPage =
    mode === 'play'
      ? p.frames().find((frame) => frame.url().includes('embedded=onboarding'))
      : p;
  const gpu = await rendererPage.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  console.log(JSON.stringify({ gpu }));
  console.log(JSON.stringify({ rendererCalls: await Promise.all(p.frames().map(async frame => ({ url: frame.url(), calls: await frame.evaluate(() => window.rendererCalls) }))) }));
  if (process.env.SCREENSHOT) {
    const canvas =
      mode === 'play'
        ? p.locator('iframe[title="Imported game in Play"]')
        : p.locator('.ob-generated-preview');
    await canvas.scrollIntoViewIfNeeded();
    await canvas.screenshot({ path: process.env.SCREENSHOT });
  }
  if (errors.length) process.exitCode = 1;
  console.log(
    JSON.stringify({
      errors,
      measuredLongTasks,
      input: await p.evaluate(() => window.folderInput),
      frameGaps: measuredFrameGaps,
      metrics: await p.evaluate(() => ({
        generations: performance
          .getEntriesByName('onboarding:generation')
          .map((e) => ({ duration: e.duration, detail: e.detail })),
        residents: performance
          .getEntriesByName('onboarding:resident')
          .map((e) => ({ time: e.duration, detail: e.detail })),
      })),
    }),
  );
} finally {
  await b.close();
  server.close();
}
