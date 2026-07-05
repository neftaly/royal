import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGzip } from 'node:zlib';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_BENCH_PORT ?? 4673);
const debugPort = Number(process.env.EXAMPLES_BENCH_DEBUG_PORT ?? 4674);
const debugHost = process.env.EXAMPLES_BENCH_DEBUG_HOST?.trim() || host;
const baseUrl = process.env.EXAMPLES_BENCH_BASE_URL?.trim() || `http://${host}:${previewPort}`;
const browserMode = process.env.EXAMPLES_BENCH_BROWSER?.trim() || 'chromium';
const benchmarkMode = process.env.EXAMPLES_BENCH_MODE?.trim() || 'quick';
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

if (!new Set(['quick', 'full', 'labs', 'all']).has(benchmarkMode)) {
  throw new Error(`EXAMPLES_BENCH_MODE must be "quick", "full", "labs", or "all", received ${JSON.stringify(benchmarkMode)}`);
}

const defaultFrameSampleCount = benchmarkMode === 'quick' ? 24 : 90;
const defaultFrameWarmupCount = benchmarkMode === 'quick' ? 8 : 30;
const frameSampleCount = envInteger('EXAMPLES_BENCH_FRAMES', defaultFrameSampleCount);
const frameWarmupCount = envInteger('EXAMPLES_BENCH_WARMUP_FRAMES', defaultFrameWarmupCount);
const frameSampleTimeoutMs = envInteger('EXAMPLES_BENCH_FRAME_TIMEOUT_MS', 10_000);
const cameraDragEnabled = process.env.EXAMPLES_BENCH_CAMERA_DRAG === '1';
const cameraDragFrameCount = cameraDragEnabled
  ? envInteger('EXAMPLES_BENCH_CAMERA_DRAG_FRAMES', frameSampleCount)
  : frameSampleCount;
const cameraDragStepPixels = cameraDragEnabled
  ? envInteger('EXAMPLES_BENCH_CAMERA_DRAG_STEP_PX', 7)
  : 7;
const instancingFuzzCases = envInteger('EXAMPLES_BENCH_INSTANCING_CASES', 4);
const instancingSeed = envInteger('EXAMPLES_BENCH_INSTANCING_SEED', 0x1a57a11);
const instancingFuzzEnabled = process.env.EXAMPLES_BENCH_INSTANCING_FUZZ === '1';
const instancingSweepMode = process.env.EXAMPLES_BENCH_INSTANCING_SWEEP?.trim()
  || (benchmarkMode === 'quick' ? 'quick' : 'default');
const defaultInstancingGrid = 16;
const routeReadyTimeoutMs = envInteger('EXAMPLES_BENCH_READY_TIMEOUT_MS', 20_000);
const cdpCommandTimeoutMs = envInteger(
  'EXAMPLES_BENCH_CDP_TIMEOUT_MS',
  Math.max(30_000, routeReadyTimeoutMs + frameSampleTimeoutMs + 15_000),
);
const clearCachePerRoute = process.env.EXAMPLES_BENCH_CLEAR_CACHE !== '0';
const managePreview = process.env.EXAMPLES_BENCH_PREVIEW !== '0';
const fakeXrEnabled = process.env.EXAMPLES_BENCH_FAKE_XR === '1';
const fakeXrHz = envInteger('EXAMPLES_BENCH_XR_HZ', 72);
const fakeXrPrepareTimeoutMs = envInteger('EXAMPLES_BENCH_XR_PREPARE_TIMEOUT_MS', 5_000);
const fakeXrSampleTimeoutMs = envInteger('EXAMPLES_BENCH_XR_SAMPLE_TIMEOUT_MS', 10_000);
const fakeXrViews = envInteger('EXAMPLES_BENCH_XR_VIEWS', 2);

if (!new Set(['chromium', 'cdp']).has(browserMode)) {
  throw new Error(`EXAMPLES_BENCH_BROWSER must be "chromium" or "cdp", received ${JSON.stringify(browserMode)}`);
}

if (!new Set(['0', 'quick', 'default', 'full']).has(instancingSweepMode)) {
  throw new Error(
    `EXAMPLES_BENCH_INSTANCING_SWEEP must be "0", "quick", "default", or "full", received ${JSON.stringify(instancingSweepMode)}`,
  );
}

const instancingRoute = ({ animate, grid, id, seed, sweep }) => ({
  id,
  path: `/gltf-instancing?animate=${animate ? 1 : 0}&grid=${grid}&seed=${seed}`,
  profile: {
    animate,
    grid,
    instanceCount: grid ** 3,
    kind: 'gltf-instancing',
    seed,
    sweep,
  },
});

const defaultInstancingRoute = () => ({
  id: 'gltf-instancing',
  path: '/gltf-instancing',
  profile: {
    animate: true,
    grid: defaultInstancingGrid,
    instanceCount: defaultInstancingGrid ** 3,
    kind: 'gltf-instancing',
    seed: 0,
    sweep: 'baseline',
  },
});

const routes = [
  { id: 'cube', path: '/cube' },
  { id: 'wireframe', path: '/wireframe' },
  { id: 'form-controls', path: '/form-controls' },
  { id: 'picking', path: '/picking' },
  { id: 'texture-materials', path: '/texture-materials' },
  { id: 'standard-lighting', path: '/standard-lighting' },
  { id: 'hud-overlay', path: '/hud-overlay' },
  { id: 'gltf-helmet', path: '/gltf-helmet' },
  defaultInstancingRoute(),
  instancingRoute({
    animate: false,
    grid: defaultInstancingGrid,
    id: 'gltf-instancing-static',
    seed: 0,
    sweep: 'baseline',
  }),
  instancingRoute({
    animate: true,
    grid: defaultInstancingGrid,
    id: 'gltf-instancing-animated',
    seed: 0,
    sweep: 'baseline',
  }),
  { id: 'gltf-kitchen-sink', path: '/gltf-kitchen-sink' },
  { id: 'gltf-kitchen-sink-slow', path: '/gltf-kitchen-sink-slow' },
  { id: 'gltf-ghostscript-tiger-svg', path: '/gltf-ghostscript-tiger-svg' },
  { id: 'gltf-lod', path: '/gltf-lod' },
  { id: 'gltf-variants', path: '/gltf-variants' },
  { id: 'webxr-vr', path: '/webxr-vr' },
];

const routeMatchesBenchmarkMode = (route) => {
  if (benchmarkMode === 'all') return true;
  if (benchmarkMode === 'labs') return route.id === 'webxr-vr';
  if (benchmarkMode === 'full') return route.id !== 'webxr-vr';

  return route.id !== 'gltf-kitchen-sink-slow' && route.id !== 'webxr-vr';
};

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

const instancingSweepRoutes = () => {
  if (instancingSweepMode === '0') return [];
  const quick = [
    instancingRoute({ animate: false, grid: 8, id: 'gltf-instancing-grid-8-static', seed: 0, sweep: 'quick' }),
    instancingRoute({ animate: false, grid: 16, id: 'gltf-instancing-grid-16-seed-271828-static', seed: 271828, sweep: 'quick' }),
  ];
  const defaultRows = [
    ...quick,
    instancingRoute({ animate: true, grid: 16, id: 'gltf-instancing-grid-16-seed-271828-animated', seed: 271828, sweep: 'default' }),
    instancingRoute({ animate: false, grid: 24, id: 'gltf-instancing-grid-24-static', seed: 314159, sweep: 'default' }),
  ];
  if (instancingSweepMode === 'quick') return quick;
  if (instancingSweepMode === 'default') return defaultRows;
  return [
    ...defaultRows,
    instancingRoute({ animate: true, grid: 24, id: 'gltf-instancing-grid-24-animated', seed: 314159, sweep: 'full' }),
    instancingRoute({ animate: false, grid: 28, id: 'gltf-instancing-grid-28-static', seed: 161803, sweep: 'full' }),
    instancingRoute({ animate: true, grid: 28, id: 'gltf-instancing-grid-28-animated', seed: 161803, sweep: 'full' }),
  ];
};

const instancingFuzzRoutes = () => {
  const random = new SeededRandom(instancingSeed);
  return Array.from({ length: instancingFuzzCases }, (_value, index) => {
    const grid = random.int(8, 25);
    const seed = random.int(0, 0xffff_ffff);
    return instancingRoute({
      animate: index % 2 === 1,
      grid,
      id: `gltf-instancing-fuzz-${index}`,
      seed,
      sweep: 'fuzz',
    });
  });
};

const selectedRoutes = () => {
  const sweepRoutes = benchmarkMode === 'labs' ? [] : instancingSweepRoutes();
  const fuzzRoutes = instancingFuzzEnabled ? instancingFuzzRoutes() : [];
  const benchmarkRoutes = routes.filter(routeMatchesBenchmarkMode);
  const allRoutes = [
    ...routes,
    ...sweepRoutes,
    ...fuzzRoutes,
  ];
  if (routeFilter === '') return [
    ...benchmarkRoutes,
    ...sweepRoutes,
    ...fuzzRoutes,
  ];
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
        clearTimeout(pending.timeout);
        if (message.error === undefined) pending.resolve(message.result);
        else pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
        return;
      }
      for (const handler of this.#handlers.get(message.method) ?? []) handler(message.params);
    });
    socket.addEventListener('close', () => {
      this.#rejectPending(new Error('CDP socket closed'));
    });
    socket.addEventListener('error', () => {
      this.#rejectPending(new Error('CDP socket error'));
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
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${cdpCommandTimeoutMs}ms`));
      }, cdpCommandTimeoutMs);
      this.#pending.set(id, { method, reject, resolve, timeout });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.socket.close();
  }

  #rejectPending(error) {
    const pending = this.#pending;
    this.#pending = new Map();
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
  }
}

const connectPage = async () => {
  await waitForJson(`http://${debugHost}:${debugPort}/json/version`, 10_000);
  const pages = await waitForJson(`http://${debugHost}:${debugPort}/json/list`, 10_000);
  const page = pages.find((entry) => entry.type === 'page');
  if (page?.webSocketDebuggerUrl === undefined) {
    throw new Error('Chromium did not expose a debuggable page target');
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://${debugHost}:${debugPort}`));
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

const glCounterTotals = (gl) => ({
  ...gl,
  drawCalls: (gl.drawArrays ?? 0) + (gl.drawElements ?? 0) + (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0),
  instancedDrawCalls: (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0),
  stateChanges:
    (gl.bindBuffer ?? 0) +
    (gl.bindTexture ?? 0) +
    (gl.bindVertexArray ?? 0) +
    (gl.useProgram ?? 0),
});

const emptyGltfInstancingCounters = Object.freeze({
  batchInstancesTotal: 0,
  batchPlansBuilt: 0,
  drawCalls: 0,
  instancesDrawn: 0,
  localModelUploadBytes: 0,
  localModelUploadCalls: 0,
  rootPoseUploadBytes: 0,
  rootPoseUploadCalls: 0,
  rootScaleUploadBytes: 0,
  rootScaleUploadCalls: 0,
});

const gltfInstancingCounterKeys = Object.keys(emptyGltfInstancingCounters);

const gltfInstancingCounters = (snapshot) => {
  const counters = snapshot?.gltfInstancing;
  if (counters === undefined || counters === null || typeof counters !== 'object') {
    return emptyGltfInstancingCounters;
  }
  return Object.fromEntries(gltfInstancingCounterKeys.map((key) => {
    const value = counters[key];
    return [key, typeof value === 'number' && Number.isFinite(value) ? value : 0];
  }));
};

const gltfInstancingCounterDelta = (after, before) => {
  const afterCounters = gltfInstancingCounters(after);
  const beforeCounters = gltfInstancingCounters(before);
  return Object.fromEntries(gltfInstancingCounterKeys.map((key) => [
    key,
    afterCounters[key] - beforeCounters[key],
  ]));
};

const gltfInstancingRootTransformUploadBytes = (counters) =>
  counters.rootPoseUploadBytes + counters.rootScaleUploadBytes;

const gltfInstancingRootTransformUploadCalls = (counters) =>
  counters.rootPoseUploadCalls + counters.rootScaleUploadCalls;

const hasGltfInstancingCounters = (snapshot) =>
  snapshot?.gltfInstancing !== undefined &&
  snapshot.gltfInstancing !== null &&
  typeof snapshot.gltfInstancing === 'object';

const rendererFrame = (snapshot) =>
  typeof snapshot?.frame === 'number' && Number.isFinite(snapshot.frame)
    ? snapshot.frame
    : undefined;

const rendererFrameDelta = (after, before) => {
  const afterFrame = rendererFrame(after);
  const beforeFrame = rendererFrame(before);
  if (afterFrame === undefined || beforeFrame === undefined) return 0;
  return Math.max(0, afterFrame - beforeFrame);
};

const gltfInstancingCounterRate = (counters, sampleFrames) => {
  const denominator = sampleFrames > 0 ? sampleFrames : 1;
  return Object.fromEntries(gltfInstancingCounterKeys.map((key) => [
    key,
    counters[key] / denominator,
  ]));
};

const gltfInstancingSampleMetrics = (after, before, sampleFrames) => {
  const delta = gltfInstancingCounterDelta(after, before);
  return {
    available: hasGltfInstancingCounters(after) || hasGltfInstancingCounters(before),
    delta,
    perFrame: gltfInstancingCounterRate(delta, sampleFrames),
    rendererFrames: rendererFrameDelta(after, before),
    sampleFrames,
  };
};

const gltfInstancingSetupMetrics = (snapshot) => ({
  available: hasGltfInstancingCounters(snapshot),
  counters: gltfInstancingCounters(snapshot),
  rendererFrame: rendererFrame(snapshot) ?? 0,
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
  const hookConfig = JSON.stringify({
    fakeXrEnabled,
    fakeXrHz,
    fakeXrSampleTimeoutMs,
    fakeXrViews,
  });
  await session.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
(() => {
  const config = ${hookConfig};
  const uniformCallNames = [
    'uniform1f',
    'uniform1fv',
    'uniform1i',
    'uniform1iv',
    'uniform1ui',
    'uniform1uiv',
    'uniform2f',
    'uniform2fv',
    'uniform2i',
    'uniform2iv',
    'uniform2ui',
    'uniform2uiv',
    'uniform3f',
    'uniform3fv',
    'uniform3i',
    'uniform3iv',
    'uniform3ui',
    'uniform3uiv',
    'uniform4f',
    'uniform4fv',
    'uniform4i',
    'uniform4iv',
    'uniform4ui',
    'uniform4uiv',
    'uniformMatrix2fv',
    'uniformMatrix2x3fv',
    'uniformMatrix2x4fv',
    'uniformMatrix3fv',
    'uniformMatrix3x2fv',
    'uniformMatrix3x4fv',
    'uniformMatrix4fv',
    'uniformMatrix4x2fv',
    'uniformMatrix4x3fv',
  ];
  const counters = {
    bindBuffer: 0,
    bindTexture: 0,
    bindVertexArray: 0,
    bufferDataBytes: 0,
    bufferDataCalls: 0,
    bufferSubDataBytes: 0,
    bufferSubDataCalls: 0,
    copyTexImage2D: 0,
    copyTexSubImage2D: 0,
    drawArrays: 0,
    drawArraysInstanced: 0,
    drawElements: 0,
    drawElementsInstanced: 0,
    texImage2D: 0,
    texSubImage2D: 0,
    uniformCalls: 0,
    uniformMatrixCalls: 0,
    useProgram: 0,
  };
  const xr = {
    activeSession: null,
    frameTimes: [],
    hz: config.fakeXrHz,
    sessions: 0,
    waiters: [],
  };
  const pendingDrawPulses = [];
  const pendingXrPulses = [];
  const statsFromDeltas = (deltas, requestedSampleCount = deltas.length, timeoutMs = 0) => {
    const sorted = [...deltas].sort((left, right) => left - right);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
    return {
      averageMs: sorted.length === 0 ? 0 : sum / sorted.length,
      failed: sorted.length === 0,
      jitterP95MinusP50Ms: percentile(0.95) - percentile(0.5),
      maxMs: sorted[sorted.length - 1] ?? 0,
      minMs: sorted[0] ?? 0,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      requestedSampleCount,
      sampleCount: sorted.length,
      samplesMissing: Math.max(0, requestedSampleCount - sorted.length),
      timedOut: sorted.length < requestedSampleCount,
      timeoutMs,
    };
  };
  const statsFromTimes = (times) =>
    statsFromDeltas(times.slice(1).map((time, index) => time - times[index]));
  const failedFrameStats = (reason, details = {}) => ({
    failed: true,
    reason,
    sampleCount: 0,
    timeoutMs: 0,
    ...details,
  });
  const resolveXrWaiters = () => {
    xr.waiters = xr.waiters.filter((waiter) => {
      const sample = xr.frameTimes.slice(waiter.startIndex, waiter.startIndex + waiter.frameCount);
      if (sample.length < waiter.frameCount) return true;
      waiter.resolve(statsFromTimes(sample));
      return false;
    });
  };
  const failXrWaiters = (reason, details = {}) => {
    const waiters = xr.waiters;
    xr.waiters = [];
    for (const waiter of waiters) waiter.resolve(failedFrameStats(reason, details));
  };
  const recordXrFrame = (time) => {
    xr.frameTimes.push(time);
    while (pendingXrPulses.length > 0) {
      pendingXrPulses.shift().resolve(time);
    }
    resolveXrWaiters();
  };
  const recordDraw = () => {
    const now = performance.now();
    while (pendingDrawPulses.length > 0) {
      pendingDrawPulses.shift().resolve(now);
    }
  };
  const nextObservedDraw = (timeoutMs) =>
    new Promise((resolve) => {
      let settled = false;
      const waiter = {
        resolve(value) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          resolve(value);
        },
      };
      const timeoutHandle = setTimeout(() => {
        const index = pendingDrawPulses.indexOf(waiter);
        if (index >= 0) pendingDrawPulses.splice(index, 1);
        waiter.resolve(null);
      }, Math.max(1, Math.floor(Number(timeoutMs) || 1)));
      pendingDrawPulses.push(waiter);
    });
  const byteLengthOf = (value) => {
    if (typeof value === 'number') return value;
    if (value?.byteLength !== undefined) return value.byteLength;
    if (value?.length !== undefined) return value.length;
    return 0;
  };
  const elementByteLengthOf = (value) => value?.BYTES_PER_ELEMENT ?? 1;
  const bufferSubDataByteLength = (args) => {
    const source = args[2];
    const sourceByteLength = byteLengthOf(source);
    const elementByteLength = elementByteLengthOf(source);
    const sourceOffset = Math.max(0, Math.floor(Number(args[3]) || 0));
    const sourceLength = args[4];
    if (typeof sourceLength === 'number') return Math.max(0, sourceLength) * elementByteLength;
    return Math.max(0, sourceByteLength - sourceOffset * elementByteLength);
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
    patch(prototype, 'bindBuffer', () => { counters.bindBuffer += 1; });
    patch(prototype, 'bindTexture', () => { counters.bindTexture += 1; });
    patch(prototype, 'bindVertexArray', () => { counters.bindVertexArray += 1; });
    patch(prototype, 'drawArrays', () => { counters.drawArrays += 1; recordDraw(); });
    patch(prototype, 'drawElements', () => { counters.drawElements += 1; recordDraw(); });
    patch(prototype, 'drawArraysInstanced', () => { counters.drawArraysInstanced += 1; recordDraw(); });
    patch(prototype, 'drawElementsInstanced', () => { counters.drawElementsInstanced += 1; recordDraw(); });
    patch(prototype, 'bufferData', (args) => {
      counters.bufferDataCalls += 1;
      counters.bufferDataBytes += byteLengthOf(args[1]);
    });
    patch(prototype, 'bufferSubData', (args) => {
      counters.bufferSubDataCalls += 1;
      counters.bufferSubDataBytes += bufferSubDataByteLength(args);
    });
    patch(prototype, 'copyTexImage2D', () => { counters.copyTexImage2D += 1; });
    patch(prototype, 'copyTexSubImage2D', () => { counters.copyTexSubImage2D += 1; });
    patch(prototype, 'texImage2D', () => { counters.texImage2D += 1; });
    patch(prototype, 'texSubImage2D', () => { counters.texSubImage2D += 1; });
    patch(prototype, 'useProgram', () => { counters.useProgram += 1; });
    for (const name of uniformCallNames) {
      patch(prototype, name, () => {
        counters.uniformCalls += 1;
        if (name.startsWith('uniformMatrix')) counters.uniformMatrixCalls += 1;
      });
    }
  };
  patchPrototype(globalThis.WebGLRenderingContext?.prototype);
  patchPrototype(globalThis.WebGL2RenderingContext?.prototype);
  const sampleXrFrames = (frameDeltas, timeoutMs = config.fakeXrSampleTimeoutMs) => {
    if (xr.activeSession === null) return null;
    const requestedFrameDeltas = Math.max(1, Math.floor(Number(frameDeltas) || 0));
    const requestedFrameCount = requestedFrameDeltas + 1;
    const startIndex = xr.frameTimes.length;
    const boundedTimeoutMs = Math.max(1, Math.floor(Number(timeoutMs) || config.fakeXrSampleTimeoutMs));
    return new Promise((resolve) => {
      let settled = false;
      let timeoutHandle;
      const waiter = {
        frameCount: requestedFrameCount,
        resolve(value) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          resolve(value);
        },
        startIndex,
      };
      timeoutHandle = setTimeout(() => {
        const observedTimes = xr.frameTimes.slice(startIndex);
        xr.waiters = xr.waiters.filter((entry) => entry !== waiter);
        waiter.resolve(failedFrameStats('timeout', {
          observedFrameCount: observedTimes.length,
          requestedFrameCount,
          sampleCount: Math.max(0, observedTimes.length - 1),
          timeoutMs: boundedTimeoutMs,
          ...(observedTimes.length > 1 ? { partialStats: statsFromTimes(observedTimes) } : {}),
        }));
      }, boundedTimeoutMs);
      xr.waiters.push(waiter);
      resolveXrWaiters();
    });
  };
  const latencyPulse = async () => {
    const eventAt = performance.now();
    const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));
    const drawPromise = nextObservedDraw(250);
    const windowRafPromise = new Promise((resolve) => {
      requestAnimationFrame((time) => resolve(time));
    });
    const xrPromise = xr.activeSession === null
      ? Promise.resolve(null)
      : new Promise((resolve) => {
        pendingXrPulses.push({ resolve });
      });
    const canvas = document.querySelector('canvas');
    canvas?.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: canvas.clientWidth / 2,
      clientY: canvas.clientHeight / 2,
      pointerId: 1,
      pointerType: 'mouse',
    }));
    const [drawAt, windowRafAt, xrFrameAt] = await Promise.all([
      drawPromise,
      Promise.race([windowRafPromise, timeout(250)]),
      Promise.race([xrPromise, timeout(250)]),
    ]);
    return {
      eventToNextDrawMs: drawAt === null ? null : drawAt - eventAt,
      eventToNextWindowRafMs: windowRafAt === null ? null : windowRafAt - eventAt,
      eventToNextXrFrameMs: xrFrameAt === null ? null : xrFrameAt - eventAt,
      measurement: 'synthetic-pointer-event-to-next-observed-frame-or-draw',
      note: 'These are event-to-next-frame/draw timings, not true motion-to-photon latency.',
    };
  };
  const cameraDragSample = async (frameDeltas, stepPixels) => {
    if (typeof PointerEvent !== 'function') return failedFrameStats('missing-pointer-event');
    const canvas = document.querySelector('canvas');
    if (canvas === null) return failedFrameStats('missing-canvas');
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return failedFrameStats('empty-canvas-bounds', {
        height: rect.height,
        width: rect.width,
      });
    }
    const requestedSampleCount = Math.max(1, Math.floor(Number(frameDeltas) || 0));
    const step = Math.max(1, Math.floor(Number(stepPixels) || 1));
    const pointerId = 913;
    let clientX = rect.left + rect.width * 0.5;
    const clientY = rect.top + rect.height * 0.5;
    const eventOptions = (type) => ({
      bubbles: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      cancelable: true,
      clientX,
      clientY,
      isPrimary: true,
      pointerId,
      pointerType: 'mouse',
    });
    const drawDeltas = [];
    const rafDeltas = [];
    const dispatchPointer = (type) => {
      canvas.dispatchEvent(new PointerEvent(type, eventOptions(type)));
    };
    dispatchPointer('pointerdown');
    try {
      for (let index = 0; index < requestedSampleCount; index += 1) {
        clientX += step;
        const drawPromise = nextObservedDraw(250);
        const rafPromise = new Promise((resolve) => requestAnimationFrame((time) => resolve(time)));
        const eventAt = performance.now();
        dispatchPointer('pointermove');
        const [drawAt, rafAt] = await Promise.all([drawPromise, rafPromise]);
        if (typeof drawAt === 'number') drawDeltas.push(drawAt - eventAt);
        if (typeof rafAt === 'number') rafDeltas.push(rafAt - eventAt);
      }
    } finally {
      dispatchPointer('pointerup');
    }
    const sampleTimeoutMs = 250;
    const draw = statsFromDeltas(drawDeltas, requestedSampleCount, sampleTimeoutMs);
    return {
      ...draw,
      measurement: 'synthetic-camera-drag-pointermove-to-next-webgl-draw',
      note: 'Draw latency is measured at the next WebGL draw call after each synthetic drag move; RAF latency is reported separately.',
      raf: statsFromDeltas(rafDeltas, requestedSampleCount, sampleTimeoutMs),
      ...(draw.failed ? { reason: 'draw-timeout' } : {}),
    };
  };
  if (config.fakeXrEnabled) {
    const webGl2Prototype = globalThis.WebGL2RenderingContext?.prototype;
    if (webGl2Prototype !== undefined) {
      Object.defineProperty(webGl2Prototype, 'makeXRCompatible', {
        configurable: true,
        value: async function makeXRCompatible() {},
        writable: true,
      });
    }
    const framePeriodMs = 1000 / config.fakeXrHz;
    const viewCount = Math.max(1, config.fakeXrViews);
    const projectionMatrix = [
      1.3, 0, 0, 0,
      0, 1.7, 0, 0,
      0, 0, -1, -1,
      0, 0, -0.05, 0,
    ];
    const viewMatrix = (index) => {
      const eyeOffset = viewCount === 1 ? 0 : (index / (viewCount - 1) - 0.5) * 0.064;
      return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        eyeOffset, -1.55, -2.4, 1,
      ];
    };
    const makeViews = (canvas) => {
      const width = canvas?.width || canvas?.clientWidth || 800;
      const height = canvas?.height || canvas?.clientHeight || 600;
      const viewWidth = Math.max(1, Math.floor(width / viewCount));
      return Array.from({ length: viewCount }, (_value, index) => ({
        __royalBenchViewport: {
          height,
          width: index === viewCount - 1 ? width - viewWidth * index : viewWidth,
          x: viewWidth * index,
          y: 0,
        },
        eye: index === 0 ? 'left' : index === 1 ? 'right' : 'none',
        projectionMatrix,
        transform: { inverse: { matrix: viewMatrix(index) } },
      }));
    };
    class RoyalBenchXrSession extends EventTarget {
      constructor() {
        super();
        this.ended = false;
        this.frameHandle = 0;
        this.handles = new Map();
        this.nextFrameTime = performance.now();
        this.renderState = {};
        xr.activeSession = this;
        xr.sessions += 1;
      }
      requestReferenceSpace(type) {
        return Promise.resolve({ __royalBenchReferenceSpace: true, type });
      }
      updateRenderState(state) {
        this.renderState = { ...this.renderState, ...state };
      }
      requestAnimationFrame(callback) {
        if (this.ended) return 0;
        const handle = ++this.frameHandle;
        const now = performance.now();
        const delay = Math.max(0, this.nextFrameTime - now);
        this.nextFrameTime = Math.max(this.nextFrameTime + framePeriodMs, now + framePeriodMs);
        const timeoutHandle = setTimeout(() => {
          if (this.ended || !this.handles.has(handle)) return;
          this.handles.delete(handle);
          const time = performance.now();
          const canvas = this.renderState.baseLayer?.context?.canvas ?? document.querySelector('canvas');
          const frame = {
            predictedDisplayTime: time + framePeriodMs,
            session: this,
            getViewerPose: () => ({ views: makeViews(canvas) }),
          };
          recordXrFrame(time);
          callback(time, frame);
        }, delay);
        this.handles.set(handle, timeoutHandle);
        return handle;
      }
      cancelAnimationFrame(handle) {
        const timeoutHandle = this.handles.get(handle);
        if (timeoutHandle === undefined) return;
        clearTimeout(timeoutHandle);
        this.handles.delete(handle);
      }
      end() {
        if (this.ended) return Promise.resolve();
        this.ended = true;
        for (const timeoutHandle of this.handles.values()) clearTimeout(timeoutHandle);
        this.handles.clear();
        if (xr.activeSession === this) xr.activeSession = null;
        failXrWaiters('session-ended');
        this.dispatchEvent(new Event('end'));
        return Promise.resolve();
      }
    }
    class RoyalBenchXrWebGlLayer {
      constructor(session, context, options = {}) {
        this.context = context;
        this.framebuffer = null;
        this.options = options;
        this.session = session;
      }
      getViewport(view) {
        return view.__royalBenchViewport;
      }
    }
    const xrSystem = {
      isSessionSupported: async (mode) => mode === 'immersive-vr',
      requestSession: async (mode) => {
        if (mode !== 'immersive-vr') throw new Error('Royal benchmark fake XR only supports immersive-vr');
        return new RoyalBenchXrSession();
      },
    };
    Object.defineProperty(globalThis, 'XRWebGLLayer', {
      configurable: true,
      value: RoyalBenchXrWebGlLayer,
    });
    Object.defineProperty(Navigator.prototype, 'xr', {
      configurable: true,
      get() {
        return xrSystem;
      },
    });
  }
  globalThis.__royalBench = {
    counters,
    cameraDragSample,
    latencyPulse,
    reset() {
      for (const key of Object.keys(counters)) counters[key] = 0;
      xr.frameTimes.length = 0;
    },
    sampleXrFrames,
    snapshot() {
      return { ...counters };
    },
    xrSnapshot() {
      return {
        active: xr.activeSession !== null,
        frameCount: xr.frameTimes.length,
        hz: xr.hz,
        sessions: xr.sessions,
        viewCount: config.fakeXrViews,
      };
    },
  };
})();
`,
  });
};

const waitForBenchmarkReady = (session) => evaluate(session, `
(async () => {
  const deadline = performance.now() + ${routeReadyTimeoutMs};
  const rafOrTimeout = (timeoutMs) => new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    requestAnimationFrame(() => finish(true));
  });
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
      return await rafOrTimeout(1000) && await rafOrTimeout(1000);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
})()
`);

const collectPageMetrics = async (session, frames, options = {}) => {
  const { sampleXr = true } = options;
  const beforeGc = await session.call('Runtime.getHeapUsage');
  await session.call('HeapProfiler.collectGarbage');
  const afterGc = await session.call('Runtime.getHeapUsage');
  const setupGl = await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}');
  const setupRenderer = await evaluate(session, 'globalThis.__royalExamplesGltfInstancingSnapshot?.() ?? null');
  const warmupComplete = await evaluate(session, `
(async () => {
  const rafOrTimeout = (deadline) => new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), Math.max(1, deadline - performance.now()));
    requestAnimationFrame(() => finish(true));
  });
  const deadline = performance.now() + ${frameSampleTimeoutMs};
  for (let index = 0; index < ${frameWarmupCount}; index += 1) {
    if (performance.now() >= deadline) return false;
    if (!await rafOrTimeout(deadline)) return false;
  }
  return true;
})()
`);
  const rendererBeforeFrames = await evaluate(session, 'globalThis.__royalExamplesGltfInstancingSnapshot?.() ?? null');
  await evaluate(session, 'globalThis.__royalBench?.reset?.()');
  const frameStats = await evaluate(session, `
(async () => {
  const frames = ${frames};
  const timeoutMs = ${frameSampleTimeoutMs};
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  const deltas = [];
  let previous = performance.now();
  for (let index = 0; index < frames; index += 1) {
    if (performance.now() >= deadline) break;
    const frameArrived = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(false), Math.max(1, deadline - performance.now()));
      requestAnimationFrame(() => finish(true));
    });
    const now = performance.now();
    if (!frameArrived) break;
    deltas.push(now - previous);
    previous = now;
  }
  deltas.sort((left, right) => left - right);
  const sum = deltas.reduce((total, value) => total + value, 0);
  const percentile = (ratio) => deltas[Math.min(deltas.length - 1, Math.floor((deltas.length - 1) * ratio))] ?? 0;
  if (deltas.length === 0) {
    return {
      averageMs: 0,
      failed: true,
      jitterP95MinusP50Ms: 0,
      maxMs: 0,
      minMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      reason: 'raf-timeout',
      requestedSampleCount: frames,
      sampleCount: 0,
      timeoutMs,
    };
  }
  return {
    averageMs: sum / deltas.length,
    jitterP95MinusP50Ms: percentile(0.95) - percentile(0.5),
    maxMs: deltas[deltas.length - 1] ?? 0,
    minMs: deltas[0] ?? 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    requestedSampleCount: frames,
    sampleCount: deltas.length,
    timedOut: deltas.length < frames,
    timeoutMs,
  };
})()
`);
  const gl = await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}');
  const rendererAfterFrames = await evaluate(session, 'globalThis.__royalExamplesGltfInstancingSnapshot?.() ?? null');
  const cameraDrag = cameraDragEnabled
    ? await (async () => {
        const dragRendererBefore = await evaluate(session, 'globalThis.__royalExamplesGltfInstancingSnapshot?.() ?? null');
        await evaluate(session, 'globalThis.__royalBench?.reset?.()');
        const frameStats = await evaluate(session, `
(async () => globalThis.__royalBench?.cameraDragSample?.(${cameraDragFrameCount}, ${cameraDragStepPixels}) ?? null)()
`);
        const dragGl = await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}');
        const dragRendererAfter = await evaluate(session, 'globalThis.__royalExamplesGltfInstancingSnapshot?.() ?? null');
        return frameStats === null
          ? undefined
          : {
              frameStats,
              gl: glCounterTotals(dragGl),
              renderer: {
                gltfInstancing: gltfInstancingSampleMetrics(
                  dragRendererAfter,
                  dragRendererBefore,
                  frameStats.sampleCount ?? cameraDragFrameCount,
                ),
              },
            };
      })()
    : undefined;
  const xrFrameStats = sampleXr
    ? await evaluate(session, `
(async () => globalThis.__royalBench?.sampleXrFrames?.(${frames}, ${fakeXrSampleTimeoutMs}) ?? null)()
`)
    : null;
  const latency = await evaluate(session, `
(async () => globalThis.__royalBench?.latencyPulse?.() ?? null)()
`);
  const xr = await evaluate(session, 'globalThis.__royalBench?.xrSnapshot?.() ?? null');
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
      ...glCounterTotals(gl),
      setup: glCounterTotals(setupGl),
    },
    renderer: {
      gltfInstancing: gltfInstancingSampleMetrics(
        rendererAfterFrames,
        rendererBeforeFrames,
        frameStats.sampleCount ?? frames,
      ),
      setup: {
        gltfInstancing: gltfInstancingSetupMetrics(setupRenderer),
      },
    },
    heap: {
      afterFinalGc,
      afterFrameGc,
      afterGc,
      beforeGc,
      retainedGrowthBytes: afterFinalGc.usedSize - afterGc.usedSize,
      transientGrowthBytes: afterFrameGc.usedSize - afterGc.usedSize,
    },
    latency,
    warmupComplete,
    ...(cameraDrag === undefined ? {} : { cameraDrag }),
    performance: perf,
    xr: xr === null ? undefined : {
      ...xr,
      frameStats: xrFrameStats,
    },
  };
};

const prepareRouteForBenchmark = async (session, route) => {
  if (!fakeXrEnabled || route.id !== 'webxr-vr') return undefined;
  try {
    return await evaluate(session, `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorMessage = (error) => error instanceof Error ? error.message : String(error);
  const timeoutMs = ${fakeXrPrepareTimeoutMs};
  const deadline = performance.now() + timeoutMs;
  let clicked = false;
  while (performance.now() < deadline) {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent?.includes('Enter XR') || entry.textContent?.includes('Exit XR'));
    if (button !== undefined && !button.disabled) {
      if (button.textContent?.includes('Enter XR')) {
        try {
          button.click();
          clicked = true;
        } catch (error) {
          return { active: false, clicked, error: errorMessage(error), reason: 'click-failed' };
        }
      }
      break;
    }
    await sleep(25);
  }
  while (performance.now() < deadline) {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent?.includes('Enter XR') || entry.textContent?.includes('Exit XR'));
    const text = document.body.innerText;
    if (button?.textContent?.includes('Exit XR') && text.includes('immersive')) {
      return { active: true, status: 'immersive' };
    }
    await sleep(25);
  }
  return {
    active: false,
    clicked,
    reason: 'timeout',
    status: document.body.innerText.slice(0, 300),
    timedOut: true,
    timeoutMs,
  };
})()
`);
  } catch (error) {
    return {
      active: false,
      error: error instanceof Error ? error.message : String(error),
      reason: 'prepare-evaluate-failed',
    };
  }
};

const benchmarkRoute = async (session, route) => {
  await session.call('Page.bringToFront');
  if (clearCachePerRoute) await session.call('Network.clearBrowserCache');
  const loaded = session.once('Page.loadEventFired');
  const start = performance.now();
  await session.call('Page.navigate', { url: baseUrl + route.path });
  await Promise.race([loaded, sleep(10_000)]);
  const ready = await waitForBenchmarkReady(session);
  const prepared = await prepareRouteForBenchmark(session, route);
  const measured = await collectPageMetrics(session, frameSampleCount, {
    sampleXr: prepared?.active !== false,
  });
  const activationFailure = prepared?.active === false
    ? {
      error: prepared.error,
      reason: prepared.reason ?? 'activation-failed',
      status: prepared.status,
      timedOut: prepared.timedOut === true,
      timeoutMs: prepared.timeoutMs,
    }
    : undefined;
  return {
    ...route,
    ...(prepared === undefined ? {} : { prepared }),
    ...(activationFailure === undefined ? {} : { fakeXrActivationFailure: activationFailure }),
    ready,
    wallNavigationAndReadyMs: performance.now() - start,
    ...measured,
  };
};

const round = (value, digits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const routeSummary = (route) => {
  const sampledFrameCount = route.frameStats.sampleCount > 0 ? route.frameStats.sampleCount : frameSampleCount;
  const drawCallsPerFrame = route.gl.drawCalls / sampledFrameCount;
  const instancedDrawCallsPerFrame = route.gl.instancedDrawCalls / sampledFrameCount;
  const bufferSubDataBytesPerFrame = route.gl.bufferSubDataBytes / sampledFrameCount;
  const stateChangesPerFrame = route.gl.stateChanges / sampledFrameCount;
  const useProgramPerFrame = route.gl.useProgram / sampledFrameCount;
  const bindBufferPerFrame = route.gl.bindBuffer / sampledFrameCount;
  const bindTexturePerFrame = route.gl.bindTexture / sampledFrameCount;
  const bindVertexArrayPerFrame = route.gl.bindVertexArray / sampledFrameCount;
  const copyTexImage2DPerFrame = route.gl.copyTexImage2D / sampledFrameCount;
  const copyTexSubImage2DPerFrame = route.gl.copyTexSubImage2D / sampledFrameCount;
  const uniformCallsPerFrame = route.gl.uniformCalls / sampledFrameCount;
  const cameraDragSampleCount = route.cameraDrag?.frameStats?.sampleCount ?? 0;
  const cameraDragFrameStats = route.cameraDrag?.frameStats;
  const cameraDragDrawCallsPerFrame = cameraDragSampleCount <= 0 || route.cameraDrag === undefined
    ? undefined
    : route.cameraDrag.gl.drawCalls / cameraDragSampleCount;
  const cameraDragInstancedDrawCallsPerFrame = cameraDragSampleCount <= 0 || route.cameraDrag === undefined
    ? undefined
    : route.cameraDrag.gl.instancedDrawCalls / cameraDragSampleCount;
  const cameraDragBufferSubDataBytesPerFrame = cameraDragSampleCount <= 0 || route.cameraDrag === undefined
    ? undefined
    : route.cameraDrag.gl.bufferSubDataBytes / cameraDragSampleCount;
  const cameraDragStateChangesPerFrame = cameraDragSampleCount <= 0 || route.cameraDrag === undefined
    ? undefined
    : route.cameraDrag.gl.stateChanges / cameraDragSampleCount;
  const cameraDragUniformCallsPerFrame = cameraDragSampleCount <= 0 || route.cameraDrag === undefined
    ? undefined
    : route.cameraDrag.gl.uniformCalls / cameraDragSampleCount;
  const cameraDragFailure = cameraDragFrameStats?.failed === true
    ? cameraDragFrameStats.reason
    : cameraDragFrameStats?.timedOut === true
      ? 'partial-timeout'
      : undefined;
  const hasCameraDragStats =
    typeof cameraDragFrameStats?.p95Ms === 'number' &&
    typeof cameraDragDrawCallsPerFrame === 'number';
  const frameFailure = route.frameStats.failed === true
    ? route.frameStats.reason
    : route.frameStats.timedOut === true
      ? 'partial-timeout'
      : undefined;
  const setupInstancedDrawCalls = route.gl.setup?.instancedDrawCalls ?? 0;
  const instanceCount = route.profile?.kind === 'gltf-instancing' ? route.profile.instanceCount : undefined;
  const gltfInstancing = route.profile?.kind === 'gltf-instancing'
    ? route.renderer?.gltfInstancing
    : undefined;
  const gltfInstancingPerFrame = gltfInstancing?.perFrame;
  const setupGltfInstancing = route.profile?.kind === 'gltf-instancing'
    ? route.renderer?.setup?.gltfInstancing
    : undefined;
  const setupGltfInstancingCounters = setupGltfInstancing?.counters;
  const gltfInstancingRootTransformUploadBytesPerFrame = gltfInstancingPerFrame === undefined
    ? undefined
    : gltfInstancingRootTransformUploadBytes(gltfInstancingPerFrame);
  const gltfInstancingRootTransformUploadCallsPerFrame = gltfInstancingPerFrame === undefined
    ? undefined
    : gltfInstancingRootTransformUploadCalls(gltfInstancingPerFrame);
  return {
    id: route.id,
    path: route.path,
    ...(route.profile === undefined ? {} : { profile: route.profile }),
    ...(frameFailure === undefined ? {} : { frameFailure }),
    p95Ms: round(route.frameStats.p95Ms),
    p99Ms: round(route.frameStats.p99Ms),
    maxMs: round(route.frameStats.maxMs),
    readyMs: round(route.wallNavigationAndReadyMs),
    jitterP95MinusP50Ms: round(route.frameStats.jitterP95MinusP50Ms),
    drawCallsPerFrame: round(drawCallsPerFrame),
    instancedDrawCallsPerFrame: round(instancedDrawCallsPerFrame),
    stateChangesPerFrame: round(stateChangesPerFrame),
    useProgramPerFrame: round(useProgramPerFrame),
    bindBufferPerFrame: round(bindBufferPerFrame),
    bindTexturePerFrame: round(bindTexturePerFrame),
    bindVertexArrayPerFrame: round(bindVertexArrayPerFrame),
    copyTexImage2DPerFrame: round(copyTexImage2DPerFrame),
    copyTexSubImage2DPerFrame: round(copyTexSubImage2DPerFrame),
    uniformCallsPerFrame: round(uniformCallsPerFrame),
    uniformMatrixCallsPerFrame: round(route.gl.uniformMatrixCalls / sampledFrameCount),
    setupDrawCalls: route.gl.setup?.drawCalls ?? 0,
    setupInstancedDrawCalls,
    setupStateChanges: route.gl.setup?.stateChanges ?? 0,
    setupUseProgram: route.gl.setup?.useProgram ?? 0,
    setupBindBuffer: route.gl.setup?.bindBuffer ?? 0,
    setupBindTexture: route.gl.setup?.bindTexture ?? 0,
    setupBindVertexArray: route.gl.setup?.bindVertexArray ?? 0,
    setupUniformCalls: route.gl.setup?.uniformCalls ?? 0,
    setupUniformMatrixCalls: route.gl.setup?.uniformMatrixCalls ?? 0,
    setupBufferDataBytes: route.gl.setup?.bufferDataBytes ?? 0,
    setupBufferSubDataBytes: route.gl.setup?.bufferSubDataBytes ?? 0,
    ...(instanceCount === undefined
      ? {}
      : {
        drawCallsPer1000Instances: round(drawCallsPerFrame / (instanceCount / 1000), 3),
        ...(gltfInstancing === undefined || gltfInstancingPerFrame === undefined
          ? {}
          : {
            gltfInstancingDiagnostics: gltfInstancing.available ? 'available' : 'missing',
            gltfRendererFrames: gltfInstancing.rendererFrames,
            gltfBatchPlansBuiltPerFrame: round(gltfInstancingPerFrame.batchPlansBuilt, 3),
            gltfBatchInstancesPerFrame: round(gltfInstancingPerFrame.batchInstancesTotal, 3),
            gltfDrawCallsPerFrame: round(gltfInstancingPerFrame.drawCalls, 3),
            gltfInstancesDrawnPerFrame: round(gltfInstancingPerFrame.instancesDrawn, 3),
            gltfLocalModelUploadBytesPerFrame: round(gltfInstancingPerFrame.localModelUploadBytes, 1),
            gltfLocalModelUploadCallsPerFrame: round(gltfInstancingPerFrame.localModelUploadCalls, 3),
            gltfRootTransformUploadBytesPerFrame: round(gltfInstancingRootTransformUploadBytesPerFrame, 1),
            gltfRootTransformUploadCallsPerFrame: round(gltfInstancingRootTransformUploadCallsPerFrame, 3),
            setupGltfBatchPlansBuilt: setupGltfInstancingCounters?.batchPlansBuilt ?? 0,
            setupGltfInstancesDrawn: setupGltfInstancingCounters?.instancesDrawn ?? 0,
            setupGltfRootTransformUploadBytes: setupGltfInstancingCounters === undefined
              ? 0
              : gltfInstancingRootTransformUploadBytes(setupGltfInstancingCounters),
            setupGltfRootTransformUploadCalls: setupGltfInstancingCounters === undefined
              ? 0
              : gltfInstancingRootTransformUploadCalls(setupGltfInstancingCounters),
          }),
        instancedDrawCallsPer1000Instances: round(instancedDrawCallsPerFrame / (instanceCount / 1000), 3),
        setupInstancedDrawCallsPer1000Instances: round(setupInstancedDrawCalls / (instanceCount / 1000), 3),
      }),
    bufferSubDataBytesPerFrame: round(bufferSubDataBytesPerFrame),
    ...(hasCameraDragStats
      ? {
        cameraDragDrawCallsPerFrame: round(cameraDragDrawCallsPerFrame),
        ...(typeof cameraDragStateChangesPerFrame === 'number' && cameraDragStateChangesPerFrame !== 0
          ? { cameraDragStateChangesPerFrame: round(cameraDragStateChangesPerFrame) }
          : {}),
        ...(typeof cameraDragUniformCallsPerFrame === 'number' && cameraDragUniformCallsPerFrame !== 0
          ? { cameraDragUniformCallsPerFrame: round(cameraDragUniformCallsPerFrame) }
          : {}),
        ...(typeof cameraDragBufferSubDataBytesPerFrame === 'number' && cameraDragBufferSubDataBytesPerFrame !== 0
          ? { cameraDragBufferSubDataBytesPerFrame: round(cameraDragBufferSubDataBytesPerFrame) }
          : {}),
        ...(typeof cameraDragInstancedDrawCallsPerFrame === 'number' && cameraDragInstancedDrawCallsPerFrame !== 0
          ? { cameraDragInstancedDrawCallsPerFrame: round(cameraDragInstancedDrawCallsPerFrame) }
          : {}),
        cameraDragDrawP95Ms: round(cameraDragFrameStats.p95Ms),
        cameraDragDrawP99Ms: round(cameraDragFrameStats.p99Ms),
        ...(typeof cameraDragFrameStats.samplesMissing === 'number' && cameraDragFrameStats.samplesMissing > 0
          ? { cameraDragSamplesMissing: cameraDragFrameStats.samplesMissing }
          : {}),
        ...(typeof cameraDragFrameStats.raf?.p95Ms === 'number'
          ? { cameraDragRafP95Ms: round(cameraDragFrameStats.raf.p95Ms) }
          : {}),
      }
      : {}),
    ...(cameraDragFailure === undefined
      ? {}
      : { cameraDragFailure }),
    retainedGrowthBytes: route.heap.retainedGrowthBytes,
    resourceTransferBytes: route.performance.resources.totalTransferSize,
    ...(typeof route.xr?.frameStats?.p95Ms === 'number'
      ? { xrP95Ms: round(route.xr.frameStats.p95Ms) }
      : {}),
    ...(route.xr?.frameStats?.failed === true
      ? { xrFrameFailure: route.xr.frameStats.reason }
      : {}),
  };
};

const numericDelta = (left, right, digits = 2) =>
  typeof left === 'number' && typeof right === 'number'
    ? round(left - right, digits)
    : undefined;

const instancingComparisons = (summaries) => {
  const instancing = summaries.filter((route) => route.profile?.kind === 'gltf-instancing');
  const staticRows = new Map();
  for (const route of instancing) {
    if (route.profile.animate) continue;
    staticRows.set(`${route.profile.grid}:${route.profile.seed}`, route);
  }
  return instancing
    .filter((route) => route.profile.animate)
    .map((animated) => {
      const staticRoute = staticRows.get(`${animated.profile.grid}:${animated.profile.seed}`);
      if (staticRoute === undefined) return undefined;
      const deltaGltfRootTransformUploadBytesPerFrame = numericDelta(
        animated.gltfRootTransformUploadBytesPerFrame,
        staticRoute.gltfRootTransformUploadBytesPerFrame,
        1,
      );
      const deltaGltfLocalModelUploadBytesPerFrame = numericDelta(
        animated.gltfLocalModelUploadBytesPerFrame,
        staticRoute.gltfLocalModelUploadBytesPerFrame,
        1,
      );
      const deltaGltfInstancesDrawnPerFrame = numericDelta(
        animated.gltfInstancesDrawnPerFrame,
        staticRoute.gltfInstancesDrawnPerFrame,
        3,
      );

      return {
        animatedId: animated.id,
        staticId: staticRoute.id,
        grid: animated.profile.grid,
        instanceCount: animated.profile.instanceCount,
        seed: animated.profile.seed,
        deltaP95Ms: round(animated.p95Ms - staticRoute.p95Ms),
        deltaDrawCallsPerFrame: round(animated.drawCallsPerFrame - staticRoute.drawCallsPerFrame),
        deltaBufferSubDataBytesPerFrame: round(
          animated.bufferSubDataBytesPerFrame - staticRoute.bufferSubDataBytesPerFrame,
        ),
        ...(deltaGltfRootTransformUploadBytesPerFrame === undefined
          ? {}
          : { deltaGltfRootTransformUploadBytesPerFrame }),
        ...(deltaGltfLocalModelUploadBytesPerFrame === undefined
          ? {}
          : { deltaGltfLocalModelUploadBytesPerFrame }),
        ...(deltaGltfInstancesDrawnPerFrame === undefined
          ? {}
          : { deltaGltfInstancesDrawnPerFrame }),
      };
    })
    .filter((comparison) => comparison !== undefined);
};

const analyzeResults = (results) => {
  const summaries = results.map(routeSummary);
  const instancing = summaries.filter((route) => route.profile?.kind === 'gltf-instancing');
  const cameraDrag = summaries.filter((route) => typeof route.cameraDragDrawP95Ms === 'number');
  return {
    slowestRoutesByP95: [...summaries]
      .sort((left, right) => right.p95Ms - left.p95Ms)
      .slice(0, 8),
    heaviestDrawRoutes: [...summaries]
      .sort((left, right) => right.drawCallsPerFrame - left.drawCallsPerFrame)
      .slice(0, 8),
    heaviestGlStateRoutes: [...summaries]
      .sort((left, right) => right.stateChangesPerFrame - left.stateChangesPerFrame)
      .slice(0, 8),
    heaviestUniformRoutes: [...summaries]
      .sort((left, right) => right.uniformCallsPerFrame - left.uniformCallsPerFrame)
      .slice(0, 8),
    instancing: {
      comparisons: instancingComparisons(summaries),
      highestP95: [...instancing]
        .sort((left, right) => right.p95Ms - left.p95Ms)
        .slice(0, 8),
      highestDrawCallsPer1000Instances: [...instancing]
        .sort((left, right) => right.drawCallsPer1000Instances - left.drawCallsPer1000Instances)
        .slice(0, 8),
      highestGltfRootTransformUploadBytesPerFrame: [...instancing]
        .sort((left, right) =>
          (right.gltfRootTransformUploadBytesPerFrame ?? 0) -
            (left.gltfRootTransformUploadBytesPerFrame ?? 0)
        )
        .slice(0, 8),
      highestGltfLocalModelUploadBytesPerFrame: [...instancing]
        .sort((left, right) =>
          (right.gltfLocalModelUploadBytesPerFrame ?? 0) -
            (left.gltfLocalModelUploadBytesPerFrame ?? 0)
        )
        .slice(0, 8),
      highestSetupInstancedDrawCallsPer1000Instances: [...instancing]
        .sort((left, right) =>
          right.setupInstancedDrawCallsPer1000Instances - left.setupInstancedDrawCallsPer1000Instances
        )
        .slice(0, 8),
    },
    ...(cameraDragEnabled
      ? {
        cameraDrag: {
          failures: summaries.filter((route) => route.cameraDragFailure !== undefined),
          slowestRoutesByP95: [...cameraDrag]
            .sort((left, right) => right.cameraDragDrawP95Ms - left.cameraDragDrawP95Ms)
            .slice(0, 8),
        },
      }
      : {}),
    xrFrameFailures: summaries.filter((route) => route.xrFrameFailure !== undefined),
  };
};

const main = async () => {
  const profileDir = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), 'royal-examples-bench-'))
  );
  const preview = managePreview
    ? spawnLogged('pnpm', [
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
    ], { cwd: appRoot })
    : undefined;
  const browserArgs = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    ...(fakeXrEnabled ? [`--unsafely-treat-insecure-origin-as-secure=${baseUrl}`] : []),
    'about:blank',
  ];
  const browser = browserMode === 'chromium'
    ? spawnLogged('chromium', browserArgs, { cwd: appRoot })
    : undefined;

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
      const instancedDrawCallsPerFrame = result.gl.instancedDrawCalls / frameSampleCount;
      const stateChangesPerFrame = result.gl.stateChanges / frameSampleCount;
      const uniformCallsPerFrame = result.gl.uniformCalls / frameSampleCount;
      const cameraDragFrameStats = result.cameraDrag?.frameStats;
      const frameFailure = result.frameStats.failed === true
        ? result.frameStats.reason
        : result.frameStats.timedOut === true
          ? 'partial-timeout'
          : undefined;
      const cameraDragSampleCount = cameraDragFrameStats?.sampleCount ?? 0;
      const cameraDragDrawCallsPerFrame = cameraDragSampleCount <= 0 || result.cameraDrag === undefined
        ? undefined
        : result.cameraDrag.gl.drawCalls / cameraDragSampleCount;
      const cameraDragFailure = cameraDragFrameStats?.failed === true
        ? cameraDragFrameStats.reason
        : cameraDragFrameStats?.timedOut === true
          ? 'partial-timeout'
          : undefined;
      const hasCameraDragStats =
        typeof cameraDragFrameStats?.p95Ms === 'number' &&
        typeof cameraDragDrawCallsPerFrame === 'number';
      const xrP95 = result.xr?.frameStats?.p95Ms;
      const xrFrameFailure = result.xr?.frameStats?.failed === true ? result.xr.frameStats.reason : undefined;
      const profile = result.profile?.kind === 'gltf-instancing'
        ? `grid=${result.profile.grid} seed=${result.profile.seed} animate=${result.profile.animate ? 1 : 0}`
        : undefined;
      const gltfInstancing = result.profile?.kind === 'gltf-instancing'
        ? result.renderer?.gltfInstancing
        : undefined;
      const gltfRootTransformUploadKibPerFrame = gltfInstancing?.perFrame === undefined
        ? undefined
        : gltfInstancingRootTransformUploadBytes(gltfInstancing.perFrame) / 1024;
      console.log([
        route.id.padEnd(28),
        ...(profile === undefined ? [] : [profile]),
        `load=${(result.performance.navigation?.duration ?? 0).toFixed(1)}ms`,
        `ready=${result.wallNavigationAndReadyMs.toFixed(1)}ms`,
        `res=${resourcesKb.toFixed(1)}KiB`,
        `p95=${result.frameStats.p95Ms.toFixed(1)}ms`,
        ...(frameFailure === undefined ? [] : [`frames=${frameFailure}`]),
        ...(hasCameraDragStats
          ? [
            `dragDrawP95=${cameraDragFrameStats.p95Ms.toFixed(1)}ms`,
            ...(typeof cameraDragFrameStats.raf?.p95Ms === 'number'
              ? [`dragRafP95=${cameraDragFrameStats.raf.p95Ms.toFixed(1)}ms`]
              : []),
            ...(typeof cameraDragFrameStats.samplesMissing === 'number' && cameraDragFrameStats.samplesMissing > 0
              ? [`dragMiss=${cameraDragFrameStats.samplesMissing}`]
              : []),
            `dragDraw/frame=${cameraDragDrawCallsPerFrame.toFixed(1)}`,
          ]
          : []),
        ...(cameraDragFailure === undefined ? [] : [`drag=${cameraDragFailure}`]),
        ...(typeof xrP95 === 'number' ? [`xrP95=${xrP95.toFixed(1)}ms`] : []),
        ...(xrFrameFailure === undefined ? [] : [`xrFrames=${xrFrameFailure}`]),
        ...(result.fakeXrActivationFailure === undefined ? [] : [`xrPrepare=${result.fakeXrActivationFailure.reason}`]),
        `draw/frame=${drawCallsPerFrame.toFixed(1)}`,
        `state/frame=${stateChangesPerFrame.toFixed(1)}`,
        `uniform/frame=${uniformCallsPerFrame.toFixed(1)}`,
        ...(instancedDrawCallsPerFrame === 0 ? [] : [`inst/frame=${instancedDrawCallsPerFrame.toFixed(1)}`]),
        ...(typeof result.gl.setup?.instancedDrawCalls === 'number' && result.gl.setup.instancedDrawCalls > 0
          ? [`setupInst=${result.gl.setup.instancedDrawCalls}`]
          : []),
        ...(gltfInstancing?.available === false ? ['gltfDiag=missing'] : []),
        ...(gltfInstancing?.available === true
          ? [
            `gltfFrames=${gltfInstancing.rendererFrames}`,
            `gltfInstances/frame=${gltfInstancing.perFrame.instancesDrawn.toFixed(1)}`,
            `gltfRootKiB/frame=${(gltfRootTransformUploadKibPerFrame ?? 0).toFixed(1)}`,
          ]
          : []),
        `heap=${retainedKb.toFixed(1)}KiB`,
      ].join(' '));
    }

    const analysis = analyzeResults(results);

    const report = {
      generatedAt: new Date().toISOString(),
      options: {
        frameSampleCount,
        frameWarmupCount,
        frameSampleTimeoutMs,
        baseUrl,
        browserMode,
        cameraDragEnabled,
        ...(cameraDragEnabled
          ? {
            cameraDragFrameCount,
            cameraDragStepPixels,
          }
          : {}),
        clearCachePerRoute,
        debugHost,
        debugPort,
        fakeXrEnabled,
        fakeXrHz,
        fakeXrPrepareTimeoutMs,
        fakeXrSampleTimeoutMs,
        fakeXrViews,
        benchmarkMode,
        instancingFuzzEnabled,
        instancingFuzzCases,
        instancingSeed,
        instancingSweepMode,
        managePreview,
      },
      analysis,
      deployment: size,
      routes: results,
    };

    console.log(JSON.stringify({
      deploymentBytes: report.deployment.totalBytes,
      deploymentGzipBytes: report.deployment.gzipBytes,
      routeCount: report.routes.length,
      slowestRoutesByP95: analysis.slowestRoutesByP95.slice(0, 5),
      heaviestGlStateRoutes: analysis.heaviestGlStateRoutes.slice(0, 5),
      heaviestUniformRoutes: analysis.heaviestUniformRoutes.slice(0, 5),
      ...(cameraDragEnabled
        ? {
          cameraDragFailures: analysis.cameraDrag.failures,
          cameraDragSlowestRoutesByP95: analysis.cameraDrag.slowestRoutesByP95.slice(0, 5),
        }
        : {}),
      instancingComparisons: analysis.instancing.comparisons,
      instancingHighestDrawCallsPer1000Instances: analysis.instancing.highestDrawCallsPer1000Instances.slice(0, 5),
      instancingHighestGltfRootTransformUploadBytesPerFrame:
        analysis.instancing.highestGltfRootTransformUploadBytesPerFrame.slice(0, 5),
      instancingHighestGltfLocalModelUploadBytesPerFrame:
        analysis.instancing.highestGltfLocalModelUploadBytesPerFrame.slice(0, 5),
      instancingHighestSetupInstancedDrawCallsPer1000Instances:
        analysis.instancing.highestSetupInstancedDrawCallsPer1000Instances.slice(0, 5),
      xrFrameFailures: analysis.xrFrameFailures,
    }, null, 2));

    if (outputPath !== '') {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`wrote ${outputPath}`);
    }
  } finally {
    session?.close();
    if (browser !== undefined) await stop(browser);
    if (preview !== undefined) await stop(preview);
    await rm(profileDir, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }
};

await main();
