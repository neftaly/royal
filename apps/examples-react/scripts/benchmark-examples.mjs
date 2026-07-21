import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { createGzip } from 'node:zlib';

import {
  captureBrowserDiagnostics,
  connectCdpPage,
  evaluate,
  spawnLogged,
  startPerformanceTrace,
  startVitePreview,
  stopProcess,
  waitForPreviewBuild,
} from './browser-harness.mjs';
import {
  exampleContract,
  rendererSnapshotExpression,
} from './example-contract.mjs';
import {
  mergeBenchmarkRouteSearch,
  selectBenchmarkRouteFilter,
} from './benchmark-route-selection.mjs';
import { summarizeCpuProfile } from './cpu-profile-summary.mjs';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(appRoot, '../..');
const reportSchema = 'royal-renderer-benchmark';
const reportSchemaVersion = 1;
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_BENCH_PORT ?? 4673);
const debugPort = Number(process.env.EXAMPLES_BENCH_DEBUG_PORT ?? 4674);
const debugHost = process.env.EXAMPLES_BENCH_DEBUG_HOST?.trim() || host;
const baseUrl = process.env.EXAMPLES_BENCH_BASE_URL?.trim() || `http://${host}:${previewPort}`;
const browserMode = process.env.EXAMPLES_BENCH_BROWSER?.trim() || 'chromium';
const gpuMode = process.env.EXAMPLES_BENCH_GPU?.trim() || 'hardware-headless';
const benchmarkMode = process.env.EXAMPLES_BENCH_MODE?.trim() || 'quick';
const routeFilter = process.env.EXAMPLES_BENCH_ROUTE?.trim() ?? '';
const routeSearch = process.env.EXAMPLES_BENCH_ROUTE_SEARCH?.trim() ?? '';
const invocationRoot = path.resolve(process.env.INIT_CWD?.trim() || process.cwd());
const resolveInvocationPath = (value) => value === '' ? '' : path.resolve(invocationRoot, value);
const outputPath = resolveInvocationPath(process.env.EXAMPLES_BENCH_OUTPUT?.trim() ?? '');
const screenshotOutputPath = resolveInvocationPath(
  process.env.EXAMPLES_BENCH_SCREENSHOT?.trim() ?? '',
);
const traceEnabled = process.env.EXAMPLES_BENCH_TRACE === '1';
const replaceJsonSuffix = (filePath, suffix) => filePath.endsWith('.json')
  ? `${filePath.slice(0, -5)}${suffix}.json`
  : `${filePath}${suffix}.json`;
const artifactBasePath = outputPath === ''
  ? path.join(tmpdir(), `royal-examples-benchmark-${Date.now()}.json`)
  : outputPath;
const failureOutputPath = replaceJsonSuffix(artifactBasePath, '.failure');
const configuredTraceOutputPath = process.env.EXAMPLES_BENCH_TRACE_OUTPUT?.trim() ?? '';
const traceOutputPath = configuredTraceOutputPath === ''
  ? replaceJsonSuffix(artifactBasePath, '.trace')
  : resolveInvocationPath(configuredTraceOutputPath);
const cpuProfileOption = process.env.EXAMPLES_BENCH_CPU_PROFILE?.trim() ?? '';
const cpuProfileEnabled = cpuProfileOption !== '' && cpuProfileOption !== '0';
const cpuProfileOutputPath = cpuProfileOption === '1'
  ? artifactBasePath.endsWith('.json')
    ? `${artifactBasePath.slice(0, -5)}.cpuprofile`
    : `${artifactBasePath}.cpuprofile`
  : resolveInvocationPath(cpuProfileOption);
const virtualTextureCloseScreenshotPath = artifactBasePath.endsWith('.json')
  ? `${artifactBasePath.slice(0, -5)}.vt-close.png`
  : `${artifactBasePath}.vt-close.png`;
const gltfLabManifest = JSON.parse(readFileSync(
  new URL('../src/examples/gltf-lab-manifest.json', import.meta.url),
  'utf8',
));
const runnableGltfLabCases = gltfLabManifest.cases.filter((entry) =>
  entry.status === 'supported-oracle'
    || entry.status === 'core-fallback-oracle'
    || entry.status === 'normalized-ingestion'
);
const gltfExampleIds = new Set(exampleContract.benchmark.gltfExampleIds);
const gltfLabRoute = (entry) => ({
  expectsGltf: true,
  id: `gltf-lab-${entry.name}`,
  path: `/gltf-lab?case=${encodeURIComponent(entry.name)}`,
});

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
const virtualTextureCloseEnabled = process.env.EXAMPLES_BENCH_VT_CLOSE === '1';
const virtualTextureCloseTarget = (() => {
  const raw = process.env.EXAMPLES_BENCH_VT_CLOSE_DISTANCE;
  if (raw === undefined || raw === '') return 0.12;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `EXAMPLES_BENCH_VT_CLOSE_DISTANCE must be a positive finite number, received ${JSON.stringify(raw)}`,
    );
  }
  return value;
})();
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
const realXrEnabled = process.env.EXAMPLES_BENCH_REAL_XR === '1';
const fakeXrHz = envInteger('EXAMPLES_BENCH_XR_HZ', 72);
const fakeXrPrepareTimeoutMs = envInteger(
  'EXAMPLES_BENCH_XR_PREPARE_TIMEOUT_MS',
  realXrEnabled ? 20_000 : 5_000,
);
const fakeXrSampleTimeoutMs = envInteger('EXAMPLES_BENCH_XR_SAMPLE_TIMEOUT_MS', 10_000);
const fakeXrViews = envInteger('EXAMPLES_BENCH_XR_VIEWS', 2);
const gpuTimersEnabled = process.env.EXAMPLES_BENCH_GPU_TIMERS !== '0';
const glCounterOption = process.env.EXAMPLES_BENCH_GL_COUNTERS?.trim() ?? '';
if (glCounterOption !== '' && glCounterOption !== '0' && glCounterOption !== '1') {
  throw new Error('EXAMPLES_BENCH_GL_COUNTERS must be "0" or "1" when set');
}
// Generic WebGL call interception perturbs CPU profiles and allocation traces.
// Profiles retain only draw observation unless full counters are explicitly requested.
const glCountersEnabled = glCounterOption === '' ? !cpuProfileEnabled : glCounterOption === '1';
const heapGcEnabled = !cpuProfileEnabled;
const gpuDrawProfileEnabled = process.env.EXAMPLES_BENCH_GPU_DRAW_PROFILE === '1';
const gpuDrawProfileFrameIndex = envInteger('EXAMPLES_BENCH_GPU_DRAW_PROFILE_FRAME', 1) - 1;
const resourceTimingBufferSize = envInteger('EXAMPLES_BENCH_RESOURCE_TIMINGS', 10_000);

if (fakeXrEnabled && realXrEnabled) {
  throw new Error('EXAMPLES_BENCH_FAKE_XR and EXAMPLES_BENCH_REAL_XR cannot both be enabled');
}

if (!new Set(['chromium', 'cdp']).has(browserMode)) {
  throw new Error(`EXAMPLES_BENCH_BROWSER must be "chromium" or "cdp", received ${JSON.stringify(browserMode)}`);
}

if (!new Set(['hardware-headed', 'hardware-headless', 'software-headless']).has(gpuMode)) {
  throw new Error(
    `EXAMPLES_BENCH_GPU must be "hardware-headed", "hardware-headless", or "software-headless", received ${JSON.stringify(gpuMode)}`,
  );
}

if (!new Set(['0', 'quick', 'default', 'full']).has(instancingSweepMode)) {
  throw new Error(
    `EXAMPLES_BENCH_INSTANCING_SWEEP must be "0", "quick", "default", or "full", received ${JSON.stringify(instancingSweepMode)}`,
  );
}

const instancingRoute = ({ animate, animation = 'position', grid, id, seed, sweep }) => ({
  expectsGltf: true,
  id,
  path: `/gltf-instancing?animate=${animate ? 1 : 0}&animation=${animation}&grid=${grid}&redraw=${animate ? 0 : 1}&seed=${seed}`,
  profile: {
    animation: animate ? animation : 'none',
    animate,
    grid,
    instanceCount: grid ** 3,
    kind: 'gltf-instancing',
    redraw: !animate,
    seed,
    sweep,
  },
});

const defaultInstancingRoute = () => ({
  expectsGltf: true,
  id: 'gltf-instancing',
  path: '/gltf-instancing',
  profile: {
    animation: 'position',
    animate: true,
    grid: defaultInstancingGrid,
    instanceCount: defaultInstancingGrid ** 3,
    kind: 'gltf-instancing',
    seed: 0,
    sweep: 'baseline',
  },
});

const routes = exampleContract.examples.flatMap(({ id, path }) => {
  if (id === 'gltf-instancing') {
    return [
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
    ];
  }
  if (id === 'gltf-lab') {
    return [gltfLabRoute(runnableGltfLabCases.find((entry) => entry.name === 'Box'))];
  }
  return [{
    expectsGltf: gltfExampleIds.has(id),
    id,
    path,
    // Keep the long Sponza camera sample inside the authored bounds. Its
    // narrow cross-axis makes the generic seven-pixel orbit leave the model.
    ...(id === 'gltf-scenes' ? { cameraDragStepPixels: 1 } : {}),
  }];
});

const optInRoutes = [
  { expectsGltf: true, id: 'gltf-scenes-beautiful-game', path: '/gltf-scenes?scene=a-beautiful-game' },
  { expectsGltf: true, id: 'gltf-scenes-virtual-city', path: '/gltf-scenes?scene=virtual-city' },
  { id: 'forward-plus-8', path: '/standard-lighting?lights=8' },
  { id: 'forward-plus-100', path: '/standard-lighting?lights=100' },
  { id: 'forward-plus-1000', path: '/standard-lighting?lights=1000' },
  instancingRoute({
    animate: true,
    animation: 'rotation',
    grid: 16,
    id: 'gltf-instancing-rotation',
    seed: 0,
    sweep: 'profile',
  }),
  instancingRoute({
    animate: true,
    animation: 'pose',
    grid: 16,
    id: 'gltf-instancing-pose',
    seed: 0,
    sweep: 'profile',
  }),
];

const gltfLabSweepRoutes = () =>
  benchmarkMode === 'full' || benchmarkMode === 'labs' || benchmarkMode === 'all'
    ? runnableGltfLabCases
      .filter((entry) => entry.name !== 'Box')
      .map(gltfLabRoute)
    : [];

const routeMatchesBenchmarkMode = (route) => {
  if (benchmarkMode === 'all') return true;
  if (benchmarkMode === 'labs') return route.id === 'webxr-vr' || route.id.startsWith('gltf-lab-');
  if (benchmarkMode === 'full') return route.id !== 'webxr-vr';

  return route.id !== 'webxr-vr';
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
  const labRoutes = gltfLabSweepRoutes();
  const benchmarkRoutes = routes.filter(routeMatchesBenchmarkMode);
  const allRoutes = [
    ...routes,
    ...optInRoutes,
    ...labRoutes,
    ...sweepRoutes,
    ...fuzzRoutes,
  ];
  const selected = routeFilter === ''
    ? [
        ...benchmarkRoutes,
        ...labRoutes,
        ...sweepRoutes,
        ...fuzzRoutes,
      ]
    : selectBenchmarkRouteFilter(allRoutes, routeFilter);
  if (selected.length === 0) throw new Error(`Examples benchmark route filter did not match: ${routeFilter}`);
  if (routeSearch === '') return selected;
  return selected.map((route) => ({
    ...route,
    path: mergeBenchmarkRouteSearch(route.path, routeSearch),
  }));
};

const connectPage = () => connectCdpPage({
  closeExtraPages: browserMode === 'cdp',
  commandTimeoutMs: cdpCommandTimeoutMs,
  debugHost,
  debugPort,
  rewriteWebSocketAuthority: true,
});

const gitOutput = (args) => {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status ?? 'unknown'}`;
    throw new Error(`Unable to capture benchmark repository state: git ${args.join(' ')}: ${detail}`);
  }
  return result.stdout.trim();
};

const readSourceEnvironment = () => ({
  architecture: process.arch,
  dirty: gitOutput(['status', '--porcelain', '--untracked-files=normal']) !== '',
  node: process.version,
  platform: process.platform,
  revision: gitOutput(['rev-parse', 'HEAD']),
});

const readBrowserEnvironment = (session) => evaluate(session, `
(() => ({
  deviceMemoryGiB: Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null,
  hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : null,
  language: navigator.language || null,
  platform: navigator.userAgentData?.platform || navigator.platform || null,
  screen: {
    colorDepth: Number.isFinite(screen.colorDepth) ? screen.colorDepth : null,
    height: Number.isFinite(screen.height) ? screen.height : null,
    width: Number.isFinite(screen.width) ? screen.width : null,
  },
  userAgent: navigator.userAgent,
}))()
`);

const readRouteDisplay = (session) => evaluate(session, `
(() => {
  const canvas = document.querySelector('canvas');
  const rectangle = canvas?.getBoundingClientRect();
  return {
    canvas: canvas === null ? null : {
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      cssHeight: rectangle?.height ?? 0,
      cssWidth: rectangle?.width ?? 0,
    },
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      height: window.innerHeight,
      width: window.innerWidth,
    },
  };
})()
`);

const mergeBrowserDiagnostics = (left, right) => ({
  reset: () => {
    left.reset();
    right.reset();
  },
  snapshot: () => {
    const leftSnapshot = left.snapshot();
    const rightSnapshot = right.snapshot();
    return {
      droppedEntries: leftSnapshot.droppedEntries + rightSnapshot.droppedEntries,
      entries: [...leftSnapshot.entries, ...rightSnapshot.entries],
    };
  },
});

const readWebGlGpu = async (session) => evaluate(session, `
(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (gl === null) return null;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    extensions: gl.getSupportedExtensions()?.slice().sort() ?? [],
    renderer: debug === null ? null : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
    vendor: debug === null ? null : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
    version: String(gl.getParameter(gl.VERSION)),
  };
})()
`);

const assertRequestedGpu = (gpu, requireHardware) => {
  if (gpu === null) throw new Error('Examples benchmark could not create a WebGL2 context');
  if (requireHardware && gpu.renderer === null) {
    throw new Error('Hardware GPU benchmark requires WEBGL_debug_renderer_info');
  }
  if (
    requireHardware
    && /SwiftShader|Subzero|llvmpipe|lavapipe|software/iu.test(gpu.renderer)
  ) {
    throw new Error(`Hardware GPU benchmark resolved to software rendering: ${gpu.renderer}`);
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
  drawCalls: (gl.drawArrays ?? 0) + (gl.drawElements ?? 0) + (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0) + (gl.multiDrawElements ?? 0),
  instancedDrawCalls: (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0),
  submissionCalls: (gl.drawArrays ?? 0) + (gl.drawElements ?? 0) + (gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0) + (gl.multiDrawCalls ?? 0),
  stateChanges:
    (gl.bindBuffer ?? 0) +
    (gl.bindTexture ?? 0) +
    (gl.bindVertexArray ?? 0) +
    (gl.useProgram ?? 0),
});

const gltfInstancingCounterKeys = exampleContract.benchmark.gltfInstancingCounterFields;
const emptyGltfInstancingCounters = Object.freeze(Object.fromEntries(
  gltfInstancingCounterKeys.map((key) => [key, 0]),
));

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

const finiteNumberRecord = (value) => value === null || typeof value !== 'object'
  ? {}
  : Object.fromEntries(Object.entries(value).filter(([, counter]) =>
      typeof counter === 'number' && Number.isFinite(counter)
    ));

const rendererRecordMetrics = (after, before, field) => {
  const afterCounters = finiteNumberRecord(after?.[field]);
  const beforeCounters = finiteNumberRecord(before?.[field]);
  const keys = [...new Set([...Object.keys(beforeCounters), ...Object.keys(afterCounters)])].sort();
  return {
    after: afterCounters,
    available: after?.[field] != null || before?.[field] != null,
    before: beforeCounters,
    delta: Object.fromEntries(keys.map((key) => [
      key,
      (afterCounters[key] ?? 0) - (beforeCounters[key] ?? 0),
    ])),
  };
};

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
    gpuDrawProfileEnabled,
    gpuDrawProfileFrameIndex,
    gpuTimersEnabled,
    glCountersEnabled,
    resourceTimingBufferSize,
  });
  await session.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
(() => {
  const config = ${hookConfig};
  performance.setResourceTimingBufferSize(config.resourceTimingBufferSize);
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
    compileShader: 0,
    compressedTexSubImage2D: 0,
    copyTexImage2D: 0,
    copyTexSubImage2D: 0,
    copyTexSubImage2DPixels: 0,
    generateMipmap: 0,
    linkProgram: 0,
    multiDrawCalls: 0,
    multiDrawElements: 0,
    drawArrays: 0,
    drawArraysInstanced: 0,
    drawElements: 0,
    drawElementsInstanced: 0,
    texImage2D: 0,
    texStorage2D: 0,
    texSubImage2D: 0,
    uniformCalls: 0,
    uniformMatrixCalls: 0,
    useProgram: 0,
  };
  const gpuWorkCounterNames = [
    'bufferDataBytes',
    'bufferDataCalls',
    'bufferSubDataBytes',
    'bufferSubDataCalls',
    'compileShader',
    'compressedTexSubImage2D',
    'generateMipmap',
    'linkProgram',
    'texImage2D',
    'texStorage2D',
    'texSubImage2D',
  ];
  const gpuWorkSnapshot = () => Object.fromEntries(
    gpuWorkCounterNames.map((name) => [name, counters[name]]),
  );
  const gpuWorkDelta = (before) => Object.fromEntries(gpuWorkCounterNames.flatMap((name) => {
    const value = counters[name] - before[name];
    return value === 0 ? [] : [[name, value]];
  }));
  const xr = {
    activeSession: null,
    callbackDurations: [],
    frameTimes: [],
    hz: config.fakeXrHz,
    sessions: 0,
    waiters: [],
  };
  const gpuTimers = {
    attempted: false,
    contexts: new WeakMap(),
    disjointSamples: 0,
    durations: [],
    errors: 0,
    frameWork: [],
    generation: 0,
    supported: false,
    windowEnabled: false,
  };
  const gpuDrawProfile = {
    active: false,
    attempted: false,
    records: [],
  };
  const glObjectIds = new WeakMap();
  const glProgramLabels = new WeakMap();
  const glProgramShaders = new WeakMap();
  const glShaderSources = new WeakMap();
  let nextGlObjectId = 1;
  const drawState = { program: null, vertexArray: null };
  let drawSequence = 0;
  const glObjectId = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return 0;
    let id = glObjectIds.get(value);
    if (id !== undefined) return id;
    id = nextGlObjectId;
    nextGlObjectId += 1;
    glObjectIds.set(value, id);
    return id;
  };
  const labelProgram = (program) => {
    const sources = glProgramShaders.get(program)?.map((shader) => glShaderSources.get(shader) ?? '').join('\\n') ?? '';
    const defines = (name) => sources.includes('#define ' + name + '\\n');
    const kind = sources.includes('uniform vec4 cameraWorldPosition')
      ? 'surface'
      : sources.includes('uniform vec4 linearColor')
        ? 'unlit'
        : sources.includes('uniform sampler2D sceneColor')
          ? 'presentation'
          : sources.includes('uniform mat4 viewProjection')
            && sources.includes('uniform mat4 model')
            ? 'depth'
            : 'unknown';
    const instanced = defines('INSTANCED') ? '-instanced' : '';
    const features = [
      ['BASE_COLOR_TEXTURED', 'baseColor'],
      ['VIRTUAL_BASE_COLOR_TEXTURED', 'virtualBaseColor'],
      ['METALLIC_ROUGHNESS_TEXTURED', 'metallicRoughness'],
      ['NORMAL_TEXTURED', 'normal'],
      ['EMISSIVE_TEXTURED', 'emissive'],
      ['OCCLUSION_TEXTURED', 'occlusion'],
      ['SPECULAR_TEXTURED', 'specular'],
      ['SPECULAR_COLOR_TEXTURED', 'specularColor'],
      ['TRANSMISSION_MATERIAL', 'transmission'],
      ['VOLUME_MATERIAL', 'volume'],
      ['TRANSMISSION_TEXTURED', 'transmissionMap'],
      ['THICKNESS_TEXTURED', 'thickness'],
      ['STUDIO_ENVIRONMENT', 'studioEnvironment'],
      ['PREFILTERED_ENVIRONMENT', 'prefilteredEnvironment'],
      ['DIRECTIONAL_LIGHTS', 'directionalLights'],
      ['PUNCTUAL_LIGHTS', 'punctualLights'],
      ['ALPHA_BLEND', 'alphaBlend'],
      ['ALPHA_MASK', 'alphaMask'],
    ].filter(([define]) => defines(define)).map(([, feature]) => feature).sort();
    glProgramLabels.set(program, kind + instanced + (features.length === 0 ? '' : ':' + features.join(',')));
  };
  let lastDrawGl;
  const pendingDrawPulses = [];
  const pendingXrPulses = [];
  let windowDrawCallbackDurations = [];
  let windowFrameSample = null;
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
    averageMs: 0,
    failed: true,
    jitterP95MinusP50Ms: 0,
    maxMs: 0,
    minMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    reason,
    requestedSampleCount: 0,
    sampleCount: 0,
    samplesMissing: 0,
    timedOut: false,
    timeoutMs: 0,
    ...details,
  });
  const gpuTimerState = (gl) => {
    if (!config.gpuTimersEnabled || !(gl instanceof WebGL2RenderingContext)) return undefined;
    if (gpuTimers.contexts.has(gl)) return gpuTimers.contexts.get(gl) ?? undefined;
    gpuTimers.attempted = true;
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (extension === null) {
      gpuTimers.contexts.set(gl, null);
      return undefined;
    }
    gpuTimers.supported = true;
    const state = { extension, freeQueries: [], gl, pending: [] };
    gpuTimers.contexts.set(gl, state);
    return state;
  };
  const pollGpuTimers = (state) => {
    if (state === undefined || state.pending.length === 0) return;
    const disjoint = state.gl.getParameter(state.extension.GPU_DISJOINT_EXT) === true;
    if (disjoint) {
      for (const sample of state.pending) sample.disjoint = true;
    }
    let completed = 0;
    for (; completed < state.pending.length; completed += 1) {
      const sample = state.pending[completed];
      if (!state.gl.getQueryParameter(sample.query, state.gl.QUERY_RESULT_AVAILABLE)) break;
      if (sample.disjoint === true) gpuTimers.disjointSamples += 1;
      else if (sample.generation === gpuTimers.generation) {
        const nanoseconds = Number(state.gl.getQueryParameter(sample.query, state.gl.QUERY_RESULT));
        if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
          const durationMs = nanoseconds / 1_000_000;
          if (sample.drawRecord !== undefined) sample.drawRecord.durationMs = durationMs;
          else if (sample.record !== false) {
            gpuTimers.durations.push(durationMs);
            gpuTimers.frameWork.push(sample.frameWork ?? {});
          }
        }
      }
      state.freeQueries.push(sample.query);
    }
    if (completed > 0) state.pending.splice(0, completed);
  };
  const xrGl = (session) => session?.renderState?.baseLayer?.context;
  const beginGpuTimerForGl = (gl) => {
    const state = gpuTimerState(gl);
    if (state === undefined) return undefined;
    pollGpuTimers(state);
    const query = state.freeQueries.pop() ?? state.gl.createQuery();
    if (query === null) return undefined;
    try {
      state.gl.beginQuery(state.extension.TIME_ELAPSED_EXT, query);
      return { generation: gpuTimers.generation, query, state };
    } catch {
      gpuTimers.errors += 1;
      state.freeQueries.push(query);
      return undefined;
    }
  };
  const beginGpuTimer = (session) => beginGpuTimerForGl(xrGl(session));
  const endGpuTimer = (sample, record = true) => {
    if (sample === undefined) return;
    try {
      sample.record = record;
      sample.state.gl.endQuery(sample.state.extension.TIME_ELAPSED_EXT);
      sample.state.pending.push(sample);
    } catch {
      gpuTimers.errors += 1;
      sample.state.freeQueries.push(sample.query);
    }
  };
  const gpuTimerStats = (gl, startIndex, requestedSampleCount) => {
    const state = gpuTimerState(gl);
    pollGpuTimers(state);
    if (!config.gpuTimersEnabled) return { enabled: false, supported: false };
    if (state === undefined) return { enabled: true, supported: false };
    const durations = gpuTimers.durations.slice(startIndex);
    return {
      ...statsFromDeltas(
        durations,
        requestedSampleCount,
        config.fakeXrSampleTimeoutMs,
      ),
      disjointSamples: gpuTimers.disjointSamples,
      enabled: true,
      errors: gpuTimers.errors,
      pendingSamples: state?.pending.length ?? 0,
      slowestSamples: durations
        .map((durationMs, index) => ({
          durationMs,
          frameNumber: index + 1,
          ...gpuTimers.frameWork[startIndex + index],
        }))
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, 12),
      supported: true,
    };
  };
  const settleGpuTimers = async (gl, generation, timeoutMs) => {
    const state = gpuTimerState(gl);
    if (state === undefined) return;
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      pollGpuTimers(state);
      if (!state.pending.some((sample) =>
        sample.generation === generation
        && (sample.record !== false || sample.drawRecord !== undefined))) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    pollGpuTimers(state);
  };
  const startWindowFrameSample = () => {
    if (windowFrameSample !== null) throw new Error('Royal benchmark window frame sample already active');
    windowFrameSample = {
      callbackStartIndex: windowDrawCallbackDurations.length,
      generation: gpuTimers.generation,
      gl: lastDrawGl,
      gpuStartIndex: gpuTimers.durations.length,
      previousGpuTimerEnabled: gpuTimers.windowEnabled,
    };
    gpuTimers.windowEnabled = true;
  };
  const stopWindowFrameSample = async (requestedSampleCount) => {
    const sample = windowFrameSample;
    if (sample === null) return null;
    windowFrameSample = null;
    gpuTimers.windowEnabled = sample.previousGpuTimerEnabled;
    await settleGpuTimers(sample.gl, sample.generation, 250);
    const renderCallbackDurationMs = statsFromDeltas(
      windowDrawCallbackDurations.slice(sample.callbackStartIndex),
      requestedSampleCount,
      ${frameSampleTimeoutMs},
    );
    return {
      gpuDurationMs: gpuTimerStats(sample.gl, sample.gpuStartIndex, requestedSampleCount),
      idle: renderCallbackDurationMs.sampleCount === 0,
      renderCallbackDurationMs,
    };
  };
  const resolveXrWaiters = () => {
    xr.waiters = xr.waiters.filter((waiter) => {
      const sample = xr.frameTimes.slice(waiter.startIndex, waiter.startIndex + waiter.frameCount);
      if (sample.length < waiter.frameCount) return true;
      waiter.resolve({
        ...statsFromTimes(sample),
        callbackDurationMs: statsFromDeltas(
          xr.callbackDurations.slice(waiter.startIndex + 1, waiter.startIndex + waiter.frameCount),
        ),
        gpuDurationMs: gpuTimerStats(
          xrGl(xr.activeSession),
          waiter.gpuStartIndex,
          waiter.frameCount - 1,
        ),
      });
      return false;
    });
  };
  const failXrWaiters = (reason, details = {}) => {
    const waiters = xr.waiters;
    xr.waiters = [];
    for (const waiter of waiters) waiter.resolve(failedFrameStats(reason, details));
  };
  const recordXrFrame = (time, callbackDuration) => {
    xr.frameTimes.push(time);
    xr.callbackDurations.push(callbackDuration);
    while (pendingXrPulses.length > 0) {
      pendingXrPulses.shift().resolve(time);
    }
    resolveXrWaiters();
  };
  const xrSessionPrototype = globalThis.XRSession?.prototype;
  const originalXrRequestAnimationFrame = xrSessionPrototype?.requestAnimationFrame;
  if (
    typeof originalXrRequestAnimationFrame === 'function' &&
    originalXrRequestAnimationFrame.__royalBenchPatched !== true
  ) {
    const wrappedXrRequestAnimationFrame = function (callback) {
      if (xr.activeSession !== this) {
        xr.activeSession = this;
        xr.sessions += 1;
        this.addEventListener('end', () => {
          if (xr.activeSession === this) xr.activeSession = null;
          failXrWaiters('session-ended');
        }, { once: true });
      }
      return originalXrRequestAnimationFrame.call(this, (time, frame) => {
        const callbackStartedAt = performance.now();
        const gpuTimer = beginGpuTimer(this);
        try {
          callback(time, frame);
        } finally {
          endGpuTimer(gpuTimer);
          recordXrFrame(time, performance.now() - callbackStartedAt);
        }
      });
    };
    Object.defineProperty(wrappedXrRequestAnimationFrame, '__royalBenchPatched', { value: true });
    xrSessionPrototype.requestAnimationFrame = wrappedXrRequestAnimationFrame;
  }
  const drawCount = () => drawSequence;
  const originalWindowRequestAnimationFrame = globalThis.requestAnimationFrame;
  if (
    typeof originalWindowRequestAnimationFrame === 'function'
    && originalWindowRequestAnimationFrame.__royalBenchPatched !== true
  ) {
    const wrappedWindowRequestAnimationFrame = (callback) =>
      originalWindowRequestAnimationFrame.call(globalThis, (time) => {
        const drawsBefore = drawCount();
        const callbackStartedAt = performance.now();
        const gpuTimer = gpuTimers.windowEnabled && !gpuDrawProfile.active
          ? beginGpuTimerForGl(lastDrawGl)
          : undefined;
        const gpuWorkBefore = gpuTimer === undefined ? undefined : gpuWorkSnapshot();
        try {
          callback(time);
        } finally {
          const drew = drawCount() > drawsBefore;
          if (drew) windowDrawCallbackDurations.push(performance.now() - callbackStartedAt);
          if (gpuTimer !== undefined && gpuWorkBefore !== undefined) {
            gpuTimer.frameWork = gpuWorkDelta(gpuWorkBefore);
          }
          endGpuTimer(gpuTimer, drew);
        }
      });
    Object.defineProperty(wrappedWindowRequestAnimationFrame, '__royalBenchPatched', { value: true });
    globalThis.requestAnimationFrame = wrappedWindowRequestAnimationFrame;
  }
  const recordDraw = (gl) => {
    drawSequence += 1;
    lastDrawGl = gl;
    if (pendingDrawPulses.length === 0) return;
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
      const after = handler(args, this);
      try {
        return original.apply(this, args);
      } finally {
        if (typeof after === 'function') after();
      }
    };
    Object.defineProperty(wrapped, '__royalBenchPatched', { value: true });
    prototype[name] = wrapped;
  };
  const profileGpuCommand = (
    kind,
    count,
    instances,
    gl,
    programLabel = glProgramLabels.get(drawState.program) ?? 'unknown',
  ) => {
    if (!gpuDrawProfile.active) return undefined;
    gpuDrawProfile.attempted = true;
    const timer = beginGpuTimerForGl(gl);
    if (timer === undefined) return undefined;
    const record = {
      count: Math.max(0, Number(count) || 0),
      durationMs: null,
      instances: Math.max(0, Number(instances) || 0),
      kind,
      ordinal: gpuDrawProfile.records.length,
      programId: glObjectId(drawState.program),
      programLabel,
      vertexArrayId: glObjectId(drawState.vertexArray),
    };
    gpuDrawProfile.records.push(record);
    timer.drawRecord = record;
    return () => endGpuTimer(timer, false);
  };
  const profileDraw = (kind, count, instances, gl) =>
    profileGpuCommand(kind, count, instances, gl);
  const profileTransfer = (kind, gl) =>
    profileGpuCommand(kind, 0, 0, gl, 'gpu-command:' + kind);
  const multiDrawElementCount = (counts, offset, drawCount) => {
    let total = 0;
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const end = start + Math.max(0, Math.floor(Number(drawCount) || 0));
    for (let index = start; index < end; index += 1) {
      total += Math.max(0, Number(counts?.[index]) || 0);
    }
    return total;
  };
  const patchDrawCalls = (prototype) => {
    const patchDirect = (name, create) => {
      const original = prototype?.[name];
      if (typeof original !== 'function' || original.__royalBenchPatched === true) return;
      const wrapped = create(original);
      Object.defineProperty(wrapped, '__royalBenchPatched', { value: true });
      prototype[name] = wrapped;
    };
    patchDirect('drawArrays', (original) => function (mode, first, count) {
      counters.drawArrays += 1;
      recordDraw(this);
      const after = profileDraw('drawArrays', count, 1, this);
      try {
        return original.call(this, mode, first, count);
      } finally {
        after?.();
      }
    });
    patchDirect('drawElements', (original) => function (mode, count, type, offset) {
      counters.drawElements += 1;
      recordDraw(this);
      const after = profileDraw('drawElements', count, 1, this);
      try {
        return original.call(this, mode, count, type, offset);
      } finally {
        after?.();
      }
    });
    patchDirect('drawArraysInstanced', (original) => function (mode, first, count, instances) {
      counters.drawArraysInstanced += 1;
      recordDraw(this);
      const after = profileDraw('drawArraysInstanced', count, instances, this);
      try {
        return original.call(this, mode, first, count, instances);
      } finally {
        after?.();
      }
    });
    patchDirect('drawElementsInstanced', (original) => function (mode, count, type, offset, instances) {
      counters.drawElementsInstanced += 1;
      recordDraw(this);
      const after = profileDraw('drawElementsInstanced', count, instances, this);
      try {
        return original.call(this, mode, count, type, offset, instances);
      } finally {
        after?.();
      }
    });
  };
  const patchPrototype = (prototype) => {
    const originalGetExtension = prototype?.getExtension;
    if (
      typeof originalGetExtension === 'function'
      && originalGetExtension.__royalBenchPatched !== true
    ) {
      const wrappedGetExtension = function (name) {
        const extension = originalGetExtension.call(this, name);
        if (
          name === 'WEBGL_multi_draw'
          && typeof extension?.multiDrawElementsWEBGL === 'function'
          && extension.multiDrawElementsWEBGL.__royalBenchPatched !== true
        ) {
          const gl = this;
          const originalMultiDrawElements = extension.multiDrawElementsWEBGL;
          const wrappedMultiDrawElements = function (
            mode,
            counts,
            countsOffset,
            type,
            offsets,
            offsetsOffset,
            drawCount,
          ) {
            counters.multiDrawCalls += 1;
            counters.multiDrawElements += Math.max(0, Number(drawCount) || 0);
            recordDraw(gl);
            const after = profileDraw(
              'multiDrawElementsWEBGL',
              multiDrawElementCount(counts, countsOffset, drawCount),
              1,
              gl,
            );
            try {
              return originalMultiDrawElements.call(
                this,
                mode,
                counts,
                countsOffset,
                type,
                offsets,
                offsetsOffset,
                drawCount,
              );
            } finally {
              after?.();
            }
          };
          Object.defineProperty(
            wrappedMultiDrawElements,
            '__royalBenchPatched',
            { value: true },
          );
          extension.multiDrawElementsWEBGL = wrappedMultiDrawElements;
        }
        return extension;
      };
      Object.defineProperty(wrappedGetExtension, '__royalBenchPatched', { value: true });
      prototype.getExtension = wrappedGetExtension;
    }
    if (config.gpuDrawProfileEnabled) {
      patch(prototype, 'shaderSource', (args) => {
        if (args[0] !== null) glShaderSources.set(args[0], String(args[1] ?? ''));
      });
      patch(prototype, 'attachShader', (args) => {
        if (args[0] === null || args[1] === null) return;
        const shaders = glProgramShaders.get(args[0]) ?? [];
        shaders.push(args[1]);
        glProgramShaders.set(args[0], shaders);
        labelProgram(args[0]);
      });
    }
    if (config.glCountersEnabled) {
      patch(prototype, 'compileShader', () => { counters.compileShader += 1; });
      patch(prototype, 'bindBuffer', () => { counters.bindBuffer += 1; });
      patch(prototype, 'bindTexture', () => { counters.bindTexture += 1; });
    }
    if (config.glCountersEnabled || config.gpuDrawProfileEnabled) {
      patch(prototype, 'bindVertexArray', (args) => {
        if (config.glCountersEnabled) counters.bindVertexArray += 1;
        drawState.vertexArray = args[0] ?? null;
      });
    }
    patchDrawCalls(prototype);
    if (config.glCountersEnabled) {
      patch(prototype, 'bufferData', (args) => {
        counters.bufferDataCalls += 1;
        counters.bufferDataBytes += byteLengthOf(args[1]);
      });
      patch(prototype, 'bufferSubData', (args) => {
        counters.bufferSubDataCalls += 1;
        counters.bufferSubDataBytes += bufferSubDataByteLength(args);
      });
      patch(prototype, 'compressedTexSubImage2D', () => { counters.compressedTexSubImage2D += 1; });
      patch(prototype, 'linkProgram', () => { counters.linkProgram += 1; });
      patch(prototype, 'texImage2D', () => { counters.texImage2D += 1; });
      patch(prototype, 'texStorage2D', () => { counters.texStorage2D += 1; });
      patch(prototype, 'texSubImage2D', () => { counters.texSubImage2D += 1; });
      for (const name of uniformCallNames) {
        patch(prototype, name, () => {
          counters.uniformCalls += 1;
          if (name.startsWith('uniformMatrix')) counters.uniformMatrixCalls += 1;
        });
      }
    }
    if (config.glCountersEnabled || config.gpuDrawProfileEnabled) {
      patch(prototype, 'copyTexImage2D', (_args, gl) => {
        if (config.glCountersEnabled) counters.copyTexImage2D += 1;
        return profileTransfer('copyTexImage2D', gl);
      });
      patch(prototype, 'copyTexSubImage2D', (args, gl) => {
        if (config.glCountersEnabled) {
          counters.copyTexSubImage2D += 1;
          const width = Number(args[6]);
          const height = Number(args[7]);
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            counters.copyTexSubImage2DPixels += width * height;
          }
        }
        return profileTransfer('copyTexSubImage2D', gl);
      });
      patch(prototype, 'generateMipmap', (_args, gl) => {
        if (config.glCountersEnabled) counters.generateMipmap += 1;
        return profileTransfer('generateMipmap', gl);
      });
    }
    if (config.glCountersEnabled || config.gpuDrawProfileEnabled) {
      patch(prototype, 'useProgram', (args) => {
        if (config.glCountersEnabled) counters.useProgram += 1;
        drawState.program = args[0] ?? null;
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
        gpuStartIndex: gpuTimers.durations.length,
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
  let frameRecorder = null;
  const startFrameRecorder = () => {
    if (frameRecorder !== null) frameRecorder.active = false;
    const recorder = { active: true, times: [] };
    frameRecorder = recorder;
    const record = (time) => {
      if (!recorder.active) return;
      recorder.times.push(time);
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  };
  const stopFrameRecorder = () => {
    const recorder = frameRecorder;
    frameRecorder = null;
    if (recorder === null) return null;
    recorder.active = false;
    return statsFromTimes(recorder.times);
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
    const requestedStep = Number(stepPixels);
    const stepMagnitude = Math.max(1, Math.floor(Math.abs(requestedStep) || 1));
    const step = requestedStep < 0 ? -stepMagnitude : stepMagnitude;
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
    const handlerDeltas = [];
    const rafDeltas = [];
    const dispatchPointer = (type) => {
      canvas.dispatchEvent(new PointerEvent(type, eventOptions(type)));
    };
    const nextRaf = (timeoutMs) => new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), timeoutMs);
      requestAnimationFrame((time) => finish(time));
    });
    dispatchPointer('pointerdown');
    const gpuGl = lastDrawGl;
    const gpuGeneration = gpuTimers.generation;
    const gpuStartIndex = gpuTimers.durations.length;
    const callbackDurationStartIndex = windowDrawCallbackDurations.length;
    const previousWindowGpuTimerEnabled = gpuTimers.windowEnabled;
    gpuTimers.windowEnabled = true;
    gpuDrawProfile.records.length = 0;
    gpuDrawProfile.attempted = false;
    try {
      for (let index = 0; index < requestedSampleCount; index += 1) {
        gpuDrawProfile.active = config.gpuDrawProfileEnabled
          && index === config.gpuDrawProfileFrameIndex;
        clientX += step;
        const drawPromise = nextObservedDraw(250);
        const rafPromise = nextRaf(250);
        const eventAt = performance.now();
        dispatchPointer('pointermove');
        handlerDeltas.push(performance.now() - eventAt);
        const [drawAt, rafAt] = await Promise.all([drawPromise, rafPromise]);
        gpuDrawProfile.active = false;
        if (typeof drawAt === 'number') drawDeltas.push(drawAt - eventAt);
        if (typeof rafAt === 'number') rafDeltas.push(rafAt - eventAt);
      }
    } finally {
      gpuDrawProfile.active = false;
      gpuTimers.windowEnabled = previousWindowGpuTimerEnabled;
      dispatchPointer('pointerup');
    }
    await settleGpuTimers(gpuGl, gpuGeneration, 250);
    const completedGpuDraws = gpuDrawProfile.records
      .filter((record) => typeof record.durationMs === 'number')
      .sort((left, right) => right.durationMs - left.durationMs);
    const gpuProgramTotals = new Map();
    for (const record of completedGpuDraws) {
      let total = gpuProgramTotals.get(record.programLabel);
      if (total === undefined) {
        total = {
          drawCount: 0,
          durationMs: 0,
          elementCount: 0,
          programLabel: record.programLabel,
        };
        gpuProgramTotals.set(record.programLabel, total);
      }
      total.drawCount += 1;
      total.durationMs += record.durationMs;
      total.elementCount += record.count * record.instances;
    }
    const gpuPrograms = [...gpuProgramTotals.values()]
      .sort((left, right) => right.durationMs - left.durationMs);
    const sampleTimeoutMs = 250;
    const draw = statsFromDeltas(drawDeltas, requestedSampleCount, sampleTimeoutMs);
    return {
      ...draw,
      measurement: 'synthetic-camera-drag-pointermove-to-next-webgl-draw',
      note: 'Draw latency is measured at the next WebGL draw call after each synthetic drag move; RAF latency is reported separately.',
      cameraInput: {
        handlerDurationMs: statsFromDeltas(handlerDeltas, requestedSampleCount, sampleTimeoutMs),
      },
      renderCallbackDurationMs: statsFromDeltas(
        windowDrawCallbackDurations.slice(callbackDurationStartIndex),
        requestedSampleCount,
        sampleTimeoutMs,
      ),
      gpuDurationMs: gpuTimerStats(gpuGl, gpuStartIndex, requestedSampleCount),
      gpuDrawProfile: {
        attempted: gpuDrawProfile.attempted,
        completedCount: completedGpuDraws.length,
        enabled: config.gpuDrawProfileEnabled,
        frameNumber: config.gpuDrawProfileFrameIndex + 1,
        programs: gpuPrograms,
        records: completedGpuDraws,
        requestedCount: gpuDrawProfile.records.length,
      },
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
          const callbackStartedAt = performance.now();
          const gpuTimer = beginGpuTimer(this);
          try {
            callback(time, frame);
          } finally {
            endGpuTimer(gpuTimer);
            recordXrFrame(time, performance.now() - callbackStartedAt);
          }
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
      get framebufferHeight() {
        return this.context.canvas.height;
      }
      get framebufferWidth() {
        return this.context.canvas.width;
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
    async endXrSession() {
      const session = xr.activeSession;
      if (session === null) return false;
      await session.end();
      return true;
    },
    reset() {
      for (const key of Object.keys(counters)) counters[key] = 0;
      drawSequence = 0;
      windowFrameSample = null;
      xr.callbackDurations = [];
      xr.frameTimes = [];
      windowDrawCallbackDurations = [];
      gpuTimers.disjointSamples = 0;
      gpuTimers.durations = [];
      gpuTimers.errors = 0;
      gpuTimers.frameWork = [];
      gpuTimers.generation += 1;
      gpuTimers.windowEnabled = false;
    },
    sampleXrFrames,
    startFrameRecorder,
    startWindowFrameSample,
    snapshot() {
      return { ...counters };
    },
    stopFrameRecorder,
    stopWindowFrameSample,
    xrSnapshot() {
      const activeSession = xr.activeSession;
      const baseLayer = activeSession?.renderState?.baseLayer;
      const supportedFrameRates = activeSession?.supportedFrameRates === undefined
        || activeSession.supportedFrameRates === null
        ? []
        : [...activeSession.supportedFrameRates];
      return {
        active: activeSession !== null,
        canUpdateTargetFrameRate: typeof activeSession?.updateTargetFrameRate === 'function',
        framebufferHeight: baseLayer?.framebufferHeight ?? null,
        framebufferWidth: baseLayer?.framebufferWidth ?? null,
        frameRate: activeSession?.frameRate ?? null,
        frameCount: xr.frameTimes.length,
        gpuTimers: {
          attempted: gpuTimers.attempted,
          disjointSamples: gpuTimers.disjointSamples,
          errors: gpuTimers.errors,
          sampleCount: gpuTimers.durations.length,
          supported: gpuTimers.supported,
        },
        hz: activeSession?.frameRate ?? xr.hz,
        sessions: xr.sessions,
        supportedFrameRates,
        viewCount: config.fakeXrViews,
      };
    },
  };
})();
`,
  });
};

const waitForBenchmarkReady = (session, requireWindowRaf = true, requireGltfAsset = false) => evaluate(session, `
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
      const snapshot = globalThis[${JSON.stringify(exampleContract.benchmark.bridge.rendererSnapshotGlobal)}]?.() ?? null;
      const assets = snapshot?.gltfLoadDiagnostics?.assets ?? [];
      const rendererReady = snapshot !== null
        && (${requireGltfAsset ? 'assets.length > 0' : 'true'})
        && assets.every((asset) => (
        asset.status !== 'loading' && (
          asset.status === 'error'
          || asset.imagesLoaded + asset.imageFailures >= asset.imageRequests
        )
      ));
      if (rendererReady) {
        return ${requireWindowRaf ? 'await rafOrTimeout(1000) && await rafOrTimeout(1000)' : 'true'};
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
})()
`);

const collectPageMetrics = async (session, frames, options = {}) => {
  const {
    cameraDragStepPixels: routeCameraDragStepPixels = cameraDragStepPixels,
    sampleXr = true,
    xrOnly = false,
  } = options;
  const setupGl = await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}');
  const setupRenderer = await evaluate(session, rendererSnapshotExpression);
  const xrStats = (value, requestedSampleCount, reason) => value ?? {
    averageMs: 0,
    failed: true,
    jitterP95MinusP50Ms: 0,
    maxMs: 0,
    minMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    reason,
    requestedSampleCount,
    sampleCount: 0,
    samplesMissing: requestedSampleCount,
    timedOut: false,
    timeoutMs: fakeXrSampleTimeoutMs,
  };
  const xrWarmupStats = xrOnly
    ? xrStats(await evaluate(session, `
(async () => globalThis.__royalBench?.sampleXrFrames?.(${frameWarmupCount}, ${fakeXrSampleTimeoutMs}) ?? null)()
`), frameWarmupCount, 'missing-active-xr-session')
    : undefined;
  const frameWarmupComplete = xrOnly
    ? xrWarmupStats.failed !== true && xrWarmupStats.sampleCount >= frameWarmupCount
    : await evaluate(session, `
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
  // Royal only schedules work when a scene is dirty. RAF-only warmup leaves a
  // static scene cold, so camera samples would include first-render pools and
  // JIT work in both their timings and retained-heap delta. Exercise the same
  // input-to-draw path before the baseline, then reverse the gesture to leave
  // the measured view effectively unchanged.
  const cameraWarmupForwardCount = Math.ceil(frameWarmupCount / 2);
  const cameraWarmupReverseCount = Math.floor(frameWarmupCount / 2);
  const cameraWarmupComplete = !cameraDragEnabled || xrOnly
    ? true
    : await evaluate(session, `
(async () => {
  const sample = globalThis.__royalBench?.cameraDragSample;
  if (typeof sample !== 'function') return false;
  const forward = await sample(${cameraWarmupForwardCount}, ${routeCameraDragStepPixels});
  if (forward?.failed === true || (forward?.sampleCount ?? 0) < ${cameraWarmupForwardCount}) return false;
  if (${cameraWarmupReverseCount} === 0) return true;
  const reverse = await sample(${cameraWarmupReverseCount}, ${-routeCameraDragStepPixels});
  return reverse?.failed !== true && reverse?.sampleCount >= ${cameraWarmupReverseCount};
})()
`);
  const warmupComplete = frameWarmupComplete && cameraWarmupComplete;
  await evaluate(session, 'globalThis.__royalBench?.reset?.()');
  const beforeGc = await session.call('Runtime.getHeapUsage');
  if (heapGcEnabled) await session.call('HeapProfiler.collectGarbage');
  const afterGc = heapGcEnabled
    ? await session.call('Runtime.getHeapUsage')
    : beforeGc;
  const rendererBeforeFrames = await evaluate(session, `
(() => {
  ${xrOnly ? '' : 'globalThis.__royalBench?.startWindowFrameSample?.();'}
  performance.mark('royal-bench-measure-start');
  return ${rendererSnapshotExpression};
})()
`);
  const frameStats = xrOnly
    ? xrStats(await evaluate(session, `
(async () => globalThis.__royalBench?.sampleXrFrames?.(${frames}, ${fakeXrSampleTimeoutMs}) ?? null)()
`), frames, 'missing-active-xr-session')
    : await evaluate(session, `
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
      samplesMissing: frames,
      timedOut: true,
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
  // Capture the GL counters and renderer frame together. An active XR session
  // keeps presenting between DevTools requests, so separate reads produce a
  // numerator and denominator from different frame windows.
  const frameMeasurement = await evaluate(session, `
(() => ({
  mark: performance.mark('royal-bench-measure-end').startTime,
  gl: globalThis.__royalBench?.snapshot?.() ?? {},
  renderer: ${rendererSnapshotExpression},
}))()
`);
  const gl = frameMeasurement.gl;
  const rendererAfterFrames = frameMeasurement.renderer;
  const frameWork = xrOnly
    ? undefined
    : await evaluate(session, `
(async () => globalThis.__royalBench?.stopWindowFrameSample?.(${frames}) ?? null)()
`);
  const renderedFrameCount = rendererFrameDelta(rendererAfterFrames, rendererBeforeFrames);
  const cameraDrag = cameraDragEnabled
    ? await (async () => {
        const dragRendererBefore = await evaluate(session, rendererSnapshotExpression);
        await evaluate(session, 'globalThis.__royalBench?.reset?.()');
        const frameStats = await evaluate(session, `
(async () => globalThis.__royalBench?.cameraDragSample?.(
  ${cameraDragFrameCount},
  ${routeCameraDragStepPixels}
) ?? null)()
`);
        const dragGl = await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}');
        const dragRendererAfter = await evaluate(session, rendererSnapshotExpression);
        return frameStats === null
          ? undefined
          : {
              frameStats,
              gl: glCounterTotals(dragGl),
              renderer: {
                frameDelta: rendererFrameDelta(dragRendererAfter, dragRendererBefore),
                gltfInstancing: gltfInstancingSampleMetrics(
                  dragRendererAfter,
                  dragRendererBefore,
                  frameStats.sampleCount ?? cameraDragFrameCount,
                ),
                virtualTexturing: rendererRecordMetrics(
                  dragRendererAfter,
                  dragRendererBefore,
                  'virtualTexturing',
                ),
              },
            };
      })()
    : undefined;
  const xrFrameStats = xrOnly
    ? frameStats
    : sampleXr
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
  await evaluate(session, 'globalThis.__royalBench?.reset?.()');
  if (heapGcEnabled) await session.call('HeapProfiler.collectGarbage');
  const afterFinalGc = heapGcEnabled
    ? await session.call('Runtime.getHeapUsage')
    : afterFrameGc;
  return {
    frameStats,
    ...(frameWork === undefined || frameWork === null ? {} : { frameWork }),
    glFrameCount: xrOnly && renderedFrameCount > 0
      ? renderedFrameCount
      : frameStats.sampleCount ?? frames,
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
      snapshots: {
        afterFrames: rendererAfterFrames,
        beforeFrames: rendererBeforeFrames,
        setup: setupRenderer,
      },
      setup: {
        gltfInstancing: gltfInstancingSetupMetrics(setupRenderer),
      },
      virtualTexturing: rendererRecordMetrics(
        rendererAfterFrames,
        rendererBeforeFrames,
        'virtualTexturing',
      ),
    },
    heap: heapGcEnabled
      ? {
          afterFinalGc,
          afterFrameGc,
          afterGc,
          beforeGc,
          forcedGc: true,
          retainedGrowthBytes: afterFinalGc.usedSize - afterGc.usedSize,
          transientGrowthBytes: afterFrameGc.usedSize - afterGc.usedSize,
        }
      : {
          after: afterFrameGc,
          before: beforeGc,
          forcedGc: false,
          observedGrowthBytes: afterFrameGc.usedSize - beforeGc.usedSize,
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

const waitForXrActivation = (session, clicked) => evaluate(session, `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = performance.now() + ${fakeXrPrepareTimeoutMs};
  while (performance.now() < deadline) {
    const control = document.querySelector('[data-royal-xr-status]');
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent?.includes('Enter XR') || entry.textContent?.includes('Exit XR'));
    const instrumented = globalThis.__royalBench?.xrSnapshot?.().active === true;
    const status = control?.getAttribute('data-royal-xr-status');
    if (
      instrumented &&
      (control?.getAttribute('data-royal-xr-status') === 'active' || button?.textContent?.includes('Exit XR'))
    ) {
      return {
        active: true,
        clicked: ${clicked ? 'true' : 'false'},
        status: control?.getAttribute('data-royal-xr-status') ?? 'immersive',
      };
    }
    if (typeof status === 'string' && /already an active, immersive XRSession/iu.test(status)) {
      return {
        active: false,
        clicked: ${clicked ? 'true' : 'false'},
        reason: 'immersive-session-already-active',
        status,
      };
    }
    if (
      typeof status === 'string'
      && !['idle', 'ready', 'starting', 'ending', 'immersive', 'unavailable'].includes(status)
    ) {
      return {
        active: false,
        clicked: ${clicked ? 'true' : 'false'},
        reason: 'xr-status-error',
        status,
      };
    }
    await sleep(25);
  }
  const control = document.querySelector('[data-royal-xr-status]');
  return {
    active: false,
    clicked: ${clicked ? 'true' : 'false'},
    reason: 'timeout',
    status: control?.getAttribute('data-royal-xr-status') ?? document.body.innerText.slice(0, 300),
    timedOut: true,
    timeoutMs: ${fakeXrPrepareTimeoutMs},
  };
})()
`);

const prepareRouteForBenchmark = async (session, route) => {
  if ((!fakeXrEnabled && !realXrEnabled) || route.id !== 'webxr-vr') return undefined;
  try {
    if (realXrEnabled) {
      const target = await evaluate(session, `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = performance.now() + ${fakeXrPrepareTimeoutMs};
  while (performance.now() < deadline) {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent?.includes('Enter XR'));
    if (button !== undefined && !button.disabled) {
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    await sleep(25);
  }
  return null;
})()
`);
      if (target === null) {
        return { active: false, clicked: false, reason: 'enter-button-unavailable' };
      }
      await session.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: target.x,
        y: target.y,
        button: 'none',
        buttons: 0,
      });
      await session.call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: target.x,
        y: target.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await session.call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: target.x,
        y: target.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      return await waitForXrActivation(session, true);
    }
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

const prepareVirtualTextureCloseView = async (session, route) => {
  if (
    !virtualTextureCloseEnabled
    || !new Set(['gltf-ghostscript-tiger-svg', 'virtual-texture-stress']).has(route.id)
  ) return undefined;
  if (route.id === 'virtual-texture-stress') {
    await evaluate(session, `
(() => {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === 'Ground plane');
  button?.click();
})()
`);
    await sleep(100);
  }
  const initial = await evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas[data-vt-distance]');
  if (canvas === null) return null;
  canvas.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const rect = canvas.getBoundingClientRect();
  return {
    clipX: rect.left + scrollX,
    clipY: rect.top + scrollY,
    distance: Number(canvas.getAttribute('data-vt-distance')),
    height: rect.height,
    width: rect.width,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
})()
`);
  if (
    initial === null
    || !Number.isFinite(initial.distance)
    || !Number.isFinite(initial.x)
    || !Number.isFinite(initial.y)
  ) {
    throw new Error('Virtual texture close-view preparation could not resolve the map canvas and distance');
  }
  await session.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: initial.x,
    y: initial.y,
    button: 'none',
    buttons: 0,
  });
  const rendererBefore = await evaluate(session, rendererSnapshotExpression);
  const glBefore = glCounterTotals(await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}'));
  await evaluate(session, 'globalThis.__royalBench?.startFrameRecorder?.()');
  const startedAt = performance.now();
  let finalDistance = initial.distance;
  let inputMode = 'trusted-cdp';
  let wheelEvents = 0;
  const wheelDelta = route.id === 'gltf-ghostscript-tiger-svg' ? -100 : -1_000;
  const maximumWheelEvents = route.id === 'gltf-ghostscript-tiger-svg' ? 24 : 12;
  let frameStats;
  try {
    while (finalDistance > virtualTextureCloseTarget && wheelEvents < maximumWheelEvents) {
      const distanceBeforeEvent = finalDistance;
      if (inputMode === 'trusted-cdp') {
        await session.call('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: initial.x,
          y: initial.y,
          deltaX: 0,
          deltaY: wheelDelta,
        });
      } else {
        await evaluate(session, `
document.querySelector('canvas[data-vt-distance]')?.dispatchEvent(new WheelEvent('wheel', {
  bubbles: true,
  cancelable: true,
  deltaMode: WheelEvent.DOM_DELTA_PIXEL,
  deltaY: ${wheelDelta},
}))
`);
      }
      wheelEvents += 1;
      await sleep(50);
      finalDistance = await evaluate(session, `
Number(document.querySelector('canvas[data-vt-distance]')?.getAttribute('data-vt-distance'))
`);
      if (inputMode === 'trusted-cdp' && !(finalDistance < distanceBeforeEvent)) {
        inputMode = 'dom-fallback';
        await evaluate(session, `
document.querySelector('canvas[data-vt-distance]')?.dispatchEvent(new WheelEvent('wheel', {
  bubbles: true,
  cancelable: true,
  deltaMode: WheelEvent.DOM_DELTA_PIXEL,
  deltaY: ${wheelDelta},
}))
`);
        await sleep(50);
        finalDistance = await evaluate(session, `
Number(document.querySelector('canvas[data-vt-distance]')?.getAttribute('data-vt-distance'))
`);
      }
    }
    await evaluate(session, `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = performance.now() + 10_000;
  let stableSince = null;
  let resourceCount = performance.getEntriesByType('resource').length;
  while (performance.now() < deadline) {
    const snapshot = ${rendererSnapshotExpression};
    const nextResourceCount = performance.getEntriesByType('resource').length;
    const pending = snapshot?.virtualTexturing?.pendingPages ?? 0;
    const outstanding = snapshot?.virtualTexturing?.outstandingPageRequests ?? 0;
    if (pending === 0 && outstanding === 0 && nextResourceCount === resourceCount) {
      stableSince ??= performance.now();
      if (performance.now() - stableSince >= 250) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return;
      }
    } else {
      stableSince = null;
      resourceCount = nextResourceCount;
    }
    await sleep(25);
  }
  throw new Error('Virtual texture close-view resources did not settle within 10000ms');
})()
`);
  } finally {
    frameStats = await evaluate(session, 'globalThis.__royalBench?.stopFrameRecorder?.() ?? null');
  }
  if (!Number.isFinite(finalDistance) || finalDistance > virtualTextureCloseTarget + 0.01) {
    throw new Error(
      `Virtual texture close-view preparation stopped at ${finalDistance}; target was ${virtualTextureCloseTarget}`,
    );
  }
  const rendererAfter = await evaluate(session, rendererSnapshotExpression);
  const glAfter = glCounterTotals(await evaluate(session, 'globalThis.__royalBench?.snapshot?.() ?? {}'));
  const screenshot = await session.call('Page.captureScreenshot', {
    captureBeyondViewport: false,
    clip: {
      height: initial.height,
      scale: 1,
      width: initial.width,
      x: initial.clipX,
      y: initial.clipY,
    },
    format: 'png',
    fromSurface: true,
  });
  await mkdir(path.dirname(virtualTextureCloseScreenshotPath), { recursive: true });
  await writeFile(virtualTextureCloseScreenshotPath, Buffer.from(screenshot.data, 'base64'));
  const glDelta = Object.fromEntries([...new Set([
    ...Object.keys(glBefore),
    ...Object.keys(glAfter),
  ])].sort().map((key) => [key, (glAfter[key] ?? 0) - (glBefore[key] ?? 0)]));
  return {
    durationMs: performance.now() - startedAt,
    finalDistance,
    frameStats,
    gl: glDelta,
    initialDistance: initial.distance,
    inputMode,
    renderer: {
      after: rendererAfter,
      before: rendererBefore,
      virtualTexturing: rendererRecordMetrics(rendererAfter, rendererBefore, 'virtualTexturing'),
    },
    screenshot: {
      height: initial.height,
      outputPath: virtualTextureCloseScreenshotPath,
      width: initial.width,
    },
    targetDistance: virtualTextureCloseTarget,
    wheelEvents,
  };
};

const startCpuProfiler = async (session) => {
  await session.call('Profiler.enable');
  await session.call('Profiler.setSamplingInterval', { interval: 100 });
  await session.call('Profiler.start');
  let stopped = false;
  return async () => {
    if (stopped) throw new Error('Examples CPU profiler was already stopped');
    stopped = true;
    try {
      return (await session.call('Profiler.stop')).profile;
    } finally {
      await session.call('Profiler.disable').catch(() => undefined);
    }
  };
};

const benchmarkRoute = async (session, route, { onCpuProfile, onSessionChanged }) => {
  await session.call('Page.bringToFront');
  if (clearCachePerRoute) await session.call('Network.clearBrowserCache');
  const domContentLoaded = session.wait(
    'Page.lifecycleEvent',
    (event) => event.name === 'DOMContentLoaded',
    { timeoutMs: 10_000 },
  );
  const start = performance.now();
  const routeUrl = new URL(baseUrl + route.path);
  routeUrl.searchParams.set('__royalBenchRun', `${Date.now()}-${Math.random()}`);
  await session.call('Page.navigate', { url: routeUrl.href });
  await domContentLoaded;
  const navigationSynchronizationMs = performance.now() - start;
  const ready = await waitForBenchmarkReady(
    session,
    !(realXrEnabled && route.id === 'webxr-vr'),
    route.expectsGltf === true,
  );
  const display = await readRouteDisplay(session);
  // End readiness timing before route preparation, warmup, and frame sampling.
  const wallNavigationAndReadyMs = performance.now() - start;
  if (realXrEnabled && route.id === 'webxr-vr') {
    // Quest can ignore trusted Input commands on the CDP attachment that
    // performed Page.navigate. Transfer sole debugger ownership after load so
    // activation and measurement share one fresh attachment.
    const closed = new Promise((resolve) => {
      session.socket.addEventListener('close', resolve, { once: true });
    });
    session.close();
    await Promise.race([closed, sleep(1_000)]);
    session = await connectPage();
    const diagnostics = captureBrowserDiagnostics(session);
    await session.call('Page.enable');
    await session.call('Page.setLifecycleEventsEnabled', { enabled: true });
    await session.call('Runtime.enable');
    await session.call('Log.enable');
    await session.call('HeapProfiler.enable');
    await session.call('Network.enable');
    await session.call('Performance.enable');
    await session.call('Page.bringToFront');
    await onSessionChanged(session, diagnostics);
  }
  const stopCpuProfiler = cpuProfileEnabled ? await startCpuProfiler(session) : undefined;
  let result;
  let routeFailure;
  try {
    const prepared = await prepareRouteForBenchmark(session, route);
    const virtualTextureClose = await prepareVirtualTextureCloseView(session, route);
    if ((realXrEnabled || fakeXrEnabled) && route.id === 'webxr-vr' && prepared?.active !== true) {
      throw new Error(
        `${realXrEnabled ? 'Real' : 'Fake'} XR activation failed: ${prepared?.reason ?? prepared?.error ?? 'inactive session'}`,
      );
    }
    const measured = await collectPageMetrics(session, frameSampleCount, {
      cameraDragStepPixels: route.cameraDragStepPixels,
      sampleXr: prepared?.active !== false,
      xrOnly: (realXrEnabled || fakeXrEnabled) && prepared?.active === true,
    });
    let screenshot;
    if (screenshotOutputPath !== '') {
      const clip = await evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  if (canvas === null) return null;
  canvas.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const rect = canvas.getBoundingClientRect();
  return {
    height: rect.height,
    width: rect.width,
    x: rect.left + scrollX,
    y: rect.top + scrollY,
  };
})()
`);
      if (
        clip === null
        || !Number.isFinite(clip.width)
        || !Number.isFinite(clip.height)
        || clip.width <= 0
        || clip.height <= 0
      ) throw new Error('EXAMPLES_BENCH_SCREENSHOT could not resolve a visible canvas');
      const captured = await session.call('Page.captureScreenshot', {
        captureBeyondViewport: false,
        clip: { ...clip, scale: 1 },
        format: 'png',
        fromSurface: true,
      });
      await mkdir(path.dirname(screenshotOutputPath), { recursive: true });
      await writeFile(screenshotOutputPath, Buffer.from(captured.data, 'base64'));
      screenshot = { height: clip.height, outputPath: screenshotOutputPath, width: clip.width };
    }
    const activationFailure = prepared?.active === false
      ? {
        error: prepared.error,
        reason: prepared.reason ?? 'activation-failed',
        status: prepared.status,
        timedOut: prepared.timedOut === true,
        timeoutMs: prepared.timeoutMs,
      }
      : undefined;
    result = {
      ...route,
      ...(prepared === undefined ? {} : { prepared }),
      ...(virtualTextureClose === undefined ? {} : { virtualTextureClose }),
      ...(screenshot === undefined ? {} : { screenshot }),
      ...(activationFailure === undefined ? {} : { xrActivationFailure: activationFailure }),
      ...(activationFailure === undefined || !fakeXrEnabled
        ? {}
        : { fakeXrActivationFailure: activationFailure }),
      navigationSynchronizationMs,
      display,
      ready,
      wallNavigationAndReadyMs,
      ...measured,
    };
  } catch (error) {
    routeFailure = error;
  }
  let cpuProfileFailure;
  if (stopCpuProfiler !== undefined) {
    try {
      await onCpuProfile(await stopCpuProfiler());
    } catch (error) {
      cpuProfileFailure = error;
    }
  }
  if (realXrEnabled && route.id === 'webxr-vr') {
    await evaluate(session, `
(async () => {
  await globalThis.__royalBench?.endXrSession?.();
  return globalThis.__royalBench?.xrSnapshot?.().active ?? false;
})()
`).catch(() => false);
  }
  if (routeFailure !== undefined) throw routeFailure;
  if (cpuProfileFailure !== undefined) throw cpuProfileFailure;
  return result;
};

const round = (value, digits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const routeSummary = (route) => {
  const sampledFrameCount = route.glFrameCount > 0
    ? route.glFrameCount
    : route.frameStats.sampleCount > 0 ? route.frameStats.sampleCount : frameSampleCount;
  const drawCallsPerFrame = route.gl.drawCalls / sampledFrameCount;
  const submissionCallsPerFrame = route.gl.submissionCalls / sampledFrameCount;
  const instancedDrawCallsPerFrame = route.gl.instancedDrawCalls / sampledFrameCount;
  const bufferSubDataBytesPerFrame = route.gl.bufferSubDataBytes / sampledFrameCount;
  const stateChangesPerFrame = route.gl.stateChanges / sampledFrameCount;
  const useProgramPerFrame = route.gl.useProgram / sampledFrameCount;
  const bindBufferPerFrame = route.gl.bindBuffer / sampledFrameCount;
  const bindTexturePerFrame = route.gl.bindTexture / sampledFrameCount;
  const bindVertexArrayPerFrame = route.gl.bindVertexArray / sampledFrameCount;
  const copyTexImage2DPerFrame = route.gl.copyTexImage2D / sampledFrameCount;
  const copyTexSubImage2DPerFrame = route.gl.copyTexSubImage2D / sampledFrameCount;
  const copyTexSubImage2DPixelsPerFrame = route.gl.copyTexSubImage2DPixels / sampledFrameCount;
  const uniformCallsPerFrame = route.gl.uniformCalls / sampledFrameCount;
  const frameRenderCallbackStats = route.frameWork?.renderCallbackDurationMs;
  const cameraDragSampleCount = route.cameraDrag?.frameStats?.sampleCount ?? 0;
  const cameraDragFrameStats = route.cameraDrag?.frameStats;
  const cameraDragRendererFrames = route.cameraDrag?.renderer?.frameDelta ?? 0;
  const cameraInputHandlerStats = cameraDragFrameStats?.cameraInput?.handlerDurationMs;
  const cameraRenderCallbackStats = cameraDragFrameStats?.renderCallbackDurationMs;
  const gpuDrawProfile = cameraDragFrameStats?.gpuDrawProfile;
  const topGpuDraw = gpuDrawProfile?.records?.[0];
  const topGpuProgram = gpuDrawProfile?.programs?.[0];
  const cameraDragDrawCallsPerFrame = cameraDragSampleCount <= 0 || route.cameraDrag === undefined
    ? undefined
    : route.cameraDrag.gl.drawCalls / cameraDragSampleCount;
  const cameraDragSubmissionCallsPerFrame =
    cameraDragSampleCount <= 0 || route.cameraDrag === undefined
      ? undefined
      : route.cameraDrag.gl.submissionCalls / cameraDragSampleCount;
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
  const cameraDragCopyTexSubImage2DPixelsPerFrame =
    cameraDragSampleCount <= 0 || route.cameraDrag === undefined
      ? undefined
      : route.cameraDrag.gl.copyTexSubImage2DPixels / cameraDragSampleCount;
  const cameraDragFailure = cameraDragFrameStats?.failed === true
    ? cameraDragFrameStats.reason
    : cameraDragFrameStats?.timedOut === true
      ? 'partial-timeout'
      : cameraDragFrameStats !== undefined &&
          (cameraDragFrameStats.sampleCount ?? 0) > 0 &&
          cameraDragRendererFrames === 0
        ? 'renderer-frame-not-advanced'
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
  const gltfInstancingModelUploadBytesPerFrame = gltfInstancingPerFrame === undefined
    ? undefined
    : gltfInstancingPerFrame.modelUploadBytes;
  const gltfInstancingModelUploadCallsPerFrame = gltfInstancingPerFrame === undefined
    ? undefined
    : gltfInstancingPerFrame.modelUploadCalls;
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
    submissionCallsPerFrame: round(submissionCallsPerFrame),
    instancedDrawCallsPerFrame: round(instancedDrawCallsPerFrame),
    stateChangesPerFrame: round(stateChangesPerFrame),
    useProgramPerFrame: round(useProgramPerFrame),
    bindBufferPerFrame: round(bindBufferPerFrame),
    bindTexturePerFrame: round(bindTexturePerFrame),
    bindVertexArrayPerFrame: round(bindVertexArrayPerFrame),
    copyTexImage2DPerFrame: round(copyTexImage2DPerFrame),
    copyTexSubImage2DPerFrame: round(copyTexSubImage2DPerFrame),
    copyTexSubImage2DPixelsPerFrame: round(copyTexSubImage2DPixelsPerFrame),
    uniformCallsPerFrame: round(uniformCallsPerFrame),
    uniformMatrixCallsPerFrame: round(route.gl.uniformMatrixCalls / sampledFrameCount),
    ...(typeof frameRenderCallbackStats?.p95Ms === 'number' && frameRenderCallbackStats.sampleCount > 0
      ? {
          renderCallbackMaxMs: round(frameRenderCallbackStats.maxMs),
          renderCallbackP95Ms: round(frameRenderCallbackStats.p95Ms),
        }
      : {}),
    ...(route.frameWork?.gpuDurationMs?.supported === true
      && route.frameWork.gpuDurationMs.sampleCount > 0
      ? {
          gpuP95Ms: round(route.frameWork.gpuDurationMs.p95Ms),
          gpuSampleCount: route.frameWork.gpuDurationMs.sampleCount,
          gpuSamplesMissing: route.frameWork.gpuDurationMs.samplesMissing,
        }
      : {}),
    ...(typeof route.xr?.frameStats?.callbackDurationMs?.p95Ms === 'number'
      ? { xrCallbackP95Ms: round(route.xr.frameStats.callbackDurationMs.p95Ms) }
      : {}),
    ...(route.xr?.frameStats?.gpuDurationMs?.supported === true
      ? {
        xrGpuP95Ms: round(route.xr.frameStats.gpuDurationMs.p95Ms),
        xrGpuSampleCount: route.xr.frameStats.gpuDurationMs.sampleCount,
        xrGpuSamplesMissing: route.xr.frameStats.gpuDurationMs.samplesMissing,
      }
      : {}),
    ...(route.virtualTextureClose === undefined
      ? {}
      : {
        virtualTextureCloseDurationMs: round(route.virtualTextureClose.durationMs),
        virtualTextureCloseFinalDistance: route.virtualTextureClose.finalDistance,
        virtualTextureCloseP95Ms: round(route.virtualTextureClose.frameStats?.p95Ms),
        virtualTextureClosePageUploadCalls:
          (route.virtualTextureClose.gl?.texSubImage2D ?? 0)
          + (route.virtualTextureClose.gl?.compressedTexSubImage2D ?? 0),
        virtualTextureCloseResidentPageDelta:
          route.virtualTextureClose.renderer?.virtualTexturing?.delta?.residentPages ?? 0,
      }),
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
            gltfModelUploadBytesPerFrame: round(gltfInstancingModelUploadBytesPerFrame, 1),
            gltfModelUploadCallsPerFrame: round(gltfInstancingModelUploadCallsPerFrame, 3),
            setupGltfBatchPlansBuilt: setupGltfInstancingCounters?.batchPlansBuilt ?? 0,
            setupGltfInstancesDrawn: setupGltfInstancingCounters?.instancesDrawn ?? 0,
            setupGltfModelUploadBytes: setupGltfInstancingCounters === undefined
              ? 0
              : setupGltfInstancingCounters.modelUploadBytes,
            setupGltfModelUploadCalls: setupGltfInstancingCounters === undefined
              ? 0
              : setupGltfInstancingCounters.modelUploadCalls,
          }),
        instancedDrawCallsPer1000Instances: round(instancedDrawCallsPerFrame / (instanceCount / 1000), 3),
        setupInstancedDrawCallsPer1000Instances: round(setupInstancedDrawCalls / (instanceCount / 1000), 3),
      }),
    bufferSubDataBytesPerFrame: round(bufferSubDataBytesPerFrame),
    ...(hasCameraDragStats
      ? {
          cameraDragDrawCallsPerFrame: round(cameraDragDrawCallsPerFrame),
          cameraDragRendererFrames,
          cameraDragSubmissionCallsPerFrame: round(cameraDragSubmissionCallsPerFrame),
        ...(typeof cameraDragStateChangesPerFrame === 'number' && cameraDragStateChangesPerFrame !== 0
          ? { cameraDragStateChangesPerFrame: round(cameraDragStateChangesPerFrame) }
          : {}),
        ...(typeof cameraDragUniformCallsPerFrame === 'number' && cameraDragUniformCallsPerFrame !== 0
          ? { cameraDragUniformCallsPerFrame: round(cameraDragUniformCallsPerFrame) }
          : {}),
        ...(typeof cameraDragCopyTexSubImage2DPixelsPerFrame === 'number'
          && cameraDragCopyTexSubImage2DPixelsPerFrame !== 0
          ? { cameraDragCopyTexSubImage2DPixelsPerFrame: round(cameraDragCopyTexSubImage2DPixelsPerFrame) }
          : {}),
        ...(typeof cameraDragBufferSubDataBytesPerFrame === 'number' && cameraDragBufferSubDataBytesPerFrame !== 0
          ? { cameraDragBufferSubDataBytesPerFrame: round(cameraDragBufferSubDataBytesPerFrame) }
          : {}),
        ...(typeof cameraDragInstancedDrawCallsPerFrame === 'number' && cameraDragInstancedDrawCallsPerFrame !== 0
          ? { cameraDragInstancedDrawCallsPerFrame: round(cameraDragInstancedDrawCallsPerFrame) }
          : {}),
        cameraDragDrawP95Ms: round(cameraDragFrameStats.p95Ms),
        cameraDragDrawP99Ms: round(cameraDragFrameStats.p99Ms),
        ...(cameraDragFrameStats.gpuDurationMs?.supported === true
          ? {
              cameraDragGpuP95Ms: round(cameraDragFrameStats.gpuDurationMs.p95Ms),
              cameraDragGpuSampleCount: cameraDragFrameStats.gpuDurationMs.sampleCount,
              cameraDragGpuSamplesMissing: cameraDragFrameStats.gpuDurationMs.samplesMissing,
            }
          : {}),
        ...(typeof topGpuDraw?.durationMs === 'number'
          ? {
              cameraDragGpuDrawProfileCount: gpuDrawProfile.completedCount,
              cameraDragGpuTopDrawCount: topGpuDraw.count,
              cameraDragGpuTopDrawDurationMs: round(topGpuDraw.durationMs),
              cameraDragGpuTopDrawProgramId: topGpuDraw.programId,
              cameraDragGpuTopDrawProgramLabel: topGpuDraw.programLabel,
            }
          : {}),
        ...(typeof topGpuProgram?.durationMs === 'number'
          ? {
              cameraDragGpuTopProgramDrawCount: topGpuProgram.drawCount,
              cameraDragGpuTopProgramDurationMs: round(topGpuProgram.durationMs),
              cameraDragGpuTopProgramElementCount: topGpuProgram.elementCount,
              cameraDragGpuTopProgramLabel: topGpuProgram.programLabel,
            }
          : {}),
        ...(typeof cameraInputHandlerStats?.p95Ms === 'number'
          ? {
              cameraInputHandlerMaxMs: round(cameraInputHandlerStats.maxMs),
              cameraInputHandlerP95Ms: round(cameraInputHandlerStats.p95Ms),
            }
          : {}),
        ...(typeof cameraRenderCallbackStats?.p95Ms === 'number'
          ? {
              cameraRenderCallbackMaxMs: round(cameraRenderCallbackStats.maxMs),
              cameraRenderCallbackP95Ms: round(cameraRenderCallbackStats.p95Ms),
            }
          : {}),
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
    ...(route.heap.forcedGc
      ? { retainedGrowthBytes: route.heap.retainedGrowthBytes }
      : { observedHeapGrowthBytes: route.heap.observedGrowthBytes }),
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
      const deltaGltfModelUploadBytesPerFrame = numericDelta(
        animated.gltfModelUploadBytesPerFrame,
        staticRoute.gltfModelUploadBytesPerFrame,
        1,
      );
      const deltaGltfInstancesDrawnPerFrame = numericDelta(
        animated.gltfInstancesDrawnPerFrame,
        staticRoute.gltfInstancesDrawnPerFrame,
        3,
      );

      return {
        animatedId: animated.id,
        animation: animated.profile.animation,
        staticId: staticRoute.id,
        grid: animated.profile.grid,
        instanceCount: animated.profile.instanceCount,
        seed: animated.profile.seed,
        deltaP95Ms: round(animated.p95Ms - staticRoute.p95Ms),
        deltaDrawCallsPerFrame: round(animated.drawCallsPerFrame - staticRoute.drawCallsPerFrame),
        deltaBufferSubDataBytesPerFrame: round(
          animated.bufferSubDataBytesPerFrame - staticRoute.bufferSubDataBytesPerFrame,
        ),
        ...(deltaGltfModelUploadBytesPerFrame === undefined
          ? {}
          : { deltaGltfModelUploadBytesPerFrame }),
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
  const measuredCpu = summaries.filter((route) => typeof route.renderCallbackP95Ms === 'number');
  const measuredGpu = summaries.filter((route) => typeof route.gpuP95Ms === 'number');
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
    heaviestCpuRoutes: [...measuredCpu]
      .sort((left, right) => right.renderCallbackP95Ms - left.renderCallbackP95Ms)
      .slice(0, 8),
    heaviestGpuRoutes: [...measuredGpu]
      .sort((left, right) => right.gpuP95Ms - left.gpuP95Ms)
      .slice(0, 8),
    instancing: {
      comparisons: instancingComparisons(summaries),
      highestP95: [...instancing]
        .sort((left, right) => right.p95Ms - left.p95Ms)
        .slice(0, 8),
      highestDrawCallsPer1000Instances: [...instancing]
        .sort((left, right) => right.drawCallsPer1000Instances - left.drawCallsPer1000Instances)
        .slice(0, 8),
      highestGltfModelUploadBytesPerFrame: [...instancing]
        .sort((left, right) =>
          (right.gltfModelUploadBytesPerFrame ?? 0) -
            (left.gltfModelUploadBytesPerFrame ?? 0)
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
    ? startVitePreview({ appRoot, host, port: previewPort })
    : undefined;
  const browserArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(gpuMode === 'hardware-headed' ? [] : ['--headless=new']),
    ...(gpuMode === 'software-headless'
      ? []
      : gpuMode === 'hardware-headed'
        ? [
          '--ozone-platform=x11',
          '--use-gl=angle',
          '--use-angle=gl',
          '--disable-software-rasterizer',
          '--use-gpu-in-tests',
        ]
        : [
          '--use-gl=angle',
          '--use-angle=vulkan',
          '--ignore-gpu-blocklist',
          '--disable-software-rasterizer',
          '--use-gpu-in-tests',
        ]),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    ...(fakeXrEnabled ? [`--unsafely-treat-insecure-origin-as-secure=${baseUrl}`] : []),
    'about:blank',
  ];
  const browser = browserMode === 'chromium'
    ? spawnLogged('chromium', browserArgs, { cwd: appRoot })
    : undefined;

  let session;
  let browserDiagnostics;
  let currentRoute;
  let performanceTrace;
  let traceReport;
  let traceFailure;
  let cpuProfile;
  let cpuProfileSummary;
  let cpuProfileWritten = false;
  const results = [];
  try {
    const expectedSource = JSON.parse(readFileSync(
      path.join(appRoot, 'dist/__royal-source.json'),
      'utf8',
    ));
    const servedSource = await waitForPreviewBuild({
      baseUrl,
      expected: expectedSource,
      preview,
      timeoutMs: 15_000,
    });
    const source = { ...readSourceEnvironment(), ...servedSource };
    const size = await deploymentSize();
    session = await connectPage();
    browserDiagnostics = captureBrowserDiagnostics(session);
    await session.call('Page.enable');
    await session.call('Page.setLifecycleEventsEnabled', { enabled: true });
    await session.call('Runtime.enable');
    await session.call('Log.enable');
    await session.call('HeapProfiler.enable');
    await session.call('Network.enable');
    await session.call('Performance.enable');
    const blankLoaded = session.wait(
      'Page.lifecycleEvent',
      (event) => event.name === 'DOMContentLoaded',
      { timeoutMs: 10_000 },
    );
    await session.call('Page.navigate', { url: 'about:blank' });
    await blankLoaded;
    browserDiagnostics.reset();
    await installBenchmarkHooks(session);
    const gpu = await readWebGlGpu(session);
    const browserEnvironment = await readBrowserEnvironment(session);
    assertRequestedGpu(gpu, gpuMode !== 'software-headless');
    console.log(`gpu=${gpu?.renderer ?? 'unavailable'} webgl=${gpu?.version ?? 'unavailable'}`);
    // Real XR transfers debugger ownership after navigation so activation and
    // measurement share a fresh Quest Browser attachment. Start tracing on
    // that replacement attachment instead of the one this path closes.
    if (traceEnabled && !realXrEnabled) performanceTrace = await startPerformanceTrace(session);

    const benchmarkRoutes = selectedRoutes();
    if (screenshotOutputPath !== '' && benchmarkRoutes.length !== 1) {
      throw new Error('EXAMPLES_BENCH_SCREENSHOT requires exactly one selected route');
    }
    if (cpuProfileEnabled && benchmarkRoutes.length !== 1) {
      throw new Error('EXAMPLES_BENCH_CPU_PROFILE requires EXAMPLES_BENCH_ROUTE to select exactly one route');
    }
    for (const route of benchmarkRoutes) {
      currentRoute = route;
      browserDiagnostics.reset();
      const result = await benchmarkRoute(session, route, {
        onCpuProfile: async (profile) => {
          cpuProfile = profile;
          cpuProfileSummary = summarizeCpuProfile(profile);
        },
        onSessionChanged: async (nextSession, nextDiagnostics) => {
          session = nextSession;
          browserDiagnostics = mergeBrowserDiagnostics(browserDiagnostics, nextDiagnostics);
          if (traceEnabled && performanceTrace === undefined) {
            performanceTrace = await startPerformanceTrace(session);
          }
        },
      });
      results.push(result);
      const resourcesKb = result.performance.resources.totalTransferSize / 1024;
      const retainedKb = (
        result.heap.retainedGrowthBytes
        ?? result.heap.observedGrowthBytes
        ?? 0
      ) / 1024;
      const measuredGlFrameCount = result.glFrameCount > 0 ? result.glFrameCount : frameSampleCount;
      const drawCallsPerFrame = result.gl.drawCalls / measuredGlFrameCount;
      const submissionCallsPerFrame = result.gl.submissionCalls / measuredGlFrameCount;
      const instancedDrawCallsPerFrame = result.gl.instancedDrawCalls / measuredGlFrameCount;
      const stateChangesPerFrame = result.gl.stateChanges / measuredGlFrameCount;
      const uniformCallsPerFrame = result.gl.uniformCalls / measuredGlFrameCount;
      const cameraDragFrameStats = result.cameraDrag?.frameStats;
      const frameRenderCallbackStats = result.frameWork?.renderCallbackDurationMs;
      const frameFailure = result.frameStats.failed === true
        ? result.frameStats.reason
        : result.frameStats.timedOut === true
          ? 'partial-timeout'
          : undefined;
      const cameraDragSampleCount = cameraDragFrameStats?.sampleCount ?? 0;
      const cameraDragDrawCallsPerFrame = cameraDragSampleCount <= 0 || result.cameraDrag === undefined
        ? undefined
        : result.cameraDrag.gl.drawCalls / cameraDragSampleCount;
      const cameraDragSubmissionCallsPerFrame =
        cameraDragSampleCount <= 0 || result.cameraDrag === undefined
          ? undefined
          : result.cameraDrag.gl.submissionCalls / cameraDragSampleCount;
      const cameraDragFailure = cameraDragFrameStats?.failed === true
        ? cameraDragFrameStats.reason
        : cameraDragFrameStats?.timedOut === true
          ? 'partial-timeout'
          : undefined;
      const hasCameraDragStats =
        typeof cameraDragFrameStats?.p95Ms === 'number' &&
        typeof cameraDragDrawCallsPerFrame === 'number';
      const xrP95 = result.xr?.frameStats?.p95Ms;
      const xrCallbackP95 = result.xr?.frameStats?.callbackDurationMs?.p95Ms;
      const xrGpu = result.xr?.frameStats?.gpuDurationMs;
      const xrFrameFailure = result.xr?.frameStats?.failed === true ? result.xr.frameStats.reason : undefined;
      const profile = result.profile?.kind === 'gltf-instancing'
        ? `grid=${result.profile.grid} seed=${result.profile.seed} animate=${result.profile.animate ? 1 : 0} animation=${result.profile.animation}`
        : undefined;
      const gltfInstancing = result.profile?.kind === 'gltf-instancing'
        ? result.renderer?.gltfInstancing
        : undefined;
      const topGpuDraw = cameraDragFrameStats?.gpuDrawProfile?.records?.[0];
      const topGpuProgram = cameraDragFrameStats?.gpuDrawProfile?.programs?.[0];
      const gltfModelUploadKibPerFrame = gltfInstancing?.perFrame === undefined
        ? undefined
        : gltfInstancing.perFrame.modelUploadBytes / 1024;
      console.log([
        route.id.padEnd(28),
        ...(profile === undefined ? [] : [profile]),
        `load=${(result.performance.navigation?.duration ?? 0).toFixed(1)}ms`,
        `nav=${result.navigationSynchronizationMs.toFixed(1)}ms`,
        `ready=${result.wallNavigationAndReadyMs.toFixed(1)}ms`,
        `res=${resourcesKb.toFixed(1)}KiB`,
        `p95=${result.frameStats.p95Ms.toFixed(1)}ms`,
        ...(typeof frameRenderCallbackStats?.p95Ms === 'number' && frameRenderCallbackStats.sampleCount > 0
          ? [`cpuP95=${frameRenderCallbackStats.p95Ms.toFixed(2)}ms`]
          : []),
        ...(result.frameWork?.gpuDurationMs?.supported === true
          && result.frameWork.gpuDurationMs.sampleCount > 0
          ? [`gpuP95=${result.frameWork.gpuDurationMs.p95Ms.toFixed(2)}ms`]
          : []),
        ...(frameFailure === undefined ? [] : [`frames=${frameFailure}`]),
        ...(hasCameraDragStats
          ? [
            `dragDrawP95=${cameraDragFrameStats.p95Ms.toFixed(1)}ms`,
            ...(cameraDragFrameStats.gpuDurationMs?.supported === true
              ? [`dragGpuP95=${cameraDragFrameStats.gpuDurationMs.p95Ms.toFixed(2)}ms`]
              : []),
            ...(typeof topGpuDraw?.durationMs === 'number'
              ? [`dragGpuTop=${topGpuDraw.durationMs.toFixed(2)}ms/${topGpuDraw.count}v/${topGpuDraw.programLabel}`]
              : []),
            ...(typeof topGpuProgram?.durationMs === 'number'
              ? [`dragGpuProgram=${topGpuProgram.durationMs.toFixed(2)}ms/${topGpuProgram.drawCount}d/${topGpuProgram.programLabel}`]
              : []),
            ...(typeof cameraDragFrameStats.cameraInput?.handlerDurationMs?.p95Ms === 'number'
              ? [`dragHandlerP95=${cameraDragFrameStats.cameraInput.handlerDurationMs.p95Ms.toFixed(2)}ms`]
              : []),
            ...(typeof cameraDragFrameStats.renderCallbackDurationMs?.p95Ms === 'number'
              ? [`dragCpuP95=${cameraDragFrameStats.renderCallbackDurationMs.p95Ms.toFixed(2)}ms`]
              : []),
            ...(typeof cameraDragFrameStats.raf?.p95Ms === 'number'
              ? [`dragRafP95=${cameraDragFrameStats.raf.p95Ms.toFixed(1)}ms`]
              : []),
            `dragFrames=${result.cameraDrag?.renderer?.frameDelta ?? 0}`,
            ...(typeof cameraDragFrameStats.samplesMissing === 'number' && cameraDragFrameStats.samplesMissing > 0
              ? [`dragMiss=${cameraDragFrameStats.samplesMissing}`]
              : []),
            `dragDraw/frame=${cameraDragDrawCallsPerFrame.toFixed(1)}`,
            `dragSubmit/frame=${cameraDragSubmissionCallsPerFrame.toFixed(1)}`,
          ]
          : []),
        ...(cameraDragFailure === undefined ? [] : [`drag=${cameraDragFailure}`]),
        ...(typeof xrP95 === 'number' ? [`xrP95=${xrP95.toFixed(1)}ms`] : []),
        ...(typeof xrCallbackP95 === 'number' ? [`xrCpuP95=${xrCallbackP95.toFixed(2)}ms`] : []),
        ...(xrGpu?.supported === true
          ? [
            `xrGpuP95=${xrGpu.p95Ms.toFixed(2)}ms`,
            ...(xrGpu.samplesMissing > 0 ? [`xrGpuMiss=${xrGpu.samplesMissing}`] : []),
          ]
          : []),
        ...(xrFrameFailure === undefined ? [] : [`xrFrames=${xrFrameFailure}`]),
        ...(result.fakeXrActivationFailure === undefined ? [] : [`xrPrepare=${result.fakeXrActivationFailure.reason}`]),
        `draw/frame=${drawCallsPerFrame.toFixed(1)}`,
        `submit/frame=${submissionCallsPerFrame.toFixed(1)}`,
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
            `gltfModelKiB/frame=${(gltfModelUploadKibPerFrame ?? 0).toFixed(1)}`,
          ]
          : []),
        `heap=${retainedKb.toFixed(1)}KiB`,
      ].join(' '));
    }
    currentRoute = undefined;

    if (cpuProfileEnabled) {
      if (cpuProfile === undefined || cpuProfileSummary === undefined) {
        throw new Error('Examples CPU profiler did not capture a profile');
      }
      await mkdir(path.dirname(cpuProfileOutputPath), { recursive: true });
      await writeFile(cpuProfileOutputPath, `${JSON.stringify(cpuProfile)}\n`);
      cpuProfileWritten = true;
      console.log(`wrote ${cpuProfileOutputPath}`);
      console.log('CPU top script self-time', cpuProfileSummary.topScriptSelfTime.slice(0, 12));
    }

    if (performanceTrace !== undefined) {
      try {
        traceReport = await performanceTrace.stop();
        await mkdir(path.dirname(traceOutputPath), { recursive: true });
        await writeFile(traceOutputPath, `${JSON.stringify(traceReport)}\n`);
        console.log(`wrote ${traceOutputPath}`);
      } catch (traceError) {
        traceFailure = traceError instanceof Error
          ? traceError.stack ?? traceError.message
          : String(traceError);
        console.warn(`performance trace unavailable: ${traceFailure}`);
      }
    }

    const analysis = analyzeResults(results);

    const report = {
      schema: reportSchema,
      schemaVersion: reportSchemaVersion,
      generatedAt: new Date().toISOString(),
      source,
      browser: browserEnvironment,
      options: {
        frameSampleCount,
        frameWarmupCount,
        frameSampleTimeoutMs,
        baseUrl,
        browserMode,
        gpuMode,
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
        gpuTimersEnabled,
        glCountersEnabled,
        heapGcEnabled,
        realXrEnabled,
        virtualTextureCloseEnabled,
        virtualTextureCloseTarget,
        benchmarkMode,
        cpuProfileEnabled,
        instancingFuzzEnabled,
        instancingFuzzCases,
        instancingSeed,
        instancingSweepMode,
        managePreview,
        resourceTimingBufferSize,
      },
      analysis,
      deployment: size,
      gpu,
      browserDiagnostics: browserDiagnostics.snapshot(),
      routes: results,
      ...(traceEnabled
        ? { trace: {
          enabled: true,
          ...(traceFailure !== undefined
            ? { failure: traceFailure }
            : traceReport !== undefined
              ? { outputPath: traceOutputPath }
              : { failure: 'Performance trace did not start' }),
        } }
        : {}),
      ...(cpuProfileSummary === undefined
        ? {}
        : { cpuProfile: { outputPath: cpuProfileOutputPath, summary: cpuProfileSummary } }),
    };

    console.log(JSON.stringify({
      deploymentBytes: report.deployment.totalBytes,
      deploymentGzipBytes: report.deployment.gzipBytes,
      gpu: report.gpu,
      routeCount: report.routes.length,
      slowestRoutesByP95: analysis.slowestRoutesByP95.slice(0, 5),
      heaviestCpuRoutes: analysis.heaviestCpuRoutes.slice(0, 5),
      heaviestGpuRoutes: analysis.heaviestGpuRoutes.slice(0, 5),
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
      instancingHighestGltfModelUploadBytesPerFrame:
        analysis.instancing.highestGltfModelUploadBytesPerFrame.slice(0, 5),
      instancingHighestSetupInstancedDrawCallsPer1000Instances:
        analysis.instancing.highestSetupInstancedDrawCallsPer1000Instances.slice(0, 5),
      xrFrameFailures: analysis.xrFrameFailures,
      ...(cpuProfileSummary === undefined
        ? {}
        : { cpuProfileTopScriptSelfTime: cpuProfileSummary.topScriptSelfTime.slice(0, 12) }),
    }, null, 2));

    if (outputPath !== '') {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`wrote ${outputPath}`);
    }
  } catch (error) {
    if (cpuProfile !== undefined && !cpuProfileWritten && cpuProfileOutputPath !== '') {
      await mkdir(path.dirname(cpuProfileOutputPath), { recursive: true });
      await writeFile(cpuProfileOutputPath, `${JSON.stringify(cpuProfile)}\n`);
      cpuProfileWritten = true;
      console.log(`wrote ${cpuProfileOutputPath}`);
    }
    if (
      performanceTrace !== undefined
      && traceReport === undefined
      && traceFailure === undefined
    ) {
      try {
        traceReport = await performanceTrace.stop();
        await mkdir(path.dirname(traceOutputPath), { recursive: true });
        await writeFile(traceOutputPath, `${JSON.stringify(traceReport)}\n`);
        console.log(`wrote ${traceOutputPath}`);
      } catch (traceError) {
        traceFailure = traceError instanceof Error ? traceError.stack ?? traceError.message : String(traceError);
      }
    }

    let page;
    if (session !== undefined) {
      try {
        page = await evaluate(session, `
(() => {
  const canvas = document.querySelector('canvas');
  return {
    bodyText: document.body?.innerText?.slice(0, 4000) ?? '',
    canvas: canvas === null ? null : {
      clientHeight: canvas.clientHeight,
      clientWidth: canvas.clientWidth,
      height: canvas.height,
      width: canvas.width,
    },
    readyState: document.readyState,
    renderer: ${rendererSnapshotExpression},
    title: document.title,
    url: location.href,
  };
})()
`);
      } catch (pageError) {
        page = {
          captureError: pageError instanceof Error ? pageError.message : String(pageError),
        };
      }
    }

    const failure = {
      generatedAt: new Date().toISOString(),
      browserDiagnostics: browserDiagnostics?.snapshot() ?? { droppedEntries: 0, entries: [] },
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      page,
      route: currentRoute,
      ...(traceFailure === undefined ? {} : { traceFailure }),
      ...(traceReport === undefined ? {} : { traceOutputPath }),
    };
    await mkdir(path.dirname(failureOutputPath), { recursive: true });
    await writeFile(failureOutputPath, `${JSON.stringify(failure, null, 2)}\n`);
    console.error(`wrote ${failureOutputPath}`);
    throw error;
  } finally {
    session?.close();
    await stopProcess(browser);
    await stopProcess(preview);
    await rm(profileDir, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }
};

await main();
