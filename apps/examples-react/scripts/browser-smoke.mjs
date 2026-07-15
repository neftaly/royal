import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  connectCdpPage,
  evaluate,
  spawnLogged,
  startVitePreview,
  stopProcess,
  waitForHttp,
} from './browser-harness.mjs';
import {
  exampleContract,
  rendererSnapshotExpression,
  requireExampleRoute,
} from './example-contract.mjs';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_SMOKE_PORT ?? 4573);
const debugPort = Number(process.env.EXAMPLES_SMOKE_DEBUG_PORT ?? 4574);
const debugHost = process.env.EXAMPLES_SMOKE_DEBUG_HOST?.trim() || host;
const baseUrl = process.env.EXAMPLES_SMOKE_BASE_URL?.trim() || `http://${host}:${previewPort}`;
const browserMode = process.env.EXAMPLES_SMOKE_BROWSER?.trim() || 'chromium';
const managePreview = process.env.EXAMPLES_SMOKE_PREVIEW !== '0';
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
const cdpCommandTimeoutMs = envNumber(
  'EXAMPLES_SMOKE_CDP_TIMEOUT_MS',
  Math.max(30_000, routeReadyTimeoutMs + 10_000),
);
const contextLossSmoke = process.env.EXAMPLES_SMOKE_CONTEXT_LOSS === '1';
const reactLifecycleSmoke = process.env.EXAMPLES_SMOKE_REACT_LIFECYCLE === '1';

if (!new Set(['cdp', 'chromium']).has(browserMode)) {
  throw new Error(
    `EXAMPLES_SMOKE_BROWSER must be "cdp" or "chromium", received ${JSON.stringify(browserMode)}`,
  );
}

const gltfLabManifest = JSON.parse(readFileSync(
  new URL('../src/examples/gltf-lab-manifest.json', import.meta.url),
  'utf8',
));
const gltfLabCaseByName = new Map(gltfLabManifest.cases.map((entry) => [entry.name, entry]));
const gltfLabResourceSubstring = (entry) => `/${entry.path}`;

const smokeExpectations = {
  cube: {
    minPaintedRatio: 0.01,
  },
  wireframe: {
    minPaintedRatio: 0.003,
  },
  picking: {
    gltfReady: true,
    minColorBuckets: 6,
    minPaintedRatio: 0.01,
  },
  'texture-materials': {
    minPaintedRatio: 0.01,
  },
  'virtual-texture-stress': {
    resourceSubstrings: [
      '/fixtures/virtual-texture-stress/map.vt.json',
      '/fixtures/virtual-texture-stress/map-pages/m3-0-0.svg',
    ],
    minColorBuckets: 8,
    minPaintedRatio: 0.02,
    virtualTextureRecovery: true,
  },
  'standard-lighting': {
    minColorBuckets: 12,
    minPaintedRatio: 0.01,
  },
  'gltf-helmet': {
    minColorBuckets: 32,
    minPaintedRatio: 0.01,
  },
  'gltf-instancing': {
    minColorBuckets: 8,
    minPaintedRatio: 0.01,
  },
  'gltf-lab': {
    resourceSubstrings: [gltfLabResourceSubstring(gltfLabCaseByName.get('Box'))],
    minColorBuckets: 1,
    minPaintedRatio: 0.0001,
  },
  'gltf-ghostscript-tiger-svg': {
    minColorBuckets: 18,
    minPaintedRatio: 0.006,
    virtualTextureRecovery: true,
  },
  'gltf-lod': {
    minColorBuckets: 8,
    minPaintedRatio: 0.004,
  },
  'gltf-variants': {
    minColorBuckets: 8,
    minPaintedRatio: 0.006,
  },
  'webxr-vr': {
    minColorBuckets: 10,
    minPaintedRatio: 0.01,
  },
};

const smokeRoutes = Object.entries(smokeExpectations).map(([id, expectation]) => ({
  ...requireExampleRoute(id),
  ...expectation,
  ...(id === 'gltf-lab' ? { path: '/gltf-lab?case=Box' } : {}),
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectPage = () => connectCdpPage({
  closeExtraPages: true,
  commandTimeoutMs: cdpCommandTimeoutMs,
  debugHost,
  debugPort,
  rewriteWebSocketAuthority: true,
});

const smokeExpression = `
(async () => {
  const smokeExpectations = ${JSON.stringify(Object.fromEntries(
    smokeRoutes.map(({ id, ...expectation }) => [id, expectation]),
  ))};
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
        gltfReady: smoke?.gltfReady === true,
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
      picking: routeId === 'picking' ? (() => {
        const readout = document.querySelector('[data-royal-picking-hovered-id]');
        return {
          hoveredId: readout?.dataset.royalPickingHoveredId ?? '',
          text: readout?.textContent?.trim() ?? '',
        };
      })() : undefined,
      renderer: ${rendererSnapshotExpression},
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
    const gltfDiagnosticsReady = !(state.route.gltfReady || state.route.id.startsWith('gltf-')) ||
      (
        Array.isArray(state.renderer?.gltfLoadDiagnostics?.assets) &&
        state.renderer.gltfLoadDiagnostics.assets.length > 0 &&
        state.renderer.gltfLoadDiagnostics.assets.some((asset) =>
          asset.status === 'sceneReady' && typeof asset.phaseMs?.toSceneReady === 'number'
        )
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
const captureCompositedCanvas = async (session) => {
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
  return capture.data;
};

const compositedCanvasSample = async (session) => {
  const capture = await captureCompositedCanvas(session);
  if (capture === undefined) return undefined;
  return evaluate(session, `
    (async () => {
      const response = await fetch('data:image/png;base64,${capture}');
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

const waitForSvgTextureMode = async (session, expectedMode) => evaluate(session, `
(async () => {
  const deadline = performance.now() + 12000;
  let stableFrames = 0;
  let sample;
  while (performance.now() < deadline && stableFrames < 6) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const container = document.querySelector('.svg-texture-example');
    const renderer = ${rendererSnapshotExpression};
    const virtualTexturing = renderer?.virtualTexturing;
    sample = {
      activePages: virtualTexturing?.activePages ?? null,
      frame: renderer?.frame ?? null,
      lifecycleError: renderer?.lifecycle?.error ?? null,
      lifecycleState: renderer?.lifecycle?.state ?? null,
      mode: container?.getAttribute('data-svg-texture-mode') ?? null,
      outstandingPageRequests: virtualTexturing?.outstandingPageRequests ?? null,
      pendingPages: virtualTexturing?.pendingPages ?? null,
      sceneReadyAssets: renderer?.gltfLoadDiagnostics?.assets
        ?.filter((asset) => asset.status === 'sceneReady').length ?? null,
    };
    const expectedResidency = '${expectedMode}' === 'virtual'
      ? sample.activePages > 0
      : sample.activePages === 0;
    if (
      sample.mode === '${expectedMode}'
      && sample.lifecycleState === 'available'
      && sample.lifecycleError === null
      && sample.sceneReadyAssets > 0
      && sample.pendingPages === 0
      && sample.outstandingPageRequests === 0
      && expectedResidency
    ) stableFrames += 1;
    else stableFrames = 0;
  }
  return { ...sample, settled: stableFrames >= 6 };
})()
`);

const captureSvgTextureCanvas = async (session) => {
  await evaluate(session, `
    (() => {
      const control = document.querySelector('.svg-texture-mode');
      if (control instanceof HTMLElement) control.style.visibility = 'hidden';
    })()
  `);
  try {
    return await captureCompositedCanvas(session);
  } finally {
    await evaluate(session, `
      (() => {
        const control = document.querySelector('.svg-texture-mode');
        if (control instanceof HTMLElement) control.style.removeProperty('visibility');
      })()
    `);
  }
};

const runSvgTextureParitySmoke = async (session) => {
  const virtual = await waitForSvgTextureMode(session, 'virtual');
  if (virtual.settled !== true) return { error: 'generated VT mode did not settle', virtual };
  const virtualCapture = await captureSvgTextureCanvas(session);
  if (virtualCapture === undefined) return { error: 'could not capture generated VT mode', virtual };

  let ordinary;
  try {
    await evaluate(session, `
      (() => {
        const control = document.querySelector('.svg-texture-mode');
        if (!(control instanceof HTMLButtonElement)) return false;
        control.click();
        return true;
      })()
    `);
    ordinary = await waitForSvgTextureMode(session, 'ordinary');
    if (ordinary.settled !== true) {
      return { error: 'ordinary SVG texture mode did not settle', ordinary, virtual };
    }
    const ordinaryCapture = await captureSvgTextureCanvas(session);
    if (ordinaryCapture === undefined) {
      return { error: 'could not capture ordinary SVG texture mode', ordinary, virtual };
    }
    const comparison = await evaluate(session, `
      (async () => {
        const decode = async (data) => {
          const response = await fetch('data:image/png;base64,' + data);
          return createImageBitmap(await response.blob());
        };
        const [virtualBitmap, ordinaryBitmap] = await Promise.all([
          decode('${virtualCapture}'),
          decode('${ordinaryCapture}'),
        ]);
        const width = 160;
        const height = Math.max(1, Math.round(width * virtualBitmap.height / virtualBitmap.width));
        const pixels = (bitmap) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context === null) return undefined;
          context.drawImage(bitmap, 0, 0, width, height);
          return context.getImageData(0, 0, width, height).data;
        };
        const virtualPixels = pixels(virtualBitmap);
        const ordinaryPixels = pixels(ordinaryBitmap);
        virtualBitmap.close();
        ordinaryBitmap.close();
        if (virtualPixels === undefined || ordinaryPixels === undefined) {
          return { error: '2D comparison context unavailable' };
        }
        const errors = [];
        let changedPixels = 0;
        let sum = 0;
        let sumSquares = 0;
        for (let index = 0; index < virtualPixels.length; index += 4) {
          const error = (
            Math.abs(virtualPixels[index] - ordinaryPixels[index])
            + Math.abs(virtualPixels[index + 1] - ordinaryPixels[index + 1])
            + Math.abs(virtualPixels[index + 2] - ordinaryPixels[index + 2])
          ) / (3 * 255);
          errors.push(error);
          sum += error;
          sumSquares += error * error;
          if (error > 0.1) changedPixels += 1;
        }
        errors.sort((left, right) => left - right);
        const count = errors.length;
        return {
          changedPixelRatio: changedPixels / count,
          height,
          meanAbsoluteError: sum / count,
          p95Error: errors[Math.min(count - 1, Math.floor(count * 0.95))],
          rootMeanSquareError: Math.sqrt(sumSquares / count),
          width,
        };
      })()
    `);
    return { comparison, ordinary, virtual };
  } finally {
    if (ordinary?.mode === 'ordinary') {
      await evaluate(session, `document.querySelector('.svg-texture-mode')?.click()`);
      await waitForSvgTextureMode(session, 'virtual');
    }
  }
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
    } else if (state.picking.text.length === 0) {
      failures.push('picking route readout is not visible');
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
      if (interaction.outlineMissIds?.some((id) => id !== 'none')) {
        failures.push(`picking selected outside helmet outline: ${interaction.outlineMissIds.join(',')}`);
      }
      if (interaction.before === interaction.hoveredId) {
        failures.push(`picking hover readout did not change from "${interaction.before}"`);
      }
    }
  }

  if (expected.id === 'gltf-variants') {
    const interaction = state.variantInteraction;
    if (interaction === undefined) {
      failures.push('glTF variants route missed selection interaction smoke');
    } else if (interaction.error !== undefined) {
      failures.push(`glTF variants interaction smoke failed: ${interaction.error}`);
    } else if (interaction.selections?.join(',') !== 'ruby,mint,slate') {
      failures.push(`glTF variants selected ${interaction.selections?.join(',')}, expected ruby,mint,slate`);
    } else if (interaction.pressed?.join(',') !== 'ruby,mint,slate') {
      failures.push(`glTF variants pressed state was ${interaction.pressed?.join(',')}, expected ruby,mint,slate`);
    }
  }

  if (expected.id === 'gltf-ghostscript-tiger-svg') {
    const parity = state.svgTextureParity;
    if (parity === undefined) {
      failures.push('SVG texture route missed generated-VT parity smoke');
    } else if (parity.error !== undefined) {
      failures.push(`SVG texture parity smoke failed: ${parity.error}`);
    } else if (parity.comparison?.error !== undefined) {
      failures.push(`SVG texture comparison failed: ${parity.comparison.error}`);
    } else {
      if (!(parity.comparison?.meanAbsoluteError < 0.015)) {
        failures.push(`SVG generated VT mean pixel error was ${parity.comparison?.meanAbsoluteError ?? 'unknown'}`);
      }
      if (!(parity.comparison?.changedPixelRatio < 0.05)) {
        failures.push(`SVG generated VT changed-pixel ratio was ${parity.comparison?.changedPixelRatio ?? 'unknown'}`);
      }
      if (
        parity.virtual?.activePages <= 0
        || parity.ordinary?.activePages !== 0
      ) {
        failures.push('SVG parity modes did not exercise distinct generated-VT and ordinary residency');
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
      const pressureSamples = [
        ...(interaction.presets ?? []),
        interaction.zoom,
        interaction.far,
        interaction.reactivation,
        interaction.pan,
      ].filter((sample) => sample !== undefined);
      const physicalAllocatedBytes = interaction.presets?.[0]?.physicalAllocatedBytes;
      const ordinaryGpuBytes = interaction.presets?.[0]?.ordinaryGpuBytes;
      if (
        !(physicalAllocatedBytes > 0)
        || !pressureSamples.every((sample) => (
          sample.physicalAllocatedBytes === physicalAllocatedBytes
          && sample.physicalAllocatedBytes <= sample.physicalBudgetBytes
          && sample.physicalQuarantinedBytes === 0
          && sample.virtualGpuBytes === sample.physicalAllocatedBytes
        ))
      ) {
        failures.push('virtual texture page pressure changed atlas allocation, exceeded budget, leaked quarantine, or diverged from governor accounting');
      }
      if (
        !(ordinaryGpuBytes > 0)
        || !pressureSamples.every((sample) => sample.ordinaryGpuBytes === ordinaryGpuBytes)
      ) {
        failures.push('virtual texture page pressure displaced or duplicated the protected ordinary texture');
      }
      if (!(
        interaction.pan?.uploadedPages > interaction.pan?.cachedPages
        && interaction.pan?.cachedPages > 0
        && interaction.pan?.cachedPages <= 24
      )) {
        failures.push('virtual texture pressure did not reuse fixed physical slots across more uploaded than cached pages');
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
      if (interaction.pan?.lifecycleState !== 'available') {
        failures.push(`virtual texture map pan left the renderer ${interaction.pan?.lifecycleState ?? 'unavailable'}`);
      }
      if (interaction.pan?.lifecycleError !== null) {
        failures.push(`virtual texture map pan reported a renderer error: ${interaction.pan?.lifecycleError ?? 'unavailable'}`);
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
      if (interaction.zoom?.lifecycleState !== 'available') {
        failures.push(`virtual texture close zoom left the renderer ${interaction.zoom?.lifecycleState ?? 'unavailable'}`);
      }
      if (interaction.zoom?.lifecycleError !== null) {
        failures.push(`virtual texture close zoom reported a renderer error: ${interaction.zoom?.lifecycleError ?? 'unavailable'}`);
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
      if (interaction.far?.lifecycleState !== 'available' || interaction.far?.lifecycleError !== null) {
        failures.push('virtual texture far zoom did not preserve an available error-free renderer');
      }
      if (interaction.far?.activePages !== 1) {
        failures.push(`virtual texture far zoom kept ${interaction.far?.activePages ?? 'unknown'} active pages instead of one`);
      }
      if (interaction.far?.activePagesMip3 !== 1) {
        failures.push(`virtual texture far zoom kept ${interaction.far?.activePagesMip3 ?? 'unknown'} active mip-3 pages instead of the root page`);
      }
      if (!(
        Number.isFinite(interaction.far?.cachedPages) &&
        interaction.far.cachedPages >= interaction.far.activePages
      )) {
        failures.push('virtual texture far zoom did not report a reusable cache containing its active page');
      }
      if (!((interaction.far?.cachedPagesMip3 ?? 0) >= 1)) {
        failures.push('virtual texture far zoom did not retain the coarsest root page');
      }
      if (interaction.reactivation?.lifecycleState !== 'available' || interaction.reactivation?.lifecycleError !== null) {
        failures.push('virtual texture cache reactivation did not preserve an available error-free renderer');
      }
      // A slow or heavily loaded runner can reach the deadline immediately after the
      // final cached page-table publication, before eight redundant stable
      // samples accrue. The semantic convergence boundary is stronger here:
      // fine pages are active and no decode/request work remains.
      if (
        !(interaction.reactivation?.activePages > 1) ||
        interaction.reactivation?.pendingPages !== 0 ||
        interaction.reactivation?.outstandingPageRequests !== 0
      ) {
        failures.push('virtual texture zoom-back did not reactivate cached fine pages');
      }
      const reactivationRequestLimit = Math.max(
        2,
        Math.ceil((interaction.reactivation?.activePages ?? 0) * 0.25),
      );
      // Resource Timing entries and atlas settlements are not one-to-one: a
      // decoded page may need another atlas upload without another fetch. Keep
      // network misses below one quarter and require at least two thirds of the
      // previous atlas working set to survive the round trip.
      const reactivationUploadLimit = Math.ceil(
        (interaction.reactivation?.activePages ?? 0) / 3,
      );
      const reactivationUploads = (
        interaction.reactivation?.uploadedPages ?? Number.POSITIVE_INFINITY
      ) - (interaction.far?.uploadedPages ?? 0);
      if (
        (interaction.reactivation?.newPageRequestCount ?? Number.POSITIVE_INFINITY) > reactivationRequestLimit ||
        reactivationUploads > reactivationUploadLimit
      ) {
        failures.push(`virtual texture zoom-back did not substantially reuse cache (${interaction.reactivation?.newPageRequestCount ?? 'unknown'}/${reactivationRequestLimit} requests, ${reactivationUploads}/${reactivationUploadLimit} uploads for ${interaction.reactivation?.activePages ?? 'unknown'} active pages)`);
      }
      if (interaction.resize?.error !== undefined) {
        failures.push(`virtual texture resize smoke failed: ${interaction.resize.error}`);
      } else {
        const expectedDpr = interaction.resize?.before?.devicePixelRatio;
        const beforeWidth = interaction.resize?.before?.backingWidth;
        const narrowWidth = interaction.resize?.narrow?.backingWidth;
        const restoredWidth = interaction.resize?.restored?.backingWidth;
        if (!(narrowWidth < beforeWidth * 0.8)) {
          failures.push(`virtual texture resize did not shrink the drawing buffer (${beforeWidth ?? 'unknown'} -> ${narrowWidth ?? 'unknown'})`);
        }
        if (!(Math.abs(restoredWidth - beforeWidth) <= 2)) {
          failures.push(`virtual texture resize did not restore the drawing buffer (${beforeWidth ?? 'unknown'} -> ${restoredWidth ?? 'unknown'})`);
        }
        for (const [label, sample] of [
          ['narrow', interaction.resize?.narrow],
          ['restored', interaction.resize?.restored],
        ]) {
          if (
            !Number.isFinite(expectedDpr)
            || Math.abs(sample?.devicePixelRatio - expectedDpr) > 0.000_001
          ) {
            failures.push(`virtual texture ${label} resize changed DPR from ${expectedDpr ?? 'unknown'} to ${sample?.devicePixelRatio ?? 'unknown'}`);
          }
          if (
            !Number.isFinite(sample?.cssWidth) ||
            !Number.isFinite(sample?.backingWidth) ||
            Math.abs(sample.backingWidth - sample.cssWidth * sample.devicePixelRatio) > 2
          ) {
            failures.push(`virtual texture ${label} drawing buffer did not track CSS pixels at DPR ${sample?.devicePixelRatio ?? 'unknown'}`);
          }
        }
        if (
          interaction.resize?.narrow?.lifecycleState !== 'available' ||
          interaction.resize?.restored?.lifecycleState !== 'available' ||
          interaction.resize?.narrow?.lifecycleError !== null ||
          interaction.resize?.restored?.lifecycleError !== null
        ) {
          failures.push('virtual texture resize did not preserve an available error-free renderer');
        }
        for (const [label, sample] of [
          ['narrow', interaction.resize?.narrow],
          ['restored', interaction.resize?.restored],
        ]) {
          if (!(
            Number.isFinite(sample?.activePages) &&
            Number.isFinite(sample?.cachedPages) &&
            sample.activePages <= sample.cachedPages
          )) {
            failures.push(`virtual texture ${label} resize exceeded its cached working set`);
          }
        }
        if (
          interaction.resize?.restored?.pendingPages !== 0 ||
          interaction.resize?.restored?.outstandingPageRequests !== 0
        ) {
          failures.push('virtual texture resize did not converge after restoring its drawing buffer');
        }
      }
      const orientation = interaction.orientation;
      if (orientation?.status === 'unsupported') {
        if (
          orientation?.before?.error !== undefined
          || orientation?.portrait?.error !== undefined
        ) {
          failures.push('virtual texture orientation capability check could not read the canvas');
        }
      } else if (
        orientation?.before?.error !== undefined
        || orientation?.portrait?.error !== undefined
        || orientation?.restored?.error !== undefined
      ) {
        failures.push('virtual texture orientation smoke could not read the canvas');
      } else {
        const before = orientation?.before;
        const portrait = orientation?.portrait;
        const restored = orientation?.restored;
        if (portrait?.settled !== true || restored?.settled !== true) {
          failures.push('virtual texture orientation change did not settle in both directions');
        }
        if (
          portrait?.innerWidth !== 600
          || portrait?.innerHeight !== 800
          || restored?.innerWidth !== 800
          || restored?.innerHeight !== 600
        ) {
          failures.push('virtual texture orientation smoke did not apply and restore viewport metrics');
        }
        if (!(portrait?.backingWidth < before?.backingWidth)) {
          failures.push(`virtual texture portrait orientation did not shrink the drawing buffer (${before?.backingWidth ?? 'unknown'} -> ${portrait?.backingWidth ?? 'unknown'})`);
        }
        if (
          Math.abs((restored?.backingWidth ?? Number.POSITIVE_INFINITY) - (before?.backingWidth ?? 0)) > 2
          || Math.abs((restored?.backingHeight ?? Number.POSITIVE_INFINITY) - (before?.backingHeight ?? 0)) > 2
        ) {
          failures.push('virtual texture landscape restoration did not restore the drawing buffer');
        }
        for (const [label, sample] of [['portrait', portrait], ['restored', restored]]) {
          if (
            !Number.isFinite(sample?.devicePixelRatio)
            || Math.abs(sample.backingWidth - sample.cssWidth * sample.devicePixelRatio) > 2
            || Math.abs(sample.backingHeight - sample.cssHeight * sample.devicePixelRatio) > 2
          ) {
            failures.push(`virtual texture ${label} orientation drawing buffer did not track CSS pixels at DPR ${sample?.devicePixelRatio ?? 'unknown'}`);
          }
          if (
            sample?.lifecycleState !== 'available'
            || sample?.lifecycleError !== null
            || sample?.pendingPages !== 0
            || sample?.outstandingPageRequests !== 0
          ) {
            failures.push(`virtual texture ${label} orientation did not preserve a settled renderer`);
          }
        }
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

  if (expected.gltfReady === true || expected.id.startsWith('gltf-')) {
    const gltfLoadDiagnostics = state.renderer?.gltfLoadDiagnostics;
    const assets = gltfLoadDiagnostics?.assets;
    if (!Array.isArray(assets) || assets.length === 0) {
      failures.push('missing glTF loading diagnostics');
    } else if (!assets.some((asset) => asset.status === 'sceneReady')) {
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

const runPickingInteractionSmoke = async (session) => evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  if (canvas === null) return { error: 'missing picking canvas' };
  const readout = document.querySelector('[data-royal-picking-hovered-id]');
  if (readout === null) return { error: 'missing visible picking readout' };
  const readHoveredId = () =>
    readout.dataset.royalPickingHoveredId ?? '';
  if (typeof PointerEvent !== 'function') return { error: 'missing PointerEvent' };
  const rect = canvas.getBoundingClientRect();
  const hoverPoints = [
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 },
    { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.56 },
    { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.5 },
    { x: rect.left + rect.width * 0.55, y: rect.top + rect.height * 0.5 },
  ];
  const outlineMissPoints = [
    { x: rect.left + rect.width * 0.68, y: rect.top + rect.height * 0.22 },
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
  const outlineMissIds = [];
  for (const point of outlineMissPoints) {
    dispatch('pointermove', point);
    let outlineId = readHoveredId();
    for (let attempt = 0; attempt < 5 && outlineId !== 'none'; attempt += 1) {
      await animationFrame();
      outlineId = readHoveredId();
    }
    outlineMissIds.push(outlineId);
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

  return {
    before,
    clearedId,
    hoveredId,
    hoveredPoint,
    leaveClearedId: readHoveredId(),
    outlineMissIds,
  };
})()
`);

const runVirtualTextureViewportConvergence = async (session, previous = null) => evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  if (canvas === null) return { error: 'missing virtual texture canvas during viewport change' };
  const previous = ${JSON.stringify(previous)};
  const rendererSnapshot = () => ${rendererSnapshotExpression};
  const deadline = performance.now() + 8000;
  let lastState = '';
  let stableFrames = 0;
  let sample;
  while (performance.now() < deadline && stableFrames < 8) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const renderer = rendererSnapshot();
    const rect = canvas.getBoundingClientRect();
    const vt = renderer?.virtualTexturing;
    sample = {
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      cssHeight: rect.height,
      cssWidth: rect.width,
      devicePixelRatio: devicePixelRatio,
      frame: renderer?.frame ?? null,
      innerHeight,
      innerWidth,
      lifecycleError: renderer?.lifecycle?.error ?? null,
      lifecycleState: renderer?.lifecycle?.state ?? null,
      outstandingPageRequests: vt?.outstandingPageRequests ?? null,
      pendingPages: vt?.pendingPages ?? null,
    };
    const changed = previous === null || (
      sample.innerWidth !== previous.innerWidth
      || sample.innerHeight !== previous.innerHeight
      || sample.backingWidth !== previous.backingWidth
      || sample.backingHeight !== previous.backingHeight
    );
    const advanced = previous === null || sample.frame > previous.frame;
    const state = JSON.stringify(sample);
    if (
      changed
      && advanced
      && sample.lifecycleState === 'available'
      && sample.lifecycleError === null
      && sample.pendingPages === 0
      && sample.outstandingPageRequests === 0
      && state === lastState
    ) stableFrames += 1;
    else stableFrames = 0;
    lastState = state;
  }
  return { ...sample, settled: stableFrames >= 8 };
})()
`);

const runVirtualTextureInteractionSmoke = async (session) => {
  if (browserMode === 'chromium') {
    await session.call('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 2,
      height: 600,
      mobile: false,
      width: 800,
    });
  }
  try {
    const interaction = await evaluate(session, `
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
  const rendererSnapshot = () => ${rendererSnapshotExpression};
  const waitForConvergence = async (afterFrame = null, previousPageUrls = [], expectedActivePages = null) => {
    const deadline = performance.now() + 8000;
    let currentPages = pageUrls().length;
    let lastPages = -1;
    let lastActivePages = -1;
    let lastCachedPages = -1;
    let stableFrames = 0;
    let renderer = rendererSnapshot();
    while (performance.now() < deadline && stableFrames < 8) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      currentPages = pageUrls().length;
      renderer = rendererSnapshot();
      const vt = renderer?.virtualTexturing;
      if (
        currentPages === lastPages &&
        vt?.activePages === lastActivePages &&
        vt?.cachedPages === lastCachedPages &&
        (expectedActivePages === null || vt?.activePages === expectedActivePages) &&
        (afterFrame === null || (renderer?.frame ?? -1) > afterFrame) &&
        vt?.pendingPages === 0 &&
        vt?.outstandingPageRequests === 0
      ) stableFrames += 1;
      else stableFrames = 0;
      lastPages = currentPages;
      lastActivePages = vt?.activePages ?? -1;
      lastCachedPages = vt?.cachedPages ?? -1;
    }
    const vt = renderer?.virtualTexturing;
    const currentPageUrls = pageUrls();
    const previousPages = new Set(previousPageUrls);
    const canvasRect = canvas.getBoundingClientRect();
    const pressure = renderer?.resourcePressure;
    return {
      activePages: vt?.activePages ?? null,
      activePagesByMip: [0, 1, 2, 3].map((mip) => vt?.['activePagesMip' + mip] ?? 0),
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      cachedPages: vt?.cachedPages ?? null,
      cachedPagesByMip: [0, 1, 2, 3].map((mip) => vt?.['cachedPagesMip' + mip] ?? 0),
      lifecycleError: renderer?.lifecycle?.error ?? null,
      lifecycleState: renderer?.lifecycle?.state ?? null,
      cssHeight: canvasRect.height,
      cssWidth: canvasRect.width,
      devicePixelRatio: window.devicePixelRatio,
      distance: Number(canvas.dataset.mapDistance),
      frame: renderer?.frame ?? null,
      outstandingPageRequests: vt?.outstandingPageRequests ?? null,
      pageCount: currentPages,
      pageUrls: currentPageUrls,
      newPageUrls: currentPageUrls.filter((url) => !previousPages.has(url)),
      newPageRequestCount: Math.max(0, currentPageUrls.length - previousPageUrls.length),
      ordinaryGpuBytes: pressure?.byClass?.['ordinary-texture']?.persistentGpuBytes ?? null,
      pendingPages: vt?.pendingPages ?? null,
      physicalAllocatedBytes: vt?.physicalAllocatedBytes ?? null,
      physicalBudgetBytes: vt?.physicalBudgetBytes ?? null,
      physicalQuarantinedBytes: vt?.physicalQuarantinedBytes ?? null,
      settled: stableFrames >= 8,
      targetX: Number(canvas.dataset.mapTargetX),
      targetY: Number(canvas.dataset.mapTargetY),
      uploadedPages: vt?.uploadedPages ?? null,
      virtualGpuBytes: pressure?.byClass?.['virtual-texture']?.persistentGpuBytes ?? null,
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
  const farSettled = await waitForConvergence(farFrame, pageUrls(), 1);
  const far = {
    ...farSettled,
    activePagesMip3: rendererSnapshot()?.virtualTexturing?.activePagesMip3 ?? null,
    cachedPagesMip3: rendererSnapshot()?.virtualTexturing?.cachedPagesMip3 ?? null,
  };
  const reactivationFrame = rendererSnapshot()?.frame ?? null;
  const previousReactivationPageUrls = pageUrls();
  canvas.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaY: -2000,
  }));
  await globalThis.__royalExamplesRenderNow?.();
  const reactivation = await waitForConvergence(reactivationFrame, previousReactivationPageUrls);
  const resizeContainer = canvas.closest('.vt-stress-canvas');
  let resize = { error: 'missing virtual texture resize container' };
  if (resizeContainer instanceof HTMLElement) {
    const originalInlineSize = resizeContainer.style.inlineSize;
    const beforeRect = canvas.getBoundingClientRect();
    const before = {
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      cssHeight: beforeRect.height,
      cssWidth: beforeRect.width,
      devicePixelRatio,
      lifecycleState: rendererSnapshot()?.lifecycle?.state ?? null,
      uploadedPages: rendererSnapshot()?.virtualTexturing?.uploadedPages ?? null,
    };
    resizeContainer.style.inlineSize = '62%';
    const narrow = await waitForConvergence(rendererSnapshot()?.frame ?? null, pageUrls());
    const narrowBackingWidth = canvas.width;
    resizeContainer.style.inlineSize = originalInlineSize;
    const restored = await waitForConvergence(rendererSnapshot()?.frame ?? null, pageUrls());
    resize = {
      before,
      narrow: { ...narrow, backingHeight: canvas.height, backingWidth: narrowBackingWidth },
      restored: { ...restored, backingHeight: canvas.height, backingWidth: canvas.width },
    };
  }
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
      reactivation,
      resize,
      zoom,
    };
  } finally {
    if (pointerDown) dispatchPan('pointerup');
    globalThis.removeEventListener('error', recordPanError);
    globalThis.removeEventListener('unhandledrejection', recordPanRejection);
  }
})()
    `);
    const before = await runVirtualTextureViewportConvergence(session);
    const orientationDpr = browserMode === 'chromium' ? 2 : before.devicePixelRatio;
    await session.call('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: orientationDpr,
      height: 800,
      mobile: false,
      width: 600,
    });
    const portrait = await runVirtualTextureViewportConvergence(session, before);
    if (portrait.innerWidth !== 600 || portrait.innerHeight !== 800) {
      return {
        ...interaction,
        orientation: {
          before,
          portrait,
          reason: 'CDP device-metrics override did not change the physical viewport',
          status: 'unsupported',
        },
      };
    }
    await session.call('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: orientationDpr,
      height: 600,
      mobile: false,
      width: 800,
    });
    const restored = await runVirtualTextureViewportConvergence(session, portrait);
    return { ...interaction, orientation: { before, portrait, restored, status: 'verified' } };
  } finally {
    await session.call('Emulation.clearDeviceMetricsOverride');
  }
};

const runGltfVariantsInteractionSmoke = async (session) => evaluate(session, `
(async () => {
  const root = document.querySelector('.gltf-variants');
  const buttons = [...document.querySelectorAll('.gltf-variants-actions button')];
  if (!(root instanceof HTMLElement)) return { error: 'missing glTF variants root' };
  if (buttons.length !== 3 || buttons.some((button) => !(button instanceof HTMLButtonElement))) {
    return { error: 'missing glTF variant selection buttons' };
  }
  const variantNames = buttons.map((button) => button.textContent?.trim() ?? '');
  const currentRoot = () => document.querySelector('.gltf-variants');
  const interactionErrors = [];
  const recordError = (event) => interactionErrors.push(event.error?.message ?? event.message);
  const recordRejection = (event) => interactionErrors.push(event.reason?.message ?? String(event.reason));
  globalThis.addEventListener('error', recordError);
  globalThis.addEventListener('unhandledrejection', recordRejection);
  try {
    const selections = [];
    const pressed = [];
    for (const [index, expected] of variantNames.entries()) {
      const currentButton = () => document.querySelectorAll('.gltf-variants-actions button')[index];
      const button = currentButton();
      if (!(button instanceof HTMLButtonElement)) return {
        error: 'glTF variant button list changed during interaction: '
          + interactionErrors.join('; ')
          + ' body=' + document.body.innerText.slice(0, 500),
      };
      button.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await globalThis.__royalExamplesRenderNow?.();
        if (currentRoot()?.getAttribute('data-selected-variant') === expected
          && currentButton()?.getAttribute('aria-pressed') === 'true') break;
      }
      selections.push(currentRoot()?.getAttribute('data-selected-variant') ?? '');
      pressed.push(currentButton()?.getAttribute('aria-pressed') === 'true' ? expected : '');
    }
    return { pressed, selections };
  } finally {
    globalThis.removeEventListener('error', recordError);
    globalThis.removeEventListener('unhandledrejection', recordRejection);
  }
})()
`);

const runContextLossSmoke = async (session, expectVirtualTexturing) => evaluate(session, `
(async () => {
  const canvas = document.querySelector('canvas');
  const snapshot = () => ${rendererSnapshotExpression};
  if (canvas === null) return { status: 'error', reason: 'missing canvas' };
  if (snapshot()?.lifecycle?.state !== 'available') {
    return { status: 'error', reason: 'renderer snapshot was not available before interruption', snapshot: snapshot() };
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
  if (${expectVirtualTexturing ? 'true' : 'false'} && (before?.virtualTexturing?.cachedPages ?? 0) <= 0) {
    return { status: 'error', reason: 'VT recovery route had no resident pages before interruption', before };
  }
  extension.loseContext();
  const lost = await waitFor((value) => value?.lifecycle?.state === 'unavailable');
  if (lost?.lifecycle?.state !== 'unavailable') {
    return { status: 'error', reason: 'renderer never published unavailable state', before, lost };
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  const settledLost = snapshot();
  if (settledLost?.frame !== lost.frame) {
    return { status: 'error', reason: 'one-shot demand frame advanced while context was lost', lost, settledLost };
  }

  extension.restoreContext();
  const restored = await waitFor((value) =>
    value?.lifecycle?.state === 'available' &&
    value.lifecycle.recoveries >= before.lifecycle.recoveries + 1 &&
    value.lifecycle.generation > before.lifecycle.generation
  );
  if (restored?.lifecycle?.state !== 'available') {
    return { status: 'error', reason: 'renderer never returned to available state', before, restored };
  }
  globalThis.__royalExamplesRenderNow?.();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  globalThis.__royalExamplesRenderNow?.();
  const recoveredResources = ${expectVirtualTexturing ? 'true' : 'false'}
    ? await waitFor((value) => {
      const vt = value?.virtualTexturing;
      return value?.lifecycle?.state === 'available'
        && (vt?.activePages ?? 0) > 0
        && (vt?.cachedPages ?? 0) > 0
        && (vt?.atlasTextures ?? 0) > 0
        && (vt?.pageTableTextures ?? 0) > 0
        && vt?.pendingPages === 0
        && vt?.outstandingPageRequests === 0;
    }, 10_000)
    : restored;
  if (${expectVirtualTexturing ? 'true' : 'false'}) {
    const vt = recoveredResources?.virtualTexturing;
    const beforeVt = before?.virtualTexturing;
    const cumulativeFailureCounters = [
      'demandRetentionOverflows',
      'gpuAdmissionFailures',
      'manifestFailures',
      'pageLoadFailures',
      'unsupportedDraws',
    ];
    const newFailures = cumulativeFailureCounters.filter((name) => (
      !Number.isFinite(vt?.[name])
      || !Number.isFinite(beforeVt?.[name])
      || vt[name] > beforeVt[name]
    ));
    if (
      (vt?.activePages ?? 0) <= 0
      || (vt?.cachedPages ?? 0) <= 0
      || (vt?.atlasTextures ?? 0) <= 0
      || (vt?.pageTableTextures ?? 0) <= 0
      || vt?.pendingPages !== 0
      || vt?.outstandingPageRequests !== 0
      || vt?.physicalQuarantinedBytes !== 0
      || newFailures.length > 0
    ) {
      return {
        status: 'error',
        reason: 'VT resources did not converge cleanly after context restoration',
        before,
        newFailures,
        recoveredResources,
      };
    }
  }
  globalThis.__royalExamplesRenderNow?.();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  globalThis.__royalExamplesRenderNow?.();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const afterCapture = snapshot();
  if (afterCapture?.frame <= lost.frame) {
    return {
      status: 'error',
      reason: 'restored renderer did not produce a fresh frame',
      afterCapture,
      lost,
      restored,
    };
  }
  return {
    status: 'ok',
    afterCapture,
    before,
    lost,
    recoveredResources,
    restored,
  };
})()
`);

const runReactLifecycleSmoke = async (session) => {
  const snapshotKey = JSON.stringify(exampleContract.benchmark.bridge.rendererSnapshotGlobal);
  const renderNowKey = JSON.stringify(exampleContract.benchmark.bridge.renderNowGlobal);
  await session.call('Network.enable');
  const loaded = session.once('Page.loadEventFired');
  await session.call('Page.navigate', {
    url: `${baseUrl}/?__royalReactLifecycleProbe=1`,
  });
  await Promise.race([loaded, sleep(5_000)]);
  await session.call('Network.setCacheDisabled', { cacheDisabled: true });
  await session.call('Network.emulateNetworkConditions', {
    downloadThroughput: -1,
    latency: 250,
    offline: false,
    uploadThroughput: -1,
  });
  try {
    return await evaluate(session, `
(async () => {
  const snapshotKey = ${snapshotKey};
  const renderNowKey = ${renderNowKey};
  const waitFor = async (predicate, timeoutMs = 10_000) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const value = predicate();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return undefined;
  };
  const safeSnapshot = (reader) => {
    try {
      return typeof reader === 'function' ? reader() : null;
    } catch (error) {
      return { thrown: String(error?.stack ?? error) };
    }
  };
  const action = (name) => {
    const button = document.querySelector('[data-probe-action="' + name + '"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing lifecycle action ' + name);
    button.click();
  };
  const initialReader = await waitFor(() => {
    const reader = globalThis[snapshotKey];
    return safeSnapshot(reader)?.lifecycle?.state === 'available' ? reader : undefined;
  });
  if (typeof initialReader !== 'function') return { error: 'initial renderer root did not become available' };
  const initialCanvas = document.querySelector('canvas');
  if (!(initialCanvas instanceof HTMLCanvasElement)) return { error: 'initial Canvas element was missing' };
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let queuedPointerMoveFrame;
  let queuedPointerMoveCancelled = false;
  globalThis.requestAnimationFrame = (callback) => {
    const frame = originalRequestAnimationFrame(callback);
    queuedPointerMoveFrame ??= frame;
    return frame;
  };
  globalThis.cancelAnimationFrame = (frame) => {
    if (frame === queuedPointerMoveFrame) queuedPointerMoveCancelled = true;
    originalCancelAnimationFrame(frame);
  };
  initialCanvas.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    buttons: 0,
    clientX: 8,
    clientY: 8,
    pointerId: 91,
    pointerType: 'mouse',
  }));
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;

  action('toggle-antialias');
  const replacementReader = await waitFor(() => {
    const reader = globalThis[snapshotKey];
    return reader !== initialReader && safeSnapshot(reader)?.lifecycle?.state === 'available'
      ? reader
      : undefined;
  });
  if (typeof replacementReader !== 'function') return { error: 'option change did not replace the renderer root' };
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  const replacementCanvas = document.querySelector('canvas');
  const refEventsAfterReplacement = document.querySelector('[data-react-lifecycle-probe]')
    ?.getAttribute('data-canvas-ref-events')?.split(',') ?? [];
  const lastCleanupRef = refEventsAfterReplacement.findLastIndex((event) => event.startsWith('cleanup-canvas-'));
  const canvasReplacement = {
    newCanvasConnected: replacementCanvas?.isConnected ?? false,
    oldCanvasConnected: initialCanvas.isConnected,
    queuedPointerMoveCancelled,
    refCleanupBeforeAttach: lastCleanupRef >= 0 && lastCleanupRef < refEventsAfterReplacement.length - 1,
    refEventsAfterReplacement,
    replaced: replacementCanvas instanceof HTMLCanvasElement && replacementCanvas !== initialCanvas,
  };

  action('animate');
  const animationStart = safeSnapshot(replacementReader)?.frame;
  if (!Number.isFinite(animationStart)) return { error: 'active useFrame loop had no initial renderer frame' };
  const animationEnd = await waitFor(() => {
    const frame = safeSnapshot(replacementReader)?.frame;
    return Number.isFinite(frame) && frame >= animationStart + 3 ? frame : undefined;
  });
  if (!Number.isFinite(animationEnd)) return { error: 'active useFrame loop did not advance the renderer' };

  action('virtual-texture');
  const manifestRequestsBefore = safeSnapshot(replacementReader)?.virtualTexturing?.manifestRequests ?? 0;
  const manifestRequestsAtUnmount = await waitFor(() => {
    const requests = safeSnapshot(replacementReader)?.virtualTexturing?.manifestRequests;
    return Number.isFinite(requests) && requests > manifestRequestsBefore ? requests : undefined;
  });
  if (!Number.isFinite(manifestRequestsAtUnmount)) return { error: 'VT manifest request did not begin before unmount' };

  action('toggle-mount');
  const unmounted = await waitFor(() => (
    document.querySelector('canvas') === null && globalThis[snapshotKey] === undefined ? true : undefined
  ));
  if (unmounted !== true) return { error: 'Canvas bridge survived unmount' };
  const disposedFrame = safeSnapshot(replacementReader)?.frame;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const disposedAfterFrames = safeSnapshot(replacementReader);

  action('toggle-mount');
  const remountedReader = await waitFor(() => {
    const reader = globalThis[snapshotKey];
    return reader !== replacementReader && safeSnapshot(reader)?.lifecycle?.state === 'available'
      ? reader
      : undefined;
  });
  if (typeof remountedReader !== 'function') return { error: 'Canvas did not create a fresh root after remount' };
  await globalThis[renderNowKey]?.();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const remountedObserver = document.querySelector('[data-probe-lifecycle-state]');
  const remountedObserverState = remountedObserver instanceof HTMLElement
    ? {
      asset: remountedObserver.dataset.probeAssetState,
      lifecycle: remountedObserver.dataset.probeLifecycleState,
    }
    : null;
  const remountedSnapshot = safeSnapshot(remountedReader);

  action('fail-frame');
  const boundaryError = await waitFor(() => {
    const output = document.querySelector('[data-probe-error]');
    return output?.textContent?.includes('React lifecycle probe frame failure') === true
      && globalThis[snapshotKey] === undefined
      ? output.textContent
      : undefined;
  });
  if (typeof boundaryError !== 'string') return { error: 'scheduled frame failure did not reach the ErrorBoundary' };
  const failedRoot = safeSnapshot(remountedReader);

  action('recover');
  const recoveredReader = await waitFor(() => {
    const reader = globalThis[snapshotKey];
    return reader !== remountedReader && safeSnapshot(reader)?.lifecycle?.state === 'available'
      ? reader
      : undefined;
  });
  if (typeof recoveredReader !== 'function') return { error: 'ErrorBoundary reset did not create a fresh renderer root' };
  const recoveredObserver = await waitFor(() => {
    const output = document.querySelector('[data-probe-lifecycle-state]');
    return output instanceof HTMLElement
      && output.dataset.probeLifecycleState === 'available'
      && output.dataset.probeAssetState === 'idle'
      ? {
        asset: output.dataset.probeAssetState,
        lifecycle: output.dataset.probeLifecycleState,
      }
      : undefined;
  });

  return {
    animationEnd,
    animationStart,
    disposedAfterFrames,
    disposedFrame,
    boundaryError,
    canvasReplacement,
    failedRoot,
    initialAfterReplacement: safeSnapshot(initialReader),
    manifestRequestsAtUnmount,
    recovered: safeSnapshot(recoveredReader),
    recoveredObserver,
    remounted: remountedSnapshot,
    remountedObserverState,
    replacementAfterUnmount: safeSnapshot(replacementReader),
  };
})()
    `);
  } finally {
    await session.call('Network.setCacheDisabled', { cacheDisabled: false });
    await session.call('Network.emulateNetworkConditions', {
      downloadThroughput: -1,
      latency: 0,
      offline: false,
      uploadThroughput: -1,
    });
  }
};

const disposedRendererResourcesReleased = (snapshot) => {
  const governor = snapshot?.resourcePressure;
  const virtualTexturing = snapshot?.virtualTexturing;
  return snapshot?.lifecycle?.state === 'disposed'
    && governor?.outstandingLeases === 0
    && governor?.outstandingReservations === 0
    && Object.entries(governor?.total ?? {})
      .every(([name, value]) => name === 'uploadBytes' || value === 0)
    && virtualTexturing?.activePages === 0
    && virtualTexturing?.atlasTextures === 0
    && virtualTexturing?.cachedPages === 0
    && virtualTexturing?.outstandingPageRequests === 0
    && virtualTexturing?.pageLifecycleEntries === 0
    && virtualTexturing?.pageTableTextures === 0
    && virtualTexturing?.pendingPages === 0
    && virtualTexturing?.physicalAllocatedBytes === 0
    && virtualTexturing?.physicalQuarantinedBytes === 0;
};

const main = async () => {
  const profileDir = browserMode === 'chromium'
    ? await mkdtemp(path.join(tmpdir(), 'royal-examples-smoke-'))
    : undefined;
  const preview = managePreview
    ? startVitePreview({ appRoot, host, port: previewPort })
    : undefined;
  const browser = browserMode === 'chromium'
    ? spawnLogged('chromium', [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--ignore-gpu-blocklist',
      '--disable-software-rasterizer',
      '--use-gpu-in-tests',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { cwd: appRoot })
    : undefined;

  let session;
  const exceptions = [];
  const consoleMessages = [];

  try {
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      const details = event.exceptionDetails;
      const location = details?.url === undefined
        ? ''
        : ` at ${details.url}:${(details.lineNumber ?? 0) + 1}:${(details.columnNumber ?? 0) + 1}`;
      exceptions.push(`${details?.exception?.description ?? details?.text ?? 'Runtime exception'}${location}`);
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
    if (gpu === null || /SwiftShader|Subzero|llvmpipe|lavapipe|software/iu.test(gpu)) {
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
      const routeExceptionStart = exceptions.length;
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
      if (route.id === 'gltf-variants') {
        state = {
          ...state,
          variantInteraction: await runGltfVariantsInteractionSmoke(session),
        };
      }
      if (route.id === 'gltf-ghostscript-tiger-svg') {
        state = {
          ...state,
          svgTextureParity: await runSvgTextureParitySmoke(session),
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
        const routeExceptions = exceptions.slice(routeExceptionStart);
        if (routeExceptions.length > 0) {
          throw new Error(`${route.id}: browser runtime exceptions: ${routeExceptions.join('; ')}`);
        }
        assertRoute(effectiveRoute, state);
      } catch (error) {
        const recentConsole = consoleMessages.slice(-8).join('; ');
        const recentResources = (state.resources ?? [])
          .map((resource) => `${resource.name} duration=${resource.duration}ms size=${resource.size}`)
          .join('; ');
        const interaction = state.virtualTextureInteraction ?? state.svgTextureParity;
        const interactionDiagnostics = interaction === undefined ? '' : JSON.stringify(interaction);
        throw new Error(`${error instanceof Error ? error.message : String(error)}${
          recentConsole === '' ? '' : `; console: ${recentConsole}`
        }${
          recentResources === '' ? '' : `; resources: ${recentResources}`
        }${
          interactionDiagnostics === '' ? '' : `; interaction: ${interactionDiagnostics}`
        }`);
      }
      if (contextLossSmoke && !contextLossChecked) {
        const lifecycle = await runContextLossSmoke(session, route.virtualTextureRecovery === true);
        if (lifecycle.status === 'error') {
          throw new Error(`context-loss smoke failed: ${lifecycle.reason}; ${JSON.stringify(lifecycle)}`);
        }
        const restoredSample = lifecycle.status === 'ok'
          ? await compositedCanvasSample(session)
          : undefined;
        if (
          lifecycle.status === 'ok'
          && (
            restoredSample === undefined
            || restoredSample.paintedPixels <= 0
            || restoredSample.colorBuckets < (effectiveRoute.minColorBuckets ?? 1)
          )
        ) {
          throw new Error(`context-loss smoke failed: restored compositor surface was unusable; ${JSON.stringify({ lifecycle, restoredSample })}`);
        }
        contextLossChecked = true;
        console.log(lifecycle.status === 'unsupported'
          ? `skip context-loss ${lifecycle.reason}`
          : `ok context-loss generation=${lifecycle.restored.lifecycle.generation} painted=${restoredSample.paintedPixels}`);
      }
      const canvasSummary = state.canvas?.sample === undefined
        ? ''
        : ` buckets=${state.canvas.sample.colorBuckets} painted=${state.canvas.sample.paintedRatio.toFixed(3)} luma=${state.canvas.sample.meanPaintedLuminance.toFixed(3)} p25=${state.canvas.sample.paintedLuminanceP25.toFixed(3)} p50=${state.canvas.sample.paintedLuminanceP50.toFixed(3)} p75=${state.canvas.sample.paintedLuminanceP75.toFixed(3)} chroma=${state.canvas.sample.meanPaintedChroma.toFixed(3)} saturation=${state.canvas.sample.meanPaintedSaturation.toFixed(3)}`;
      const paritySummary = state.svgTextureParity?.comparison?.meanAbsoluteError === undefined
        ? ''
        : ` svgParityMae=${state.svgTextureParity.comparison.meanAbsoluteError.toFixed(4)} changed=${state.svgTextureParity.comparison.changedPixelRatio.toFixed(4)}`;
      console.log(`ok ${route.id}${canvasSummary}${paritySummary}`);
    }

    if (contextLossSmoke && !contextLossChecked) {
      throw new Error('Context-loss smoke did not run on a selected route');
    }

    if ((routeFilter === '' || reactLifecycleSmoke) && !contextLossSmoke) {
      const lifecycle = await runReactLifecycleSmoke(session);
      if (
        lifecycle?.error !== undefined
        || !disposedRendererResourcesReleased(lifecycle?.initialAfterReplacement)
        || !disposedRendererResourcesReleased(lifecycle?.replacementAfterUnmount)
        || !disposedRendererResourcesReleased(lifecycle?.failedRoot)
        || lifecycle?.disposedAfterFrames?.lifecycle?.state !== 'disposed'
        || lifecycle?.disposedAfterFrames?.frame !== lifecycle?.disposedFrame
        || lifecycle?.remounted?.lifecycle?.state !== 'available'
        || !(lifecycle?.remounted?.frame > 0)
        || !(lifecycle?.animationEnd >= lifecycle?.animationStart + 3)
        || !(lifecycle?.manifestRequestsAtUnmount > 0)
        || lifecycle?.boundaryError !== 'React lifecycle probe frame failure'
        || lifecycle?.canvasReplacement?.replaced !== true
        || lifecycle?.canvasReplacement?.oldCanvasConnected !== false
        || lifecycle?.canvasReplacement?.newCanvasConnected !== true
        || lifecycle?.canvasReplacement?.queuedPointerMoveCancelled !== true
        || lifecycle?.canvasReplacement?.refCleanupBeforeAttach !== true
        || lifecycle?.remountedObserverState?.lifecycle !== 'available'
        || lifecycle?.remountedObserverState?.asset !== 'idle'
        || lifecycle?.recovered?.lifecycle?.state !== 'available'
        || lifecycle?.recoveredObserver?.lifecycle !== 'available'
        || lifecycle?.recoveredObserver?.asset !== 'idle'
      ) {
        throw new Error(`React Canvas lifecycle smoke failed: ${JSON.stringify(lifecycle)}`);
      }
      console.log(`ok react-canvas-lifecycle frames=${lifecycle.animationStart}->${lifecycle.animationEnd} manifestRequests=${lifecycle.manifestRequestsAtUnmount}`);
    }

    if (exceptions.length > 0) {
      throw new Error('Browser runtime exceptions: ' + exceptions.join('; '));
    }
  } finally {
    session?.close();
    await stopProcess(browser);
    await stopProcess(preview);
    if (profileDir !== undefined) {
      await rm(profileDir, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      });
    }
  }
};

await main();
