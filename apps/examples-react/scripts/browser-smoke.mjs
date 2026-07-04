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
const routeReadyTimeoutMs = envNumber('EXAMPLES_ROUTE_READY_TIMEOUT_MS', 20_000);

const khronosKitchenSinkAssetNames = [
  'AlphaBlendModeTest',
  'AnimatedMorphCube',
  'AttenuationTest',
  'Box',
  'BoxAnimated',
  'BoxInterleaved',
  'BoxTextured',
  'BoxTexturedNonPowerOfTwo',
  'BoxVertexColors',
  'CesiumMan',
  'CesiumMilkTruck',
  'ClearCoatCarPaint',
  'ClearCoatTest',
  'ClearcoatWicker',
  'CompareBaseColor',
  'CompareClearcoat',
  'CompareDispersion',
  'CompareEmissiveStrength',
  'CompareIor',
  'CompareIridescence',
  'CompareMetallic',
  'CompareNormal',
  'CompareRoughness',
  'CompareSheen',
  'CompareSpecular',
  'CompareTransmission',
  'CompareVolume',
  'CubeVisibility',
  'DirectionalLight',
  'Duck',
  'EmissiveStrengthTest',
  'Fox',
  'GlassBrokenWindow',
  'InterpolationTest',
  'IridescenceSuzanne',
  'LightVisibility',
  'MetalRoughSpheresNoTextures',
  'MorphPrimitivesTest',
  'MorphStressTest',
  'MultiUVTest',
  'NegativeScaleTest',
  'NormalTangentTest',
  'OrientationTest',
  'PointLightIntensityTest',
  'RecursiveSkeletons',
  'RiggedFigure',
  'RiggedSimple',
  'SimpleInstancing',
  'SpecularTest',
  'SunglassesKhronos',
  'TextureCoordinateTest',
  'TextureEncodingTest',
  'TextureLinearInterpolationTest',
  'TextureSettingsTest',
  'TextureTransformMultiTest',
  'TransmissionRoughnessTest',
  'TransmissionTest',
  'TransmissionThinwallTestGrid',
  'Unicode❤♻Test',
  'UnlitTest',
  'USDShaderBallForGltf',
  'VertexColorTest',
];
// Classifier result for iPad A10+/Safari 17+ and Quest 2 targets.
const inherentlySlowKitchenSinkAssetNames = [
  'AlphaBlendModeTest',
  'ClearcoatWicker',
  'CompareBaseColor',
  'CompareSpecular',
  'GlassBrokenWindow',
  'MetalRoughSpheresNoTextures',
  'MorphStressTest',
  'NormalTangentTest',
  'RecursiveSkeletons',
  'TransmissionTest',
  'TransmissionThinwallTestGrid',
  'USDShaderBallForGltf',
];
const okKitchenSinkAssetNames = khronosKitchenSinkAssetNames
  .filter((name) => !inherentlySlowKitchenSinkAssetNames.includes(name));
const khronosGlbResourceSubstring = (name) => {
  const encodedName = encodeURIComponent(name);
  return `/fixtures/khronos/${encodedName}/glTF-Binary/${encodedName}.glb`;
};
const okKitchenSinkResourceSubstrings = okKitchenSinkAssetNames.map(khronosGlbResourceSubstring);
const slowKitchenSinkResourceSubstrings = inherentlySlowKitchenSinkAssetNames.map(khronosGlbResourceSubstring);

const smokeExpectations = {
  cube: {
    path: '/cube',
    minPaintedRatio: 0.01,
  },
  wireframe: {
    path: '/wireframe',
    minPaintedRatio: 0.003,
  },
  'form-controls': {
    path: '/form-controls',
    minPaintedRatio: 0.01,
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
  'standard-lighting': {
    path: '/standard-lighting',
    minColorBuckets: 12,
    minPaintedRatio: 0.01,
  },
  'hud-overlay': {
    path: '/hud-overlay',
    minColorBuckets: 14,
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
  'gltf-kitchen-sink': {
    path: '/gltf-kitchen-sink',
    absentResourceSubstrings: slowKitchenSinkResourceSubstrings,
    resourceSubstrings: okKitchenSinkResourceSubstrings,
    minColorBuckets: 24,
    minPaintedRatio: 0.004,
  },
  'gltf-kitchen-sink-slow': {
    path: '/gltf-kitchen-sink-slow',
    absentResourceSubstrings: okKitchenSinkResourceSubstrings,
    resourceSubstrings: slowKitchenSinkResourceSubstrings,
    minColorBuckets: 20,
    minPaintedRatio: 0.004,
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
      paintedPixels += 1;
      buckets.add(\`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`);
    }

    return {
      colorBuckets: buckets.size,
      paintedPixels,
      paintedRatio: paintedPixels / (width * height),
    };
  };
  const describeDomElement = (element) => {
    if (!(element instanceof Element)) return undefined;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const name = element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLFieldSetElement ||
      element instanceof HTMLFormElement ||
      element instanceof HTMLOutputElement
      ? element.name
      : element.getAttribute('name') ?? '';
    const type = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element.type
      : element.getAttribute('type') ?? '';

    return {
      ariaHidden: element.getAttribute('aria-hidden') ?? '',
      ariaBusy: element.getAttribute('aria-busy') ?? '',
      ariaLabel: element.getAttribute('aria-label') ?? '',
      className: String(element.getAttribute('class') ?? ''),
      contentEditable: element.getAttribute('contenteditable') ?? '',
      disabled: element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLButtonElement ||
        element instanceof HTMLFieldSetElement
        ? element.disabled
        : false,
      display: style.display,
      height: Number(rect.height.toFixed(2)),
      hidden: element instanceof HTMLElement ? element.hidden : false,
      id: element.id,
      name,
      role: element.getAttribute('role') ?? '',
      tabIndex: element instanceof HTMLElement ? element.tabIndex : null,
      tag: element.tagName.toLowerCase(),
      type,
      visibility: style.visibility,
      width: Number(rect.width.toFixed(2)),
    };
  };
  const describeActiveElement = () => describeDomElement(document.activeElement);
  const probeCanvasFocus = (canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        currentFocus: { ok: false, reason: 'missing canvas' },
        focusableNow: false,
        focusableWithTemporaryTabIndex: false,
        hasCanvas: false,
        temporaryFocus: undefined,
      };
    }

    const currentAttributeTabIndex = canvas.getAttribute('tabindex');
    const currentTabIndex = canvas.tabIndex;
    const tryFocus = () => {
      try {
        canvas.focus({ preventScroll: true });
      } catch (error) {
        return {
          activeElement: describeActiveElement(),
          message: error instanceof Error ? error.message : String(error),
          ok: false,
          reason: 'focus threw',
        };
      }

      return {
        activeElement: describeActiveElement(),
        ok: document.activeElement === canvas,
        reason: document.activeElement === canvas ? 'focused' : 'active element did not change to canvas',
      };
    };

    if (document.activeElement === canvas) {
      canvas.blur();
    }

    const currentFocus = tryFocus();
    let temporaryFocus;

    if (currentFocus.ok !== true) {
      canvas.setAttribute('tabindex', '0');
      temporaryFocus = tryFocus();
      if (currentAttributeTabIndex === null) {
        canvas.removeAttribute('tabindex');
      } else {
        canvas.setAttribute('tabindex', currentAttributeTabIndex);
      }
    }

    return {
      attributeTabIndex: currentAttributeTabIndex,
      currentFocus,
      currentTabIndex,
      focusableNow: currentFocus.ok === true,
      focusableWithTemporaryTabIndex: temporaryFocus?.ok === true || currentFocus.ok === true,
      hasCanvas: true,
      restoredAttributeTabIndex: canvas.getAttribute('tabindex'),
      sequentiallyFocusable: currentTabIndex >= 0,
      temporaryFocus,
    };
  };
  const readFormControlsRuntime = (canvas) => {
    const allElements = Array.from(document.querySelectorAll('*'));
    const domControls = Array.from(
      document.querySelectorAll('button, fieldset, form, input, output, select, textarea'),
    ).map(describeDomElement);
    const contentEditableControls = allElements
      .filter((element) =>
        element instanceof HTMLElement &&
        (element.getAttribute('contenteditable') !== null || element.isContentEditable)
      )
      .map(describeDomElement);
    const knownHiddenBridgeSelectors = [
      '[data-royal-text-clipboard-bridge]',
      '.renderer-text-clipboard-bridge',
      '[data-royal-text-context-menu]',
      '.renderer-text-context-menu',
      '[data-royal-text-menu-action]',
      '[data-royal-form-bridge]',
      '[data-royal-form-control-bridge]',
      '[data-royal-file-input-bridge]',
      '[data-royal-file-picker-bridge]',
      '[data-royal-clipboard-bridge]',
      '[data-input-file-bridge]',
      '[data-file-input-bridge]',
      '[data-hidden-file-input]',
      '[data-hidden-file-picker]',
      '[data-clipboard-bridge]',
      '.royal-form-bridge',
      '.royal-file-input-bridge',
      '.royal-file-picker-bridge',
      '.royal-clipboard-bridge',
      '.file-input-bridge',
      '.input-file-bridge',
      '.hidden-file-input',
      '.hidden-file-picker',
      '.hidden-clipboard-textarea',
      '.clipboard-bridge',
    ];
    const bridgeAttributePattern =
      /(?:ClipboardFallback|clipboard-bridge|clipboardBridge|clipboardTextarea|hiddenClipboard|hiddenFile|hidden-file|fileInput|file-input|filePicker|file-picker|inputFileBridge|input-file-bridge|renderer-text-clipboard-bridge|renderer-text-context-menu|royal-form-bridge|royal-file-input-bridge|royal-file-picker-bridge|royal-clipboard-bridge)/i;
    const bridgeNodes = new Map();
    const addBridgeNode = (element, match) => {
      const key = element;
      const current = bridgeNodes.get(key) ?? { ...describeDomElement(element), matches: [] };
      current.matches.push(match);
      bridgeNodes.set(key, current);
    };

    for (const selector of knownHiddenBridgeSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        addBridgeNode(element, selector);
      }
    }

    for (const element of allElements) {
      const matchedAttributes = Array.from(element.attributes)
        .filter((attribute) => bridgeAttributePattern.test(attribute.name) ||
          bridgeAttributePattern.test(attribute.value))
        .map((attribute) => \`\${attribute.name}=\${attribute.value}\`);
      if (matchedAttributes.length > 0) {
        addBridgeNode(element, matchedAttributes.join(', '));
      }
    }

    const canvasFocus = probeCanvasFocus(canvas);
    const focusMode = canvasFocus.focusableNow
      ? 'current'
      : canvasFocus.focusableWithTemporaryTabIndex
        ? 'temporary-tabindex'
        : 'none';
    const knownHiddenBridgeNodes = Array.from(bridgeNodes.values());

    return {
      canvas: canvas === undefined ? undefined : describeDomElement(canvas),
      canvasFocus,
      contentEditableControls,
      domControls,
      knownHiddenBridgeNodes,
      summary: {
        contentEditableCount: contentEditableControls.length,
        domControlCount: domControls.length,
        focusMode,
        knownHiddenBridgeCount: knownHiddenBridgeNodes.length,
      },
    };
  };
  const read = async () => {
    const routePathname = window.location.pathname.replace(/\\/$/, '') || '/';
    const routePath = routePathname + window.location.search;
    const routeEntry = Object.entries(smokeExpectations).find(([, expectation]) =>
      expectation.path === routePath
    ) ?? Object.entries(smokeExpectations).find(([, expectation]) =>
      expectation.path === routePathname
    );
    const routeId = routeEntry?.[0] ?? '';
    const smoke = routeEntry?.[1];
    const canvas = document.querySelector('canvas');
    return {
      route: {
        absentResourceSubstrings: smoke?.absentResourceSubstrings ?? [],
        id: routeId,
        path: routePath,
        resourceSubstrings: smoke?.resourceSubstrings ?? [],
      },
      canvas: canvas === null ? undefined : {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        minColorBuckets: smoke?.minColorBuckets,
        minPaintedRatio: smoke?.minPaintedRatio ?? 0,
        sample: sampleCanvas(canvas),
      },
      picking: routeId === 'picking' ? {
        hoveredId: canvas?.dataset.royalPickingHoveredId ?? '',
        text: canvas?.dataset.royalPickingReadout ?? '',
      } : undefined,
      formControls: routeId === 'form-controls' ? readFormControlsRuntime(canvas ?? undefined) : undefined,
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
    if (state.route.id === 'form-controls') {
      return state.formControls !== undefined &&
        state.formControls?.canvas?.ariaBusy !== 'true' &&
        (
          canvasReady ||
          (
            state.formControls.summary.domControlCount > 0 &&
            state.formControls.summary.contentEditableCount === 0 &&
            state.formControls.summary.knownHiddenBridgeCount === 0
          )
        );
    }
    return canvasReady && resourceReady;
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

  if (expected.id === 'form-controls') {
    const form = state.formControls;
    const summarizeNode = (node) => {
      if (node === undefined || node === null) return 'unknown node';
      const id = node.id === '' ? '' : `#${node.id}`;
      const name = node.name === '' ? '' : `[name="${node.name}"]`;
      const type = node.type === '' ? '' : `[type="${node.type}"]`;
      const matches = Array.isArray(node.matches) && node.matches.length > 0
        ? ` (${node.matches.join(', ')})`
        : '';
      return `${node.tag}${id}${type}${name}${matches}`;
    };
    const summarizeNodes = (nodes) => nodes.slice(0, 5).map(summarizeNode).join(', ');

    if (form === undefined) {
      failures.push('form controls route missed runtime DOM inspection');
    } else {
      const domControlCount = form.summary?.domControlCount ?? form.domControls?.length ?? 0;
      if ((form.summary?.contentEditableCount ?? form.contentEditableControls?.length ?? 0) !== 0) {
        failures.push(
          `form controls route rendered contenteditable control(s): ${
            summarizeNodes(form.contentEditableControls ?? [])
          }`,
        );
      }
      if ((form.summary?.knownHiddenBridgeCount ?? form.knownHiddenBridgeNodes?.length ?? 0) !== 0) {
        failures.push(
          `form controls route rendered hidden bridge node(s): ${
            summarizeNodes(form.knownHiddenBridgeNodes ?? [])
          }`,
        );
      }
      if (form.canvas?.ariaBusy === 'true') {
        failures.push('form controls font-backed canvas scene stayed busy');
      }
      const focus = form.canvasFocus;
      if (focus?.hasCanvas !== true) {
        if (domControlCount <= 0) {
          failures.push('form controls route rendered neither canvas nor DOM controls');
        }
      } else {
        if ((focus.currentTabIndex ?? -1) >= 0 && focus.currentFocus?.ok !== true) {
          failures.push(`form controls canvas tabIndex=${focus.currentTabIndex} did not receive focus`);
        }
        if (focus.focusableNow !== true && focus.focusableWithTemporaryTabIndex !== true) {
          failures.push(
            `form controls canvas could not receive focus for future form host work: ${
              focus.temporaryFocus?.reason ?? focus.currentFocus?.reason ?? 'unknown'
            }`,
          );
        }
      }
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
  await animationFrame();
  const clearedId = readHoveredId();
  if (hoveredPoint !== null) {
    dispatch('pointermove', hoveredPoint);
    await animationFrame();
  }
  dispatch('pointerleave', hoveredPoint ?? hoverPoints[0]);
  await animationFrame();

  return { before, clearedId, hoveredId, hoveredPoint, leaveClearedId: readHoveredId() };
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
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
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

    for (const route of selectedRoutes) {
      const routeLoaded = session.once('Page.loadEventFired');
      await session.call('Page.navigate', { url: baseUrl + route.path });
      await Promise.race([routeLoaded, sleep(5_000)]);
      let state = await waitForRouteState(session, route);
      if (route.id === 'picking') {
        state = {
          ...state,
          pickingInteraction: await runPickingInteractionSmoke(session),
        };
      }
      try {
        assertRoute(route, state);
      } catch (error) {
        const recentConsole = consoleMessages.slice(-8).join('; ');
        const recentResources = (state.resources ?? [])
          .map((resource) => `${resource.name} duration=${resource.duration}ms size=${resource.size}`)
          .join('; ');
        throw new Error(`${error instanceof Error ? error.message : String(error)}${
          recentConsole === '' ? '' : `; console: ${recentConsole}`
        }${
          recentResources === '' ? '' : `; resources: ${recentResources}`
        }`);
      }
      const canvasSummary = state.canvas?.sample === undefined
        ? ''
        : ` buckets=${state.canvas.sample.colorBuckets} painted=${state.canvas.sample.paintedRatio.toFixed(3)}`;
      const formSummary = route.id === 'form-controls' && state.formControls !== undefined
        ? ` domControls=${state.formControls.summary.domControlCount}` +
          ` contenteditable=${state.formControls.summary.contentEditableCount}` +
          ` bridges=${state.formControls.summary.knownHiddenBridgeCount}` +
          ` focus=${state.formControls.summary.focusMode}`
        : '';
      console.log(`ok ${route.id}${canvasSummary}${formSummary}`);
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
