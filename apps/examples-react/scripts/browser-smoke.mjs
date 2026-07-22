import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  connectCdpPage,
  createBoundedProcessDiagnostics,
  evaluate,
  gltfRendererSnapshotSettled,
  spawnLogged,
  startVitePreview,
  stopProcess,
  waitForPreviewBuild,
} from './browser-harness.mjs';
import {
  exampleContract,
  rendererSnapshotExpression,
  requireExampleRoute,
} from './example-contract.mjs';
import { summarizeCanvasPixels } from './canvas-sample.mjs';

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
const captureDirectory = process.env.EXAMPLES_SMOKE_CAPTURE_DIR?.trim() ?? '';
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
const embeddedTextureGate = process.env.EXAMPLES_SMOKE_EMBEDDED_TEXTURE_GATE === '1';
const svgFallbackSmoke = process.env.EXAMPLES_SMOKE_SVG_FALLBACK === '1';
const allowSoftwareGpu = process.env.EXAMPLES_SMOKE_ALLOW_SOFTWARE_GPU === '1';

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
const gltfSceneResourceById = new Map([
  ['sponza', '/fixtures/scenes/Sponza/glTF/Sponza.gltf'],
  ['a-beautiful-game', '/fixtures/scenes/ABeautifulGame/glTF-Binary/ABeautifulGame.glb'],
  ['virtual-city', '/fixtures/scenes/VirtualCity/glTF-Binary/VirtualCity.glb'],
  ['damaged-helmet', '/DamagedHelmet/DamagedHelmet.gltf'],
]);
const selectedGltfSceneId = new URLSearchParams(routeQuery).get('scene') ?? 'sponza';
const selectedGltfSceneResource = gltfSceneResourceById.get(selectedGltfSceneId);

if (selectedGltfSceneResource === undefined) {
  throw new Error(`Unknown glTF scene showcase entry: ${selectedGltfSceneId}`);
}

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
    resourceSubstrings: ['/DamagedHelmet/Default_albedo.jpg'],
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
    ...(new URLSearchParams(routeQuery).get('environment') === 'prefiltered'
      ? { prefilteredEnvironmentReady: true }
      : {}),
  },
  'gltf-helmet': {
    minColorBuckets: 32,
    minPaintedRatio: 0.01,
  },
  'gltf-bistro-web': {
    gltfReady: true,
    minColorBuckets: 8,
    minPaintedRatio: 0.01,
    resourceSubstrings: ['/BistroWeb/Bistro.gltf'],
  },
  'gltf-scenes': {
    gltfReady: true,
    ...(selectedGltfSceneId === 'a-beautiful-game' ? { minImagesLoaded: 15 } : {}),
    minColorBuckets: 12,
    minPaintedRatio: 0.01,
    resourceSubstrings: [selectedGltfSceneResource],
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
    // A flat parchment card previously reached 22 buckets while the decoded
    // Tiger consistently contributes far more color variation.
    minColorBuckets: 48,
    minPaintedRatio: 0.006,
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
    gltfReady: true,
    minColorBuckets: 10,
    minPaintedRatio: 0.01,
    resourceSubstrings: [
      '/fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf',
      '/fixtures/gltf-svg-texture/ghostscript-tiger.svg',
    ],
  },
};

const smokeRoutes = Object.entries(smokeExpectations)
  // Bistro is an approximately 100 MB torture workload. Keep it available as
  // a focused smoke without adding that transfer and decode cost to every run.
  .filter(([id]) => id !== 'gltf-bistro-web' || routeFilter !== '')
  .map(([id, expectation]) => ({
    ...requireExampleRoute(id),
    ...expectation,
    ...(id === 'gltf-lab' ? { path: '/gltf-lab?case=Box' } : {}),
  }));

const helmetTextureProbes = [
  { file: 'Default_normal.jpg', name: 'normal' },
  { file: 'Default_metalRoughness.jpg', name: 'metallic-roughness' },
  { file: 'Default_AO.jpg', name: 'occlusion' },
  { file: 'Default_emissive.jpg', name: 'emissive' },
];
const textureProbeFilter = process.env.EXAMPLES_SMOKE_TEXTURE_PROBE?.trim() ?? '';
if (
  textureProbeFilter !== ''
  && !helmetTextureProbes.some(({ name }) => name === textureProbeFilter)
) throw new Error(`Unknown secondary texture probe: ${textureProbeFilter}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const continuePausedRequests = async (session, requests) => {
  const continued = new Set();
  for (let round = 0; round < 4; round += 1) {
    const pending = requests.filter(({ requestId }) => !continued.has(requestId));
    for (const { requestId } of pending) {
      await session.call('Fetch.continueRequest', { requestId });
      continued.add(requestId);
    }
    await sleep(25);
  }
};

const connectPage = () => connectCdpPage({
  closeExtraPages: true,
  commandTimeoutMs: cdpCommandTimeoutMs,
  debugHost,
  debugPort,
  rewriteWebSocketAuthority: true,
});

const smokeExpression = `
(async () => {
  const summarizeCanvasPixels = ${summarizeCanvasPixels.toString()};
  const gltfRendererSnapshotSettled = ${gltfRendererSnapshotSettled.toString()};
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
    return summarizeCanvasPixels(
      context.getImageData(0, 0, width, height).data,
      width,
      height,
    );
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
        minImagesLoaded: smoke?.minImagesLoaded ?? 0,
        path: routePath,
        prefilteredEnvironmentReady: smoke?.prefilteredEnvironmentReady === true,
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
      prefilteredEnvironmentState: document
        .querySelector('[data-prefiltered-environment-status]')
        ?.getAttribute('data-prefiltered-environment-status'),
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
    const gltfDiagnosticsReady = globalThis.__royalSmokeAllowPendingGltf === true ||
      !(state.route.gltfReady || state.route.id.startsWith('gltf-')) ||
      gltfRendererSnapshotSettled(state.renderer, state.route.minImagesLoaded);
    const prefilteredEnvironmentReady = state.route.prefilteredEnvironmentReady !== true
      || state.prefilteredEnvironmentState === 'ready';
    return canvasReady && resourceReady && gltfDiagnosticsReady && prefilteredEnvironmentReady;
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
  let readyReads = 0;

  while (Date.now() < deadline) {
    lastState = await evaluate(session, smokeExpression);
    if (routeCanvasReady(route, lastState)) {
      readyReads += 1;
      if (readyReads >= (route.stableReadyReads ?? 1)) return lastState;
    } else readyReads = 0;
    await sleep(100);
  }

  return lastState ?? await evaluate(session, smokeExpression);
};

// A continuously animated Canvas transfers frame ownership to React's RAF loop.
// With preserveDrawingBuffer disabled, drawImage(canvas) may then observe the
// discarded back buffer between frames. CDP captures the composited surface,
// which is the image a user actually sees.
const captureCompositedCanvas = async (session) => {
  const captureState = await evaluate(session, `
    (async () => {
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const ancestorScroll = [];
      for (let ancestor = canvas.parentElement, depth = 0; ancestor !== null; ancestor = ancestor.parentElement, depth += 1) {
        ancestorScroll.push({ depth, left: ancestor.scrollLeft, top: ancestor.scrollTop });
      }
      const restore = { ancestorScroll, x: scrollX, y: scrollY };
      canvas.scrollIntoView({ block: 'start', inline: 'nearest' });
      await globalThis.__royalExamplesRenderNow?.();
      for (let frame = 0; frame < 2; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
      const rect = canvas.getBoundingClientRect();
      let left = Math.max(0, rect.left);
      let top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right);
      let bottom = Math.min(innerHeight, rect.bottom);
      for (let ancestor = canvas.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        if (/(auto|clip|hidden|scroll)/.test(style.overflowX)) {
          left = Math.max(left, ancestorRect.left);
          right = Math.min(right, ancestorRect.right);
        }
        if (/(auto|clip|hidden|scroll)/.test(style.overflowY)) {
          top = Math.max(top, ancestorRect.top);
          bottom = Math.min(bottom, ancestorRect.bottom);
        }
      }
      if (right <= left || bottom <= top) return null;
      return {
        clip: {
          x: left + scrollX,
          y: top + scrollY,
          width: right - left,
          height: bottom - top,
          scale: 1,
        },
        restore,
      };
    })()
  `);
  if (captureState === null || captureState.clip.width <= 0 || captureState.clip.height <= 0) return undefined;
  try {
    const capture = await session.call('Page.captureScreenshot', {
      captureBeyondViewport: false,
      clip: captureState.clip,
      format: 'png',
      fromSurface: true,
    });
    return capture.data;
  } finally {
    await evaluate(session, `
      (() => {
        const canvas = document.querySelector('canvas');
        if (canvas instanceof HTMLCanvasElement) {
          const positions = ${JSON.stringify(captureState.restore.ancestorScroll)};
          for (let ancestor = canvas.parentElement, depth = 0; ancestor !== null; ancestor = ancestor.parentElement, depth += 1) {
            const position = positions[depth];
            if (position !== undefined) ancestor.scrollTo(position.left, position.top);
          }
        }
        scrollTo(${JSON.stringify(captureState.restore.x)}, ${JSON.stringify(captureState.restore.y)});
      })()
    `);
  }
};

const compositedCanvasSample = async (session) => {
  const capture = await captureCompositedCanvas(session);
  if (capture === undefined) return undefined;
  return evaluate(session, `
    (async () => {
      const summarizeCanvasPixels = ${summarizeCanvasPixels.toString()};
      const response = await fetch('data:image/png;base64,${capture}');
      const gate = globalThis.__royalEmbeddedTextureGate;
      if (gate !== undefined) gate.bypass = true;
      const decoding = createImageBitmap(await response.blob());
      if (gate !== undefined) gate.bypass = false;
      const bitmap = await decoding;
      const width = Math.max(1, Math.min(160, bitmap.width));
      const height = Math.max(1, Math.min(160, bitmap.height));
      const sample = document.createElement('canvas');
      sample.width = width;
      sample.height = height;
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (context === null) return undefined;
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return summarizeCanvasPixels(
        context.getImageData(0, 0, width, height).data,
        width,
        height,
      );
    })()
  `);
};

const waitForCompositedRouteState = async (session, route, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await waitForRouteState(session, route, 500);
    const sample = await compositedCanvasSample(session);
    if (sample !== undefined && state.canvas !== undefined) {
      state = { ...state, canvas: { ...state.canvas, sample } };
    }
    if (routeCanvasReady(route, state)) return state;
  }
  return state ?? await waitForRouteState(session, route, 1);
};

const compositedCanvasColorAt = async (session, x = 0.5, y = 0.5) => {
  const capture = await captureCompositedCanvas(session);
  if (capture === undefined) return undefined;
  return evaluate(session, `
    (async () => {
      const response = await fetch('data:image/png;base64,${capture}');
      const gate = globalThis.__royalEmbeddedTextureGate;
      if (gate !== undefined) gate.bypass = true;
      const decoding = createImageBitmap(await response.blob());
      if (gate !== undefined) gate.bypass = false;
      const bitmap = await decoding;
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return undefined;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const centerX = Math.floor(canvas.width * ${x});
      const centerY = Math.floor(canvas.height * ${y});
      const radius = 2;
      const pixels = context.getImageData(
        centerX - radius,
        centerY - radius,
        radius * 2 + 1,
        radius * 2 + 1,
      ).data;
      const rgb = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        rgb[0] += pixels[index];
        rgb[1] += pixels[index + 1];
        rgb[2] += pixels[index + 2];
      }
      const count = pixels.length / 4;
      return rgb.map((value) => value / count / 255);
    })()
  `);
};

const compareCompositedCanvasCaptures = async (session, before, after) => evaluate(session, `
  (async () => {
    const decode = async (base64) => createImageBitmap(
      await (await fetch('data:image/png;base64,' + base64)).blob()
    );
    const [beforeBitmap, afterBitmap] = await Promise.all([
      decode(${JSON.stringify(before)}),
      decode(${JSON.stringify(after)}),
    ]);
    try {
      const width = Math.max(1, Math.min(512, beforeBitmap.width, afterBitmap.width));
      const height = Math.max(1, Math.min(512, beforeBitmap.height, afterBitmap.height));
      const pixels = (bitmap) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) throw new Error('secondary texture comparison needs 2D canvas');
        context.drawImage(bitmap, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };
      const beforePixels = pixels(beforeBitmap);
      const afterPixels = pixels(afterBitmap);
      let changedPixels = 0;
      let materialChangedPixels = 0;
      let materialMaximumDelta = 0;
      let materialTotalDelta = 0;
      let maximumDelta = 0;
      let totalDelta = 0;
      for (let index = 0; index < beforePixels.length; index += 4) {
        const delta = (
          Math.abs(beforePixels[index] - afterPixels[index])
          + Math.abs(beforePixels[index + 1] - afterPixels[index + 1])
          + Math.abs(beforePixels[index + 2] - afterPixels[index + 2])
        ) / (3 * 255);
        totalDelta += delta;
        maximumDelta = Math.max(maximumDelta, delta);
        if (delta > 0.5 / 255) changedPixels += 1;
        if ((index / 4) % width >= width / 2) {
          materialTotalDelta += delta;
          materialMaximumDelta = Math.max(materialMaximumDelta, delta);
          if (delta > 0.5 / 255) materialChangedPixels += 1;
        }
      }
      const pixelCount = beforePixels.length / 4;
      const materialPixelCount = Math.floor(width / 2) * height;
      return {
        changedPixels,
        changedRatio: changedPixels / pixelCount,
        materialChangedPixels,
        materialChangedRatio: materialChangedPixels / materialPixelCount,
        materialMaximumDelta,
        materialMeanDelta: materialTotalDelta / materialPixelCount,
        maximumDelta,
        meanDelta: totalDelta / pixelCount,
      };
    } finally {
      beforeBitmap.close();
      afterBitmap.close();
    }
  })()
`);

const assertNeutralTextureTransition = (fallback, authored) => {
  if (!Array.isArray(fallback) || !Array.isArray(authored)) {
    throw new Error(`texture fallback smoke could not sample both states: ${JSON.stringify({ authored, fallback })}`);
  }
  const fallbackMaximum = Math.max(...fallback);
  const fallbackMinimum = Math.min(...fallback);
  if (fallbackMinimum <= 0.05 || fallbackMaximum >= 0.8 || fallbackMaximum - fallbackMinimum >= 0.15) {
    throw new Error(`texture fallback was not a bounded neutral presentation: ${JSON.stringify(fallback)}`);
  }
  const distance = Math.hypot(
    authored[0] - fallback[0],
    authored[1] - fallback[1],
    authored[2] - fallback[2],
  );
  if (distance <= 0.02) {
    throw new Error(`authored texture did not visibly replace its neutral fallback: ${JSON.stringify({ authored, fallback })}`);
  }
  const authoredLooksDebugMagenta = authored[0] > 0.7
    && authored[1] < 0.3
    && authored[2] > 0.7;
  if (authoredLooksDebugMagenta) {
    throw new Error(`authored texture resolved to a debug-magenta presentation: ${JSON.stringify(authored)}`);
  }
};

const assertSecondaryTextureTransition = (fallback, authored, comparison, repeatComparison) => {
  if (!Array.isArray(fallback) || !Array.isArray(authored)) {
    throw new Error(`secondary texture smoke could not sample both states: ${JSON.stringify({ authored, fallback })}`);
  }
  for (const [label, color] of [['fallback', fallback], ['authored', authored]]) {
    const looksDebugMagenta = color[0] > 0.7 && color[1] < 0.3 && color[2] > 0.7;
    const looksUninitializedWhite = color.every((channel) => channel > 0.92);
    if (looksDebugMagenta || looksUninitializedWhite) {
      throw new Error(`secondary texture ${label} presentation exposed a placeholder: ${JSON.stringify(color)}`);
    }
  }
  const distance = Math.hypot(
    authored[0] - fallback[0],
    authored[1] - fallback[1],
    authored[2] - fallback[2],
  );
  const repeatMaximum = repeatComparison?.maximumDelta ?? 0;
  const repeatMean = repeatComparison?.meanDelta ?? 0;
  const changedAwayFromSample = comparison?.changedPixels > 0
    && comparison.maximumDelta > repeatMaximum + 1 / 255
    && comparison.meanDelta > repeatMean + 1e-7;
  if (distance <= 0.02 && !changedAwayFromSample) {
    throw new Error(`secondary texture did not visibly refine the material: ${JSON.stringify({ authored, comparison, fallback })}`);
  }
};

const assertEmbeddedTextureTransition = (fallback, authored, comparison, repeatComparison) => {
  assertSecondaryTextureTransition(fallback, authored, comparison, repeatComparison);
  if (
    !(comparison?.materialChangedPixels > 0)
    || !(comparison.materialMaximumDelta > (repeatComparison?.materialMaximumDelta ?? 0) + 1 / 255)
    || !(comparison.materialMeanDelta > (repeatComparison?.materialMeanDelta ?? 0) + 1e-7)
  ) {
    throw new Error(`embedded texture publication did not refine the material region: ${JSON.stringify({ comparison, repeatComparison })}`);
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

  if (expected.id === 'gltf-bistro-web') {
    const interaction = state.bistroSceneInteraction;
    if (interaction === undefined) {
      failures.push('Bistro route missed scene-selection interaction smoke');
    } else if (interaction.error !== undefined) {
      failures.push(`Bistro scene-selection smoke failed: ${interaction.error}`);
    } else {
      const options = interaction.options
        ?.map(({ title, value }) => `${value}:${title}`)
        .join(',');
      if (options !== 'exterior:Exterior,interior:Interior,interior-wine:Interior Wine') {
        failures.push(`Bistro scene options were ${options ?? 'missing'}`);
      }
      if (interaction.query !== 'exterior' || interaction.scene !== 'exterior') {
        failures.push(
          `Bistro scene selection resolved query=${interaction.query} scene=${interaction.scene}`,
        );
      }
      if (interaction.sceneIndex !== 0) {
        failures.push(`Bistro renderer resolved scene index ${interaction.sceneIndex}, expected 0`);
      }
      if (interaction.status !== 'ready' && interaction.status !== 'degraded') {
        failures.push(`Bistro selected scene settled as ${interaction.status ?? 'missing'}`);
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
    } else if (interaction.colorSmoke?.error !== undefined) {
      failures.push(`glTF variants color smoke failed: ${interaction.colorSmoke.error}`);
    } else {
      const { mint, ruby, slate } = interaction.colorSmoke?.colors ?? {};
      if (!(ruby?.[0] > ruby?.[1] * 1.5 && ruby?.[0] > ruby?.[2] * 1.4)) {
        failures.push(`glTF ruby variant was not red-dominant: ${JSON.stringify(ruby)}`);
      }
      if (!(mint?.[1] > mint?.[0] * 1.25 && mint?.[1] > mint?.[2])) {
        failures.push(`glTF mint variant was not green-dominant: ${JSON.stringify(mint)}`);
      }
      if (!(slate?.[2] > slate?.[0] * 1.25 && slate?.[2] > slate?.[1] * 1.15)) {
        failures.push(`glTF slate variant was not blue-dominant: ${JSON.stringify(slate)}`);
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
      const settledSamples = [
        ...(interaction.presets ?? []),
        interaction.zoom,
        interaction.far,
        interaction.reactivation,
        interaction.pan,
      ].filter((sample) => sample !== undefined);
      if (!settledSamples.every((sample) => (
        sample.settled === true
        && sample.lifecycleState === 'available'
        && sample.lifecycleError === null
        && sample.failedPages === 0
        && sample.manifestFailures === 0
        && sample.manifestsReady === 1
        && sample.pendingPages === 0
        && sample.residentPages > 0
        && sample.persistentGpuDeniedClaims === 0
      ))) {
        failures.push('virtual texture interaction did not preserve settled focused status and GPU admission');
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
        interaction.pan?.pendingPages !== 0
      ) {
        failures.push(`virtual texture map pan left ${interaction.pan?.pendingPages ?? 'unknown'} pages pending`);
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
      if (interaction.reactivation?.lifecycleState !== 'available' || interaction.reactivation?.lifecycleError !== null) {
        failures.push('virtual texture cache reactivation did not preserve an available error-free renderer');
      }
      if (
        !(interaction.reactivation?.residentPages > 0) ||
        interaction.reactivation?.pendingPages !== 0
      ) {
        failures.push('virtual texture zoom-back did not restore resident pages');
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
        if (interaction.resize?.restored?.pendingPages !== 0) {
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
            || sample?.failedPages !== 0
            || sample?.manifestFailures !== 0
            || sample?.manifestsReady !== 1
            || sample?.pendingPages !== 0
            || !(sample?.residentPages > 0)
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
    } else if (!assets.some((asset) => (
      asset.status === 'streaming'
      || asset.status === 'degraded'
      || asset.status === 'ready'
    ))) {
      failures.push('glTF load diagnostics did not report a usable asset');
    } else if (!assets.some((asset) => asset.imagesLoaded >= (expected.minImagesLoaded ?? 0))) {
      failures.push(`glTF load diagnostics did not reach ${expected.minImagesLoaded} loaded images`);
    }
  }

  if (
    expected.prefilteredEnvironmentReady === true
    && state.prefilteredEnvironmentState !== 'ready'
  ) failures.push('prefiltered environment did not become ready');

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
      failedPages: vt?.failedPages ?? null,
      manifestFailures: vt?.manifestFailures ?? null,
      manifestsReady: vt?.manifestsReady ?? null,
      pendingPages: vt?.pendingPages ?? null,
      residentPages: vt?.residentPages ?? null,
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
      && sample.failedPages === 0
      && sample.manifestFailures === 0
      && sample.manifestsReady === 1
      && sample.pendingPages === 0
      && sample.residentPages > 0
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
  const buttons = ['Both', 'NW', 'NE', 'SW', 'SE']
    .map((preset) => document.querySelector('[data-vt-preset="' + preset + '"]'));
  if (buttons.some((button) => !(button instanceof HTMLButtonElement))) {
    return { error: 'missing virtual texture camera presets' };
  }
  const pageUrls = () => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => url.includes('/fixtures/virtual-texture-stress/map-pages/'));
  const rendererSnapshot = () => ${rendererSnapshotExpression};
  const waitForConvergence = async (afterFrame = null, previousPageUrls = []) => {
    const deadline = performance.now() + 8000;
    let currentPages = pageUrls().length;
    let lastPages = -1;
    let lastResidentPages = -1;
    let stableFrames = 0;
    let renderer = rendererSnapshot();
    while (performance.now() < deadline && stableFrames < 8) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      currentPages = pageUrls().length;
      renderer = rendererSnapshot();
      const vt = renderer?.virtualTexturing;
      if (
        currentPages === lastPages &&
        vt?.residentPages === lastResidentPages &&
        (afterFrame === null || (renderer?.frame ?? -1) > afterFrame) &&
        vt?.failedPages === 0 &&
        vt?.manifestFailures === 0 &&
        vt?.manifestsReady === 1 &&
        vt?.pendingPages === 0 &&
        vt?.residentPages > 0
      ) stableFrames += 1;
      else stableFrames = 0;
      lastPages = currentPages;
      lastResidentPages = vt?.residentPages ?? -1;
    }
    const vt = renderer?.virtualTexturing;
    const currentPageUrls = pageUrls();
    const previousPages = new Set(previousPageUrls);
    const canvasRect = canvas.getBoundingClientRect();
    const pressure = renderer?.resourcePressure;
    return {
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      failedPages: vt?.failedPages ?? null,
      lifecycleError: renderer?.lifecycle?.error ?? null,
      lifecycleState: renderer?.lifecycle?.state ?? null,
      cssHeight: canvasRect.height,
      cssWidth: canvasRect.width,
      devicePixelRatio: window.devicePixelRatio,
      distance: Number(canvas.dataset.mapDistance),
      frame: renderer?.frame ?? null,
      manifestFailures: vt?.manifestFailures ?? null,
      manifestsReady: vt?.manifestsReady ?? null,
      pageCount: currentPages,
      pageUrls: currentPageUrls,
      newPageUrls: currentPageUrls.filter((url) => !previousPages.has(url)),
      newPageRequestCount: Math.max(0, currentPageUrls.length - previousPageUrls.length),
      pendingPages: vt?.pendingPages ?? null,
      persistentGpuDeniedClaims: pressure?.persistentGpuDeniedClaims ?? null,
      residentPages: vt?.residentPages ?? null,
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
  const far = await waitForConvergence(farFrame, pageUrls());
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
      residentPages: rendererSnapshot()?.virtualTexturing?.residentPages ?? null,
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

const runGltfBistroSceneInteractionSmoke = async (session) => evaluate(session, `
(async () => {
  const gltfRendererSnapshotSettled = ${gltfRendererSnapshotSettled.toString()};
  const selector = document.querySelector('.bistro-scene-selector select');
  if (!(selector instanceof HTMLSelectElement)) return { error: 'missing Bistro scene selector' };
  const options = [...selector.options].map(({ textContent, value }) => ({
    title: textContent?.trim() ?? '',
    value,
  }));
  selector.value = 'exterior';
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  const deadline = performance.now() + ${routeReadyTimeoutMs};
  let snapshot = null;
  while (performance.now() < deadline) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await globalThis.__royalExamplesRenderNow?.();
    snapshot = ${rendererSnapshotExpression};
    const asset = snapshot?.gltfLoadDiagnostics?.assets?.[0];
    if (
      new URLSearchParams(location.search).get('scene') === 'exterior'
      && document.querySelector('[data-bistro-scene]')?.getAttribute('data-bistro-scene') === 'exterior'
      && asset?.sceneIndex === 0
      && gltfRendererSnapshotSettled(snapshot)
    ) break;
  }
  return {
    options,
    query: new URLSearchParams(location.search).get('scene'),
    scene: document.querySelector('[data-bistro-scene]')?.getAttribute('data-bistro-scene') ?? '',
    sceneIndex: snapshot?.gltfLoadDiagnostics?.assets?.[0]?.sceneIndex,
    status: snapshot?.gltfLoadDiagnostics?.assets?.[0]?.status,
  };
})()
`);

const runGltfVariantsColorSmoke = async (session) => {
  const colors = {};
  for (const variant of ['ruby', 'mint', 'slate']) {
    const selected = await evaluate(session, `
      (async () => {
        const button = [...document.querySelectorAll('.gltf-variants-actions button')]
          .find((candidate) => candidate.textContent?.trim() === '${variant}');
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await globalThis.__royalExamplesRenderNow?.();
          if (document.querySelector('.gltf-variants')?.getAttribute('data-selected-variant') === '${variant}') {
            return true;
          }
        }
        return false;
      })()
    `);
    if (!selected) return { error: `could not select ${variant} for color smoke` };
    const capture = await captureCompositedCanvas(session);
    if (capture === undefined) return { error: `could not capture ${variant} variant` };
    colors[variant] = await evaluate(session, `
      (async () => {
        const response = await fetch('data:image/png;base64,${capture}');
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) return null;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const x = Math.min(canvas.width - 1, Math.max(0, Math.round(canvas.width * 0.5)));
        const y = Math.min(canvas.height - 1, Math.max(0, Math.round(canvas.height * 0.42)));
        const pixel = context.getImageData(x, y, 1, 1).data;
        return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
      })()
    `);
  }
  return { colors };
};

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
  if (${expectVirtualTexturing ? 'true' : 'false'} && (before?.virtualTexturing?.residentPages ?? 0) <= 0) {
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
        && vt?.manifestsReady === 1
        && (vt?.residentPages ?? 0) > 0
        && vt?.pendingPages === 0;
    }, 10_000)
    : restored;
  if (${expectVirtualTexturing ? 'true' : 'false'}) {
    const vt = recoveredResources?.virtualTexturing;
    const beforeVt = before?.virtualTexturing;
    const cumulativeFailureCounters = ['failedPages', 'manifestFailures'];
    const newFailures = cumulativeFailureCounters.filter((name) => (
      !Number.isFinite(vt?.[name])
      || !Number.isFinite(beforeVt?.[name])
      || vt[name] > beforeVt[name]
    ));
    if (
      vt?.manifestsReady !== 1
      || (vt?.residentPages ?? 0) <= 0
      || vt?.pendingPages !== 0
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
  const queuedPointerMoveFrames = new Set();
  let queuedPointerMoveCancelled = false;
  globalThis.requestAnimationFrame = (callback) => {
    const frame = originalRequestAnimationFrame(callback);
    queuedPointerMoveFrames.add(frame);
    return frame;
  };
  globalThis.cancelAnimationFrame = (frame) => {
    if (queuedPointerMoveFrames.has(frame)) queuedPointerMoveCancelled = true;
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
  if (typeof replacementReader !== 'function') return {
    error: 'option change did not replace the renderer root',
    optionChange: {
      antialias: document.querySelector('[data-react-lifecycle-probe]')?.getAttribute('data-antialias'),
      canvasRefEvents: document.querySelector('[data-react-lifecycle-probe]')?.getAttribute('data-canvas-ref-events'),
      canvasReplaced: document.querySelector('canvas') !== initialCanvas,
      current: safeSnapshot(globalThis[snapshotKey]),
      errorBoundary: document.querySelector('[data-probe-error]')?.textContent,
      observerAsset: document.querySelector('[data-probe-lifecycle-status]')?.getAttribute('data-probe-asset-status'),
      observerLifecycle: document.querySelector('[data-probe-lifecycle-status]')?.getAttribute('data-probe-lifecycle-status'),
      readerReplaced: globalThis[snapshotKey] !== initialReader,
    },
  };
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
  const remountedSnapshot = await waitFor(() => {
    const snapshot = safeSnapshot(remountedReader);
    return (snapshot?.frame ?? 0) > 0 ? snapshot : undefined;
  });
  const remountedObserver = document.querySelector('[data-probe-lifecycle-status]');
  const remountedObserverState = remountedObserver instanceof HTMLElement
    ? {
      asset: remountedObserver.dataset.probeAssetStatus,
      lifecycle: remountedObserver.dataset.probeLifecycleStatus,
    }
    : null;
  if (remountedSnapshot === undefined) return { error: 'remounted Canvas did not produce a frame' };

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
    const output = document.querySelector('[data-probe-lifecycle-status]');
    return output instanceof HTMLElement
      && output.dataset.probeLifecycleStatus === 'available'
      && output.dataset.probeAssetStatus === 'idle'
      ? {
        asset: output.dataset.probeAssetStatus,
        lifecycle: output.dataset.probeLifecycleStatus,
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
  return snapshot?.lifecycle?.state === 'disposed'
    && snapshot?.resourcePressure?.persistentGpuRetainedBytes === 0;
};

const main = async () => {
  const nativeGpuDiagnostics = createBoundedProcessDiagnostics(
    /GL_INVALID_(?:ENUM|VALUE|OPERATION|FRAMEBUFFER_OPERATION)|Feedback loop formed between Framebuffer and active Texture|GPU process (?:crashed|exited unexpectedly)/iu,
  );
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
      `--use-angle=${allowSoftwareGpu ? 'swiftshader' : 'vulkan'}`,
      ...(allowSoftwareGpu
        ? ['--enable-unsafe-swiftshader']
        : ['--ignore-gpu-blocklist', '--disable-software-rasterizer', '--use-gpu-in-tests']),
      '--window-size=1200,800',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { cwd: appRoot, onStderr: nativeGpuDiagnostics.write })
    : undefined;

  let session;
  const exceptions = [];
  const consoleMessages = [];

  try {
    const expectedSource = JSON.parse(readFileSync(
      path.join(appRoot, 'dist/__royal-source.json'),
      'utf8',
    ));
    await waitForPreviewBuild({
      baseUrl,
      expected: expectedSource,
      preview,
      timeoutMs: 15_000,
    });
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
    if (gpu === null) {
      throw new Error('Browser smoke could not create a WebGL2 context');
    }
    if (!allowSoftwareGpu && /SwiftShader|Subzero|llvmpipe|lavapipe|software/iu.test(gpu)) {
      throw new Error(`Hardware GPU smoke resolved to software rendering: ${gpu}`);
    }
    console.log(`gpu ${gpu}${allowSoftwareGpu ? ' (software behavior oracle)' : ''}`);

    const filteredRoutes = routeFilter === ''
      ? smokeRoutes
      : smokeRoutes.filter((route) =>
        route.id === routeFilter ||
        route.path === routeFilter ||
        route.path === `/${routeFilter}`
      );
    if (filteredRoutes.length === 0) {
      throw new Error(`Examples smoke route filter did not match a route: ${routeFilter}`);
    }
    const selectedRoutes = filteredRoutes.flatMap((route) => route.id === 'gltf-helmet'
      ? helmetTextureProbes
        .filter(({ name }) => textureProbeFilter === '' || name === textureProbeFilter)
        .map((textureProbe) => ({
          ...route,
          path: `${route.path}?textureProbe=${textureProbe.name}`,
          textureProbe,
        }))
      : [route]);
    let contextLossChecked = false;

    for (const route of selectedRoutes) {
      if (route.textureProbe !== undefined) {
        console.log(`probe secondary-texture ${route.textureProbe.name}`);
      }
      const routeExceptionStart = exceptions.length;
      const routeConsoleStart = consoleMessages.length;
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
        selectedCase.status !== 'supported-oracle' &&
        selectedCase.status !== 'core-fallback-oracle' &&
        selectedCase.status !== 'normalized-ingestion') {
        throw new Error(`glTF lab success smoke cannot render ${selectedCase.name}: ${selectedCase.status}`);
      }
      const selectedEffectiveRoute = selectedCase === undefined
        ? { ...route, path: routeUrl.pathname + routeUrl.search }
        : {
          ...route,
          absentResourceSubstrings: [],
          minColorBuckets: selectedCase.features.includes('KHR_materials_transmission') ? 8 : 1,
          minPaintedRatio: 0.0001,
          path: routeUrl.pathname + routeUrl.search,
          resourceSubstrings: [
            gltfLabResourceSubstring(selectedCase),
            ...(selectedCase.features.includes('KHR_materials_transmission')
              ? ['surface-composite-owner']
              : []),
          ],
          ...(selectedCase.features.includes('KHR_materials_transmission')
            ? { stableReadyReads: 12 }
            : {}),
        };
      const effectiveRoute = selectedEffectiveRoute;
      let textureFallbackPause;
      let textureFallbackKind;
      let textureFallbackCapture;
      let svgFallbackIntercepted;
      const pausedTextureRequests = [];
      const pausedVirtualTextureRequests = [];
      if (route.id === 'texture-materials') {
        textureFallbackKind = 'base-color';
        await session.call('Fetch.enable', {
          patterns: [{
            requestStage: 'Request',
            urlPattern: '*Default_albedo.jpg*',
          }],
        });
        session.on('Fetch.requestPaused', (request) => {
          if (request.request.url.includes('/DamagedHelmet/Default_albedo.jpg')) {
            pausedTextureRequests.push(request);
          }
        });
        textureFallbackPause = session.wait(
          'Fetch.requestPaused',
          ({ request }) => request.url.includes('/DamagedHelmet/Default_albedo.jpg'),
          { timeoutMs: 10_000 },
        );
      } else if (route.id === 'gltf-helmet') {
        textureFallbackKind = 'secondary';
        const textureProbe = route.textureProbe ?? helmetTextureProbes[0];
        await session.call('Fetch.enable', {
          patterns: [{
            requestStage: 'Request',
            urlPattern: `*${textureProbe.file}*`,
          }],
        });
        session.on('Fetch.requestPaused', (request) => {
          if (request.request.url.includes(`/DamagedHelmet/${textureProbe.file}`)) {
            pausedTextureRequests.push(request);
          }
        });
        textureFallbackPause = session.wait(
          'Fetch.requestPaused',
          ({ request }) => request.url.includes(`/DamagedHelmet/${textureProbe.file}`),
          { timeoutMs: 10_000 },
        );
      } else if (route.id === 'virtual-texture-stress') {
        textureFallbackKind = 'virtual';
        await session.call('Fetch.enable', {
          patterns: [{
            requestStage: 'Request',
            urlPattern: '*map-pages/*',
          }],
        });
        session.on('Fetch.requestPaused', (request) => {
          if (request.request.url.includes('/fixtures/virtual-texture-stress/map-pages/')) {
            pausedVirtualTextureRequests.push(request);
          }
        });
        textureFallbackPause = session.wait(
          'Fetch.requestPaused',
          ({ request }) => request.url.includes('/fixtures/virtual-texture-stress/map-pages/'),
          { timeoutMs: 10_000 },
        );
      }
      if (embeddedTextureGate && route.id === 'gltf-lab') {
        textureFallbackKind = 'embedded';
        await session.call('Page.addScriptToEvaluateOnNewDocument', { source: `
          (() => {
            const decode = globalThis.createImageBitmap?.bind(globalThis);
            if (decode === undefined) return;
            const pending = [];
            let released = false;
            globalThis.__royalEmbeddedTextureGate = {
              bypass: false,
              get pending() { return pending.length; },
              release() {
                released = true;
                for (const run of pending.splice(0)) run();
              },
            };
            globalThis.createImageBitmap = (...arguments_) => {
              if (
                released
                || globalThis.__royalEmbeddedTextureGate.bypass
                || !(arguments_[0] instanceof Blob)
              ) return decode(...arguments_);
              return new Promise((resolve, reject) => {
                pending.push(() => decode(...arguments_).then(resolve, reject));
              });
            };
          })();
        ` });
      }
      if (svgFallbackSmoke) {
        if (route.id !== 'gltf-ghostscript-tiger-svg') {
          throw new Error('EXAMPLES_SMOKE_SVG_FALLBACK requires the Ghostscript Tiger route');
        }
        await session.call('Fetch.enable', {
          patterns: [{
            requestStage: 'Request',
            urlPattern: '*ghostscript-tiger.svg*',
          }],
        });
        session.on('Fetch.requestPaused', (request) => {
          if (!request.request.url.includes('/ghostscript-tiger.svg')) return;
          void session.call('Fetch.failRequest', {
            errorReason: 'Failed',
            requestId: request.requestId,
          }).catch((error) => exceptions.push(`SVG fallback interception failed: ${error}`));
        });
        svgFallbackIntercepted = session.wait(
          'Fetch.requestPaused',
          ({ request }) => request.url.includes('/ghostscript-tiger.svg'),
          { timeoutMs: 10_000 },
        );
      }
      const routeLoaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: routeUrl.href });
      await Promise.race([
        textureFallbackPause === undefined ? routeLoaded : textureFallbackPause,
        sleep(5_000),
      ]);
      let textureFallbackColor;
      if (textureFallbackKind === 'embedded') {
        let pending = 0;
        const deadline = Date.now() + 10_000;
        while (pending === 0 && Date.now() < deadline) {
          pending = await evaluate(
            session,
            'globalThis.__royalEmbeddedTextureGate?.pending ?? 0',
          );
          if (pending === 0) await sleep(25);
        }
        if (pending === 0) throw new Error('embedded texture gate did not intercept a decode');
        await evaluate(session, 'globalThis.__royalSmokeAllowPendingGltf = true');
        const fallbackState = await waitForCompositedRouteState(session, effectiveRoute);
        if (!routeCanvasReady(effectiveRoute, fallbackState)) {
          throw new Error(`embedded texture fallback did not become presentable: ${JSON.stringify(fallbackState)}`);
        }
        textureFallbackColor = await compositedCanvasColorAt(session);
        textureFallbackCapture = await captureCompositedCanvas(session);
        await evaluate(session, 'globalThis.__royalEmbeddedTextureGate.release()');
        await evaluate(session, 'globalThis.__royalSmokeAllowPendingGltf = false');
      } else if (textureFallbackPause !== undefined) {
        const paused = await textureFallbackPause;
        if (paused === undefined) {
          await session.call('Fetch.disable');
          throw new Error('texture fallback smoke did not intercept the authored image request');
        }
        const virtualTextureFallback = textureFallbackKind === 'virtual';
        const secondaryTextureFallback = textureFallbackKind === 'secondary';
        const fallbackRoute = virtualTextureFallback
          ? {
              ...effectiveRoute,
              absentResourceSubstrings: ['/fixtures/virtual-texture-stress/map-pages/'],
              minColorBuckets: undefined,
              resourceSubstrings: ['/fixtures/virtual-texture-stress/map.vt.json'],
            }
          : secondaryTextureFallback
            ? {
                ...effectiveRoute,
                absentResourceSubstrings: [`/DamagedHelmet/${route.textureProbe.file}`],
                minColorBuckets: 8,
                resourceSubstrings: ['/DamagedHelmet/Default_albedo.jpg'],
              }
            : {
              ...effectiveRoute,
              absentResourceSubstrings: ['/DamagedHelmet/Default_albedo.jpg'],
              resourceSubstrings: [],
            };
        if (secondaryTextureFallback) {
          await evaluate(session, 'globalThis.__royalSmokeAllowPendingGltf = true');
        }
        const fallbackState = await waitForCompositedRouteState(session, fallbackRoute);
        if (!routeCanvasReady(fallbackRoute, fallbackState)) {
          for (const request of pausedVirtualTextureRequests) {
            await session.call('Fetch.continueRequest', { requestId: request.requestId });
          }
          if (!virtualTextureFallback) {
            await continuePausedRequests(session, pausedTextureRequests);
          }
          await session.call('Fetch.disable');
          throw new Error(`texture fallback did not become presentable: ${JSON.stringify(fallbackState)}`);
        }
        textureFallbackColor = await compositedCanvasColorAt(
          session,
          virtualTextureFallback ? 0.35 : 0.5,
          0.5,
        );
        if (secondaryTextureFallback) {
          textureFallbackCapture = await captureCompositedCanvas(session);
          await evaluate(session, 'globalThis.__royalSmokeAllowPendingGltf = false');
        }
        for (const request of pausedVirtualTextureRequests) {
          await session.call('Fetch.continueRequest', { requestId: request.requestId });
        }
        if (!virtualTextureFallback) {
          await continuePausedRequests(session, pausedTextureRequests);
        }
        await session.call('Fetch.disable');
      }
      let state = await waitForRouteState(session, effectiveRoute);
      if (svgFallbackIntercepted !== undefined) {
        if (await svgFallbackIntercepted === undefined) {
          throw new Error('SVG fallback smoke did not intercept the preferred source');
        }
        await session.call('Fetch.disable');
        const fallbackCount = state.renderer?.gltfLoadDiagnostics?.assets?.[0]?.imageFallbacks;
        if (fallbackCount !== 1) {
          throw new Error(`SVG fallback was not reported exactly once: ${JSON.stringify(state.renderer)}`);
        }
      }
      if ((state.canvas?.sample?.paintedPixels ?? 0) === 0) {
        const compositedSample = await compositedCanvasSample(session);
        if (compositedSample !== undefined && state.canvas !== undefined) {
          state = { ...state, canvas: { ...state.canvas, sample: compositedSample } };
        }
      }
      if (captureDirectory !== '') {
        const capture = await captureCompositedCanvas(session);
        if (capture !== undefined) {
          await mkdir(captureDirectory, { recursive: true });
          await writeFile(
            path.join(captureDirectory, `${route.id}-initial.png`),
            Buffer.from(capture, 'base64'),
          );
        }
        if (textureFallbackCapture !== undefined) {
          await writeFile(
            path.join(captureDirectory, `${route.id}-fallback.png`),
            Buffer.from(textureFallbackCapture, 'base64'),
          );
        }
      }
      if (route.id === 'picking') {
        state = {
          ...state,
          pickingInteraction: await runPickingInteractionSmoke(session),
        };
      }
      if (route.id === 'gltf-bistro-web') {
        state = {
          ...state,
          bistroSceneInteraction: await runGltfBistroSceneInteractionSmoke(session),
        };
      }
      if (route.id === 'gltf-variants') {
        const interaction = await runGltfVariantsInteractionSmoke(session);
        state = {
          ...state,
          variantInteraction: {
            ...interaction,
            colorSmoke: await runGltfVariantsColorSmoke(session),
          },
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
      if (textureFallbackKind !== undefined) {
        const authoredCapture = textureFallbackKind === 'secondary'
          || textureFallbackKind === 'embedded'
          ? await captureCompositedCanvas(session)
          : undefined;
        const authoredRepeatCapture = authoredCapture === undefined
          ? undefined
          : await captureCompositedCanvas(session);
        state = {
          ...state,
          textureTransition: {
            authored: await compositedCanvasColorAt(
              session,
              textureFallbackKind === 'virtual' ? 0.35 : 0.5,
              0.5,
            ),
            ...(
              authoredCapture === undefined
              || authoredRepeatCapture === undefined
              || textureFallbackCapture === undefined
              ? {}
              : {
                  comparison: await compareCompositedCanvasCaptures(
                    session,
                    textureFallbackCapture,
                    authoredCapture,
                  ),
                  repeatComparison: await compareCompositedCanvasCaptures(
                    session,
                    authoredCapture,
                    authoredRepeatCapture,
                  ),
                }),
            fallback: textureFallbackColor,
            kind: textureFallbackKind,
            ...(route.textureProbe === undefined ? {} : { probe: route.textureProbe.name }),
          },
        };
      }
      try {
        const routeExceptions = exceptions.slice(routeExceptionStart);
        if (routeExceptions.length > 0) {
          throw new Error(`${route.id}: browser runtime exceptions: ${routeExceptions.join('; ')}`);
        }
        const routeConsoleErrors = consoleMessages
          .slice(routeConsoleStart)
          .filter((message) => message.startsWith('error:'));
        if (routeConsoleErrors.length > 0) {
          throw new Error(`${route.id}: browser console errors: ${routeConsoleErrors.join('; ')}`);
        }
        const nativeErrors = nativeGpuDiagnostics.snapshot();
        if (nativeErrors.length > 0) {
          throw new Error(`${route.id}: native GPU errors: ${nativeErrors.join('; ')}`);
        }
        assertRoute(effectiveRoute, state);
        if (state.textureTransition !== undefined) {
          const assertTransition = state.textureTransition.kind === 'embedded'
            ? assertEmbeddedTextureTransition
            : state.textureTransition.kind === 'secondary'
              ? assertSecondaryTextureTransition
              : assertNeutralTextureTransition;
          assertTransition(
            state.textureTransition.fallback,
            state.textureTransition.authored,
            state.textureTransition.comparison,
            state.textureTransition.repeatComparison,
          );
          console.log(
            `ok texture-transition kind=${state.textureTransition.kind}`
            + `${state.textureTransition.probe === undefined ? '' : ` probe=${state.textureTransition.probe}`}`
            + ` fallback=${state.textureTransition.fallback.map((value) => value.toFixed(3)).join(',')}`
            + ` authored=${state.textureTransition.authored.map((value) => value.toFixed(3)).join(',')}`,
            state.textureTransition.comparison ?? '',
            state.textureTransition.repeatComparison ?? '',
          );
        }
      } catch (error) {
        const recentConsole = consoleMessages.slice(-8).join('; ');
        const recentResources = (state.resources ?? [])
          .map((resource) => `${resource.name} duration=${resource.duration}ms size=${resource.size}`)
          .join('; ');
        const interaction = state.virtualTextureInteraction;
        const interactionDiagnostics = interaction === undefined ? '' : JSON.stringify(interaction);
        const rendererDiagnostics = state.renderer === undefined ? '' : JSON.stringify(state.renderer);
        throw new Error(`${error instanceof Error ? error.message : String(error)}${
          recentConsole === '' ? '' : `; console: ${recentConsole}`
        }${
          recentResources === '' ? '' : `; resources: ${recentResources}`
        }${
          interactionDiagnostics === '' ? '' : `; interaction: ${interactionDiagnostics}`
        }${
          rendererDiagnostics === '' ? '' : `; renderer: ${rendererDiagnostics}`
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
      console.log(`ok ${route.id}${canvasSummary}`);
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
