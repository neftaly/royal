import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_SMOKE_PORT ?? 4573);
const debugPort = Number(process.env.EXAMPLES_SMOKE_DEBUG_PORT ?? 4574);
const baseUrl = `http://${host}:${previewPort}`;
const gpuMode = process.env.EXAMPLES_SMOKE_GPU?.trim() || 'swiftshader';
const routeQuery = process.env.EXAMPLES_SMOKE_QUERY?.trim() ?? '';
const routeFilter = process.env.EXAMPLES_SMOKE_ROUTE?.trim() ?? '';
const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  throw new Error(`${name} must be a finite number, received ${JSON.stringify(raw)}`);
};
const routeReadyTimeoutMs = envNumber('EXAMPLES_ROUTE_READY_TIMEOUT_MS', 20_000);
const contextLossSmoke = process.env.EXAMPLES_SMOKE_CONTEXT_LOSS === '1';

if (!new Set(['swiftshader', 'hardware-headless']).has(gpuMode)) {
  throw new Error(`EXAMPLES_SMOKE_GPU must be "swiftshader" or "hardware-headless", received ${JSON.stringify(gpuMode)}`);
}

const gltfLabManifest = JSON.parse(readFileSync(
  new URL('../src/examples/gltf-lab-manifest.json', import.meta.url),
  'utf8',
));
const gltfLabCaseByName = new Map(gltfLabManifest.cases.map((entry) => [entry.name, entry]));
const gltfLabResourceSubstring = (entry) => `/${entry.path}`;

const smokeExpectations = {
  cube: {
    path: '/cube',
    minPaintedRatio: 0.01,
  },
  wireframe: {
    path: '/wireframe',
    minPaintedRatio: 0.003,
  },
  picking: {
    path: '/picking',
    minColorBuckets: 6,
    minPaintedRatio: 0.01,
  },
  'texture-materials': {
    path: '/texture-materials',
    minPaintedRatio: 0.01,
  },
  'virtual-texture-stress': {
    path: '/virtual-texture-stress',
    resourceSubstrings: [
      '/fixtures/virtual-texture-stress/map.vt.json',
      '/fixtures/virtual-texture-stress/map-pages/m3-0-0.svg',
    ],
    minColorBuckets: 8,
    minPaintedRatio: 0.02,
  },
  'standard-lighting': {
    path: '/standard-lighting',
    minColorBuckets: 12,
    minPaintedRatio: 0.01,
  },
  'gltf-helmet': {
    path: '/gltf-helmet',
    minColorBuckets: 32,
    minPaintedRatio: 0.01,
  },
  'gltf-instancing': {
    path: '/gltf-instancing',
    minColorBuckets: 8,
    minPaintedRatio: 0.01,
  },
  'gltf-lab': {
    path: '/gltf-lab?case=Box',
    resourceSubstrings: [gltfLabResourceSubstring(gltfLabCaseByName.get('Box'))],
    minColorBuckets: 1,
    minPaintedRatio: 0.0001,
  },
  'gltf-ghostscript-tiger-svg': {
    path: '/gltf-ghostscript-tiger-svg',
    minColorBuckets: 18,
    minPaintedRatio: 0.006,
  },
  'gltf-lod': {
    path: '/gltf-lod',
    minColorBuckets: 8,
    minPaintedRatio: 0.004,
  },
  'gltf-variants': {
    path: '/gltf-variants',
    minColorBuckets: 8,
    minPaintedRatio: 0.006,
  },
  'webxr-vr': {
    path: '/webxr-vr',
    minColorBuckets: 10,
    minPaintedRatio: 0.01,
  },
};

const smokeRoutes = Object.entries(smokeExpectations).map(([id, expectation]) => ({
  id,
  ...expectation,
}));

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

const evaluate = async (session, expression, options = {}) => {
  const result = await session.call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
    ...options,
  });

  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }

  return result.result.value;
};

const smokeExpression = `
(async () => {
  const smokeExpectations = ${JSON.stringify(smokeExpectations)};
  const gltfLabPaths = ${JSON.stringify(Object.fromEntries(
    gltfLabManifest.cases.map((entry) => [entry.name, `/${entry.path}`]),
  ))};
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
    let chromaSum = 0;
    let luminanceSum = 0;
    let saturationSum = 0;
    const luminances = [];
    let paintedPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha === 0) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      paintedPixels += 1;
      const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      luminanceSum += luminance;
      luminances.push(luminance);
      const maximum = Math.max(red, green, blue);
      const chroma = maximum - Math.min(red, green, blue);
      chromaSum += chroma / 255;
      saturationSum += maximum === 0 ? 0 : chroma / maximum;
      buckets.add(\`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`);
    }

    luminances.sort((left, right) => left - right);
    const quantile = (fraction) => luminances.length === 0
      ? 0
      : luminances[Math.min(luminances.length - 1, Math.floor(fraction * luminances.length))];

    return {
      colorBuckets: buckets.size,
      meanPaintedChroma: paintedPixels === 0 ? 0 : chromaSum / paintedPixels,
      meanPaintedLuminance: paintedPixels === 0 ? 0 : luminanceSum / paintedPixels,
      meanPaintedSaturation: paintedPixels === 0 ? 0 : saturationSum / paintedPixels,
      paintedLuminanceP25: quantile(0.25),
      paintedLuminanceP50: quantile(0.5),
      paintedLuminanceP75: quantile(0.75),
      paintedPixels,
      paintedRatio: paintedPixels / (width * height),
    };
  };
  const read = async () => {
    globalThis.__royalExamplesRenderNow?.();
    const routePathname = window.location.pathname.replace(/\\/$/, '') || '/';
    const routePath = routePathname + window.location.search;
    const routeEntry = Object.entries(smokeExpectations).find(([, expectation]) =>
      expectation.path === routePath
    ) ?? Object.entries(smokeExpectations).find(([, expectation]) =>
      expectation.path.split('?')[0] === routePathname
    );
    const routeId = routeEntry?.[0] ?? '';
    const smoke = routeEntry?.[1];
    const selectedCase = new URLSearchParams(window.location.search).get('case');
    const selectedCasePath = selectedCase === null ? undefined : gltfLabPaths[selectedCase];
    const canvas = document.querySelector('canvas');
    return {
      route: {
        absentResourceSubstrings: selectedCasePath === undefined
          ? smoke?.absentResourceSubstrings ?? []
          : [],
        id: routeId,
        path: routePath,
        resourceSubstrings: selectedCasePath === undefined
          ? smoke?.resourceSubstrings ?? []
          : [selectedCasePath],
      },
      canvas: canvas === null ? undefined : {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        minColorBuckets: selectedCasePath === undefined ? smoke?.minColorBuckets : 1,
        minPaintedRatio: selectedCasePath === undefined ? smoke?.minPaintedRatio ?? 0 : 0.0001,
        sample: sampleCanvas(canvas),
      },
      picking: routeId === 'picking' ? {
        hoveredId: canvas?.dataset.royalPickingHoveredId ?? '',
        text: canvas?.dataset.royalPickingReadout ?? '',
      } : undefined,
      renderer: globalThis.__royalExamplesRendererBenchmarkSnapshot?.() ?? null,
      resources: performance.getEntriesByType('resource')
        .slice(-20)
        .map((entry) => ({
          duration: Math.round(entry.duration),
          name: entry.name,
          size: Math.round(entry.transferSize ?? 0),
        })),
      resourceNames: performance.getEntriesByType('resource')
        .map((entry) => entry.name),
      source: (() => {
        const sourceFile = document.querySelector('.example-page[data-example-id="' + routeId + '"]')
          ?.getAttribute('data-source-file') ?? '';
        return sourceFile === ''
          ? ''
          : document.querySelector('[data-source-file="' + sourceFile + '"] code')?.textContent ?? '';
      })(),
    };
  };
  const deadline = performance.now() + ${routeReadyTimeoutMs};
  let state = await read();
  const isReady = () => {
    if (state.route.id === '') return false;
    const resourceReady = state.route.resourceSubstrings.every((substring) =>
      state.resourceNames.some((name) => name.includes(substring))
    ) && state.route.absentResourceSubstrings.every((substring) =>
      !state.resourceNames.some((name) => name.includes(substring))
    );
    const canvasReady = state.canvas !== undefined &&
      state.canvas.backingWidth > 0 &&
      state.canvas.backingHeight > 0 &&
      state.canvas.sample !== undefined &&
      state.canvas.sample.paintedRatio >= state.canvas.minPaintedRatio &&
      (
        state.canvas.minColorBuckets === undefined ||
        state.canvas.sample.colorBuckets >= state.canvas.minColorBuckets
      );
    const gltfDiagnosticsReady = !state.route.id.startsWith('gltf-') ||
      (
        Array.isArray(state.renderer?.gltfLoadDiagnostics?.assets) &&
        state.renderer.gltfLoadDiagnostics.assets.length > 0 &&
        (state.renderer.gltfLoadDiagnostics.sceneReadyAssets ?? 0) > 0 &&
        state.renderer.gltfLoadDiagnostics.assets.some((asset) => typeof asset.phaseMs?.toSceneReady === 'number')
      );
    return canvasReady && resourceReady && gltfDiagnosticsReady;
  };

  while (performance.now() < deadline && !isReady()) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = await read();
  }

  return state;
})()
`;

const routeCanvasReady = (route, state) => {
  if (state.route?.id !== route.id || state.route?.path !== route.path) return false;
  const sample = state.canvas?.sample;
  if (sample === undefined) return false;
  if (sample.paintedPixels <= 0) return false;
  if (sample.paintedRatio < route.minPaintedRatio) return false;
  if (route.minColorBuckets !== undefined && sample.colorBuckets < route.minColorBuckets) return false;
  for (const resourceSubstring of route.resourceSubstrings ?? []) {
    if (!state.resourceNames?.some((name) => name.includes(resourceSubstring))) return false;
  }
  for (const resourceSubstring of route.absentResourceSubstrings ?? []) {
    if (state.resourceNames?.some((name) => name.includes(resourceSubstring))) return false;
  }
  return true;
};

const waitForRouteState = async (session, route, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastState;

  while (Date.now() < deadline) {
    lastState = await evaluate(session, smokeExpression);
    if (routeCanvasReady(route, lastState)) {
      return lastState;
    }
    await sleep(100);
  }

  return lastState ?? await evaluate(session, smokeExpression);
};

// A continuously animated Canvas transfers frame ownership to React's RAF loop.
// With preserveDrawingBuffer disabled, drawImage(canvas) may then observe the
// discarded back buffer between frames. CDP captures the composited surface,
// which is the image a user actually sees.
const compositedCanvasSample = async (session) => {
  await evaluate(session, `
    (async () => {
      await globalThis.__royalExamplesRenderNow?.();
      for (let frame = 0; frame < 2; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
    })()
  `);
  const clip = await evaluate(session, `
    (() => {
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    })()
  `);
  if (clip === null || clip.width <= 0 || clip.height <= 0) return undefined;
  const capture = await session.call('Page.captureScreenshot', {
    captureBeyondViewport: false,
    clip,
    format: 'png',
    fromSurface: false,
  });
  return evaluate(session, `
    (async () => {
      const response = await fetch('data:image/png;base64,${capture.data}');
      const bitmap = await createImageBitmap(await response.blob());
      const width = Math.max(1, Math.min(160, bitmap.width));
      const height = Math.max(1, Math.min(160, bitmap.height));
      const sample = document.createElement('canvas');
      sample.width = width;
      sample.height = height;
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (context === null) return undefined;
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const pixels = context.getImageData(0, 0, width, height).data;
      const buckets = new Set();
      let chromaSum = 0;
      let luminanceSum = 0;
      let saturationSum = 0;
      const luminances = [];
      let paintedPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        if (alpha === 0) continue;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        paintedPixels += 1;
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        luminanceSum += luminance;
        luminances.push(luminance);
        const maximum = Math.max(red, green, blue);
        const chroma = maximum - Math.min(red, green, blue);
        chromaSum += chroma / 255;
        saturationSum += maximum === 0 ? 0 : chroma / maximum;
        buckets.add([red >> 5, green >> 5, blue >> 5, alpha >> 6].join(':'));
      }
      luminances.sort((left, right) => left - right);
      const quantile = (fraction) => luminances.length === 0
        ? 0
        : luminances[Math.min(luminances.length - 1, Math.floor(fraction * luminances.length))];
      return {
        colorBuckets: buckets.size,
        meanPaintedChroma: paintedPixels === 0 ? 0 : chromaSum / paintedPixels,
        meanPaintedLuminance: paintedPixels === 0 ? 0 : luminanceSum / paintedPixels,
        meanPaintedSaturation: paintedPixels === 0 ? 0 : saturationSum / paintedPixels,
        paintedLuminanceP25: quantile(0.25),
        paintedLuminanceP50: quantile(0.5),
        paintedLuminanceP75: quantile(0.75),
        paintedPixels,
        paintedRatio: paintedPixels / (width * height),
      };
    })()
  `);
};

const assertRoute = (expected, state) => {
  const failures = [];
  if (state.route.id !== expected.id) {
    failures.push(`resolved route id "${state.route.id || 'missing'}" for "${expected.id}"`);
  }
  if (state.route.path !== expected.path) {
    failures.push(`browser path "${state.route.path}" did not match "${expected.path}"`);
  }

  const sample = state.canvas?.sample;
  if (state.canvas === undefined) {
    failures.push('missing canvas');
  } else if (state.canvas !== undefined && (sample === undefined || sample.paintedPixels <= 0)) {
    failures.push('canvas pixels stayed blank');
  } else if (state.canvas !== undefined && sample !== undefined) {
    if (sample.paintedRatio < state.canvas.minPaintedRatio) {
      failures.push(
        `canvas painted ratio ${sample.paintedRatio.toFixed(4)} < ${state.canvas.minPaintedRatio}`,
      );
    }
    if (expected.minColorBuckets !== undefined && sample.colorBuckets < expected.minColorBuckets) {
      failures.push(
        `canvas color buckets ${sample.colorBuckets} < ${expected.minColorBuckets}`,
      );
    }
  }

  if (expected.id === 'picking') {
    const interaction = state.pickingInteraction;
    if (state.picking === undefined) {
      failures.push('picking route missed readout');
    }
    if (interaction === undefined) {
      failures.push('picking route missed interaction smoke');
    } else if (interaction.error !== undefined) {
      failures.push(`picking route interaction smoke failed: ${interaction.error}`);
    } else {
      if (interaction.hoveredId !== 'helmet') {
        failures.push(`picking hover selected "${interaction.hoveredId}", expected "helmet"`);
      }
      if (interaction.clearedId !== 'none') {
        failures.push(`picking no-hit hover cleared to "${interaction.clearedId}", expected "none"`);
      }
      if (interaction.leaveClearedId !== 'none') {
        failures.push(`picking pointer leave cleared to "${interaction.leaveClearedId}", expected "none"`);
      }
      if (interaction.before === interaction.hoveredId) {
        failures.push(`picking hover readout did not change from "${interaction.before}"`);
      }
    }
  }

  if (expected.id === 'virtual-texture-stress') {
    const interaction = state.virtualTextureInteraction;
    if (interaction === undefined) {
      failures.push('virtual texture route missed focus interaction smoke');
    } else if (interaction.error !== undefined) {
      failures.push(`virtual texture interaction smoke failed: ${interaction.error}`);
    } else {
      const expectedTargets = [[0, 0], [-2, 2], [2, 2], [-2, -2], [2, -2], [0, 0]];
      if (!interaction.presets?.every((preset, index) =>
        preset.settled === true
        && Math.abs(preset.targetX - expectedTargets[index][0]) < 0.01
        && Math.abs(preset.targetY - expectedTargets[index][1]) < 0.01)) {
        failures.push('virtual texture map presets did not center and settle in Overview/NW/NE/SW/SE/Overview order');
      }
      if ((interaction.presets?.[1]?.pageCount ?? 0) <= (interaction.presets?.[0]?.pageCount ?? 0)) {
        failures.push('virtual texture map focus did not request finer public pages');
      }
      if ((interaction.pan?.errors?.length ?? 0) > 0) {
        failures.push(`virtual texture map pan crashed: ${interaction.pan.errors.join('; ')}`);
      }
      if (!Number.isFinite(interaction.pan?.targetX) || !Number.isFinite(interaction.pan?.targetY)) {
        failures.push('virtual texture map pan produced a non-finite camera target');
      } else if (
        Math.abs(interaction.pan.targetX) > 16 ||
        Math.abs(interaction.pan.targetY) > 16
      ) {
        failures.push(`virtual texture map pan produced an unbounded camera target (${interaction.pan.targetX}, ${interaction.pan.targetY})`);
      } else if (Math.hypot(
        interaction.pan.targetX - interaction.pan.startTargetX,
        interaction.pan.targetY - interaction.pan.startTargetY,
      ) < 0.25) {
        failures.push('virtual texture map pan did not move the camera target');
      }
      if (interaction.pan?.contextLifecycle !== 'active') {
        failures.push(`virtual texture map pan left the renderer context ${interaction.pan?.contextLifecycle ?? 'unavailable'}`);
      }
      if (interaction.pan?.contextLastError !== null) {
        failures.push(`virtual texture map pan reported a renderer context error: ${interaction.pan?.contextLastError ?? 'unavailable'}`);
      }
      if (!(interaction.pan?.frameAfter > interaction.pan?.frameBefore)) {
        failures.push('virtual texture map pan did not continue rendering');
      }
      if (interaction.pan?.settled !== true) {
        failures.push('virtual texture map pan did not settle');
      }
      if (
        interaction.pan?.pendingPages !== 0 ||
        interaction.pan?.outstandingPageRequests !== 0
      ) {
        failures.push(`virtual texture map pan left VT work pending (${interaction.pan?.pendingPages ?? 'unknown'} pages, ${interaction.pan?.outstandingPageRequests ?? 'unknown'} requests)`);
      }
      if (interaction.zoom?.contextLifecycle !== 'active') {
        failures.push(`virtual texture close zoom left the renderer context ${interaction.zoom?.contextLifecycle ?? 'unavailable'}`);
      }
      if (interaction.zoom?.contextLastError !== null) {
        failures.push(`virtual texture close zoom reported a renderer context error: ${interaction.zoom?.contextLastError ?? 'unavailable'}`);
      }
      if (interaction.zoom?.settled !== true) {
        failures.push('virtual texture close zoom did not settle');
      }
      if (!(interaction.zoom?.distance < 1.1)) {
        failures.push('virtual texture close zoom did not reach the intended close inspection distance');
      }
      if (!(interaction.far?.distance > 50) || interaction.far?.settled !== true) {
        failures.push('virtual texture far zoom did not reach and settle at the coarse overview distance');
      }
      if (interaction.far?.contextLifecycle !== 'active' || interaction.far?.contextLastError !== null) {
        failures.push('virtual texture far zoom did not preserve an active error-free context');
      }
      if (!((interaction.far?.residentPagesMip3 ?? 0) >= 1)) {
        failures.push('virtual texture far zoom did not retain the coarsest root page');
      }
      const focusedRegions = [
        { label: 'NW', preset: 1, u: 0.25, v: 0.25 },
        { label: 'NE', preset: 2, u: 0.75, v: 0.25 },
        { label: 'SW', preset: 3, u: 0.25, v: 0.75 },
        { label: 'SE', preset: 4, u: 0.75, v: 0.75 },
      ];
      for (const region of focusedRegions) {
        const pageUrls = interaction.presets?.[region.preset]?.pageUrls ?? [];
        const pages = pageUrls.flatMap((url) => {
          const match = /\/map-pages\/m(\d+)-(\d+)-(\d+)\.svg(?:$|\?)/.exec(url);
          if (match === null) return [];
          const mip = Number(match[1]);
          const grid = 2 ** Math.max(0, 3 - mip);
          return [{
            maxU: (Number(match[2]) + 1) / grid,
            maxV: (Number(match[3]) + 1) / grid,
            mip,
            minU: Number(match[2]) / grid,
            minV: Number(match[3]) / grid,
          }];
        });
        if (!pages.some((page) => (
          page.mip < 3
          && page.minU <= region.u && region.u <= page.maxU
          && page.minV <= region.v && region.v <= page.maxV
        ))) {
          failures.push(`virtual texture map ${region.label} focus did not refine the target UV beyond the coarse root`);
        }
      }
    }
  }

  if (expected.id.startsWith('gltf-')) {
    const gltfLoadDiagnostics = state.renderer?.gltfLoadDiagnostics;
    const assets = gltfLoadDiagnostics?.assets;
    if (!Array.isArray(assets) || assets.length === 0) {
      failures.push('missing glTF loading diagnostics');
    } else if ((gltfLoadDiagnostics.sceneReadyAssets ?? 0) <= 0) {
      failures.push('glTF load diagnostics did not report a scene-ready asset');
    } else if (!assets.some((asset) => typeof asset.phaseMs?.toSceneReady === 'number')) {
      failures.push('glTF load diagnostics missed toSceneReady phase timing');
    }
  }

  for (const resourceSubstring of expected.resourceSubstrings ?? []) {
    if (!state.resourceNames?.some((name) => name.includes(resourceSubstring))) {
      failures.push(`missing expected resource "${resourceSubstring}"`);
    }
  }
  for (const resourceSubstring of expected.absentResourceSubstrings ?? []) {
    if (state.resourceNames?.some((name) => name.includes(resourceSubstring))) {
      failures.push(`unexpected resource "${resourceSubstring}"`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${expected.id}: ${failures.join('; ')}`);
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

const runPickingInteractionSmoke = async (session) => evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  if (canvas === null) return { error: 'missing picking canvas' };
  const readHoveredId = () =>
    canvas.dataset.royalPickingHoveredId ?? '';
  if (typeof PointerEvent !== 'function') return { error: 'missing PointerEvent' };
  const rect = canvas.getBoundingClientRect();
  const hoverPoints = [
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 },
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.56 },
    { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.5 },
    { x: rect.left + rect.width * 0.55, y: rect.top + rect.height * 0.5 },
  ];
  const emptyPoint = { x: rect.left + rect.width * 0.08, y: rect.top + rect.height * 0.12 };
  const animationFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const dispatch = (type, point) => {
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: 0,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      isPrimary: true,
      pointerId: 9,
      pointerType: 'mouse',
    }));
  };
  const before = readHoveredId();
  let hoveredId = before;
  let hoveredPoint = null;
  for (let attempt = 0; attempt < 45 && hoveredId !== 'helmet'; attempt += 1) {
    for (const point of hoverPoints) {
      dispatch('pointermove', point);
      await animationFrame();
      hoveredId = readHoveredId();
      if (hoveredId === 'helmet') {
        hoveredPoint = point;
        break;
      }
    }
    await animationFrame();
  }
  dispatch('pointermove', emptyPoint);
  let clearedId = readHoveredId();
  for (let attempt = 0; attempt < 5 && clearedId !== 'none'; attempt += 1) {
    await animationFrame();
    clearedId = readHoveredId();
  }
  if (hoveredPoint !== null) {
    dispatch('pointermove', hoveredPoint);
    await animationFrame();
  }
  dispatch('pointerleave', hoveredPoint ?? hoverPoints[0]);
  await animationFrame();

  return { before, clearedId, hoveredId, hoveredPoint, leaveClearedId: readHoveredId() };
})()
`);

const runVirtualTextureInteractionSmoke = async (session) => evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  if (canvas === null) return { error: 'missing virtual texture canvas' };
  const buttons = [...document.querySelectorAll('.vt-stress-actions button')];
  if (buttons.length !== 5 || buttons.some((button) => !(button instanceof HTMLButtonElement))) {
    return { error: 'missing virtual texture camera presets' };
  }
  const pageUrls = () => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => url.includes('/fixtures/virtual-texture-stress/map-pages/'));
  const rendererSnapshot = () => globalThis.__royalExamplesRendererBenchmarkSnapshot?.() ?? null;
  const waitForConvergence = async (afterFrame = null, previousPageUrls = []) => {
    const deadline = performance.now() + 8000;
    let currentPages = pageUrls().length;
    let lastPages = -1;
    let stableFrames = 0;
    let renderer = rendererSnapshot();
    while (performance.now() < deadline && stableFrames < 8) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      currentPages = pageUrls().length;
      renderer = rendererSnapshot();
      const vt = renderer?.virtualTexturing;
      if (
        currentPages === lastPages &&
        (afterFrame === null || (renderer?.frame ?? -1) > afterFrame) &&
        vt?.pendingPages === 0 &&
        vt?.outstandingPageRequests === 0
      ) stableFrames += 1;
      else stableFrames = 0;
      lastPages = currentPages;
    }
    const vt = renderer?.virtualTexturing;
    const currentPageUrls = pageUrls();
    const previousPages = new Set(previousPageUrls);
    return {
      contextLastError: renderer?.context?.lastError ?? null,
      contextLifecycle: renderer?.context?.lifecycle ?? null,
      distance: Number(canvas.dataset.mapDistance),
      frame: renderer?.frame ?? null,
      outstandingPageRequests: vt?.outstandingPageRequests ?? null,
      pageCount: currentPages,
      pageUrls: currentPageUrls,
      newPageUrls: currentPageUrls.filter((url) => !previousPages.has(url)),
      pendingPages: vt?.pendingPages ?? null,
      settled: stableFrames >= 8,
      targetX: Number(canvas.dataset.mapTargetX),
      targetY: Number(canvas.dataset.mapTargetY),
    };
  };
  const presets = [await waitForConvergence(null, [])];
  for (const button of buttons.slice(1)) {
    const frame = rendererSnapshot()?.frame ?? null;
    const previousPageUrls = pageUrls();
    button.click();
    presets.push(await waitForConvergence(frame, previousPageUrls));
  }
  const overviewFrame = rendererSnapshot()?.frame ?? null;
  const previousOverviewPageUrls = pageUrls();
  buttons[0].click();
  presets.push(await waitForConvergence(overviewFrame, previousOverviewPageUrls));
  const zoomFrame = rendererSnapshot()?.frame ?? null;
  const previousZoomPageUrls = pageUrls();
  for (let step = 0; step < 8; step += 1) {
    canvas.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: -200,
    }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  await globalThis.__royalExamplesRenderNow?.();
  const zoom = await waitForConvergence(zoomFrame, previousZoomPageUrls);
  for (let step = 0; step < 8; step += 1) {
    canvas.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: 200,
    }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  await waitForConvergence(rendererSnapshot()?.frame ?? null, pageUrls());
  const farFrame = rendererSnapshot()?.frame ?? null;
  canvas.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaY: 2000,
  }));
  await globalThis.__royalExamplesRenderNow?.();
  const farSettled = await waitForConvergence(farFrame, pageUrls());
  const far = {
    ...farSettled,
    residentPagesMip3: rendererSnapshot()?.virtualTexturing?.residentPagesMip3 ?? null,
  };
  canvas.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaY: -2000,
  }));
  await waitForConvergence(rendererSnapshot()?.frame ?? null, pageUrls());
  const panErrors = [];
  const recordPanError = (event) => panErrors.push(String(event.error?.stack ?? event.message ?? event.error));
  const recordPanRejection = (event) => panErrors.push(String(event.reason?.stack ?? event.reason));
  globalThis.addEventListener('error', recordPanError);
  globalThis.addEventListener('unhandledrejection', recordPanRejection);
  const rect = canvas.getBoundingClientRect();
  const pointerId = 1217;
  let clientX = rect.left + rect.width * 0.5;
  const clientY = rect.top + rect.height * 0.5;
  const startTargetX = Number(canvas.dataset.mapTargetX);
  const startTargetY = Number(canvas.dataset.mapTargetY);
  const frameBefore = rendererSnapshot()?.frame ?? null;
  const previousPanPageUrls = pageUrls();
  const dispatchPan = (type) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 1,
    buttons: type === 'pointerup' ? 0 : 4,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: 'mouse',
  }));
  let pointerDown = false;
  try {
    dispatchPan('pointerdown');
    pointerDown = true;
    for (let step = 0; step < 10; step += 1) {
      clientX += 10;
      dispatchPan('pointermove');
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
    dispatchPan('pointerup');
    pointerDown = false;
    await globalThis.__royalExamplesRenderNow?.();
    const settled = await waitForConvergence(frameBefore, previousPanPageUrls);
    return {
      far,
      pageUrls: pageUrls(),
      pan: {
        ...settled,
        errors: panErrors,
        frameAfter: rendererSnapshot()?.frame ?? settled.frame,
        frameBefore,
        startTargetX,
        startTargetY,
      },
      presets,
      zoom,
    };
  } finally {
    if (pointerDown) dispatchPan('pointerup');
    globalThis.removeEventListener('error', recordPanError);
    globalThis.removeEventListener('unhandledrejection', recordPanRejection);
  }
})()
`);

const runContextLossSmoke = async (session) => evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  const snapshot = () => globalThis.__royalExamplesRendererBenchmarkSnapshot?.() ?? null;
  if (canvas === null) return { status: 'error', reason: 'missing canvas' };
  if (snapshot()?.context?.lifecycle !== 'active') {
    return { status: 'error', reason: 'renderer context snapshot was not active before loss', snapshot: snapshot() };
  }
  const gl = canvas.getContext('webgl2');
  if (gl === null) return { status: 'error', reason: 'canvas no longer returned its WebGL2 context' };
  const extension = gl.getExtension('WEBGL_lose_context');
  if (extension === null) return { status: 'unsupported', reason: 'WEBGL_lose_context unavailable' };

  const waitFor = async (predicate, timeoutMs = 5000) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const value = snapshot();
      if (predicate(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return snapshot();
  };
  const before = snapshot();
  extension.loseContext();
  const lost = await waitFor((value) => value?.context?.lifecycle === 'lost');
  if (lost?.context?.lifecycle !== 'lost') {
    return { status: 'error', reason: 'renderer never published lost context state', before, lost };
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  const settledLost = snapshot();
  if (settledLost?.frame !== lost.frame) {
    return { status: 'error', reason: 'one-shot demand frame advanced while context was lost', lost, settledLost };
  }

  extension.restoreContext();
  const restored = await waitFor((value) =>
    value?.context?.lifecycle === 'active' &&
    value.context.restores >= before.context.restores + 1 &&
    value.context.generation > before.context.generation
  );
  if (restored?.context?.lifecycle !== 'active') {
    return { status: 'error', reason: 'renderer never returned to active context state', before, restored };
  }
  globalThis.__royalExamplesRenderNow?.();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  globalThis.__royalExamplesRenderNow?.();

  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.min(160, canvas.width));
  sample.height = Math.max(1, Math.min(160, canvas.height));
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (context === null) return { status: 'error', reason: '2D capture context unavailable', restored };
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let paintedPixels = 0;
  let checksum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] !== 0) paintedPixels += 1;
    checksum = (checksum + pixels[index] * 3 + pixels[index + 1] * 5 + pixels[index + 2] * 7 + pixels[index + 3]) >>> 0;
  }
  const afterCapture = snapshot();
  if (paintedPixels === 0 || checksum === 0 || afterCapture?.frame <= lost.frame) {
    return {
      status: 'error',
      reason: 'restored renderer did not produce a fresh usable pixel capture',
      afterCapture,
      checksum,
      lost,
      paintedPixels,
      restored,
    };
  }
  return { status: 'ok', afterCapture, before, checksum, lost, paintedPixels, restored };
})()
`);

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-examples-smoke-'));
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
    '--use-gl=angle',
    ...(gpuMode === 'swiftshader'
      ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
      : [
        '--use-angle=vulkan',
        '--ignore-gpu-blocklist',
        '--disable-software-rasterizer',
        '--use-gpu-in-tests',
      ]),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { cwd: appRoot });

  let session;
  const exceptions = [];
  const consoleMessages = [];

  try {
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    session.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'warning' && event.type !== 'error') return;
      const text = event.args
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ');
      if (text !== '') consoleMessages.push(`${event.type}: ${text}`);
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');

    const gpu = await evaluate(session, `
      (() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (gl === null) return null;
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        return debug === null ? null : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
      })()
    `);
    if (gpuMode === 'hardware-headless' &&
      (gpu === null || /SwiftShader|Subzero|llvmpipe|lavapipe|software/iu.test(gpu))) {
      throw new Error(`Hardware GPU smoke resolved to software rendering: ${gpu ?? 'unknown renderer'}`);
    }
    console.log(`gpu ${gpu ?? 'renderer unavailable'}`);

    const selectedRoutes = routeFilter === ''
      ? smokeRoutes
      : smokeRoutes.filter((route) =>
        route.id === routeFilter ||
        route.path === routeFilter ||
        route.path === `/${routeFilter}`
      );
    if (selectedRoutes.length === 0) {
      throw new Error(`Examples smoke route filter did not match a route: ${routeFilter}`);
    }
    let contextLossChecked = false;

    for (const route of selectedRoutes) {
      const routeUrl = new URL(baseUrl + route.path);
      for (const [name, value] of new URLSearchParams(routeQuery)) {
        routeUrl.searchParams.set(name, value);
      }
      const selectedCaseName = routeUrl.searchParams.get('case');
      const selectedCase = selectedCaseName === null ? undefined : gltfLabCaseByName.get(selectedCaseName);
      if (selectedCaseName !== null && selectedCase === undefined) {
        throw new Error(`Unknown glTF lab case: ${selectedCaseName}`);
      }
      if (selectedCase?.status !== undefined &&
        selectedCase.status !== 'supported-oracle' && selectedCase.status !== 'normalized-ingestion') {
        throw new Error(`glTF lab success smoke cannot render ${selectedCase.name}: ${selectedCase.status}`);
      }
      const effectiveRoute = selectedCase === undefined
        ? { ...route, path: routeUrl.pathname + routeUrl.search }
        : {
          ...route,
          absentResourceSubstrings: [],
          minColorBuckets: 1,
          minPaintedRatio: 0.0001,
          path: routeUrl.pathname + routeUrl.search,
          resourceSubstrings: [gltfLabResourceSubstring(selectedCase)],
        };
      const routeLoaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: routeUrl.href });
      await Promise.race([routeLoaded, sleep(5_000)]);
      let state = await waitForRouteState(session, effectiveRoute);
      if ((state.canvas?.sample?.paintedPixels ?? 0) === 0) {
        const compositedSample = await compositedCanvasSample(session);
        if (compositedSample !== undefined && state.canvas !== undefined) {
          state = { ...state, canvas: { ...state.canvas, sample: compositedSample } };
        }
      }
      if (route.id === 'picking') {
        state = {
          ...state,
          pickingInteraction: await runPickingInteractionSmoke(session),
        };
      }
      if (route.id === 'virtual-texture-stress') {
        const virtualTextureInteraction = await runVirtualTextureInteractionSmoke(session);
        const refreshedSample = await compositedCanvasSample(session);
        state = {
          ...state,
          ...(refreshedSample === undefined || state.canvas === undefined
            ? {}
            : { canvas: { ...state.canvas, sample: refreshedSample } }),
          virtualTextureInteraction,
        };
      }
      try {
        assertRoute(effectiveRoute, state);
      } catch (error) {
        const recentConsole = consoleMessages.slice(-8).join('; ');
        const recentResources = (state.resources ?? [])
          .map((resource) => `${resource.name} duration=${resource.duration}ms size=${resource.size}`)
          .join('; ');
        const interactionDiagnostics = state.virtualTextureInteraction === undefined
          ? ''
          : JSON.stringify(state.virtualTextureInteraction);
        throw new Error(`${error instanceof Error ? error.message : String(error)}${
          recentConsole === '' ? '' : `; console: ${recentConsole}`
        }${
          recentResources === '' ? '' : `; resources: ${recentResources}`
        }${
          interactionDiagnostics === '' ? '' : `; interaction: ${interactionDiagnostics}`
        }`);
      }
      if (contextLossSmoke && !contextLossChecked) {
        const lifecycle = await runContextLossSmoke(session);
        if (lifecycle.status === 'error') {
          throw new Error(`context-loss smoke failed: ${lifecycle.reason}; ${JSON.stringify(lifecycle)}`);
        }
        contextLossChecked = true;
        console.log(lifecycle.status === 'unsupported'
          ? `skip context-loss ${lifecycle.reason}`
          : `ok context-loss generation=${lifecycle.restored.context.generation} painted=${lifecycle.paintedPixels}`);
      }
      const canvasSummary = state.canvas?.sample === undefined
        ? ''
        : ` buckets=${state.canvas.sample.colorBuckets} painted=${state.canvas.sample.paintedRatio.toFixed(3)} luma=${state.canvas.sample.meanPaintedLuminance.toFixed(3)} p25=${state.canvas.sample.paintedLuminanceP25.toFixed(3)} p50=${state.canvas.sample.paintedLuminanceP50.toFixed(3)} p75=${state.canvas.sample.paintedLuminanceP75.toFixed(3)} chroma=${state.canvas.sample.meanPaintedChroma.toFixed(3)} saturation=${state.canvas.sample.meanPaintedSaturation.toFixed(3)}`;
      console.log(`ok ${route.id}${canvasSummary}`);
    }

    if (contextLossSmoke && !contextLossChecked) {
      throw new Error('Context-loss smoke did not run on a selected route');
    }

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
