import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGzip } from 'node:zlib';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_BENCH_PORT ?? 4673);
const debugPort = Number(process.env.EXAMPLES_BENCH_DEBUG_PORT ?? 4674);
const baseUrl = `http://${host}:${previewPort}`;
const routeFilter = process.env.EXAMPLES_BENCH_ROUTE?.trim() ?? '';
const outputPath = process.env.EXAMPLES_BENCH_OUTPUT?.trim() ?? '';

const envInteger = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
  }
  return value;
};

const frameSampleCount = envInteger('EXAMPLES_BENCH_FRAMES', 90);
const frameWarmupCount = envInteger('EXAMPLES_BENCH_WARMUP_FRAMES', 30);
const instancingFuzzCases = envInteger('EXAMPLES_BENCH_INSTANCING_CASES', 4);
const instancingSeed = envInteger('EXAMPLES_BENCH_INSTANCING_SEED', 0x1a57a11);
const routeReadyTimeoutMs = envInteger('EXAMPLES_BENCH_READY_TIMEOUT_MS', 20_000);
const clearCachePerRoute = process.env.EXAMPLES_BENCH_CLEAR_CACHE !== '0';

const routes = [
  { id: 'cube', path: '/cube' },
  { id: 'wireframe', path: '/wireframe' },
  { id: 'form-controls', path: '/form-controls' },
  { id: 'picking', path: '/picking' },
  { id: 'texture-materials', path: '/texture-materials' },
  { id: 'standard-lighting', path: '/standard-lighting' },
  { id: 'hud-overlay', path: '/hud-overlay' },
  { id: 'gltf-helmet', path: '/gltf-helmet' },
  { id: 'gltf-instancing', path: '/gltf-instancing' },
  { id: 'gltf-material-extensions', path: '/gltf-material-extensions' },
  { id: 'gltf-ghostscript-tiger-svg', path: '/gltf-ghostscript-tiger-svg' },
  { id: 'gltf-lod', path: '/gltf-lod' },
  { id: 'gltf-variants', path: '/gltf-variants' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class SeededRandom {
  #state;

  constructor(seed) {
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  float() {
    this.#state = (Math.imul(this.#state, 1664525) + 1013904223) >>> 0;
    return this.#state / 0x100000000;
  }

  int(minInclusive, maxExclusive) {
    return minInclusive + Math.floor(this.float() * (maxExclusive - minInclusive));
  }
}

const instancingFuzzRoutes = () => {
  const random = new SeededRandom(instancingSeed);
  return Array.from({ length: instancingFuzzCases }, (_value, index) => {
    const grid = random.int(8, 25);
    const seed = random.int(0, 0xffff_ffff);
    return {
      id: `gltf-instancing-fuzz-${index}`,
      path: `/gltf-instancing?grid=${grid}&seed=${seed}`,
      profile: { grid, seed },
    };
  });
};

const selectedRoutes = () => {
  const allRoutes = [
    ...routes,
    ...(process.env.EXAMPLES_BENCH_INSTANCING_FUZZ === '0' ? [] : instancingFuzzRoutes()),
  ];
  if (routeFilter === '') return allRoutes;
  const selected = allRoutes.filter((route) =>
    route.id === routeFilter ||
    route.path === routeFilter ||
    route.path === `/${routeFilter}` ||
    route.id.startsWith(`${routeFilter}-`)
  );
  if (selected.length === 0) throw new Error(`Examples benchmark route filter did not match: ${routeFilter}`);
  return selected;
};

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
        if (message.error === undefined) pending.resolve(message.result);
        else pending.reject(new Error(message.error.message));
        return;
      }
      for (const handler of this.#handlers.get(message.method) ?? []) handler(message.params);
    });
  }

  on(method, handler) {
    this.#handlers.set(method, [...(this.#handlers.get(method) ?? []), handler]);
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.#handlers.set(method, (this.#handlers.get(method) ?? []).filter((entry) => entry !== handler));
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

const evaluate = async (session, expression, options = {}) => {
  const result = await session.call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
    ...options,
  });
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text);
  return result.result.value;
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

const gzipSize = (filePath) => new Promise((resolve, reject) => {
  let size = 0;
  const gzip = createGzip({ level: 9 });
  gzip.on('data', (chunk) => {
    size += chunk.length;
  });
  gzip.on('end', () => resolve(size));
  gzip.on('error', reject);
  createReadStream(filePath).on('error', reject).pipe(gzip);
});

const deploymentSize = async () => {
  const distRoot = path.join(appRoot, 'dist');
  const entries = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
        continue;
      }
      const info = await stat(filePath);
      entries.push({
        bytes: info.size,
        gzipBytes: await gzipSize(filePath),
        path: path.relative(distRoot, filePath),
      });
    }
  };
  await visit(distRoot);
  const byExtension = {};
  for (const entry of entries) {
    const extension = path.extname(entry.path) || '<none>';
    const current = byExtension[extension] ?? { bytes: 0, count: 0, gzipBytes: 0 };
    byExtension[extension] = {
      bytes: current.bytes + entry.bytes,
      count: current.count + 1,
      gzipBytes: current.gzipBytes + entry.gzipBytes,
    };
  }
  return {
    byExtension,
    fileCount: entries.length,
    gzipBytes: entries.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    topFiles: [...entries].sort((left, right) => right.bytes - left.bytes).slice(0, 12),
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
};

const installBenchmarkHooks = async (session) => {
  await session.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
(() => {
  const counters = {
    bufferDataBytes: 0,
    bufferDataCalls: 0,
    bufferSubDataBytes: 0,
    bufferSubDataCalls: 0,
    drawArrays: 0,
    drawArraysInstanced: 0,
    drawElements: 0,
    drawElementsInstanced: 0,
    texImage2D: 0,
    texSubImage2D: 0,
  };
  const byteLengthOf = (value) => {
    if (typeof value === 'number') return value;
    if (value?.byteLength !== undefined) return value.byteLength;
    if (value?.length !== undefined) return value.length;
    return 0;
  };
  const patch = (prototype, name, handler) => {
    const original = prototype?.[name];
    if (typeof original !== 'function' || original.__royalBenchPatched === true) return;
    const wrapped = function (...args) {
      handler(args);
      return original.apply(this, args);
    };
    Object.defineProperty(wrapped, '__royalBenchPatched', { value: true });
    prototype[name] = wrapped;
  };
  const patchPrototype = (prototype) => {
    patch(prototype, 'drawArrays', () => { counters.drawArrays += 1; });
    patch(prototype, 'drawElements', () => { counters.drawElements += 1; });
    patch(prototype, 'drawArraysInstanced', () => { counters.drawArraysInstanced += 1; });
    patch(prototype, 'drawElementsInstanced', () => { counters.drawElementsInstanced += 1; });
    patch(prototype, 'bufferData', (args) => {
      counters.bufferDataCalls += 1;
      counters.bufferDataBytes += byteLengthOf(args[1]);
    });
    patch(prototype, 'bufferSubData', (args) => {
      counters.bufferSubDataCalls += 1;
      counters.bufferSubDataBytes += byteLengthOf(args[2]);
    });
    patch(prototype, 'texImage2D', () => { counters.texImage2D += 1; });
    patch(prototype, 'texSubImage2D', () => { counters.texSubImage2D += 1; });
  };
  patchPrototype(globalThis.WebGLRenderingContext?.prototype);
  patchPrototype(globalThis.WebGL2RenderingContext?.prototype);
  globalThis.__royalBench = {
    counters,
    reset() {
      for (const key of Object.keys(counters)) counters[key] = 0;
    },
    snapshot() {
      return { ...counters };
    },
  };
})();
`,
  });
};

const waitForBenchmarkReady = (session) => evaluate(session, `
(async () => {
  const deadline = performance.now() + ${routeReadyTimeoutMs};
  let stableResourceCount = -1;
  let stableSince = performance.now();
  while (performance.now() < deadline) {
    const canvas = document.querySelector('canvas');
    const resourceCount = performance.getEntriesByType('resource').length;
    if (resourceCount !== stableResourceCount) {
      stableResourceCount = resourceCount;
      stableSince = performance.now();
    }
    if (document.readyState === 'complete' && canvas !== null && performance.now() - stableSince > 350) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
})()
`);

const collectPageMetrics = async (session, frames) => {
  const beforeGc = await session.call('Runtime.getHeapUsage');
  await session.call('HeapProfiler.collectGarbage');
  const afterGc = await session.call('Runtime.getHeapUsage');
  await evaluate(session, `
(async () => {
  for (let index = 0; index < ${frameWarmupCount}; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
})()
`);
  await evaluate(session, 'globalThis.__royalBench?.reset?.()');
  const frameStats = await evaluate(session, `
(async () => {
  const frames = ${frames};
  const deltas = [];
  let previous = performance.now();
  for (let index = 0; index < frames; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const now = performance.now();
    deltas.push(now - previous);
    previous = now;
  }
  deltas.sort((left, right) => left - right);
  const sum = deltas.reduce((total, value) => total + value, 0);
  const percentile = (ratio) => deltas[Math.min(deltas.length - 1, Math.floor((deltas.length - 1) * ratio))] ?? 0;
  return {
    averageMs: sum / deltas.length,
    maxMs: deltas[deltas.length - 1] ?? 0,
    minMs: deltas[0] ?? 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    sampleCount: deltas.length,
  };
})()
`);
  const gl = await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}');
  const perf = await evaluate(session, `
(() => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]));
  const resources = performance.getEntriesByType('resource').map((entry) => ({
    decodedBodySize: entry.decodedBodySize ?? 0,
    duration: entry.duration,
    encodedBodySize: entry.encodedBodySize ?? 0,
    initiatorType: entry.initiatorType,
    name: entry.name,
    startTime: entry.startTime,
    transferSize: entry.transferSize ?? 0,
  }));
  const byType = {};
  for (const resource of resources) {
    const key = resource.initiatorType || 'unknown';
    const current = byType[key] ?? {
      count: 0,
      decodedBodySize: 0,
      duration: 0,
      encodedBodySize: 0,
      transferSize: 0,
    };
    byType[key] = {
      count: current.count + 1,
      decodedBodySize: current.decodedBodySize + resource.decodedBodySize,
      duration: current.duration + resource.duration,
      encodedBodySize: current.encodedBodySize + resource.encodedBodySize,
      transferSize: current.transferSize + resource.transferSize,
    };
  }
  return {
    navigation: navigation === undefined ? undefined : {
      domInteractive: navigation.domInteractive,
      duration: navigation.duration,
      loadEventEnd: navigation.loadEventEnd,
      requestStart: navigation.requestStart,
      responseEnd: navigation.responseEnd,
      startTime: navigation.startTime,
      transferSize: navigation.transferSize ?? 0,
    },
    paints,
    resources: {
      byType,
      count: resources.length,
      totalDuration: resources.reduce((sum, resource) => sum + resource.duration, 0),
      totalEncodedBodySize: resources.reduce((sum, resource) => sum + resource.encodedBodySize, 0),
      totalTransferSize: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
      slowest: [...resources].sort((left, right) => right.duration - left.duration).slice(0, 8),
    },
  };
})()
`);
  const afterFrameGc = await session.call('Runtime.getHeapUsage');
  await session.call('HeapProfiler.collectGarbage');
  const afterFinalGc = await session.call('Runtime.getHeapUsage');
  return {
    frameStats,
    gl: {
      ...gl,
      drawCalls: (gl.drawArrays ?? 0) + (gl.drawElements ?? 0) + (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0),
      instancedDrawCalls: (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0),
    },
    heap: {
      afterFinalGc,
      afterFrameGc,
      afterGc,
      beforeGc,
      retainedGrowthBytes: afterFinalGc.usedSize - afterGc.usedSize,
      transientGrowthBytes: afterFrameGc.usedSize - afterGc.usedSize,
    },
    performance: perf,
  };
};

const benchmarkRoute = async (session, route) => {
  if (clearCachePerRoute) await session.call('Network.clearBrowserCache');
  const loaded = session.once('Page.loadEventFired');
  const start = performance.now();
  await session.call('Page.navigate', { url: baseUrl + route.path });
  await Promise.race([loaded, sleep(10_000)]);
  const ready = await waitForBenchmarkReady(session);
  const measured = await collectPageMetrics(session, frameSampleCount);
  return {
    ...route,
    ready,
    wallNavigationAndReadyMs: performance.now() - start,
    ...measured,
  };
};

const main = async () => {
  const profileDir = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), 'royal-examples-bench-'))
  );
  const preview = spawnLogged('pnpm', [
    'exec',
    'vite',
    'preview',
    '--config',
    'vite.config.ts',
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
    '--use-gl=angle',
    '--use-angle=swiftshader',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { cwd: appRoot });

  let session;
  try {
    const size = await deploymentSize();
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('HeapProfiler.enable');
    await session.call('Network.enable');
    await session.call('Performance.enable');
    await installBenchmarkHooks(session);

    const results = [];
    for (const route of selectedRoutes()) {
      const result = await benchmarkRoute(session, route);
      results.push(result);
      const resourcesKb = result.performance.resources.totalTransferSize / 1024;
      const retainedKb = result.heap.retainedGrowthBytes / 1024;
      const drawCallsPerFrame = result.gl.drawCalls / frameSampleCount;
      console.log([
        route.id.padEnd(28),
        `load=${(result.performance.navigation?.duration ?? 0).toFixed(1)}ms`,
        `res=${resourcesKb.toFixed(1)}KiB`,
        `p95=${result.frameStats.p95Ms.toFixed(1)}ms`,
        `draw/frame=${drawCallsPerFrame.toFixed(1)}`,
        `heap=${retainedKb.toFixed(1)}KiB`,
      ].join(' '));
    }

    const report = {
      generatedAt: new Date().toISOString(),
      options: {
        frameSampleCount,
        frameWarmupCount,
        clearCachePerRoute,
        instancingFuzzCases,
        instancingSeed,
      },
      deployment: size,
      routes: results,
    };

    console.log(JSON.stringify({
      deploymentBytes: report.deployment.totalBytes,
      deploymentGzipBytes: report.deployment.gzipBytes,
      routeCount: report.routes.length,
      slowestRouteByP95: [...report.routes]
        .sort((left, right) => right.frameStats.p95Ms - left.frameStats.p95Ms)
        .slice(0, 5)
        .map((route) => ({ id: route.id, p95Ms: route.frameStats.p95Ms })),
    }, null, 2));

    if (outputPath !== '') {
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`wrote ${outputPath}`);
    }
  } finally {
    session?.close();
    await stop(browser);
    await stop(preview);
    await rm(profileDir, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }
};

await main();
