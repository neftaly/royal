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

const routes = [
  {
    path: '/hello-cube',
    title: 'Hello Cube',
    canvasLabel: 'Lit cube',
    sourceNeedle: 'export const HelloCube',
  },
  {
    path: '/imperative-root',
    title: 'Imperative Root',
    canvasLabel: 'Imperative Royal root',
    sourceNeedle: 'export const ImperativeRoot',
  },
  {
    path: '/gltf-helmet',
    title: 'glTF Helmet',
    canvasLabel: 'Damaged Helmet glTF model',
    sourceNeedle: 'export const GltfHelmet',
  },
  {
    path: '/labs/text-prototype',
    title: 'Text Prototype',
    canvasLabel: 'Vector text prototype',
    sourceNeedle: 'export const TextPrototype',
    readableText: 'glyphs',
  },
];

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

const smokeExpression = (route) => `
(async () => {
  const route = ${JSON.stringify(route)};
  const isCanvasNonBlank = (canvas) => {
    const width = Math.max(1, Math.min(96, canvas.width));
    const height = Math.max(1, Math.min(96, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return false;
    context.drawImage(canvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && (pixels[index] > 8 || pixels[index + 1] > 8 || pixels[index + 2] > 8)) {
        return true;
      }
    }
    return false;
  };
  const read = () => {
    const bodyText = document.body.textContent ?? '';
    const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
      candidate.getAttribute('aria-label') === route.canvasLabel
    );
    return {
      bodyText,
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      canvasHeight: canvas?.height ?? 0,
      canvasWidth: canvas?.width ?? 0,
      canvasFound: canvas !== undefined,
      canvasNonBlank: canvas === undefined ? false : isCanvasNonBlank(canvas),
    };
  };

  const deadline = performance.now() + 8000;
  let state = read();
  while (
    performance.now() < deadline &&
    (state.h1 !== route.title ||
      !state.canvasFound ||
      !state.canvasNonBlank ||
      !state.bodyText.includes(route.sourceNeedle) ||
      (route.readableText !== undefined && !state.bodyText.includes(route.readableText)))
  ) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = read();
  }

  return state;
})()
`;

const assertRoute = (route, state) => {
  const failures = [];
  if (state.h1 !== route.title) failures.push(`expected h1 "${route.title}", received "${state.h1}"`);
  if (!state.canvasFound) failures.push(`missing canvas "${route.canvasLabel}"`);
  if (state.canvasWidth <= 0 || state.canvasHeight <= 0) failures.push('canvas has no backing size');
  if (!state.canvasNonBlank) failures.push('canvas pixels stayed blank');
  if (!state.bodyText.includes(route.sourceNeedle)) failures.push(`source panel missed "${route.sourceNeedle}"`);
  if (route.readableText !== undefined && !state.bodyText.includes(route.readableText)) {
    failures.push(`page text missed "${route.readableText}"`);
  }

  if (failures.length > 0) {
    throw new Error(`${route.title}: ${failures.join('; ')}`);
  }
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
    await waitForHttp(baseUrl + routes[0].path, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');

    for (const route of routes) {
      const loaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: baseUrl + route.path });
      await loaded;
      const state = await evaluate(session, smokeExpression(route));
      assertRoute(route, state);
      console.log(`ok ${route.title}`);
    }

    if (exceptions.length > 0) {
      throw new Error('Browser runtime exceptions: ' + exceptions.join('; '));
    }
  } finally {
    session?.close();
    await stop(browser);
    await stop(preview);
    await rm(profileDir, { force: true, recursive: true });
  }
};

await main();
