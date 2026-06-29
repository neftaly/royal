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
  text: {
    surface: 'canvas',
    canvasLabel: 'Renderer text',
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
  const sampleRightEdge = (canvas, stripRatio = 0.03) => {
    const width = Math.max(1, Math.min(12, Math.ceil(canvas.width * stripRatio)));
    const height = Math.max(1, Math.min(180, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;
    context.drawImage(canvas, canvas.width - width, 0, width, canvas.height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let brightPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha === 0) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (red > 40 || green > 40 || blue > 40) brightPixels += 1;
    }

    return {
      brightPixels,
      brightRatio: brightPixels / (width * height),
      height,
      width,
    };
  };
  const helmetClearColor = [Math.round(0.04 * 255), Math.round(0.05 * 255), Math.round(0.06 * 255)];
  const helmetProbePoints = [
    { label: 'corner-nw', x: 0.08, y: 0.08 },
    { label: 'corner-ne', x: 0.92, y: 0.08 },
    { label: 'corner-sw', x: 0.08, y: 0.92 },
    { label: 'corner-se', x: 0.92, y: 0.92 },
    { label: 'edge-n', x: 0.5, y: 0.08 },
    { label: 'edge-s', x: 0.5, y: 0.92 },
    { label: 'helmet-center', x: 0.5, y: 0.5 },
    { label: 'helmet-left', x: 0.42, y: 0.5 },
    { label: 'helmet-right', x: 0.58, y: 0.5 },
    { label: 'helmet-upper', x: 0.5, y: 0.42 },
    { label: 'helmet-lower', x: 0.5, y: 0.62 },
    { label: 'helmet-upper-left', x: 0.4, y: 0.44 },
    { label: 'helmet-upper-right', x: 0.6, y: 0.44 },
  ];
  const colorDistance = (color, target) => Math.hypot(
    color[0] - target[0],
    color[1] - target[1],
    color[2] - target[2],
  );
  const classifyHelmetPixel = (rgba) => {
    const distance = colorDistance(rgba, helmetClearColor);
    if (rgba[3] === 0) return { classification: 'invisible', distance };
    if (distance <= 20) return { classification: 'background', distance };
    if (distance >= 34) return { classification: 'helmet', distance };
    return { classification: 'edge', distance };
  };
  const readHelmetSamples = (canvas) => {
    const contextCanvas = document.createElement('canvas');
    contextCanvas.width = 1;
    contextCanvas.height = 1;
    const context = contextCanvas.getContext('2d', { willReadFrequently: true });
    if (context === null || canvas.width <= 0 || canvas.height <= 0) return [];
    const rect = canvas.getBoundingClientRect();

    return helmetProbePoints.map((point) => {
      const canvasX = Math.max(0, Math.min(canvas.width - 1, Math.round(point.x * (canvas.width - 1))));
      const canvasY = Math.max(0, Math.min(canvas.height - 1, Math.round(point.y * (canvas.height - 1))));
      context.clearRect(0, 0, 1, 1);
      context.drawImage(canvas, canvasX, canvasY, 1, 1, 0, 0, 1, 1);
      const rgba = Array.from(context.getImageData(0, 0, 1, 1).data);
      const classified = classifyHelmetPixel(rgba);

      return {
        ...point,
        background: classified.classification === 'background' || classified.classification === 'invisible',
        canvasX,
        canvasY,
        classification: classified.classification,
        clientX: rect.left + point.x * rect.width,
        clientY: rect.top + point.y * rect.height,
        covered: classified.classification === 'helmet',
        distance: Number(classified.distance.toFixed(2)),
        rgba,
      };
    });
  };
  const dispatchHelmetPointerSpam = (canvas, samples) => {
    const EventCtor = window.PointerEvent ?? window.MouseEvent;
    for (const sample of samples) {
      canvas.dispatchEvent(new EventCtor('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: sample.clientX,
        clientY: sample.clientY,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
        screenX: sample.clientX,
        screenY: sample.clientY,
      }));
    }
    for (const sample of samples.filter((_, index) => index % 5 === 0)) {
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        canvas.dispatchEvent(new EventCtor(type, {
          bubbles: true,
          cancelable: true,
          clientX: sample.clientX,
          clientY: sample.clientY,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
          screenX: sample.clientX,
          screenY: sample.clientY,
        }));
      }
    }
  };
  const probeHitId = (report) => {
    if (typeof report === 'string') return report;
    if (report === null || typeof report !== 'object') return undefined;
    for (const key of ['id', 'hitId', 'assetId', 'objectId', 'targetId', 'pickedId']) {
      if (typeof report[key] === 'string') return report[key];
    }
    for (const key of ['hit', 'asset', 'object', 'target', 'picked']) {
      const value = report[key];
      if (value !== null && typeof value === 'object' && typeof value.id === 'string') return value.id;
    }
    return undefined;
  };
  const probeGeometryFailure = (report) => {
    if (report === null || typeof report !== 'object') return false;
    for (const key of ['geometryFailure', 'geometryFailed', 'geometryInvalid', 'boundsFailure']) {
      if (report[key] === true || typeof report[key] === 'string') return true;
    }
    for (const key of ['geometryFailures', 'geometryErrors']) {
      if (Array.isArray(report[key]) && report[key].length > 0) return true;
    }
    const reason = String(report.reason ?? report.error ?? report.message ?? '');
    return report.ok === false && /geometry|bounds/i.test(reason);
  };
  const readPickingProbe = async (sample) => {
    const probe = window.__royalPickingProbe;
    if (probe === undefined || probe === null) return undefined;

    const input = {
      canvasX: sample.canvasX,
      canvasY: sample.canvasY,
      clientX: sample.clientX,
      clientY: sample.clientY,
      label: sample.label,
      normalizedX: sample.x,
      normalizedY: sample.y,
      x: sample.canvasX,
      y: sample.canvasY,
    };
    let report;
    if (typeof probe === 'function') {
      report = await probe(input);
    } else if (typeof probe.pick === 'function') {
      report = await probe.pick(input);
    } else if (typeof probe.sample === 'function') {
      report = await probe.sample(input);
    } else if (typeof probe.read === 'function') {
      report = await probe.read(input);
    } else {
      report = probe;
    }

    return {
      geometryFailure: probeGeometryFailure(report),
      hitId: probeHitId(report),
      reportType: report === null ? 'null' : typeof report,
    };
  };
  const runHelmetPickingSmoke = async (canvas) => {
    const samples = readHelmetSamples(canvas);
    dispatchHelmetPointerSpam(canvas, samples);
    const probePresent = window.__royalPickingProbe !== undefined && window.__royalPickingProbe !== null;
    const probeReports = [];

    if (probePresent) {
      for (const sample of samples) {
        try {
          probeReports.push({ label: sample.label, ...(await readPickingProbe(sample)) });
        } catch (error) {
          probeReports.push({
            error: error instanceof Error ? error.message : String(error),
            geometryFailure: false,
            hitId: undefined,
            label: sample.label,
          });
        }
      }
    }

    return {
      backgroundCount: samples.filter((sample) => sample.background).length,
      clearColor: helmetClearColor,
      coveredCount: samples.filter((sample) => sample.covered).length,
      probePresent,
      probeReports,
      samples,
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
    const demoPanel = document.querySelector('.demo-panel');
    const sourcePanel = document.querySelector('.source-panel');
    const demoRect = demoPanel?.getBoundingClientRect();
    const sourceRect = sourcePanel?.getBoundingClientRect();
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
      panelOrder: {
        sourceAfterPreview: demoPanel !== null && sourcePanel !== null &&
          (demoPanel.compareDocumentPosition(sourcePanel) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        sourceBelowPreview: demoRect !== undefined && sourceRect !== undefined &&
          sourceRect.top >= demoRect.bottom - 1,
      },
      canvas: canvas === undefined ? undefined : {
        label: canvas.getAttribute('aria-label') ?? '',
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        edge: routeId === 'text' ? sampleRightEdge(canvas) : undefined,
        minColorBuckets: smoke?.minColorBuckets ?? 0,
        minPaintedRatio: smoke?.minPaintedRatio ?? 0,
        sample: sampleCanvas(canvas),
      },
      textControls: routeId === 'text' ? {
        rangeInputs: document.querySelectorAll('.text-example input[type="range"]').length,
        textInputs: document.querySelectorAll('.text-example input[type="text"]').length,
        textValue: document.querySelector('.text-example input[type="text"]')?.value ?? '',
      } : undefined,
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

  if (state.route.id === 'gltf-helmet') {
    const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
      candidate.getAttribute('aria-label') === 'glTF DamagedHelmet'
    );
    if (canvas !== undefined) {
      state = {
        ...state,
        helmetPicking: await runHelmetPickingSmoke(canvas),
      };
    }
  }

  if (state.route.id === 'text') {
    const deadline = performance.now() + 8000;
    while (
      performance.now() < deadline &&
      (
        state.textControls?.textInputs !== 1 ||
        state.textControls?.rangeInputs !== 1 ||
        state.canvas?.edge === undefined
      )
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      state = read();
    }
  }

  return state;
})()
`;

const artifactsExpression = `
(async () => {
  const deadline = performance.now() + 8000;
  const validateJsonAsset = (asset, json) => {
    switch (asset.id) {
      case 'picking-replay-json':
        return Array.isArray(json.rows) && json.rows.length >= 4 &&
          json.fixtureId === 'notched-bounds-contract-smoke';
      case 'asset-contract-schema':
        return json.$schema !== undefined && json.properties !== undefined;
      case 'asset-contract-vt':
        return Array.isArray(json.artifacts) && json.artifacts.length >= 6 &&
          Array.isArray(json.bounds) && json.bounds.length >= 4;
      case 'asset-contract-terrain':
        return Array.isArray(json.artifacts) && json.artifacts.length >= 9 &&
          Array.isArray(json.pages) && json.pages.length >= 1;
      case 'asset-contract-impostors':
        return Array.isArray(json.artifacts) && json.artifacts.length >= 6 &&
          Array.isArray(json.bounds) && json.bounds.length >= 7;
      case 'offline-terrain-manifest':
        return Array.isArray(json.meshes) && json.meshes.length >= 1 &&
          Array.isArray(json.materialTextures) && json.materialTextures.length >= 4;
      case 'offline-terrain-world-index':
        return Array.isArray(json.tiles) && json.tiles.length >= 4;
      case 'offline-terrain-schema':
        return json.$schema !== undefined && json.properties !== undefined;
      case 'dynamic-impostors-manifest':
        return Array.isArray(json.sourceMeshes) && json.sourceMeshes.length >= 3 &&
          Array.isArray(json.impostorAtlases) && json.impostorAtlases.length >= 2;
      case 'vt-manifest':
        return Array.isArray(json.pages) && json.pages.length >= 21 &&
          json.virtualTexture?.mipCount === 3 && json.demoBudget?.cacheSlots === 12;
      case 'vt-example-fixture':
        return json.virtualTexture?.mipCount === 3 &&
          Array.isArray(json.assets?.previewAssets) && json.assets.previewAssets.length >= 2;
      case 'vt-camera-stats':
        return Array.isArray(json.frames) && json.frames.length >= 6;
      default:
        return false;
    }
  };
  const validateAsset = async (asset) => {
    try {
      const response = await fetch(asset.href, { cache: 'no-store' });
      if (!response.ok) {
        return { ...asset, ok: false, reason: \`http \${response.status}\` };
      }
      if (asset.kind === 'json') {
        const json = await response.json();
        const ok = validateJsonAsset(asset, json);
        return {
          ...asset,
          ok,
          reason: ok ? '' : 'json structure mismatch',
        };
      }
      if (asset.kind === 'svg' || asset.kind === 'html') {
        const text = await response.text();
        const marker = asset.kind === 'svg' ? '<svg' : '<!doctype html';
        return {
          ...asset,
          ok: text.toLowerCase().includes(marker),
          reason: text.toLowerCase().includes(marker) ? '' : \`\${asset.kind} marker missing\`,
        };
      }
      const blob = await response.blob();
      return {
        ...asset,
        ok: blob.size > 0 && blob.type.startsWith('image/'),
        reason: blob.size > 0 ? '' : 'empty image response',
      };
    } catch (error) {
      return { ...asset, ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
  const read = () => {
    const page = document.querySelector('[data-artifacts-page]');

    return {
      hasPage: page !== null,
      title: document.querySelector('h1')?.textContent?.trim() ?? '',
      artifactsNavCount: document.querySelectorAll('[data-artifacts-nav-link]').length,
      artifactCards: Array.from(document.querySelectorAll('.artifact-card[data-artifact-id]')).map((card) => ({
        id: card.getAttribute('data-artifact-id') ?? '',
        text: card.textContent?.trim() ?? '',
      })),
      assets: Array.from(document.querySelectorAll('[data-artifact-asset]')).map((link) => ({
        href: link.href,
        id: link.getAttribute('data-artifact-asset-id') ?? '',
        artifactId: link.getAttribute('data-artifact-id') ?? '',
        kind: link.getAttribute('data-artifact-asset-kind') ?? '',
        text: link.textContent?.trim() ?? '',
      })),
      previews: Array.from(document.querySelectorAll('[data-artifact-preview]')).map((image) => ({
        complete: image.complete,
        id: image.getAttribute('data-artifact-preview-id') ?? '',
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        src: image.currentSrc,
      })),
      navAssetCount: document.querySelectorAll('[data-artifact-nav-asset]').length,
      primaryExampleNavCount: document.querySelectorAll('[data-example-nav-link]').length,
      relatedRouteCount: document.querySelectorAll('[data-artifact-related-route]').length,
    };
  };

  let state = read();
  while (performance.now() < deadline && (
    !state.hasPage ||
    state.artifactCards.length === 0 ||
    state.assets.length === 0 ||
    state.previews.some((preview) => !preview.complete || preview.naturalWidth === 0)
  )) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = read();
  }

  return { ...state, assetChecks: await Promise.all(state.assets.map(validateAsset)) };
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
  if (!state.panelOrder.sourceAfterPreview) failures.push('source panel did not follow preview');
  if (!state.panelOrder.sourceBelowPreview) failures.push('source panel was not below preview');

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

  if (expected.id === 'text') {
    if (state.textControls?.textInputs !== 1) {
      failures.push(`text route rendered ${state.textControls?.textInputs ?? 0} text input(s)`);
    }
    if (state.textControls?.rangeInputs !== 1) {
      failures.push(`text route rendered ${state.textControls?.rangeInputs ?? 0} range input(s)`);
    }
    if (state.textControls?.textValue !== 'Moloch, whose factories dream and croak in the fog') {
      failures.push('text route default editable sentence changed unexpectedly');
    }
    const edgeRatio = state.canvas?.edge?.brightRatio;
    if (edgeRatio === undefined) {
      failures.push('text route missed right-edge canvas sample');
    } else if (edgeRatio > 0.001) {
      failures.push(`text canvas has bright right-edge pixels ${edgeRatio.toFixed(4)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${expected.title}: ${failures.join('; ')}`);
  }
};

const assertHelmetPickingSmoke = (state) => {
  const failures = [];
  const picking = state.helmetPicking;
  if (picking === undefined) {
    failures.push('missing helmet picking smoke result');
  } else {
    if (picking.coveredCount <= 0) failures.push('helmet pixel oracle found no covered samples');
    if (picking.backgroundCount <= 0) failures.push('helmet pixel oracle found no background samples');

    const samplesByLabel = new Map(picking.samples.map((sample) => [sample.label, sample]));
    const geometryFailures = picking.probeReports.filter((report) => report.geometryFailure);
    if (geometryFailures.length > 0) {
      failures.push(
        `helmet picking probe reported geometry failures at ${
          geometryFailures.map((report) => report.label).join(', ')
        }`,
      );
    }

    const falseHelmetHits = picking.probeReports.filter((report) => {
      const sample = samplesByLabel.get(report.label);
      return report.hitId === 'damaged-helmet' && sample?.background === true;
    });
    if (falseHelmetHits.length > 0) {
      failures.push(
        `helmet picking probe hit damaged-helmet over background at ${
          falseHelmetHits.map((report) => report.label).join(', ')
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`glTF Helmet picking smoke: ${failures.join('; ')}`);
  }
};

const assertArtifactsPage = (state) => {
  const failures = [];
  if (!state.hasPage) failures.push('missing research artifacts page marker');
  if (state.title !== 'Research Artifacts') {
    failures.push(`expected research artifacts title, received "${state.title}"`);
  }
  if (state.artifactsNavCount !== 0) {
    failures.push(`research artifacts nav is exposed ${state.artifactsNavCount} time(s)`);
  }
  const artifactIds = new Set(state.artifactCards.map((artifact) => artifact.id));
  for (const expectedId of [
    'picking-raycasting-fuzz',
    'asset-manifest-contract',
    'offline-terrain-pipeline',
    'dynamic-impostors',
    'virtual-texturing-research',
  ]) {
    if (!artifactIds.has(expectedId)) failures.push(`missing ${expectedId} research artifact card`);
  }
  const assetIds = new Set(state.assets.map((asset) => asset.id));
  for (const expectedId of [
    'picking-replay-json',
    'asset-contract-schema',
    'asset-contract-vt',
    'asset-contract-terrain',
    'asset-contract-impostors',
    'offline-terrain-manifest',
    'offline-terrain-world-index',
    'offline-terrain-schema',
    'dynamic-impostors-manifest',
    'vt-manifest',
    'vt-example-fixture',
    'vt-camera-stats',
    'vt-overview',
    'vt-debug-overlay',
    'vt-report',
  ]) {
    if (!assetIds.has(expectedId)) failures.push(`missing ${expectedId} public artifact asset`);
  }
  if (state.assets.some((asset) => asset.href === '' || asset.text === '')) {
    failures.push('research artifacts contains an empty link');
  }
  if (state.assets.some((asset) => !asset.href.includes('/artifacts/'))) {
    failures.push('research artifacts contains a non-public-artifacts asset link');
  }
  if (state.assets.some((asset) => asset.href.includes('github.com'))) {
    failures.push('research artifacts still relies on GitHub repo links');
  }
  if (state.assetChecks.some((asset) => !asset.ok)) {
    const broken = state.assetChecks
      .filter((asset) => !asset.ok)
      .map((asset) => `${asset.id}: ${asset.reason}`)
      .join('; ');
    failures.push(`public artifact validation failed: ${broken}`);
  }
  if (state.previews.length === 0) failures.push('research artifacts did not render a preview image');
  if (state.previews.some((preview) => preview.naturalWidth <= 0 || preview.naturalHeight <= 0)) {
    failures.push('research artifact preview image did not load');
  }
  if (state.navAssetCount !== 0) {
    failures.push(`research artifact asset nav is exposed ${state.navAssetCount} time(s)`);
  }
  if (state.relatedRouteCount === 0) {
    failures.push('missing related real example route link');
  }
  if (state.primaryExampleNavCount !== Object.keys(smokeExpectations).length) {
    failures.push(`primary example nav count changed to ${state.primaryExampleNavCount}`);
  }

  if (failures.length > 0) {
    throw new Error(`Research Artifacts: ${failures.join('; ')}`);
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
      if (route.id === 'gltf-helmet') assertHelmetPickingSmoke(state);
      const canvasSummary = state.canvas?.sample === undefined
        ? ''
        : ` buckets=${state.canvas.sample.colorBuckets} painted=${state.canvas.sample.paintedRatio.toFixed(3)}`;
      console.log(`ok ${route.title}${canvasSummary}`);
    }

    const artifactsLoaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: baseUrl + '/artifacts' });
    await artifactsLoaded;
    const artifactsState = await evaluate(session, artifactsExpression);
    assertArtifactsPage(artifactsState);
    console.log('ok Research Artifacts');

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
