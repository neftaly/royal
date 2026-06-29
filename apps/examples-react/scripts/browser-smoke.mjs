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
    canvasLabel: 'Renderer text editor',
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
  'virtual-texturing-terrain': {
    surface: 'canvas',
    canvasLabel: 'Virtual texturing terrain',
    minColorBuckets: 6,
    minPaintedRatio: 0.5,
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
  const readTextEditorProbe = () => {
    const probe = window.__royalTextEditorProbe;
    if (probe === undefined || probe === null) return undefined;
    const selection = probe.selection ?? {};
    const normalizePlacement = (placement) => ({
      index: Number(placement?.index ?? 0),
      line: Number(placement?.line ?? 0),
      x: Number(placement?.x ?? 0),
    });
    const normalizeRect = (rect) => ({
      end: Number(rect?.end ?? 0),
      height: Number(rect?.height ?? 0),
      line: Number(rect?.line ?? 0),
      start: Number(rect?.start ?? 0),
      width: Number(rect?.width ?? 0),
      x: Number(rect?.x ?? 0),
      y: Number(rect?.y ?? 0),
    });
    const fontSizeSweep = typeof probe.measureFontSizes === 'function'
      ? probe.measureFontSizes([0.48, 0.72, 1.04]).map((entry) => ({
        fontSize: Number(entry?.fontSize ?? 0),
        lineCount: Number(entry?.lineCount ?? 0),
        maxSelectionHeight: Number(entry?.maxSelectionHeight ?? 0),
        minSelectionHeight: Number(entry?.minSelectionHeight ?? 0),
        selectionHeight: Number(entry?.selectionHeight ?? 0),
      }))
      : [];

    return {
      caret: {
        height: Number(probe.caret?.height ?? 0),
        index: Number(probe.caret?.index ?? 0),
        line: Number(probe.caret?.line ?? 0),
        x: Number(probe.caret?.x ?? 0),
        y: Number(probe.caret?.y ?? 0),
      },
      fontSize: Number(probe.fontSize ?? 0),
      fontSizeSweep,
      hitTest: {
        count: Number(probe.hitTest?.count ?? 0),
        lastClientX: Number(probe.hitTest?.lastClientX ?? 0),
        lastClientY: Number(probe.hitTest?.lastClientY ?? 0),
        lastIndex: Number(probe.hitTest?.lastIndex ?? -1),
        lastLine: Number(probe.hitTest?.lastLine ?? -1),
        lastMs: Number(probe.hitTest?.lastMs ?? 0),
        maxMs: Number(probe.hitTest?.maxMs ?? 0),
      },
      layout: {
        lineCount: Number(probe.layout?.lineCount ?? 0),
        maxWidth: Number(probe.layout?.maxWidth ?? 0),
        selectionHeight: Number(probe.layout?.selectionHeight ?? 0),
        selectionYOffset: Number(probe.layout?.selectionYOffset ?? 0),
      },
      lineHeight: Number(probe.lineHeight ?? 0),
      origin: {
        x: Number(probe.origin?.x ?? 0),
        y: Number(probe.origin?.y ?? 0),
      },
      placements: Array.isArray(probe.placements) ? probe.placements.map(normalizePlacement) : [],
      selection: {
        anchor: Number(selection.anchor ?? 0),
        anchorLine: selection.anchorLine === undefined ? undefined : Number(selection.anchorLine),
        focus: Number(selection.focus ?? 0),
        focusLine: selection.focusLine === undefined ? undefined : Number(selection.focusLine),
      },
      selectionRects: Array.isArray(probe.selectionRects) ? probe.selectionRects.map(normalizeRect) : [],
      textLength: Number(probe.textLength ?? 0),
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
  const readVirtualTextureProbe = () => {
    const probe = window.__royalVirtualTextureProbe;
    if (probe === undefined || probe === null) return undefined;

    return {
      atlasPreviewReadback: probe.atlasPreviewReadback ?? { colorBuckets: 0, paintedRatio: 0 },
      bytesUploaded: Number(probe.bytesUploaded ?? 0),
      camera: probe.camera ?? { distance: 0, moved: false, pitch: 0, targetX: 0, targetZ: 0, yaw: 0 },
      canvasReadback: probe.canvasReadback ?? { colorBuckets: 0, paintedRatio: 0 },
      detail: {
        baseResolveCount: Number(probe.detail?.baseResolveCount ?? 0),
        effectiveVirtualResolution: Number(probe.detail?.effectiveVirtualResolution ?? 0),
        focusU: Number(probe.detail?.focusU ?? 0),
        focusV: Number(probe.detail?.focusV ?? 0),
        maxResidentDetail: Number(probe.detail?.maxResidentDetail ?? 0),
        maxResidentMip: Number(probe.detail?.maxResidentMip ?? 0),
        requestSignature: String(probe.detail?.requestSignature ?? ''),
        requestedMip: Number(probe.detail?.requestedMip ?? 0),
        requestedPageIds: Array.isArray(probe.detail?.requestedPageIds) ? probe.detail.requestedPageIds : [],
        requestedPages: Number(probe.detail?.requestedPages ?? 0),
      },
      drawCalls: Number(probe.drawCalls ?? 0),
      error: String(probe.error ?? ''),
      evictedPageIds: Array.isArray(probe.evictedPageIds) ? probe.evictedPageIds : [],
      exactPageCount: Number(probe.exactPageCount ?? 0),
      fallbackPageCount: Number(probe.fallbackPageCount ?? 0),
      frameCount: Number(probe.frameCount ?? 0),
      lastPageTableUploadSample: Array.isArray(probe.lastPageTableUploadSample)
        ? probe.lastPageTableUploadSample
        : [],
      lastPhysicalAtlasUpload: String(probe.lastPhysicalAtlasUpload ?? ''),
      mode: String(probe.mode ?? ''),
      pageTablePreviewReadback: probe.pageTablePreviewReadback ?? { colorBuckets: 0, paintedRatio: 0 },
      pageTableReadback: probe.pageTableReadback ?? { nonZeroTexels: 0, texels: 0, uniqueEntries: 0 },
      pageTableTexelUploads: Number(probe.pageTableTexelUploads ?? 0),
      physicalAtlasUploads: Number(probe.physicalAtlasUploads ?? 0),
      previewDrawCalls: Number(probe.previewDrawCalls ?? 0),
      ready: probe.ready === true,
      residentPageIds: Array.isArray(probe.residentPageIds) ? probe.residentPageIds : [],
      supported: probe.supported === true,
      terrainDrawCalls: Number(probe.terrainDrawCalls ?? 0),
      terrainReadback: probe.terrainReadback ?? { colorBuckets: 0, paintedRatio: 0 },
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
        editorAriaValue: document.querySelector('.text-example canvas')?.getAttribute('aria-valuetext') ?? '',
        editorRole: document.querySelector('.text-example canvas')?.getAttribute('role') ?? '',
        editorTabIndex: document.querySelector('.text-example canvas')?.tabIndex ?? -1,
        probe: readTextEditorProbe(),
        rangeInputs: document.querySelectorAll('.text-example input[type="range"]').length,
        rangeInputIds: Array.from(document.querySelectorAll('.text-example input[type="range"]')).map((input) => input.id),
        rangeInputNames: Array.from(document.querySelectorAll('.text-example input[type="range"]')).map((input) => input.name),
        textInputs: document.querySelectorAll('.text-example input[type="text"]').length,
        textInputIds: Array.from(document.querySelectorAll('.text-example input[type="text"]')).map((input) => input.id),
        textInputNames: Array.from(document.querySelectorAll('.text-example input[type="text"]')).map((input) => input.name),
        textValue: document.querySelector('.text-example input[type="text"]')?.value ?? '',
      } : undefined,
      virtualTextureControls: routeId === 'virtual-texturing-terrain' ? (() => {
        const slider = document.querySelector('[data-virtual-texture-detail-slider]');
        const output = document.querySelector('[data-virtual-texture-effective-resolution]');

        return {
          controlGroups: document.querySelectorAll('[data-virtual-texture-controls]').length,
          id: slider?.getAttribute('id') ?? '',
          max: Number(slider?.getAttribute('max') ?? 0),
          min: Number(slider?.getAttribute('min') ?? 0),
          name: slider?.getAttribute('name') ?? '',
          outputResolution: Number(output?.getAttribute('data-virtual-texture-effective-resolution') ?? 0),
          rangeInputs: document.querySelectorAll('[data-virtual-texture-example] input[type="range"]').length,
          value: Number(slider?.value ?? 0),
        };
      })() : undefined,
      virtualTexturing: routeId === 'virtual-texturing-terrain' ? readVirtualTextureProbe() : undefined,
      activeNav: activeLink === null ? undefined : {
        id: activeLink.getAttribute('data-example-id') ?? '',
        path: activeLink.getAttribute('data-example-route') ?? '',
        text: activeLink.textContent?.trim() ?? '',
      },
    };
  };
  const runVirtualTextureDetailSmoke = async () => {
    const before = read();
    const slider = document.querySelector('[data-virtual-texture-detail-slider]');
    const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
      candidate.getAttribute('aria-label') === 'Virtual texturing terrain'
    );

    if (slider !== null) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(slider, slider.getAttribute('max') ?? slider.value);
      slider.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }
    if (canvas !== undefined) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: 0,
        deltaY: -5000,
      }));
    }

    const deadline = performance.now() + 8000;
    let state = read();
    const beforeResolution = before.virtualTexturing?.detail?.effectiveVirtualResolution ?? 0;
    const maxControl = state.virtualTextureControls?.max ?? 0;
    const isCranked = () => {
      const vt = state.virtualTexturing;
      return vt?.ready === true &&
        vt.detail.maxResidentDetail === maxControl &&
        vt.detail.effectiveVirtualResolution > beforeResolution &&
        vt.detail.requestedMip === 0 &&
        vt.exactPageCount > 0 &&
        vt.canvasReadback.colorBuckets >= 6 &&
        vt.terrainReadback.paintedRatio >= 0.2;
    };

    while (performance.now() < deadline && !isCranked()) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      state = read();
    }

    return {
      ...state,
      virtualTextureControlsBefore: before.virtualTextureControls,
      virtualTexturingBeforeDetail: before.virtualTexturing,
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
      state.canvas.sample.paintedRatio >= state.canvas.minPaintedRatio &&
      (state.route.id !== 'virtual-texturing-terrain' || state.virtualTexturing?.ready === true);
  };

  while (performance.now() < deadline && !isReady()) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state = read();
  }

  if (state.route.id === 'virtual-texturing-terrain') {
    state = await runVirtualTextureDetailSmoke();
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
        state.textControls?.textInputs !== 0 ||
        state.textControls?.rangeInputs !== 0 ||
        state.textControls?.editorRole !== 'textbox' ||
        state.canvas?.edge === undefined ||
        state.textControls?.probe === undefined
      )
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      state = read();
    }
    state = read();
  }

  return state;
})()
`;

const textProbeExpression = `
(() => {
  const probe = window.__royalTextEditorProbe;
  if (probe === undefined || probe === null) return undefined;
  const selection = probe.selection ?? {};
  const normalizePlacement = (placement) => ({
    index: Number(placement?.index ?? 0),
    line: Number(placement?.line ?? 0),
    x: Number(placement?.x ?? 0),
  });
  const normalizeRect = (rect) => ({
    end: Number(rect?.end ?? 0),
    height: Number(rect?.height ?? 0),
    line: Number(rect?.line ?? 0),
    start: Number(rect?.start ?? 0),
    width: Number(rect?.width ?? 0),
    x: Number(rect?.x ?? 0),
    y: Number(rect?.y ?? 0),
  });

  return {
    caret: {
      height: Number(probe.caret?.height ?? 0),
      index: Number(probe.caret?.index ?? 0),
      line: Number(probe.caret?.line ?? 0),
      x: Number(probe.caret?.x ?? 0),
      y: Number(probe.caret?.y ?? 0),
    },
    fontSize: Number(probe.fontSize ?? 0),
    hitTest: {
      count: Number(probe.hitTest?.count ?? 0),
      lastClientX: Number(probe.hitTest?.lastClientX ?? 0),
      lastClientY: Number(probe.hitTest?.lastClientY ?? 0),
      lastIndex: Number(probe.hitTest?.lastIndex ?? -1),
      lastLine: Number(probe.hitTest?.lastLine ?? -1),
      lastMs: Number(probe.hitTest?.lastMs ?? 0),
      maxMs: Number(probe.hitTest?.maxMs ?? 0),
    },
    layout: {
      lineCount: Number(probe.layout?.lineCount ?? 0),
      maxWidth: Number(probe.layout?.maxWidth ?? 0),
      selectionHeight: Number(probe.layout?.selectionHeight ?? 0),
      selectionYOffset: Number(probe.layout?.selectionYOffset ?? 0),
    },
    lineHeight: Number(probe.lineHeight ?? 0),
    origin: {
      x: Number(probe.origin?.x ?? 0),
      y: Number(probe.origin?.y ?? 0),
    },
    placements: Array.isArray(probe.placements) ? probe.placements.map(normalizePlacement) : [],
    selection: {
      anchor: Number(selection.anchor ?? 0),
      anchorLine: selection.anchorLine === undefined ? undefined : Number(selection.anchorLine),
      focus: Number(selection.focus ?? 0),
      focusLine: selection.focusLine === undefined ? undefined : Number(selection.focusLine),
    },
    selectionRects: Array.isArray(probe.selectionRects) ? probe.selectionRects.map(normalizeRect) : [],
    textLength: Number(probe.textLength ?? 0),
  };
})()
`;

const textInteractionPlanExpression = `
(() => {
  const probe = window.__royalTextEditorProbe;
  const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
    candidate.getAttribute('aria-label') === 'Renderer text editor'
  );
  if (probe === undefined || probe === null || canvas === undefined || probe.placements.length < 2) {
    return { error: 'missing text canvas or caret placements' };
  }

  const bounds = { bottom: -3.2, left: -5.6, right: 5.6, top: 3.2 };
  const textWorldToClient = (x, y) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((x - bounds.left) / (bounds.right - bounds.left)) * rect.width,
      y: rect.top + ((bounds.top - y) / (bounds.top - bounds.bottom)) * rect.height,
    };
  };
  const pointFor = (placement) =>
    textWorldToClient(
      Number(probe.origin.x) + Number(placement.x),
      Number(probe.origin.y) -
        Number(placement.line) * Number(probe.lineHeight) +
        Number(probe.layout.selectionYOffset),
    );
  const normalizePlacement = (placement) => placement === undefined ? undefined : ({
    index: Number(placement.index ?? 0),
    line: Number(placement.line ?? 0),
    x: Number(placement.x ?? 0),
  });

  const clickTarget = normalizePlacement(probe.placements[Math.max(1, Math.floor(probe.placements.length * 0.45))]);
  const startTarget = normalizePlacement(probe.placements[0]);
  const endTarget = normalizePlacement(probe.placements[probe.placements.length - 1]);
  const clickPoint = pointFor(clickTarget);
  const dragStart = pointFor(startTarget);
  const dragEnd = pointFor(endTarget);
  const clickHit = normalizePlacement(probe.hitTestClientPoint?.(clickPoint.x, clickPoint.y));

  return {
    clickHit,
    clickPoint,
    clickTarget,
    dragEnd,
    dragStart,
    endTarget,
    startTarget,
  };
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
    if (state.textControls?.textInputs !== 0) {
      failures.push(`text route rendered ${state.textControls?.textInputs ?? 0} text input(s)`);
    }
    if (state.textControls?.rangeInputs !== 0) {
      failures.push(`text route rendered ${state.textControls?.rangeInputs ?? 0} range input(s)`);
    }
    if ((state.textControls?.textInputIds?.length ?? 0) > 0) {
      failures.push(`text route still rendered text input id(s): ${state.textControls.textInputIds.join(', ')}`);
    }
    if ((state.textControls?.textInputNames?.length ?? 0) > 0) {
      failures.push(`text route still rendered text input name(s): ${state.textControls.textInputNames.join(', ')}`);
    }
    if ((state.textControls?.rangeInputIds?.length ?? 0) > 0) {
      failures.push(`text route still rendered range input id(s): ${state.textControls.rangeInputIds.join(', ')}`);
    }
    if ((state.textControls?.rangeInputNames?.length ?? 0) > 0) {
      failures.push(`text route still rendered range input name(s): ${state.textControls.rangeInputNames.join(', ')}`);
    }
    if (state.textControls?.editorRole !== 'textbox') {
      failures.push(`text route canvas role was "${state.textControls?.editorRole ?? 'missing'}"`);
    }
    if (state.textControls?.editorTabIndex !== 0) {
      failures.push(`text route canvas tabIndex was ${state.textControls?.editorTabIndex ?? 'missing'}`);
    }
    if (state.textControls?.editorAriaValue !== 'Moloch, whose factories dream and croak in the fog') {
      failures.push('text route default editable sentence changed unexpectedly');
    }
    const edgeRatio = state.canvas?.edge?.brightRatio;
    if (edgeRatio === undefined) {
      failures.push('text route missed right-edge canvas sample');
    } else if (edgeRatio > 0.001) {
      failures.push(`text canvas has bright right-edge pixels ${edgeRatio.toFixed(4)}`);
    }
    const probe = state.textControls?.probe;
    if (probe === undefined) {
      failures.push('text route missed editor geometry probe');
    } else {
      if (probe.layout.lineCount <= 0 || probe.placements.length < 2) {
        failures.push(`text probe placements were lineCount=${probe.layout.lineCount} placements=${probe.placements.length}`);
      }
      if (probe.layout.selectionHeight <= 0 || probe.lineHeight <= 0) {
        failures.push(
          `text probe invalid metrics selectionHeight=${probe.layout.selectionHeight} lineHeight=${probe.lineHeight}`,
        );
      }
      if (probe.fontSizeSweep.length !== 3) {
        failures.push(`text probe font-size sweep returned ${probe.fontSizeSweep.length} entries`);
      } else {
        const invalidSweep = probe.fontSizeSweep.filter((entry) =>
          entry.lineCount <= 0 ||
          entry.selectionHeight <= 0 ||
          entry.minSelectionHeight <= 0 ||
          entry.maxSelectionHeight < entry.minSelectionHeight
        );
        if (invalidSweep.length > 0) {
          failures.push('text probe font-size sweep produced invalid geometry');
        }
        for (let index = 1; index < probe.fontSizeSweep.length; index += 1) {
          if (probe.fontSizeSweep[index].selectionHeight <= probe.fontSizeSweep[index - 1].selectionHeight) {
            failures.push('text probe selection height did not scale with font size');
            break;
          }
        }
      }
    }
    const interaction = state.textInteraction;
    if (interaction === undefined) {
      failures.push('text route missed interaction smoke');
    } else if (interaction.error !== undefined) {
      failures.push(`text route interaction smoke failed: ${interaction.error}`);
    } else {
      const clicked = interaction.clicked;
      const clickHit = interaction.clickHit;
      const clickPoint = interaction.clickPoint;
      const clickTarget = interaction.clickTarget;
      const after = interaction.after;
      if (clicked?.selection?.focus !== clickTarget?.index || clicked?.selection?.focusLine !== clickTarget?.line) {
        failures.push(
          `text click landed at ${clicked?.selection?.focus}:${clicked?.selection?.focusLine}, expected ${
            clickTarget?.index
          }:${clickTarget?.line}, pre-hit ${
            clickHit === undefined ? 'missing' : `${clickHit.index}:${clickHit.line}`
          }, handler-hit ${clicked?.hitTest?.lastIndex}:${clicked?.hitTest?.lastLine} count ${
            clicked?.hitTest?.count ?? 'missing'
          } client ${clicked?.hitTest?.lastClientX ?? 'missing'},${clicked?.hitTest?.lastClientY ?? 'missing'} sent ${
            clickPoint === undefined ? 'missing' : `${clickPoint.x},${clickPoint.y}`
          }`,
        );
      }
      if (interaction.clickToProbeMs > 250) {
        failures.push(`text click-to-probe took ${interaction.clickToProbeMs.toFixed(1)}ms`);
      }
      if ((after?.selectionRects.length ?? 0) <= 0) {
        failures.push('text drag selection produced no selection rectangles');
      }
      if ((after?.hitTest.maxMs ?? 0) > 8) {
        failures.push(`text hit testing max ${after.hitTest.maxMs.toFixed(2)}ms > 8ms`);
      }
      const rectOverflow = after?.selectionRects.find((rect) =>
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.x < after.origin.x - 0.01 ||
        rect.x + rect.width > after.origin.x + after.layout.maxWidth + 0.01
      );
      if (rectOverflow !== undefined) {
        failures.push(
          `text selection rect overflow line=${rectOverflow.line} x=${rectOverflow.x.toFixed(3)} width=${
            rectOverflow.width.toFixed(3)
          }`,
        );
      }
    }
  }

  if (expected.id === 'virtual-texturing-terrain') {
    const vt = state.virtualTexturing;
    const initialVt = state.virtualTexturingBeforeDetail;
    const controls = state.virtualTextureControls;

    if (controls?.controlGroups !== 1) {
      failures.push(`virtual texture rendered ${controls?.controlGroups ?? 0} control group(s)`);
    }
    if (controls?.rangeInputs !== 1) {
      failures.push(`virtual texture rendered ${controls?.rangeInputs ?? 0} detail slider(s)`);
    }
    if (controls?.id !== 'virtual-texture-detail-budget') {
      failures.push('virtual texture detail slider id is missing');
    }
    if (controls?.name !== 'virtual-texture-detail-budget') {
      failures.push('virtual texture detail slider name is missing');
    }
    if (controls?.min !== 0 || (controls?.max ?? 0) < 6) {
      failures.push(`virtual texture slider range was ${controls?.min ?? 'missing'}-${controls?.max ?? 'missing'}`);
    }
    if (controls?.value !== controls?.max) {
      failures.push(`virtual texture detail slider value was ${controls?.value ?? 'missing'}, expected ${controls?.max}`);
    }
    if ((initialVt?.detail?.effectiveVirtualResolution ?? 0) >= (vt?.detail?.effectiveVirtualResolution ?? 0)) {
      failures.push('virtual texture cranked detail did not raise effective resolution');
    }
    if (vt === undefined) {
      failures.push('missing virtual texturing probe');
    } else {
      if (!vt.supported) failures.push(`virtual texturing probe unsupported: ${vt.error}`);
      if (vt.mode !== 'webgl2-virtual-texture') {
        failures.push(`virtual texturing mode was "${vt.mode}"`);
      }
      if (!vt.ready) failures.push('virtual texturing probe did not become ready');
      if (vt.detail.maxResidentDetail !== controls?.max) {
        failures.push(`virtual texture max resident detail was ${vt.detail.maxResidentDetail}, expected ${controls?.max}`);
      }
      if (vt.detail.requestedMip !== 0) {
        failures.push(`virtual texture zoomed request mip was ${vt.detail.requestedMip}, expected 0`);
      }
      if (vt.detail.effectiveVirtualResolution < 4096 || controls?.outputResolution !== vt.detail.effectiveVirtualResolution) {
        failures.push(
          `virtual texture effective resolution was ${vt.detail.effectiveVirtualResolution} with output ${
            controls?.outputResolution ?? 'missing'
          }`,
        );
      }
      if (vt.detail.baseResolveCount < 4096 || vt.pageTableTexelUploads < vt.detail.baseResolveCount) {
        failures.push(
          `page-table coverage was base=${vt.detail.baseResolveCount} uploads=${vt.pageTableTexelUploads}`,
        );
      }
      if (vt.detail.requestedPages < 2 || vt.detail.requestedPageIds.length !== vt.detail.requestedPages) {
        failures.push(
          `virtual texture requested pages were count=${vt.detail.requestedPages} ids=${vt.detail.requestedPageIds.length}`,
        );
      }
      if (vt.detail.requestSignature === '') {
        failures.push('virtual texture request signature stayed empty');
      }
      if (vt.physicalAtlasUploads < vt.detail.requestedPages) {
        failures.push(`physical atlas uploads ${vt.physicalAtlasUploads} < requested pages ${vt.detail.requestedPages}`);
      }
      if (vt.bytesUploaded <= vt.pageTableTexelUploads * 4) {
        failures.push('virtual texture upload byte count only covers page-table texels');
      }
      if (vt.pageTableReadback.nonZeroTexels < vt.detail.baseResolveCount) {
        failures.push(
          `page-table readback nonzero texels ${vt.pageTableReadback.nonZeroTexels} < ${vt.detail.baseResolveCount}`,
        );
      }
      if (vt.pageTableReadback.uniqueEntries < 3) {
        failures.push(`page-table readback unique entries ${vt.pageTableReadback.uniqueEntries} < 3`);
      }
      if (vt.canvasReadback.colorBuckets < 6) {
        failures.push(`virtual texture canvas buckets ${vt.canvasReadback.colorBuckets} < 6`);
      }
      if (vt.terrainDrawCalls <= 0) {
        failures.push('virtual texture terrain draw count stayed empty');
      }
      if (vt.terrainReadback.colorBuckets < 6 || vt.terrainReadback.paintedRatio < 0.2) {
        failures.push(
          `virtual texture terrain readback was buckets=${vt.terrainReadback.colorBuckets} painted=${
            vt.terrainReadback.paintedRatio.toFixed(4)
          }`,
        );
      }
      if (vt.previewDrawCalls < 2) {
        failures.push(`virtual texture preview draw count ${vt.previewDrawCalls} < 2`);
      }
      if (vt.atlasPreviewReadback.colorBuckets < 4 || vt.atlasPreviewReadback.paintedRatio < 0.2) {
        failures.push(
          `virtual texture atlas preview readback was buckets=${vt.atlasPreviewReadback.colorBuckets} painted=${
            vt.atlasPreviewReadback.paintedRatio.toFixed(4)
          }`,
        );
      }
      if (vt.pageTablePreviewReadback.colorBuckets < 3 || vt.pageTablePreviewReadback.paintedRatio < 0.2) {
        failures.push(
          `virtual texture page-table preview readback was buckets=${
            vt.pageTablePreviewReadback.colorBuckets
          } painted=${vt.pageTablePreviewReadback.paintedRatio.toFixed(4)}`,
        );
      }
      if (vt.camera.distance <= 0) {
        failures.push('virtual texture camera probe did not initialize');
      }
      if (vt.exactPageCount <= 0 || vt.fallbackPageCount <= 0) {
        failures.push(
          `virtual texture exact/fallback counts were final=${vt.exactPageCount}/${vt.fallbackPageCount}`,
        );
      }
      if (vt.lastPageTableUploadSample.length < 4) {
        failures.push('virtual texture page-table upload sample stayed empty');
      }
      if (vt.lastPhysicalAtlasUpload === '') {
        failures.push('virtual texture physical atlas upload marker stayed empty');
      }
      if (vt.drawCalls <= 0 || vt.frameCount < 3) {
        failures.push(`virtual texture draw/frame counts were ${vt.drawCalls}/${vt.frameCount}`);
      }
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

const dispatchMouse = async (session, type, point, buttons = 0) => {
  await session.call('Input.dispatchMouseEvent', {
    button: 'left',
    buttons,
    clickCount: type === 'mousePressed' ? 1 : 0,
    type,
    x: point.x,
    y: point.y,
  });
};

const waitForTextProbeState = async (session, predicate, timeoutMs = 800) => {
  const deadline = Date.now() + timeoutMs;
  let probe = await evaluate(session, textProbeExpression);

  while (Date.now() < deadline && !predicate(probe)) {
    await sleep(16);
    probe = await evaluate(session, textProbeExpression);
  }

  return probe;
};

const runTextInteractionCdpSmoke = async (session) => {
  const before = await evaluate(session, textProbeExpression);
  const plan = await evaluate(session, textInteractionPlanExpression);
  if (plan?.error !== undefined) return { before, error: plan.error };

  const startedClickAt = performance.now();
  await dispatchMouse(session, 'mouseMoved', plan.clickPoint, 0);
  await dispatchMouse(session, 'mousePressed', plan.clickPoint, 1);
  await sleep(16);
  await dispatchMouse(session, 'mouseReleased', plan.clickPoint, 0);
  const clicked = await waitForTextProbeState(
    session,
    (probe) =>
      probe?.selection.focus === plan.clickTarget.index &&
      probe.selection.focusLine === plan.clickTarget.line,
  );
  const clickToProbeMs = performance.now() - startedClickAt;
  const startedDragAt = performance.now();
  await dispatchMouse(session, 'mouseMoved', plan.dragStart, 0);
  await dispatchMouse(session, 'mousePressed', plan.dragStart, 1);
  for (let step = 1; step <= 5; step += 1) {
    const ratio = step / 5;
    await dispatchMouse(session, 'mouseMoved', {
      x: plan.dragStart.x + (plan.dragEnd.x - plan.dragStart.x) * ratio,
      y: plan.dragStart.y + (plan.dragEnd.y - plan.dragStart.y) * ratio,
    }, 1);
    await sleep(16);
  }
  await dispatchMouse(session, 'mouseReleased', plan.dragEnd, 0);
  const after = await waitForTextProbeState(
    session,
    (probe) =>
      (probe?.selectionRects.length ?? 0) > 0 &&
      Math.abs((probe?.selection.focus ?? -1) - plan.endTarget.index) <= 1,
  );

  return {
    after,
    before,
    clickHit: plan.clickHit,
    clickPoint: plan.clickPoint,
    clickTarget: plan.clickTarget,
    clickToProbeMs,
    clicked,
    dragToProbeMs: performance.now() - startedDragAt,
    endTarget: plan.endTarget,
    startTarget: plan.startTarget,
  };
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
      let state = await evaluate(session, smokeExpression);
      if (route.id === 'text') {
        state = {
          ...state,
          textInteraction: await runTextInteractionCdpSmoke(session),
        };
      }
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
