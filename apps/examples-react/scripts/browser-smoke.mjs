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
const routeFilter = process.env.EXAMPLES_SMOKE_ROUTE?.trim() ?? '';
const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  throw new Error(`${name} must be a finite number, received ${JSON.stringify(raw)}`);
};
const textSelectionLatencyBudget = {
  maxClickToProbeMs: envNumber('EXAMPLES_TEXT_MAX_CLICK_TO_PROBE_MS', 250),
  maxDragToProbeMs: envNumber('EXAMPLES_TEXT_MAX_DRAG_TO_PROBE_MS', 750),
  maxHitTestMs: envNumber('EXAMPLES_TEXT_MAX_HIT_TEST_MS', 8),
};

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
  'virtual-texturing': {
    surface: 'canvas',
    canvasLabel: 'Virtual texturing plane',
    minColorBuckets: 6,
    minPaintedRatio: 0.04,
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
    const normalizeClipboard = (clipboard) => {
      const counters = clipboard?.counters ?? {};
      const failure = clipboard?.failure ?? clipboard?.fallback ?? {};
      const fallback = clipboard?.fallback ?? clipboard?.failure ?? {};
      const last = clipboard?.last ?? {};

      return {
        counters: {
          copy: Number(counters.copy ?? 0),
          cut: Number(counters.cut ?? 0),
          failure: Number(counters.failure ?? counters.fallback ?? 0),
          fallback: Number(counters.fallback ?? counters.failure ?? 0),
          keyboardCopy: Number(counters.keyboardCopy ?? 0),
          keyboardCut: Number(counters.keyboardCut ?? 0),
          keyboardPaste: Number(counters.keyboardPaste ?? 0),
          menuCopy: Number(counters.menuCopy ?? 0),
          menuCut: Number(counters.menuCut ?? 0),
          menuPaste: Number(counters.menuPaste ?? 0),
          nativeCopy: Number(counters.nativeCopy ?? 0),
          nativeCut: Number(counters.nativeCut ?? 0),
          nativePaste: Number(counters.nativePaste ?? 0),
          paste: Number(counters.paste ?? 0),
        },
        fallback: {
          action: String(fallback.action ?? 'none'),
          active: fallback.active === true,
          message: String(fallback.message ?? ''),
          reason: String(fallback.reason ?? 'none'),
          source: String(fallback.source ?? 'none'),
        },
        failure: {
          action: String(failure.action ?? 'none'),
          active: failure.active === true,
          message: String(failure.message ?? ''),
          reason: String(failure.reason ?? 'none'),
          source: String(failure.source ?? 'none'),
        },
        last: {
          action: String(last.action ?? 'none'),
          at: Number(last.at ?? 0),
          fallback: last.fallback === true,
          message: String(last.message ?? ''),
          ok: last.ok === true,
          reason: String(last.reason ?? 'none'),
          source: String(last.source ?? 'none'),
          text: String(last.text ?? ''),
          textLength: Number(last.textLength ?? String(last.text ?? '').length),
        },
      };
    };
    const normalizeMenu = (menu) => {
      const numeric = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      const normalizeCommand = (command) => ({
        action: String(command?.action ?? ''),
        clientX: numeric(command?.clientX),
        clientY: numeric(command?.clientY),
        enabled: command?.enabled === true,
      });

      return {
        commands: Array.isArray(menu?.commands) ? menu.commands.map(normalizeCommand) : [],
        enabled: {
          copy: menu?.enabled?.copy === true,
          cut: menu?.enabled?.cut === true,
          paste: menu?.enabled?.paste === true,
        },
        fallback: menu?.fallback === true,
        fallbackReason: String(menu?.fallbackReason ?? 'none'),
        open: menu?.open === true,
        unavailableReason: {
          paste: String(menu?.unavailableReason?.paste ?? 'none'),
        },
        x: Number(menu?.x ?? 0),
        y: Number(menu?.y ?? 0),
      };
    };
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
      selectedText: String(probe.selectedText ?? ''),
      clipboard: normalizeClipboard(probe.clipboard),
      clipboardReadPermission: String(probe.clipboardReadPermission ?? 'unknown'),
      menu: normalizeMenu(probe.menu),
      text: String(probe.text ?? ''),
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
      textControls: routeId === 'text' ? (() => {
        const editor = document.querySelector('canvas[aria-label="Renderer text editor"]');

        return {
          editorAriaValue: editor?.getAttribute('aria-valuetext') ?? '',
          editorRole: editor?.getAttribute('role') ?? '',
          editorTabIndex: editor?.tabIndex ?? -1,
          domClipboardBridges: document.querySelectorAll(
            '[data-royal-text-clipboard-bridge], .renderer-text-clipboard-bridge',
          ).length,
          domContextMenus: document.querySelectorAll(
            '[data-royal-text-context-menu], .renderer-text-context-menu',
          ).length,
          domMenuActions: document.querySelectorAll('[data-royal-text-menu-action]').length,
          probe: readTextEditorProbe(),
          rangeInputs: document.querySelectorAll('input[type="range"]').length,
          rangeInputIds: Array.from(document.querySelectorAll('input[type="range"]')).map((input) => input.id),
          rangeInputNames: Array.from(document.querySelectorAll('input[type="range"]')).map((input) => input.name),
          textInputs: document.querySelectorAll('input[type="text"]').length,
          textInputIds: Array.from(document.querySelectorAll('input[type="text"]')).map((input) => input.id),
          textInputNames: Array.from(document.querySelectorAll('input[type="text"]')).map((input) => input.name),
          textValue: document.querySelector('input[type="text"]')?.value ?? '',
        };
      })() : undefined,
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
  const normalizeClipboard = (clipboard) => {
    const counters = clipboard?.counters ?? {};
    const failure = clipboard?.failure ?? clipboard?.fallback ?? {};
    const fallback = clipboard?.fallback ?? clipboard?.failure ?? {};
    const last = clipboard?.last ?? {};

    return {
      counters: {
        copy: Number(counters.copy ?? 0),
        cut: Number(counters.cut ?? 0),
        failure: Number(counters.failure ?? counters.fallback ?? 0),
        fallback: Number(counters.fallback ?? counters.failure ?? 0),
        keyboardCopy: Number(counters.keyboardCopy ?? 0),
        keyboardCut: Number(counters.keyboardCut ?? 0),
        keyboardPaste: Number(counters.keyboardPaste ?? 0),
        menuCopy: Number(counters.menuCopy ?? 0),
        menuCut: Number(counters.menuCut ?? 0),
        menuPaste: Number(counters.menuPaste ?? 0),
        nativeCopy: Number(counters.nativeCopy ?? 0),
        nativeCut: Number(counters.nativeCut ?? 0),
        nativePaste: Number(counters.nativePaste ?? 0),
        paste: Number(counters.paste ?? 0),
      },
      fallback: {
        action: String(fallback.action ?? 'none'),
        active: fallback.active === true,
        message: String(fallback.message ?? ''),
        reason: String(fallback.reason ?? 'none'),
        source: String(fallback.source ?? 'none'),
      },
      failure: {
        action: String(failure.action ?? 'none'),
        active: failure.active === true,
        message: String(failure.message ?? ''),
        reason: String(failure.reason ?? 'none'),
        source: String(failure.source ?? 'none'),
      },
      last: {
        action: String(last.action ?? 'none'),
        at: Number(last.at ?? 0),
        fallback: last.fallback === true,
        message: String(last.message ?? ''),
        ok: last.ok === true,
        reason: String(last.reason ?? 'none'),
        source: String(last.source ?? 'none'),
        text: String(last.text ?? ''),
        textLength: Number(last.textLength ?? String(last.text ?? '').length),
      },
    };
  };
  const normalizeMenu = (menu) => {
    const numeric = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const normalizeCommand = (command) => ({
      action: String(command?.action ?? ''),
      clientX: numeric(command?.clientX),
      clientY: numeric(command?.clientY),
      enabled: command?.enabled === true,
    });

    return {
      commands: Array.isArray(menu?.commands) ? menu.commands.map(normalizeCommand) : [],
      enabled: {
        copy: menu?.enabled?.copy === true,
        cut: menu?.enabled?.cut === true,
        paste: menu?.enabled?.paste === true,
      },
      fallback: menu?.fallback === true,
      fallbackReason: String(menu?.fallbackReason ?? 'none'),
      open: menu?.open === true,
      unavailableReason: {
        paste: String(menu?.unavailableReason?.paste ?? 'none'),
      },
      x: Number(menu?.x ?? 0),
      y: Number(menu?.y ?? 0),
    };
  };

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
    selectedText: String(probe.selectedText ?? ''),
    clipboard: normalizeClipboard(probe.clipboard),
    clipboardReadPermission: String(probe.clipboardReadPermission ?? 'unknown'),
    menu: normalizeMenu(probe.menu),
    text: String(probe.text ?? ''),
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
  const partialStartIndex = Math.min(
    probe.placements.length - 2,
    Math.max(0, Math.floor(probe.placements.length * 0.18)),
  );
  const partialEndIndex = Math.min(
    probe.placements.length - 1,
    Math.max(partialStartIndex + 1, Math.floor(probe.placements.length * 0.7)),
  );
  const partialStartTarget = normalizePlacement(probe.placements[partialStartIndex]);
  const partialEndTarget = normalizePlacement(probe.placements[partialEndIndex]);
  const clickPoint = pointFor(clickTarget);
  const dragStart = pointFor(startTarget);
  const dragEnd = pointFor(endTarget);
  const partialDragStart = pointFor(partialStartTarget);
  const partialDragEnd = pointFor(partialEndTarget);
  const clickHit = normalizePlacement(probe.hitTestClientPoint?.(clickPoint.x, clickPoint.y));

  return {
    clickHit,
    clickPoint,
    clickTarget,
    dragEnd,
    dragStart,
    endTarget,
    partialDragEnd,
    partialDragStart,
    partialEndTarget,
    partialStartTarget,
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
    if ((state.textControls?.domClipboardBridges ?? 0) > 0) {
      failures.push(`text route rendered ${state.textControls.domClipboardBridges} DOM clipboard bridge(s)`);
    }
    if ((state.textControls?.domContextMenus ?? 0) > 0) {
      failures.push(`text route rendered ${state.textControls.domContextMenus} DOM context menu(s)`);
    }
    if ((state.textControls?.domMenuActions ?? 0) > 0) {
      failures.push(`text route rendered ${state.textControls.domMenuActions} DOM menu action(s)`);
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
      if (interaction.clickToProbeMs > textSelectionLatencyBudget.maxClickToProbeMs) {
        failures.push(
          `text click-to-probe took ${interaction.clickToProbeMs.toFixed(1)}ms > ${
            textSelectionLatencyBudget.maxClickToProbeMs
          }ms`,
        );
      }
      if (interaction.dragToProbeMs > textSelectionLatencyBudget.maxDragToProbeMs) {
        failures.push(
          `text drag-to-probe took ${interaction.dragToProbeMs.toFixed(1)}ms > ${
            textSelectionLatencyBudget.maxDragToProbeMs
          }ms`,
        );
      }
      if ((after?.selectionRects.length ?? 0) <= 0) {
        failures.push('text drag selection produced no selection rectangles');
      }
      if ((after?.hitTest.maxMs ?? 0) > textSelectionLatencyBudget.maxHitTestMs) {
        failures.push(
          `text hit testing max ${after.hitTest.maxMs.toFixed(2)}ms > ${
            textSelectionLatencyBudget.maxHitTestMs
          }ms`,
        );
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
      if ((after?.selectedText.length ?? 0) <= 0) {
        failures.push('text drag selection did not expose selected text');
      }

      const keyboard = interaction.keyboard;
      if (keyboard === undefined) {
        failures.push('text keyboard clipboard smoke did not run');
      } else {
        const afterCopy = keyboard.afterCopyShortcut;
        const afterCut = keyboard.afterCutShortcut;
        const afterPaste = keyboard.afterPasteShortcut;
        const keyboardEvents = Array.isArray(keyboard.keyboardClipboardEvents?.events)
          ? keyboard.keyboardClipboardEvents.events
          : [];
        const assertKeyboardClipboardEvent = (type) => {
          const event = keyboardEvents.find((candidate) => candidate.type === type);
          if (event === undefined) {
            failures.push(`text Ctrl-${type === 'copy' ? 'C' : type === 'cut' ? 'X' : 'V'} did not dispatch a ${type} event`);
            return;
          }
          if (event.targetIsCanvas !== true || event.currentTargetIsCanvas !== true) {
            failures.push(`text Ctrl-${type === 'copy' ? 'C' : type === 'cut' ? 'X' : 'V'} ${type} event did not target the canvas`);
          }
          if (event.activeElementIsCanvas !== true) {
            failures.push(`text Ctrl-${type === 'copy' ? 'C' : type === 'cut' ? 'X' : 'V'} ${type} event did not keep canvas focus`);
          }
          if (type === 'paste' && event.textLength !== (keyboard.nativeKeyboardPasteText?.length ?? Number.NaN)) {
            failures.push('text Ctrl-V paste event did not carry seeded native clipboard text');
          }
        };

        if (keyboard.keyboardClipboardEventLogSetup?.ok !== true) {
          failures.push(`text keyboard clipboard event log setup failed: ${
            keyboard.keyboardClipboardEventLogSetup?.reason ?? 'unknown'
          }`);
        }
        if (keyboard.keyboardClipboardEvents?.ok !== true) {
          failures.push(`text keyboard clipboard event log read failed: ${
            keyboard.keyboardClipboardEvents?.reason ?? 'unknown'
          }`);
        }
        assertKeyboardClipboardEvent('copy');
        if ((afterCopy?.clipboard.counters.keyboardCopy ?? 0) <= (after?.clipboard.counters.keyboardCopy ?? 0)) {
          failures.push('text Ctrl-C shortcut was not observed');
        }
        if ((afterCopy?.clipboard.counters.copy ?? 0) <= (after?.clipboard.counters.copy ?? 0)) {
          failures.push('text Ctrl-C did not reach a copy handler');
        }
        if (afterCopy?.clipboard.last.action !== 'copy' ||
          afterCopy?.clipboard.last.ok !== true ||
          afterCopy?.clipboard.last.source !== 'native') {
          failures.push(`text Ctrl-C did not report native clipboard success: ${
            afterCopy?.clipboard.last.reason ?? 'missing'
          } ${afterCopy?.clipboard.last.message ?? ''}`.trim());
        }
        if ((afterCopy?.clipboard.last.textLength ?? 0) !== (keyboard.keyboardCopyText?.length ?? Number.NaN)) {
          failures.push('text Ctrl-C did not report selected text length');
        }
        if (keyboard.afterCopyNativeClipboard?.ok !== true) {
          failures.push(`text Ctrl-C native clipboard readback failed: ${
            keyboard.afterCopyNativeClipboard?.reason ?? 'unknown'
          }${keyboard.afterCopyNativeClipboard?.message === undefined ? '' : ` (${keyboard.afterCopyNativeClipboard.message})`}`);
        } else if (keyboard.afterCopyNativeClipboard.text !== keyboard.keyboardCopyText) {
          failures.push('text Ctrl-C native clipboard readback did not match selected text');
        }
        assertKeyboardClipboardEvent('cut');
        if ((afterCut?.clipboard.counters.keyboardCut ?? 0) <= (afterCopy?.clipboard.counters.keyboardCut ?? 0)) {
          failures.push('text Ctrl-X shortcut was not observed');
        }
        if ((afterCut?.clipboard.counters.cut ?? 0) <= (afterCopy?.clipboard.counters.cut ?? 0)) {
          failures.push('text Ctrl-X did not reach a cut handler');
        }
        if (afterCut?.clipboard.last.action !== 'cut' ||
          afterCut?.clipboard.last.ok !== true ||
          afterCut?.clipboard.last.source !== 'native') {
          failures.push(`text Ctrl-X did not report native clipboard success: ${
            afterCut?.clipboard.last.reason ?? 'missing'
          } ${afterCut?.clipboard.last.message ?? ''}`.trim());
        }
        if ((afterCut?.clipboard.last.textLength ?? 0) !== (keyboard.keyboardCutText?.length ?? Number.NaN)) {
          failures.push('text Ctrl-X did not report cut text length');
        }
        if ((afterCut?.textLength ?? Number.POSITIVE_INFINITY) >= (afterCopy?.textLength ?? 0)) {
          failures.push('text Ctrl-X did not delete selected text');
        }
        if (keyboard.afterCutNativeClipboard?.ok !== true) {
          failures.push(`text Ctrl-X native clipboard readback failed: ${
            keyboard.afterCutNativeClipboard?.reason ?? 'unknown'
          }${keyboard.afterCutNativeClipboard?.message === undefined ? '' : ` (${keyboard.afterCutNativeClipboard.message})`}`);
        } else if (keyboard.afterCutNativeClipboard.text !== keyboard.keyboardCutText) {
          failures.push('text Ctrl-X native clipboard readback did not match cut text');
        }
        if (keyboard.keyboardPasteSetup?.ok !== true) {
          failures.push(`text Ctrl-V could not verify native clipboard seed: ${
            keyboard.keyboardPasteSetup?.reason ?? 'unknown'
          }${keyboard.keyboardPasteSetup?.message === undefined ? '' : ` (${keyboard.keyboardPasteSetup.message})`}`);
        }
        if (keyboard.keyboardPasteSetup?.ok === true) {
          if (keyboard.keyboardPasteReadTextTrap?.ok !== true) {
            failures.push(`text Ctrl-V readText trap setup failed: ${
              keyboard.keyboardPasteReadTextTrap?.reason ?? 'unknown'
            }`);
          } else if (keyboard.afterKeyboardPasteReadTextTrap?.ok !== true) {
            failures.push(`text Ctrl-V readText trap read failed: ${
              keyboard.afterKeyboardPasteReadTextTrap?.reason ?? 'unknown'
            }`);
          } else if ((keyboard.afterKeyboardPasteReadTextTrap?.calls ?? 0) !== 0) {
            failures.push(`text Ctrl-V called navigator.clipboard.readText ${
              keyboard.afterKeyboardPasteReadTextTrap.calls
            } time(s)`);
          }
          if (keyboard.keyboardPasteReadTextTrapRestore?.ok !== true) {
            failures.push(`text Ctrl-V readText trap restore failed: ${
              keyboard.keyboardPasteReadTextTrapRestore?.reason ?? 'unknown'
            }`);
          }
          if (keyboard.keyboardPasteReadTextTrap?.ok === true) {
            assertKeyboardClipboardEvent('paste');
          }
          if ((afterPaste?.clipboard.counters.keyboardPaste ?? 0) <=
            (keyboard.afterKeyboardPasteSelection?.clipboard.counters.keyboardPaste ?? 0)) {
            failures.push('text Ctrl-V shortcut was not observed');
          }
          if ((afterPaste?.clipboard.counters.paste ?? 0) <=
            (keyboard.afterKeyboardPasteSelection?.clipboard.counters.paste ?? 0)) {
            failures.push('text Ctrl-V did not reach a paste handler');
          }
          if (afterPaste?.clipboard.last.action !== 'paste' ||
            afterPaste?.clipboard.last.ok !== true ||
            afterPaste?.clipboard.last.reason !== 'success' ||
            afterPaste?.clipboard.last.source !== 'native') {
            failures.push(`text Ctrl-V did not report native clipboard success: ${
              afterPaste?.clipboard.last.reason ?? 'missing'
            } ${afterPaste?.clipboard.last.message ?? ''}`.trim());
          }
          if ((afterPaste?.clipboard.last.textLength ?? 0) !==
            (keyboard.nativeKeyboardPasteText?.length ?? Number.NaN)) {
            failures.push('text Ctrl-V did not report seeded native clipboard text length');
          }
          if (!String(afterPaste?.text ?? '').includes(keyboard.nativeKeyboardPasteText ?? '')) {
            failures.push('text Ctrl-V did not insert seeded native clipboard text');
          }
          if (keyboard.afterPasteNativeClipboard?.ok !== true) {
            failures.push(`text Ctrl-V native clipboard readback failed after paste: ${
              keyboard.afterPasteNativeClipboard?.reason ?? 'unknown'
            }${keyboard.afterPasteNativeClipboard?.message === undefined ? '' : ` (${keyboard.afterPasteNativeClipboard.message})`}`);
          } else if (keyboard.afterPasteNativeClipboard.text !== keyboard.nativeKeyboardPasteText) {
            failures.push('text Ctrl-V changed the native clipboard unexpectedly');
          }
        }
      }

      const contextMenu = interaction.contextMenu;
      if (contextMenu === undefined) {
        failures.push('text context-menu clipboard smoke did not run');
      } else {
        const assertMenuCommand = (opened, action) => {
          const command = opened?.menu?.commands?.find((candidate) => candidate.action === action);
          if (command === undefined) {
            failures.push(`text context menu probe missed "${action}" command`);
            return undefined;
          }
          if (command.enabled !== opened?.menu?.enabled?.[action]) {
            failures.push(`text context menu "${action}" command enabled state did not match menu.enabled`);
          }
          if (!Number.isFinite(command.clientX) || !Number.isFinite(command.clientY)) {
            failures.push(`text context menu "${action}" command missed client coordinates`);
          }
          return command;
        };
        const assertNoMenuDom = (state, phase) => {
          if (state === undefined) {
            failures.push(`text context menu did not inspect DOM state after ${phase}`);
            return;
          }
          if ((state.clipboardBridges ?? 0) > 0) {
            failures.push(`text context menu rendered ${state.clipboardBridges} DOM clipboard bridge(s) after ${phase}`);
          }
          if ((state.contextMenus ?? 0) > 0) {
            failures.push(`text context menu rendered ${state.contextMenus} DOM menu(s) after ${phase}`);
          }
          if ((state.menuActions ?? 0) > 0) {
            failures.push(`text context menu rendered ${state.menuActions} DOM menu action(s) after ${phase}`);
          }
        };

        if (contextMenu.menuOpenedForCopy?.menu.open !== true) {
          failures.push('text context menu did not open');
        }
        assertNoMenuDom(contextMenu.menuDomAfterOpenForCopy, 'copy open');
        assertNoMenuDom(contextMenu.menuDomAfterOpenForCut, 'cut open');
        assertNoMenuDom(contextMenu.menuDomAfterOpenForPaste, 'paste open');
        assertMenuCommand(contextMenu.menuOpenedForCopy, 'copy');
        assertMenuCommand(contextMenu.menuOpenedForCut, 'cut');
        assertMenuCommand(contextMenu.menuOpenedForPaste, 'paste');
        if (contextMenu.menuOpenedForCopy?.menu.enabled.copy !== true ||
          contextMenu.menuOpenedForCopy?.menu.enabled.cut !== true) {
          failures.push('text context menu did not enable copy/cut for selected text');
        }
        if (contextMenu.menuCopyClick?.ok !== true || contextMenu.menuCopyClick?.disabled === true) {
          failures.push(`text context-menu copy click failed: ${contextMenu.menuCopyClick?.reason ?? 'disabled'}`);
        }
        if ((contextMenu.afterMenuCopy?.clipboard.counters.menuCopy ?? 0) <=
          (contextMenu.menuOpenedForCopy?.clipboard.counters.menuCopy ?? 0)) {
          failures.push('text context-menu copy did not update copy counters');
        }
        if ((contextMenu.afterMenuCopy?.clipboard.last.textLength ??
          contextMenu.afterMenuCopy?.clipboard.last.text.length ?? 0) <= 0) {
          failures.push('text context-menu copy did not use selected text');
        }
        if (contextMenu.menuCutClick?.ok !== true || contextMenu.menuCutClick?.disabled === true) {
          failures.push(`text context-menu cut click failed: ${contextMenu.menuCutClick?.reason ?? 'disabled'}`);
        }
        if ((contextMenu.afterMenuCut?.clipboard.counters.menuCut ?? 0) <=
          (contextMenu.menuOpenedForCut?.clipboard.counters.menuCut ?? 0)) {
          failures.push('text context-menu cut did not update cut counters');
        }
        if ((contextMenu.afterMenuCut?.textLength ?? Number.POSITIVE_INFINITY) >=
          (contextMenu.afterMenuCopy?.textLength ?? 0)) {
          failures.push('text context-menu cut did not delete selected text');
        }
        if (contextMenu.menuOpenedForPaste?.menu.enabled.paste !== true) {
          failures.push('text context-menu paste was not enabled when native clipboard reads were available');
        }
        if (contextMenu.menuOpenedForPaste?.menu.unavailableReason?.paste !== 'none') {
          failures.push('text context-menu paste still exposed an unavailable reason');
        }
        if (interaction.menuPasteSetup?.ok !== true) {
          failures.push(`text context-menu paste could not verify native clipboard seed: ${
            interaction.menuPasteSetup?.reason ?? 'unknown'
          }${interaction.menuPasteSetup?.message === undefined ? '' : ` (${interaction.menuPasteSetup.message})`}`);
        }
        if (contextMenu.menuPasteClick?.ok !== true || contextMenu.menuPasteClick?.disabled === true) {
          failures.push(`text context-menu paste click failed: ${contextMenu.menuPasteClick?.reason ?? 'disabled'}`);
        }
        if ((contextMenu.afterMenuPaste?.clipboard.counters.menuPaste ?? 0) <=
          (contextMenu.menuOpenedForPaste?.clipboard.counters.menuPaste ?? 0)) {
          failures.push('text context-menu paste did not update paste counters');
        }
        if (contextMenu.afterMenuPaste?.clipboard.last.action !== 'paste' ||
          contextMenu.afterMenuPaste?.clipboard.last.ok !== true ||
          contextMenu.afterMenuPaste?.clipboard.last.source !== 'menu') {
          failures.push(`text context-menu paste did not report native menu success: ${
            contextMenu.afterMenuPaste?.clipboard.last.reason ?? 'missing'
          } ${contextMenu.afterMenuPaste?.clipboard.last.message ?? ''}`.trim());
        }
        if ((contextMenu.afterMenuPaste?.clipboard.last.textLength ?? 0) !==
          (interaction.nativeMenuPasteText?.length ?? Number.NaN)) {
          failures.push('text context-menu paste did not report seeded native clipboard text length');
        }
        if (!String(contextMenu.afterMenuPaste?.text ?? '').includes(interaction.nativeMenuPasteText ?? '')) {
          failures.push('text context-menu paste did not insert seeded native clipboard text');
        }
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
  ]) {
    if (!artifactIds.has(expectedId)) failures.push(`missing ${expectedId} research artifact card`);
  }
  const assetIds = new Set(state.assets.map((asset) => asset.id));
  for (const expectedId of [
    'picking-replay-json',
    'asset-contract-schema',
    'asset-contract-terrain',
    'asset-contract-impostors',
    'offline-terrain-manifest',
    'offline-terrain-world-index',
    'offline-terrain-schema',
    'dynamic-impostors-manifest',
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

const dispatchKeyboardShortcut = async (session, key) => {
  const normalizedKey = key.toLowerCase();
  const upperKey = normalizedKey.toUpperCase();
  const keyCode = upperKey.charCodeAt(0);
  const event = {
    code: `Key${upperKey}`,
    key: normalizedKey,
    modifiers: 2,
    nativeVirtualKeyCode: keyCode,
    windowsVirtualKeyCode: keyCode,
  };

  await session.call('Input.dispatchKeyEvent', { ...event, type: 'keyDown' });
  await session.call('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
};

const dispatchTextPointer = async (session, type, point, buttons = 0) => evaluate(session, `
(() => {
  const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
    candidate.getAttribute('aria-label') === 'Renderer text editor'
  );
  if (canvas === undefined) return { ok: false, reason: 'missing text canvas' };
  if (typeof PointerEvent !== 'function') return { ok: false, reason: 'missing PointerEvent' };

  const event = new PointerEvent(${JSON.stringify(type)}, {
    bubbles: true,
    button: 0,
    buttons: ${Number(buttons)},
    cancelable: true,
    clientX: ${Number(point.x)},
    clientY: ${Number(point.y)},
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse',
  });
  return { defaultPrevented: event.defaultPrevented, dispatched: canvas.dispatchEvent(event), ok: true };
})()
`);

const dispatchTextContextMenu = async (session, point) => evaluate(session, `
(() => {
  const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
    candidate.getAttribute('aria-label') === 'Renderer text editor'
  );
  if (canvas === undefined) return { ok: false, reason: 'missing text canvas' };

  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    buttons: 2,
    cancelable: true,
    clientX: ${Number(point.x)},
    clientY: ${Number(point.y)},
    composed: true,
    view: window,
  });
  canvas.focus({ preventScroll: true });
  return { defaultPrevented: event.defaultPrevented, dispatched: canvas.dispatchEvent(event), ok: true };
})()
`);

const seedNativeTextClipboard = async (session, text) => evaluate(session, `
(async () => {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) {
    return { ok: false, phase: 'api', reason: 'navigator.clipboard unavailable' };
  }
  if (typeof clipboard.writeText !== 'function') {
    return { ok: false, phase: 'write-api', reason: 'navigator.clipboard.writeText unavailable' };
  }
  if (typeof clipboard.readText !== 'function') {
    return { ok: false, phase: 'read-api', reason: 'navigator.clipboard.readText unavailable' };
  }

  try {
    await clipboard.writeText(${JSON.stringify(text)});
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : '',
      ok: false,
      phase: 'write',
      reason: 'native clipboard write failed',
    };
  }

  try {
    const readback = await clipboard.readText();
    return {
      ok: readback === ${JSON.stringify(text)},
      phase: 'readback',
      readbackLength: readback.length,
      reason: readback === ${JSON.stringify(text)} ? 'seeded' : 'native clipboard readback mismatch',
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : '',
      ok: false,
      phase: 'readback',
      reason: 'native clipboard readback failed',
    };
  }
})()
`);

const readNativeTextClipboard = async (session) => evaluate(session, `
(async () => {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.readText !== 'function') {
    return { ok: false, reason: 'navigator.clipboard.readText unavailable' };
  }

  try {
    const text = await clipboard.readText();
    return { ok: true, text, textLength: text.length };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : '',
      ok: false,
      reason: 'native clipboard read failed',
    };
  }
})()
`);

const installTextClipboardEventLog = async (session) => evaluate(session, `
(() => {
  const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
    candidate.getAttribute('aria-label') === 'Renderer text editor'
  );
  if (canvas === undefined) return { ok: false, reason: 'missing text canvas' };

  window.__royalTextClipboardEventLog?.dispose?.();

  const events = [];
  const listener = (event) => {
    let textLength = 0;
    if (event.type === 'paste') {
      try {
        textLength = String(event.clipboardData?.getData('text/plain') ?? '').length;
      } catch {
        textLength = -1;
      }
    }

    events.push({
      activeElementIsCanvas: document.activeElement === canvas,
      cancelable: event.cancelable === true,
      currentTargetIsCanvas: event.currentTarget === canvas,
      defaultPrevented: event.defaultPrevented === true,
      targetIsCanvas: event.target === canvas,
      textLength,
      type: event.type,
    });
  };

  for (const type of ['copy', 'cut', 'paste']) {
    canvas.addEventListener(type, listener);
  }

  window.__royalTextClipboardEventLog = {
    dispose: () => {
      for (const type of ['copy', 'cut', 'paste']) {
        canvas.removeEventListener(type, listener);
      }
    },
    events,
  };

  return { ok: true };
})()
`);

const readTextClipboardEventLog = async (session) => evaluate(session, `
(() => {
  const log = window.__royalTextClipboardEventLog;
  if (log === undefined) return { events: [], ok: false, reason: 'missing event log' };
  return {
    events: Array.isArray(log.events) ? log.events.map((event) => ({
      activeElementIsCanvas: event.activeElementIsCanvas === true,
      cancelable: event.cancelable === true,
      currentTargetIsCanvas: event.currentTargetIsCanvas === true,
      defaultPrevented: event.defaultPrevented === true,
      targetIsCanvas: event.targetIsCanvas === true,
      textLength: Number(event.textLength ?? 0),
      type: String(event.type ?? ''),
    })) : [],
    ok: true,
  };
})()
`);

const installTextClipboardReadTextTrap = async (session) => evaluate(session, `
(() => {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.readText !== 'function') {
    return { ok: false, reason: 'navigator.clipboard.readText unavailable' };
  }

  window.__royalTextClipboardReadTextTrap?.restore?.();

  const original = clipboard.readText.bind(clipboard);
  let calls = 0;
  const trappedReadText = async () => {
    calls += 1;
    throw new DOMException('readText trap during keyboard paste', 'NotAllowedError');
  };

  try {
    Object.defineProperty(clipboard, 'readText', {
      configurable: true,
      value: trappedReadText,
      writable: true,
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
      reason: 'failed to install readText trap',
    };
  }

  window.__royalTextClipboardReadTextTrap = {
    get calls() {
      return calls;
    },
    restore: () => {
      Object.defineProperty(clipboard, 'readText', {
        configurable: true,
        value: original,
        writable: true,
      });
    },
  };

  return { ok: true };
})()
`);

const readTextClipboardReadTextTrap = async (session) => evaluate(session, `
(() => {
  const trap = window.__royalTextClipboardReadTextTrap;
  if (trap === undefined) return { calls: 0, ok: false, reason: 'missing readText trap' };
  return { calls: Number(trap.calls ?? 0), ok: true };
})()
`);

const restoreTextClipboardReadTextTrap = async (session) => evaluate(session, `
(() => {
  const trap = window.__royalTextClipboardReadTextTrap;
  if (trap === undefined || typeof trap.restore !== 'function') {
    return { ok: false, reason: 'missing readText trap' };
  }

  try {
    trap.restore();
    delete window.__royalTextClipboardReadTextTrap;
    return { ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
      reason: 'failed to restore readText trap',
    };
  }
})()
`);

const readTextMenuDomState = async (session) => evaluate(session, `
(() => ({
  clipboardBridges: document.querySelectorAll(
    '[data-royal-text-clipboard-bridge], .renderer-text-clipboard-bridge',
  ).length,
  contextMenus: document.querySelectorAll(
    '[data-royal-text-context-menu], .renderer-text-context-menu',
  ).length,
  menuActions: document.querySelectorAll('[data-royal-text-menu-action]').length,
}))()
`);

const clickTextContextMenuAction = async (session, action) => evaluate(session, `
(() => {
  const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) =>
    candidate.getAttribute('aria-label') === 'Renderer text editor'
  );
  if (canvas === undefined) return { disabled: false, ok: false, reason: 'missing text canvas' };

  const commands = window.__royalTextEditorProbe?.menu?.commands;
  if (!Array.isArray(commands)) {
    return { disabled: false, ok: false, reason: 'missing menu commands' };
  }
  const command = commands.find((candidate) => candidate?.action === ${JSON.stringify(action)});
  if (command === undefined) {
    return { disabled: false, ok: false, reason: 'missing menu command' };
  }
  const clientX = Number(command.clientX);
  const clientY = Number(command.clientY);
  const enabled = command.enabled === true;
  const commandProbe = {
    action: String(command.action ?? ''),
    clientX,
    clientY,
    enabled,
  };

  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return { command: commandProbe, disabled: !enabled, ok: false, reason: 'invalid menu command point' };
  }
  if (!enabled) {
    return { command: commandProbe, disabled: true, ok: false, reason: 'disabled' };
  }

  const init = {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId: 2,
    pointerType: 'mouse',
  };
  canvas.focus({ preventScroll: true });
  const down = new PointerEvent('pointerdown', { ...init, buttons: 1 });
  const downDispatched = canvas.dispatchEvent(down);
  const up = new PointerEvent('pointerup', { ...init, buttons: 0 });
  const upDispatched = canvas.dispatchEvent(up);
  return {
    command: commandProbe,
    defaultPrevented: down.defaultPrevented || up.defaultPrevented,
    disabled: false,
    downDispatched,
    ok: true,
    upDispatched,
  };
})()
`, { userGesture: true });

const waitForTextProbeState = async (session, predicate, timeoutMs = 800) => {
  const deadline = Date.now() + timeoutMs;
  let probe = await evaluate(session, textProbeExpression);

  while (Date.now() < deadline && !predicate(probe)) {
    await sleep(16);
    probe = await evaluate(session, textProbeExpression);
  }

  return probe;
};

const dragTextSelection = async (session, plan) => {
  const startedDragAt = performance.now();
  await dispatchTextPointer(session, 'pointermove', plan.dragStart, 0);
  await dispatchTextPointer(session, 'pointerdown', plan.dragStart, 1);
  for (let step = 1; step <= 5; step += 1) {
    const ratio = step / 5;
    await dispatchTextPointer(session, 'pointermove', {
      x: plan.dragStart.x + (plan.dragEnd.x - plan.dragStart.x) * ratio,
      y: plan.dragStart.y + (plan.dragEnd.y - plan.dragStart.y) * ratio,
    }, 1);
    await sleep(16);
  }
  await dispatchTextPointer(session, 'pointerup', plan.dragEnd, 0);
  const after = await waitForTextProbeState(
    session,
    (probe) =>
      (probe?.selectionRects.length ?? 0) > 0 &&
      (probe?.selectedText.length ?? 0) > 0 &&
      Math.abs((probe?.selection.focus ?? -1) - plan.endTarget.index) <= 1,
  );

  return {
    after,
    dragToProbeMs: performance.now() - startedDragAt,
  };
};

const openTextContextMenu = async (session, point) => {
  await dispatchTextContextMenu(session, point);
  return waitForTextProbeState(session, (probe) => probe?.menu.open === true);
};

const runTextInteractionCdpSmoke = async (session) => {
  const before = await evaluate(session, textProbeExpression);
  const plan = await evaluate(session, textInteractionPlanExpression);
  if (plan?.error !== undefined) return { before, error: plan.error };

  const startedClickAt = performance.now();
  await dispatchTextPointer(session, 'pointermove', plan.clickPoint, 0);
  await dispatchTextPointer(session, 'pointerdown', plan.clickPoint, 1);
  await sleep(16);
  await dispatchTextPointer(session, 'pointerup', plan.clickPoint, 0);
  const clicked = await waitForTextProbeState(
    session,
    (probe) =>
      probe?.selection.focus === plan.clickTarget.index &&
      probe.selection.focusLine === plan.clickTarget.line,
  );
  const clickToProbeMs = performance.now() - startedClickAt;
  const primarySelectionPlan = {
    ...plan,
    dragEnd: plan?.partialDragEnd ?? plan.dragEnd,
    dragStart: plan?.partialDragStart ?? plan.dragStart,
    endTarget: plan?.partialEndTarget ?? plan.endTarget,
    startTarget: plan?.partialStartTarget ?? plan.startTarget,
  };
  const dragSelection = await dragTextSelection(session, primarySelectionPlan);
  const after = dragSelection.after;
  const dragToProbeMs = dragSelection.dragToProbeMs;
  const keyboardClipboardEventLogSetup = await installTextClipboardEventLog(session);

  const keyboardCopyText = after?.selectedText ?? '';
  await dispatchKeyboardShortcut(session, 'c');
  const afterCopyShortcut = await waitForTextProbeState(
    session,
    (probe) =>
      (probe?.clipboard.counters.keyboardCopy ?? 0) > (after?.clipboard.counters.keyboardCopy ?? 0) &&
      (probe?.clipboard.counters.copy ?? 0) > (after?.clipboard.counters.copy ?? 0) &&
      probe?.clipboard.last.action === 'copy' &&
      probe.clipboard.last.ok === true &&
      probe.clipboard.last.source === 'native' &&
      probe.clipboard.last.textLength === keyboardCopyText.length,
  );
  const afterCopyNativeClipboard = await readNativeTextClipboard(session);

  const keyboardCutText = afterCopyShortcut?.selectedText ?? keyboardCopyText;
  await dispatchKeyboardShortcut(session, 'x');
  const afterCutShortcut = await waitForTextProbeState(
    session,
    (probe) =>
      (probe?.clipboard.counters.keyboardCut ?? 0) > (afterCopyShortcut?.clipboard.counters.keyboardCut ?? 0) &&
      (probe?.clipboard.counters.cut ?? 0) > (afterCopyShortcut?.clipboard.counters.cut ?? 0) &&
      probe?.clipboard.last.action === 'cut' &&
      probe.clipboard.last.ok === true &&
      probe.clipboard.last.source === 'native' &&
      probe.clipboard.last.textLength === keyboardCutText.length &&
      (probe?.textLength ?? Number.POSITIVE_INFINITY) < (afterCopyShortcut?.textLength ?? 0),
  );
  const afterCutNativeClipboard = await readNativeTextClipboard(session);

  const nativeKeyboardPasteText = `Smoke native keyboard paste ${Date.now().toString(36)}`;
  const keyboardPasteSetup = await seedNativeTextClipboard(session, nativeKeyboardPasteText);
  const beforeKeyboardPastePermission = await waitForTextProbeState(
    session,
    (probe) => probe?.clipboardReadPermission === 'granted',
    1200,
  );
  await dispatchKeyboardShortcut(session, 'a');
  const afterKeyboardPasteSelection = await waitForTextProbeState(
    session,
    (probe) => (probe?.selectionRects.length ?? 0) > 0 && (probe?.selectedText.length ?? 0) > 0,
  );
  let afterPasteShortcut = afterKeyboardPasteSelection;
  let keyboardPasteReadTextTrap = { ok: false, reason: 'native clipboard paste setup failed' };
  let afterKeyboardPasteReadTextTrap = { calls: 0, ok: false, reason: 'readText trap was not installed' };
  let keyboardPasteReadTextTrapRestore = { ok: false, reason: 'readText trap was not installed' };
  if (keyboardPasteSetup.ok === true) {
    keyboardPasteReadTextTrap = await installTextClipboardReadTextTrap(session);
  }
  if (keyboardPasteSetup.ok === true && keyboardPasteReadTextTrap.ok === true) {
    await dispatchKeyboardShortcut(session, 'v');
    afterPasteShortcut = await waitForTextProbeState(
      session,
      (probe) =>
        (probe?.clipboard.counters.keyboardPaste ?? 0) >
          (afterKeyboardPasteSelection?.clipboard.counters.keyboardPaste ?? 0) &&
        (probe?.clipboard.counters.paste ?? 0) >
          (afterKeyboardPasteSelection?.clipboard.counters.paste ?? 0) &&
        probe?.clipboard.last.action === 'paste' &&
        probe.clipboard.last.ok === true &&
        probe.clipboard.last.reason === 'success' &&
        probe.clipboard.last.source === 'native' &&
        probe.clipboard.last.textLength === nativeKeyboardPasteText.length &&
        String(probe.text ?? '').includes(nativeKeyboardPasteText),
      1200,
    );
    afterKeyboardPasteReadTextTrap = await readTextClipboardReadTextTrap(session);
    keyboardPasteReadTextTrapRestore = await restoreTextClipboardReadTextTrap(session);
  }
  const keyboardClipboardEvents = await readTextClipboardEventLog(session);
  const afterPasteNativeClipboard = await readNativeTextClipboard(session);

  const menuPlan = await evaluate(session, textInteractionPlanExpression);
  const menuSelectionPlan = {
    ...menuPlan,
    dragEnd: menuPlan?.partialDragEnd ?? menuPlan?.dragEnd,
    dragStart: menuPlan?.partialDragStart ?? menuPlan?.dragStart,
    endTarget: menuPlan?.partialEndTarget ?? menuPlan?.endTarget,
    startTarget: menuPlan?.partialStartTarget ?? menuPlan?.startTarget,
  };
  const menuSelection = menuPlan?.error === undefined
    ? await dragTextSelection(session, menuSelectionPlan)
    : { after: afterCutShortcut, dragToProbeMs: 0 };
  const afterMenuSelection = menuSelection.after;
  const menuPoint = menuPlan?.clickPoint ?? plan.clickPoint;
  const menuOpenedForCopy = await openTextContextMenu(session, menuPoint);
  const menuDomAfterOpenForCopy = await readTextMenuDomState(session);
  const menuCopyClick = await clickTextContextMenuAction(session, 'copy');
  const afterMenuCopy = await waitForTextProbeState(
    session,
    (probe) =>
      (probe?.clipboard.counters.menuCopy ?? 0) > (menuOpenedForCopy?.clipboard.counters.menuCopy ?? 0),
  );
  const menuOpenedForCut = await openTextContextMenu(session, menuPoint);
  const menuDomAfterOpenForCut = await readTextMenuDomState(session);
  const menuCutClick = await clickTextContextMenuAction(session, 'cut');
  const afterMenuCut = await waitForTextProbeState(
    session,
    (probe) =>
      (probe?.clipboard.counters.menuCut ?? 0) > (menuOpenedForCut?.clipboard.counters.menuCut ?? 0) &&
      (probe?.textLength ?? Number.POSITIVE_INFINITY) < (afterMenuCopy?.textLength ?? 0),
  );
  await dispatchKeyboardShortcut(session, 'a');
  const afterMenuPasteSelection = await waitForTextProbeState(
    session,
    (probe) => (probe?.selectionRects.length ?? 0) > 0 && (probe?.selectedText.length ?? 0) > 0,
  );
  const nativeMenuPasteText = `Smoke native menu paste ${Date.now().toString(36)}`;
  const menuPasteSetup = await seedNativeTextClipboard(session, nativeMenuPasteText);
  const menuOpenedForPaste = await openTextContextMenu(session, menuPoint);
  const menuDomAfterOpenForPaste = await readTextMenuDomState(session);
  const menuPasteClick = await clickTextContextMenuAction(session, 'paste');
  const afterMenuPaste = menuPasteSetup.ok === true && menuPasteClick.ok === true
    ? await waitForTextProbeState(
      session,
      (probe) =>
        (probe?.clipboard.counters.menuPaste ?? 0) > (menuOpenedForPaste?.clipboard.counters.menuPaste ?? 0) &&
        probe?.clipboard.last.action === 'paste' &&
        probe.clipboard.last.ok === true &&
        probe.clipboard.last.source === 'menu' &&
        String(probe.text ?? '').includes(nativeMenuPasteText),
      1200,
    )
    : await evaluate(session, textProbeExpression);
  const selectionLatencySamples = [
    { durationMs: clickToProbeMs, phase: 'click' },
    { durationMs: dragToProbeMs, phase: 'drag-select' },
  ];

  return {
    after,
    before,
    clickHit: plan.clickHit,
    clickPoint: plan.clickPoint,
    clickTarget: plan.clickTarget,
    clickToProbeMs,
    clicked,
    contextMenu: {
      afterMenuCopy,
      afterMenuCut,
      afterMenuPaste,
      afterMenuPasteSelection,
      afterMenuSelection,
      menuDomAfterOpenForCopy,
      menuDomAfterOpenForCut,
      menuDomAfterOpenForPaste,
      menuCopyClick,
      menuCutClick,
      menuOpenedForCopy,
      menuOpenedForCut,
      menuOpenedForPaste,
      menuPasteClick,
    },
    dragToProbeMs,
    endTarget: primarySelectionPlan.endTarget,
    keyboard: {
      afterCopyNativeClipboard,
      afterCopyShortcut,
      afterCutNativeClipboard,
      afterCutShortcut,
      afterKeyboardPasteSelection,
      afterKeyboardPasteReadTextTrap,
      afterPasteNativeClipboard,
      afterPasteShortcut,
      beforeKeyboardPastePermission,
      keyboardClipboardEventLogSetup,
      keyboardClipboardEvents,
      keyboardCopyText,
      keyboardCutText,
      keyboardPasteReadTextTrap,
      keyboardPasteReadTextTrapRestore,
      keyboardPasteSetup,
      nativeKeyboardPasteText,
    },
    nativeMenuPasteText,
    menuPasteSetup,
    selectionLatency: {
      maxToProbeMs: Math.max(...selectionLatencySamples.map((sample) => sample.durationMs)),
      samples: selectionLatencySamples,
    },
    startTarget: primarySelectionPlan.startTarget,
  };
};

const grantNativeClipboardPermissions = async (session) => {
  try {
    await session.call('Browser.grantPermissions', {
      origin: baseUrl,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    return { ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    };
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
    await grantNativeClipboardPermissions(session);

    const loaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: baseUrl });
    await loaded;
    const routes = await evaluate(session, routeListExpression);
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new Error('Examples smoke could not discover routes');
    }
    const selectedRoutes = routeFilter === ''
      ? routes
      : routes.filter((route) =>
        route.id === routeFilter ||
        route.path === routeFilter ||
        route.path === `/${routeFilter}`
      );
    if (selectedRoutes.length === 0) {
      throw new Error(`Examples smoke route filter did not match a route: ${routeFilter}`);
    }

    for (const route of selectedRoutes) {
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

    if (routeFilter === '') {
      const artifactsLoaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: baseUrl + '/artifacts' });
      await artifactsLoaded;
      const artifactsState = await evaluate(session, artifactsExpression);
      assertArtifactsPage(artifactsState);
      console.log('ok Research Artifacts');
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
