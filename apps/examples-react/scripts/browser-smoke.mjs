import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(appRoot, '../..');
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_SMOKE_PORT ?? 4573);
const debugPort = Number(process.env.EXAMPLES_SMOKE_DEBUG_PORT ?? 4574);
const baseUrl = `http://${host}:${previewPort}`;
const defaultOraclePath = path.join(
  repoRoot,
  'research/text-visual-diagnosis/text-smoke-oracle.json',
);
const oraclePath = process.env.EXAMPLES_TEXT_QA_ORACLE ?? defaultOraclePath;
const reportPath = process.env.EXAMPLES_TEXT_QA_REPORT;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForJson = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

const waitForHttp = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

class CdpSession {
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
          return;
        }
        this.#pending.delete(message.id);
        if (message.error === undefined) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error.message));
        }
        return;
      }

      const handlers = this.#handlers.get(message.method) ?? [];
      for (const handler of handlers) {
        handler(message.params);
      }
    });
  }

  on(method, handler) {
    this.#handlers.set(method, [...(this.#handlers.get(method) ?? []), handler]);
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.#handlers.set(
          method,
          (this.#handlers.get(method) ?? []).filter((entry) => entry !== handler),
        );
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.socket.close();
  }
}

const connectPage = async () => {
  await waitForJson(`http://${host}:${debugPort}/json/version`, 10_000);
  const pages = await waitForJson(`http://${host}:${debugPort}/json/list`, 10_000);
  const page = pages.find((entry) => entry.type === 'page');
  if (page?.webSocketDebuggerUrl === undefined) {
    throw new Error('Chromium did not expose a debuggable page target');
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  return new CdpSession(socket);
};

const evaluate = async (session, expression) => {
  const result = await session.call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }

  return result.result.value;
};

const routeListExpression = `
(async () => {
  const deadline = performance.now() + 8000;
  const read = () => Array.from(document.querySelectorAll('[data-example-nav-link]')).map((link) => ({
    id: link.getAttribute('data-example-id') ?? '',
    path: link.getAttribute('data-example-route') ?? '',
    title: link.textContent?.trim() ?? '',
  })).filter((route) => route.id !== '' && route.path !== '' && route.title !== '');

  let routes = read();
  while (performance.now() < deadline && routes.length === 0) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    routes = read();
  }

  return routes;
})()
`;

const smokeExpression = `
(async () => {
  const parseNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseJson = (value) => {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const fontFor = (selector) => {
    const element = document.querySelector(selector);
    if (element === null) return undefined;
    const style = getComputedStyle(element);
    return {
      selector,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      text: (element.textContent ?? '').trim().slice(0, 80),
    };
  };
  const sampleCanvas = (canvas, maxSize = 160) => {
    const width = Math.max(1, Math.min(maxSize, canvas.width));
    const height = Math.max(1, Math.min(maxSize, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;
    context.drawImage(canvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const buckets = new Set();
    let paintedPixels = 0;
    let brightPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha === 0) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (red > 8 || green > 8 || blue > 8) paintedPixels += 1;
      if (red + green + blue > 384) brightPixels += 1;
      buckets.add(\`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`);
    }

    const totalPixels = width * height;
    return {
      sampleWidth: width,
      sampleHeight: height,
      colorBuckets: buckets.size,
      paintedPixels,
      paintedRatio: paintedPixels / totalPixels,
      brightPixels,
      brightRatio: brightPixels / totalPixels,
    };
  };
  const measureTextRoi = (canvas, roi) => {
    const sourceX = Math.max(0, Math.floor(canvas.width * roi.x));
    const sourceY = Math.max(0, Math.floor(canvas.height * roi.y));
    const sourceWidth = Math.max(1, Math.min(canvas.width - sourceX, Math.floor(canvas.width * roi.width)));
    const sourceHeight = Math.max(1, Math.min(canvas.height - sourceY, Math.floor(canvas.height * roi.height)));
    const maxWidth = 320;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const width = Math.max(1, Math.floor(sourceWidth * scale));
    const height = Math.max(1, Math.floor(sourceHeight * scale));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;
    context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const luminance = new Uint8Array(width * height);
    const luminanceBuckets = new Set();
    let foregroundPixels = 0;
    let alphaPixels = 0;

    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const index = pixel * 4;
      const alpha = pixels[index + 3];
      const value = Math.round(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
      luminance[pixel] = value;
      if (alpha > 0) alphaPixels += 1;
      if (alpha > 0 && value >= 128) foregroundPixels += 1;
      if (alpha > 0) luminanceBuckets.add(value >> 5);
    }

    let edgeTransitions = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = luminance[y * width + x];
        if (x + 1 < width && Math.abs(value - luminance[y * width + x + 1]) >= 32) {
          edgeTransitions += 1;
        }
        if (y + 1 < height && Math.abs(value - luminance[(y + 1) * width + x]) >= 32) {
          edgeTransitions += 1;
        }
      }
    }

    return {
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      sampleWidth: width,
      sampleHeight: height,
      alphaPixels,
      edgeTransitions,
      foregroundPixels,
      inkCoverage: foregroundPixels / (width * height),
      luminanceBuckets: luminanceBuckets.size,
    };
  };
  const measureCanvas = (canvas, textQuality) => {
    if (canvas === undefined) return undefined;
    const rect = canvas.getBoundingClientRect();
    const canvasSample = sampleCanvas(canvas);
    return {
      ariaLabel: canvas.getAttribute('aria-label') ?? '',
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      backingDprX: rect.width > 0 ? canvas.width / rect.width : 0,
      backingDprY: rect.height > 0 ? canvas.height / rect.height : 0,
      sample: canvasSample,
      textRoi: textQuality === undefined ? undefined : measureTextRoi(canvas, textQuality.roi),
    };
  };
  const read = () => {
    const page = document.querySelector('.example-page');
    const bodyText = document.body.textContent ?? '';
    const dataset = page?.dataset ?? {};
    const readableText = (dataset.smokeReadableText ?? '').split('\\n').filter(Boolean);
    const textQuality = parseJson(dataset.smokeTextQuality);
    const canvas = dataset.smokeCanvasLabel === undefined ? undefined : Array.from(document.querySelectorAll('canvas')).find((candidate) =>
      candidate.getAttribute('aria-label') === dataset.smokeCanvasLabel
    );
    const activeLink = document.querySelector('[data-example-nav-link].active');
    const sourceCode = document.querySelector('.source-panel code')?.textContent ?? '';
    const input = textQuality === undefined ? undefined : Array.from(document.querySelectorAll('input')).find((candidate) =>
      candidate.getAttribute('aria-label') === textQuality.inputLabel
    );

    return {
      bodyText,
      route: {
        id: dataset.exampleId ?? '',
        path: dataset.exampleRoute ?? '',
        title: document.querySelector('h1')?.textContent?.trim() ?? '',
      },
      source: {
        file: dataset.sourceFile ?? '',
        exportName: dataset.sourceExport ?? '',
        panelHasFile: dataset.sourceFile === undefined ? false : bodyText.includes(dataset.sourceFile),
        panelHasExport: dataset.sourceExport === undefined ? false : sourceCode.includes('export const ' + dataset.sourceExport),
      },
      smoke: {
        surface: dataset.smokeSurface ?? '',
        canvasLabel: dataset.smokeCanvasLabel,
        minColorBuckets: parseNumber(dataset.smokeMinColorBuckets, 0),
        minPaintedRatio: parseNumber(dataset.smokeMinPaintedRatio, 0),
        readableText,
        textQuality,
      },
      canvas: measureCanvas(canvas, textQuality),
      textInput: input === undefined ? undefined : {
        value: input.value,
        ariaLabel: input.getAttribute('aria-label') ?? '',
      },
      fonts: [
        fontFor('body'),
        fontFor('h1'),
        fontFor('[data-example-nav-link].active'),
        fontFor('input'),
        fontFor('.source-panel code'),
      ].filter(Boolean),
      visibleDomFonts: Array.from(document.querySelectorAll('h1, h2, p, a, button, input, code, .control-readout'))
        .filter(isVisible)
        .slice(0, 24)
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            text: ((element instanceof HTMLInputElement ? element.value : element.textContent) ?? '').trim().slice(0, 80),
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          };
        }),
      activeNav: activeLink === null ? undefined : {
        id: activeLink.getAttribute('data-example-id') ?? '',
        path: activeLink.getAttribute('data-example-route') ?? '',
        text: activeLink.textContent?.trim() ?? '',
      },
      viewport: {
        dpr: window.devicePixelRatio,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
      },
      fontsStatus: document.fonts?.status ?? 'unavailable',
    };
  };

  const deadline = performance.now() + 8000;
  let state = read();
  const isReady = () => {
    const readableReady = state.smoke.readableText.every((text) => state.bodyText.includes(text));
    const canvasReady = state.smoke.surface !== 'canvas' || (
      state.canvas !== undefined &&
      state.canvas.backingWidth > 0 &&
      state.canvas.backingHeight > 0 &&
      state.canvas.sample !== undefined &&
      state.canvas.sample.paintedPixels > 0 &&
      state.canvas.sample.colorBuckets >= state.smoke.minColorBuckets &&
      state.canvas.sample.paintedRatio >= state.smoke.minPaintedRatio
    );
    return state.route.title !== '' && readableReady && canvasReady && state.source.panelHasFile && state.source.panelHasExport;
  };

  while (performance.now() < deadline && !isReady()) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = read();
  }

  return state;
})()
`;

const loadOracle = async () => {
  try {
    const text = await readFile(oraclePath, 'utf8');
    return { path: oraclePath, value: JSON.parse(text) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

const thresholdsFromOracle = (oracle, state) => {
  const routeOracle = oracle?.value?.routes?.[state.route.id] ?? oracle?.value?.routes?.[state.route.path];
  return routeOracle?.textQuality;
};

const thresholdFailures = (metrics, thresholds) => {
  if (metrics === undefined || thresholds === undefined) {
    return [];
  }
  const checks = [
    ['edgeTransitions', metrics.edgeTransitions, thresholds.minEdgeTransitions],
    ['foregroundPixels', metrics.foregroundPixels, thresholds.minForegroundPixels],
    ['inkCoverage', metrics.inkCoverage, thresholds.minInkCoverage],
    ['luminanceBuckets', metrics.luminanceBuckets, thresholds.minLuminanceBuckets],
  ];

  return checks
    .filter(([, actual, minimum]) => minimum !== undefined && actual < minimum)
    .map(([name, actual, minimum]) => `${name} ${actual} < ${minimum}`);
};

const assertRoute = (expected, state, oracle) => {
  const failures = [];
  if (state.route.title !== expected.title) {
    failures.push(`expected h1 "${expected.title}", received "${state.route.title}"`);
  }
  if (state.route.path !== expected.path) {
    failures.push(`expected route "${expected.path}", received "${state.route.path}"`);
  }
  if (state.activeNav?.path !== expected.path) {
    failures.push(`active nav path was "${state.activeNav?.path ?? 'missing'}"`);
  }
  if (!state.source.panelHasFile) {
    failures.push(`source panel missed "${state.source.file}"`);
  }
  if (!state.source.panelHasExport) {
    failures.push(`source panel missed export "${state.source.exportName}"`);
  }
  for (const text of state.smoke.readableText) {
    if (!state.bodyText.includes(text)) {
      failures.push(`page text missed "${text}"`);
    }
  }

  if (state.smoke.surface === 'canvas') {
    const sample = state.canvas?.sample;
    if (state.canvas === undefined) {
      failures.push(`missing canvas "${state.smoke.canvasLabel ?? ''}"`);
    } else if (state.canvas.backingWidth <= 0 || state.canvas.backingHeight <= 0) {
      failures.push('canvas has no backing size');
    } else if (sample === undefined || sample.paintedPixels <= 0) {
      failures.push('canvas pixels stayed blank');
    } else {
      if (sample.colorBuckets < state.smoke.minColorBuckets) {
        failures.push(`canvas color buckets ${sample.colorBuckets} < ${state.smoke.minColorBuckets}`);
      }
      if (sample.paintedRatio < state.smoke.minPaintedRatio) {
        failures.push(`canvas painted ratio ${sample.paintedRatio.toFixed(4)} < ${state.smoke.minPaintedRatio}`);
      }
    }
  }

  if (state.smoke.textQuality !== undefined) {
    const expectedValue = state.smoke.textQuality.acceptanceText;
    if (state.textInput?.value !== expectedValue) {
      failures.push(`text input value "${state.textInput?.value ?? 'missing'}" did not match "${expectedValue}"`);
    }
    const oracleFailures = thresholdFailures(state.canvas?.textRoi, thresholdsFromOracle(oracle, state));
    for (const failure of oracleFailures) {
      failures.push(`text oracle ${failure}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${expected.title}: ${failures.join('; ')}`);
  }
};

const warningForRoute = (state, oracle) => {
  if (state.smoke.textQuality === undefined || thresholdsFromOracle(oracle, state) !== undefined) {
    return undefined;
  }
  const failures = thresholdFailures(state.canvas?.textRoi, state.smoke.textQuality.warnThresholds);
  if (failures.length === 0) {
    return undefined;
  }
  return `${state.route.title}: provisional text quality warning: ${failures.join('; ')}`;
};

const spawnLogged = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};

const writeReport = async (report) => {
  if (reportPath === undefined) {
    return;
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
};

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-examples-smoke-'));
  const preview = spawnLogged('pnpm', [
    'exec',
    'vite',
    'preview',
    '--config',
    '../../vite.config.ts',
    '--host',
    host,
    '--port',
    String(previewPort),
    '--strictPort',
  ], { cwd: appRoot });
  const browser = spawnLogged('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { cwd: appRoot });

  let session;
  const exceptions = [];
  const states = [];
  const warnings = [];

  try {
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');

    const loaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: baseUrl });
    await loaded;
    const routes = await evaluate(session, routeListExpression);
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new Error('Examples smoke could not discover route metadata');
    }

    const oracle = await loadOracle();
    if (oracle === undefined) {
      console.log(`text QA oracle not found at ${oraclePath}; using provisional warnings`);
    } else {
      console.log(`text QA oracle loaded from ${oracle.path}`);
    }

    for (const route of routes) {
      const routeLoaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: baseUrl + route.path });
      await routeLoaded;
      const state = await evaluate(session, smokeExpression);
      assertRoute(route, state, oracle);
      states.push(state);
      const warning = warningForRoute(state, oracle);
      if (warning !== undefined) {
        warnings.push(warning);
        console.warn(`warn ${warning}`);
      }
      const canvasSummary = state.canvas?.sample === undefined
        ? ''
        : ` buckets=${state.canvas.sample.colorBuckets} painted=${state.canvas.sample.paintedRatio.toFixed(3)}`;
      const textSummary = state.canvas?.textRoi === undefined
        ? ''
        : ` textEdges=${state.canvas.textRoi.edgeTransitions} textInk=${state.canvas.textRoi.inkCoverage.toFixed(4)}`;
      console.log(`ok ${route.title}${canvasSummary}${textSummary}`);
    }

    if (exceptions.length > 0) {
      throw new Error('Browser runtime exceptions: ' + exceptions.join('; '));
    }

    await writeReport({
      capturedAt: new Date().toISOString(),
      baseUrl,
      oraclePath,
      oracleLoaded: (await loadOracle()) !== undefined,
      warnings,
      routes: states,
    });
  } finally {
    session?.close();
    await stop(browser);
    await stop(preview);
    await rm(profileDir, { force: true, recursive: true });
  }
};

await main();
