import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_SMOKE_PORT ?? 4573);
const debugPort = Number(process.env.EXAMPLES_SMOKE_DEBUG_PORT ?? 4574);
const baseUrl = `http://${host}:${previewPort}`;

const smokeExpectations = {
  cube: {
    surface: 'canvas',
    canvasLabel: 'Lit cube',
    minColorBuckets: 5,
    minPaintedRatio: 0.01,
  },
  wireframe: {
    surface: 'canvas',
    canvasLabel: 'Wireframe cube',
    minColorBuckets: 3,
    minPaintedRatio: 0.003,
  },
  'texture-materials': {
    surface: 'canvas',
    canvasLabel: 'Texture materials',
    minColorBuckets: 5,
    minPaintedRatio: 0.01,
  },
  'gltf-helmet': {
    surface: 'canvas',
    canvasLabel: 'glTF DamagedHelmet',
    minColorBuckets: 5,
    minPaintedRatio: 0.01,
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForJson = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
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
      if (response.ok) return;
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
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error === undefined) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error.message));
        }
        return;
      }

      for (const handler of this.#handlers.get(message.method) ?? []) {
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
  const smokeExpectations = ${JSON.stringify(smokeExpectations)};
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

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha === 0) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (red > 8 || green > 8 || blue > 8) paintedPixels += 1;
      buckets.add(\`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`);
    }

    return {
      colorBuckets: buckets.size,
      paintedPixels,
      paintedRatio: paintedPixels / (width * height),
    };
  };
  const read = () => {
    const page = document.querySelector('.example-page');
    const bodyText = document.body.textContent ?? '';
    const dataset = page?.dataset ?? {};
    const routeId = dataset.exampleId ?? '';
    const smoke = smokeExpectations[routeId];
    const sourceCode = document.querySelector('.source-panel code')?.textContent ?? '';
    const activeLink = document.querySelector('[data-example-nav-link].active');
    const canvasLabel = smoke?.canvasLabel;
    const canvas = canvasLabel === undefined ? undefined : Array.from(document.querySelectorAll('canvas')).find((candidate) =>
      candidate.getAttribute('aria-label') === canvasLabel
    );

    return {
      bodyText,
      route: {
        id: routeId,
        path: dataset.exampleRoute ?? '',
        surface: smoke?.surface ?? '',
        title: document.querySelector('h1')?.textContent?.trim() ?? '',
      },
      source: {
        file: dataset.sourceFile ?? '',
        hasFile: dataset.sourceFile === undefined ? false : bodyText.includes(dataset.sourceFile),
        hasExport: sourceCode.includes('export const '),
      },
      canvas: canvas === undefined ? undefined : {
        label: canvas.getAttribute('aria-label') ?? '',
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        minColorBuckets: smoke?.minColorBuckets ?? 0,
        minPaintedRatio: smoke?.minPaintedRatio ?? 0,
        sample: sampleCanvas(canvas),
      },
      activeNav: activeLink === null ? undefined : {
        id: activeLink.getAttribute('data-example-id') ?? '',
        path: activeLink.getAttribute('data-example-route') ?? '',
        text: activeLink.textContent?.trim() ?? '',
      },
    };
  };

  const deadline = performance.now() + 8000;
  let state = read();
  const isReady = () => {
    const sourceReady = state.source.hasFile && state.source.hasExport;
    if (!sourceReady || state.route.title === '') return false;
    return state.canvas !== undefined &&
      state.canvas.backingWidth > 0 &&
      state.canvas.backingHeight > 0 &&
      state.canvas.sample !== undefined &&
      state.canvas.sample.colorBuckets >= state.canvas.minColorBuckets &&
      state.canvas.sample.paintedRatio >= state.canvas.minPaintedRatio;
  };

  while (performance.now() < deadline && !isReady()) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = read();
  }

  return state;
})()
`;

const wipExpression = `
(async () => {
  const deadline = performance.now() + 8000;
  const read = () => {
    const page = document.querySelector('[data-wip-page]');
    const activeLink = document.querySelector('[data-wip-nav-link].active');

    return {
      hasPage: page !== null,
      title: document.querySelector('h1')?.textContent?.trim() ?? '',
      activeNavText: activeLink?.textContent?.trim() ?? '',
      links: Array.from(document.querySelectorAll('[data-wip-link]')).map((link) => ({
        href: link.href,
        id: link.getAttribute('data-wip-link-id') ?? '',
        target: link.getAttribute('data-wip-link-target') ?? '',
        text: link.textContent?.trim() ?? '',
      })),
      statusCardCount: document.querySelectorAll('.wip-card, [data-wip-demo-id]').length,
      primaryExampleNavCount: document.querySelectorAll('[data-example-nav-link]').length,
    };
  };

  let state = read();
  while (performance.now() < deadline && (!state.hasPage || state.links.length === 0)) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = read();
  }

  return state;
})()
`;

const assertRoute = (expected, state) => {
  const failures = [];
  const smoke = smokeExpectations[expected.id];
  if (smoke === undefined) {
    failures.push(`missing smoke expectations for "${expected.id}"`);
  }
  if (state.route.title !== expected.title) {
    failures.push(`expected h1 "${expected.title}", received "${state.route.title}"`);
  }
  if (state.route.path !== expected.path) {
    failures.push(`expected route "${expected.path}", received "${state.route.path}"`);
  }
  if (state.activeNav?.path !== expected.path) {
    failures.push(`active nav path was "${state.activeNav?.path ?? 'missing'}"`);
  }
  if (!state.source.hasFile) failures.push(`source panel missed "${state.source.file}"`);
  if (!state.source.hasExport) failures.push('source panel missed an exported component');

  const sample = state.canvas?.sample;
  if (state.canvas === undefined) {
    failures.push('missing canvas');
  } else if (sample === undefined || sample.paintedPixels <= 0) {
    failures.push('canvas pixels stayed blank');
  } else {
    if (sample.colorBuckets < state.canvas.minColorBuckets) {
      failures.push(`canvas color buckets ${sample.colorBuckets} < ${state.canvas.minColorBuckets}`);
    }
    if (sample.paintedRatio < state.canvas.minPaintedRatio) {
      failures.push(
        `canvas painted ratio ${sample.paintedRatio.toFixed(4)} < ${state.canvas.minPaintedRatio}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`${expected.title}: ${failures.join('; ')}`);
  }
};

const assertWipPage = (state) => {
  const failures = [];
  if (!state.hasPage) failures.push('missing WIP page marker');
  if (state.title !== 'WIP Demo Links') failures.push(`expected WIP title, received "${state.title}"`);
  if (state.activeNavText !== 'WIP Demo Links') {
    failures.push(`active WIP nav text was "${state.activeNavText || 'missing'}"`);
  }
  const linkIds = new Set(state.links.map((link) => link.id));
  for (const expectedId of [
    'gltf-asset-viewer',
    'picking-raycasting-fuzz',
    'asset-manifest-contract',
    'offline-terrain-pipeline',
    'dynamic-impostors',
    'virtual-texturing-research',
  ]) {
    if (!linkIds.has(expectedId)) failures.push(`missing ${expectedId} WIP link`);
  }
  if (state.links.some((link) => link.href === '' || link.text === '')) {
    failures.push('WIP contains an empty link');
  }
  if (state.links.some((link) => link.target !== 'route' && link.target !== 'repo')) {
    failures.push('WIP contains a link without a real target type');
  }
  if (state.statusCardCount !== 0) failures.push('WIP rendered decorative status cards');
  if (state.primaryExampleNavCount !== Object.keys(smokeExpectations).length) {
    failures.push(`primary example nav count changed to ${state.primaryExampleNavCount}`);
  }

  if (failures.length > 0) {
    throw new Error(`WIP Demo Links: ${failures.join('; ')}`);
  }
};

const spawnLogged = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
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
      throw new Error('Examples smoke could not discover routes');
    }

    for (const route of routes) {
      const routeLoaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: baseUrl + route.path });
      await routeLoaded;
      const state = await evaluate(session, smokeExpression);
      assertRoute(route, state);
      const canvasSummary = state.canvas?.sample === undefined
        ? ''
        : ` buckets=${state.canvas.sample.colorBuckets} painted=${state.canvas.sample.paintedRatio.toFixed(3)}`;
      console.log(`ok ${route.title}${canvasSummary}`);
    }

    const wipLoaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: baseUrl + '/wip' });
    await wipLoaded;
    const wipState = await evaluate(session, wipExpression);
    assertWipPage(wipState);
    console.log('ok WIP Demo Links');

    if (exceptions.length > 0) {
      throw new Error('Browser runtime exceptions: ' + exceptions.join('; '));
    }
  } finally {
    session?.close();
    await stop(browser);
    await stop(preview);
    await rm(profileDir, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
};

await main();
