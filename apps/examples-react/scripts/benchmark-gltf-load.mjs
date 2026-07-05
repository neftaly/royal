import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_GLTF_LOAD_PORT ?? 4773);
const debugPort = Number(process.env.EXAMPLES_GLTF_LOAD_DEBUG_PORT ?? 4774);
const baseUrl = process.env.EXAMPLES_GLTF_LOAD_BASE_URL?.trim() || `http://${host}:${previewPort}`;
const routePathInput = process.env.EXAMPLES_GLTF_LOAD_ROUTE?.trim() || '/gltf-helmet';
const routePath = routePathInput.startsWith('/') ? routePathInput : `/${routePathInput}`;
const outputPath = process.env.EXAMPLES_GLTF_LOAD_OUTPUT?.trim() ?? '';
const managePreview = process.env.EXAMPLES_GLTF_LOAD_PREVIEW !== '0';

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  throw new Error(`${name} must be a positive finite number, received ${JSON.stringify(raw)}`);
};

const readyTimeoutMs = envNumber('EXAMPLES_GLTF_LOAD_READY_TIMEOUT_MS', 20_000);
const fullyLoadedStableMs = envNumber('EXAMPLES_GLTF_LOAD_STABLE_MS', 500);
const vtFrameSampleEnabled = process.env.EXAMPLES_GLTF_LOAD_VT_FRAME_SAMPLE === '1';
const vtFrameSampleCount = envNumber('EXAMPLES_GLTF_LOAD_VT_FRAMES', 60);
const vtFrameSampleTimeoutMs = envNumber('EXAMPLES_GLTF_LOAD_VT_FRAME_TIMEOUT_MS', 10_000);
const vtCameraDragEnabled = process.env.EXAMPLES_GLTF_LOAD_VT_CAMERA_DRAG === '1';
const vtCameraDragStepPixels = envNumber('EXAMPLES_GLTF_LOAD_VT_CAMERA_DRAG_STEP_PX', 7);
const forceGeneratedVirtualTexturing = process.env.EXAMPLES_GLTF_LOAD_FORCE_GENERATED_VT === '1';

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
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
};

const spawnLogged = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
};

const stop = async (child) => {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};

const installBenchmarkHooks = async (session) => {
  const hookConfig = JSON.stringify({
    firstUsableMinColorBuckets: 16,
    firstUsableMinPaintedRatio: 0.01,
    firstUsableSampleSize: 96,
    readyTimeoutMs,
    vtCameraDragStepPixels,
  });
  await session.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
(() => {
  if (globalThis.__royalGltfLoadBenchInstalled === true) return;
  Object.defineProperty(globalThis, '__royalGltfLoadBenchInstalled', { value: true });
  const config = ${hookConfig};
  const counters = {
    bindTexture: 0,
    compressedTexImage2D: 0,
    compressedTexSubImage2D: 0,
    copyTexImage2D: 0,
    copyTexSubImage2D: 0,
    createTexture: 0,
    deleteTexture: 0,
    drawArrays: 0,
    drawArraysInstanced: 0,
    drawElements: 0,
    drawElementsInstanced: 0,
    generateMipmap: 0,
    texImage2D: 0,
    texStorage2D: 0,
    texSubImage2D: 0,
    textureAllocationCalls: 0,
    textureUploadBytesRough: 0,
    textureUploadCalls: 0,
  };
  let firstDrawAt = null;
  let firstTextureUploadAt = null;
  let firstTexturedFrameAt = null;
  let firstTexturedFrameSample = null;
  let firstUsableAt = null;
  let firstUsableSample = null;
  let fullyLoadedAt = null;
  let fullyLoadedState = null;

  const raf = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const rafBeforeDeadline = (deadline) => new Promise((resolve) => {
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
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const finiteDimension = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const sourceSize = (source) => {
    const width = source?.width ?? source?.videoWidth ?? source?.naturalWidth ?? source?.displayWidth;
    const height = source?.height ?? source?.videoHeight ?? source?.naturalHeight ?? source?.displayHeight;
    return finiteDimension(width) && finiteDimension(height) ? { width, height } : null;
  };
  const bytesPerPixel = (format, type) => {
    const gl = globalThis.WebGL2RenderingContext?.prototype;
    const rgba = gl?.RGBA ?? 0x1908;
    const rgb = gl?.RGB ?? 0x1907;
    const luminanceAlpha = gl?.LUMINANCE_ALPHA ?? 0x190A;
    const alpha = gl?.ALPHA ?? 0x1906;
    const luminance = gl?.LUMINANCE ?? 0x1909;
    const unsignedShort565 = gl?.UNSIGNED_SHORT_5_6_5 ?? 0x8363;
    const unsignedShort4444 = gl?.UNSIGNED_SHORT_4_4_4_4 ?? 0x8033;
    const unsignedShort5551 = gl?.UNSIGNED_SHORT_5_5_5_1 ?? 0x8034;
    if (type === unsignedShort565 || type === unsignedShort4444 || type === unsignedShort5551) return 2;
    if (format === rgb) return 3;
    if (format === luminanceAlpha) return 2;
    if (format === alpha || format === luminance) return 1;
    if (format === rgba) return 4;
    return 4;
  };
  const roughBytes = (width, height, format, type) =>
    finiteDimension(width) && finiteDimension(height)
      ? Math.max(0, Math.round(width * height * bytesPerPixel(format, type)))
      : 0;
  const texImageBytes = (args) => {
    if (typeof args[3] === 'number' && typeof args[4] === 'number') {
      return roughBytes(args[3], args[4], args[6], args[7]);
    }
    const size = sourceSize(args[5]);
    return size === null ? 0 : roughBytes(size.width, size.height, args[3], args[4]);
  };
  const texSubImageBytes = (args) => {
    if (typeof args[4] === 'number' && typeof args[5] === 'number') {
      return roughBytes(args[4], args[5], args[6], args[7]);
    }
    const size = sourceSize(args[6]);
    return size === null ? 0 : roughBytes(size.width, size.height, args[4], args[5]);
  };
  const compressedBytes = (args) => {
    const payload = args.find((value) => value?.byteLength !== undefined);
    return typeof payload?.byteLength === 'number' ? payload.byteLength : 0;
  };
  const recordDraw = () => {
    if (firstDrawAt === null) firstDrawAt = performance.now();
  };
  const recordTextureUpload = () => {
    if (firstTextureUploadAt === null) firstTextureUploadAt = performance.now();
  };
  const patch = (prototype, name, handler) => {
    const original = prototype?.[name];
    if (typeof original !== 'function' || original.__royalGltfLoadBenchPatched === true) return;
    const wrapped = function (...args) {
      handler(args);
      return original.apply(this, args);
    };
    Object.defineProperty(wrapped, '__royalGltfLoadBenchPatched', { value: true });
    prototype[name] = wrapped;
  };
  const patchPrototype = (prototype) => {
    patch(prototype, 'bindTexture', () => { counters.bindTexture += 1; });
    patch(prototype, 'createTexture', () => { counters.createTexture += 1; });
    patch(prototype, 'deleteTexture', () => { counters.deleteTexture += 1; });
    patch(prototype, 'drawArrays', () => { counters.drawArrays += 1; recordDraw(); });
    patch(prototype, 'drawElements', () => { counters.drawElements += 1; recordDraw(); });
    patch(prototype, 'drawArraysInstanced', () => { counters.drawArraysInstanced += 1; recordDraw(); });
    patch(prototype, 'drawElementsInstanced', () => { counters.drawElementsInstanced += 1; recordDraw(); });
    patch(prototype, 'texImage2D', (args) => {
      counters.texImage2D += 1;
      counters.textureAllocationCalls += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += texImageBytes(args);
      recordTextureUpload();
    });
    patch(prototype, 'texSubImage2D', (args) => {
      counters.texSubImage2D += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += texSubImageBytes(args);
      recordTextureUpload();
    });
    patch(prototype, 'texStorage2D', () => {
      counters.texStorage2D += 1;
      counters.textureAllocationCalls += 1;
    });
    patch(prototype, 'compressedTexImage2D', (args) => {
      counters.compressedTexImage2D += 1;
      counters.textureAllocationCalls += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += compressedBytes(args);
      recordTextureUpload();
    });
    patch(prototype, 'compressedTexSubImage2D', (args) => {
      counters.compressedTexSubImage2D += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += compressedBytes(args);
      recordTextureUpload();
    });
    patch(prototype, 'copyTexImage2D', () => {
      counters.copyTexImage2D += 1;
      counters.textureAllocationCalls += 1;
    });
    patch(prototype, 'copyTexSubImage2D', () => {
      counters.copyTexSubImage2D += 1;
      counters.textureUploadCalls += 1;
      recordTextureUpload();
    });
    patch(prototype, 'generateMipmap', () => { counters.generateMipmap += 1; });
  };
  patchPrototype(globalThis.WebGLRenderingContext?.prototype);
  patchPrototype(globalThis.WebGL2RenderingContext?.prototype);

  const sampleCanvas = () => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return null;
    const width = Math.max(1, Math.min(config.firstUsableSampleSize, canvas.width));
    const height = Math.max(1, Math.min(config.firstUsableSampleSize, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;
    try {
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
        height,
        paintedPixels,
        paintedRatio: paintedPixels / (width * height),
        width,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        height,
        width,
      };
    }
  };
  const isUsableSample = (sample) =>
    sample !== null &&
    typeof sample.paintedRatio === 'number' &&
    sample.paintedRatio >= config.firstUsableMinPaintedRatio &&
    sample.colorBuckets >= config.firstUsableMinColorBuckets;
  const updateFirstUsable = () => {
    const sample = sampleCanvas();
    if (firstTexturedFrameAt === null && firstTextureUploadAt !== null && isUsableSample(sample)) {
      firstTexturedFrameAt = performance.now();
      firstTexturedFrameSample = sample;
    }
    if (firstUsableAt !== null) return true;
    if (!isUsableSample(sample)) return false;
    firstUsableAt = performance.now();
    firstUsableSample = sample;
    return true;
  };
  const waitForFirstUsable = async (timeoutMs = config.readyTimeoutMs) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (updateFirstUsable()) {
        return {
          firstDrawAt,
          firstUsableAt,
          firstUsableSample,
          timedOut: false,
        };
      }
      await raf();
    }
    return {
      firstDrawAt,
      firstUsableAt,
      firstUsableSample,
      timedOut: true,
      lastSample: sampleCanvas(),
    };
  };
  const readRendererSnapshot = () =>
    globalThis.__royalExamplesRendererBenchmarkSnapshot?.()
      ?? globalThis.__royalExamplesGltfInstancingSnapshot?.()
      ?? null;
  const rendererVirtualTexturingDone = () => {
    const virtualTexturing = readRendererSnapshot()?.virtualTexturing;
    if (virtualTexturing === undefined || virtualTexturing === null) return true;
    const manifestRequests = virtualTexturing.manifestRequests ?? 0;
    const settledManifests = (virtualTexturing.manifestsReady ?? 0) + (virtualTexturing.manifestFailures ?? 0);
    return (virtualTexturing.pendingPages ?? 0) === 0 && settledManifests >= manifestRequests;
  };
  const resourceVirtualTexturingDone = (resources) => {
    const manifestCount = resources.byKind.vtManifest?.count ?? 0;
    if (manifestCount === 0) return true;
    const virtualTexturing = readRendererSnapshot()?.virtualTexturing;
    if (
      (virtualTexturing?.generatedManifestUses ?? 0) > 0 &&
      (virtualTexturing?.pendingPages ?? 0) === 0 &&
      (virtualTexturing?.uploadedPages ?? 0) > 0
    ) {
      return true;
    }
    return (resources.byKind.vtPage?.count ?? 0) > 0;
  };
  const resourceRows = () => performance.getEntriesByType('resource').map((entry) => ({
    decodedBodySize: entry.decodedBodySize ?? 0,
    duration: entry.duration,
    encodedBodySize: entry.encodedBodySize ?? 0,
    initiatorType: entry.initiatorType,
    name: entry.name,
    responseEnd: entry.responseEnd,
    startTime: entry.startTime,
    transferSize: entry.transferSize ?? 0,
  }));
  const classifyResource = (name) => {
    let url;
    try {
      url = new URL(name, location.href);
    } catch {
      url = { pathname: name, search: '' };
    }
    const pathname = url.pathname.toLowerCase();
    if (pathname.endsWith('.vt.json')) return 'vtManifest';
    if (url.search.includes('vt-page=') || /\\/pages\\/mip-/u.test(pathname)) return 'vtPage';
    if (pathname.endsWith('.gltf') || pathname.endsWith('.glb')) return 'gltf';
    if (pathname.endsWith('.bin')) return 'gltfBuffer';
    if (/\\.(?:avif|gif|jpe?g|ktx2|png|webp)$/u.test(pathname)) return 'image';
    if (pathname.endsWith('.wasm')) return 'wasm';
    if (/\\.(?:css|js|mjs)$/u.test(pathname)) return 'app';
    return 'other';
  };
  const resourceSummary = () => {
    const rows = resourceRows();
    const byKind = {};
    for (const row of rows) {
      const kind = classifyResource(row.name);
      const current = byKind[kind] ?? {
        count: 0,
        decodedBodySize: 0,
        duration: 0,
        encodedBodySize: 0,
        transferSize: 0,
      };
      byKind[kind] = {
        count: current.count + 1,
        decodedBodySize: current.decodedBodySize + row.decodedBodySize,
        duration: current.duration + row.duration,
        encodedBodySize: current.encodedBodySize + row.encodedBodySize,
        transferSize: current.transferSize + row.transferSize,
      };
    }
    return {
      byKind,
      count: rows.length,
      slowest: [...rows].sort((left, right) => right.duration - left.duration).slice(0, 8),
      totalDecodedBodySize: rows.reduce((sum, row) => sum + row.decodedBodySize, 0),
      totalDuration: rows.reduce((sum, row) => sum + row.duration, 0),
      totalEncodedBodySize: rows.reduce((sum, row) => sum + row.encodedBodySize, 0),
      totalTransferSize: rows.reduce((sum, row) => sum + row.transferSize, 0),
    };
  };
  const waitForFullyLoaded = async (timeoutMs = config.readyTimeoutMs, stableMs = 500) => {
    const deadline = performance.now() + timeoutMs;
    let stableResourceCount = -1;
    let stableSince = performance.now();
    let lastState = null;
    await waitForFirstUsable(timeoutMs);
    while (performance.now() < deadline) {
      const resourceCount = performance.getEntriesByType('resource').length;
      if (resourceCount !== stableResourceCount) {
        stableResourceCount = resourceCount;
        stableSince = performance.now();
      }
      const sample = sampleCanvas();
      const resources = resourceSummary();
      lastState = {
        documentReadyState: document.readyState,
        renderer: readRendererSnapshot(),
        resourceCount,
        resources,
        resourceStableForMs: performance.now() - stableSince,
        sample,
      };
      if (
        document.readyState === 'complete' &&
        (firstUsableAt !== null || isUsableSample(sample)) &&
        performance.now() - stableSince >= stableMs &&
        rendererVirtualTexturingDone() &&
        resourceVirtualTexturingDone(resources)
      ) {
        await raf();
        await raf();
        updateFirstUsable();
        fullyLoadedAt = performance.now();
        fullyLoadedState = {
          ...lastState,
          renderer: readRendererSnapshot(),
          resources: resourceSummary(),
        };
        return {
          fullyLoadedAt,
          firstDrawAt,
          firstUsableAt,
          firstUsableSample,
          state: fullyLoadedState,
          timedOut: false,
        };
      }
      await delay(50);
    }
    return {
      firstDrawAt,
      firstUsableAt,
      firstUsableSample,
      state: lastState,
      timedOut: true,
    };
  };
  const drawCalls = () =>
    counters.drawArrays + counters.drawElements + counters.drawArraysInstanced + counters.drawElementsInstanced;
  const statsFromDeltas = (deltas) => {
    const sorted = [...deltas].sort((left, right) => left - right);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
    return {
      averageMs: sorted.length === 0 ? 0 : sum / sorted.length,
      jitterP95MinusP50Ms: percentile(0.95) - percentile(0.5),
      maxMs: sorted[sorted.length - 1] ?? 0,
      minMs: sorted[0] ?? 0,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      sampleCount: sorted.length,
    };
  };
  const numberDelta = (after, before) => {
    const result = {};
    for (const [key, value] of Object.entries(after ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const previous = before?.[key];
      result[key] = value - (typeof previous === 'number' && Number.isFinite(previous) ? previous : 0);
    }
    return result;
  };
  const dispatchCameraDragMove = (index) => {
    if (typeof PointerEvent !== 'function') return false;
    const canvas = document.querySelector('canvas');
    if (canvas === null) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    canvas.dispatchEvent(new PointerEvent(index === 0 ? 'pointerdown' : 'pointermove', {
      bubbles: true,
      button: 0,
      buttons: 1,
      cancelable: true,
      clientX: rect.left + rect.width * 0.5 + index * config.vtCameraDragStepPixels,
      clientY: rect.top + rect.height * 0.5,
      isPrimary: true,
      pointerId: 947,
      pointerType: 'mouse',
    }));
    return true;
  };
  const endCameraDrag = () => {
    if (typeof PointerEvent !== 'function') return;
    const canvas = document.querySelector('canvas');
    if (canvas === null) return;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      cancelable: true,
      clientX: rect.left + rect.width * 0.5,
      clientY: rect.top + rect.height * 0.5,
      isPrimary: true,
      pointerId: 947,
      pointerType: 'mouse',
    }));
  };
  const sampleVtUploadFrames = async (frameCount, timeoutMs, cameraDrag) => {
    const requestedFrames = Math.max(1, Math.floor(Number(frameCount) || 1));
    const deadline = performance.now() + Math.max(1, Math.floor(Number(timeoutMs) || config.readyTimeoutMs));
    const beforeRenderer = readRendererSnapshot();
    const beforeCounters = { ...counters, drawCalls: drawCalls() };
    const frames = [];
    let previous = performance.now();
    let dragStarted = false;
    let settledFrame = null;
    try {
      for (let index = 0; index < requestedFrames && performance.now() < deadline; index += 1) {
        if (cameraDrag === true) dragStarted = dispatchCameraDragMove(index) || dragStarted;
        if (!await rafBeforeDeadline(deadline)) break;
        updateFirstUsable();
        const now = performance.now();
        const renderer = readRendererSnapshot();
        frames.push({
          deltaMs: now - previous,
          drawCalls: drawCalls(),
          rendererFrame: renderer?.frame,
          vt: renderer?.virtualTexturing ?? null,
        });
        previous = now;
        const vt = renderer?.virtualTexturing;
        if (vt !== undefined && vt !== null && index > 0) {
          const settled = (vt.pendingPages ?? 0) === 0 && (vt.uploadedPages ?? 0) > 0;
          if (settledFrame === null && settled) settledFrame = index;
        }
      }
    } finally {
      if (dragStarted) endCameraDrag();
    }
    const afterRenderer = readRendererSnapshot();
    const afterCounters = { ...counters, drawCalls: drawCalls() };
    const pendingPages = frames
      .map((frame) => frame.vt?.pendingPages)
      .filter((value) => typeof value === 'number' && Number.isFinite(value));

    return {
      cameraDrag: cameraDrag === true,
      timedOut: performance.now() >= deadline,
      requestedFrames,
      settledFrame,
      frameStats: statsFromDeltas(frames.map((frame) => frame.deltaMs)),
      gl: numberDelta(afterCounters, beforeCounters),
      virtualTexturing: {
        before: beforeRenderer?.virtualTexturing ?? null,
        after: afterRenderer?.virtualTexturing ?? null,
        delta: numberDelta(afterRenderer?.virtualTexturing ?? {}, beforeRenderer?.virtualTexturing ?? {}),
        maxPendingPages: pendingPages.length === 0 ? 0 : Math.max(...pendingPages),
        framesWithPendingPages: pendingPages.filter((value) => value > 0).length,
      },
    };
  };
  void waitForFirstUsable(config.readyTimeoutMs);
  globalThis.__royalGltfLoadBench = {
    sampleCanvas,
    sampleVtUploadFrames,
    snapshot() {
      return {
        counters: {
          ...counters,
          drawCalls: drawCalls(),
        },
        fullyLoadedAt,
        fullyLoadedState,
        firstDrawAt,
        firstTexturedFrameAt,
        firstTexturedFrameSample,
        firstTextureUploadAt,
        firstUsableAt,
        firstUsableSample,
        renderer: readRendererSnapshot(),
        resources: resourceSummary(),
      };
    },
    waitForFirstUsable,
    waitForFullyLoaded,
  };
})();
`,
  });
};

const waitForHook = (session) => evaluate(session, `
(async () => {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (globalThis.__royalGltfLoadBench !== undefined) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
})()
`);

const round = (value, digits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const heapGrowth = (after, before) =>
  typeof after?.usedSize === 'number' && typeof before?.usedSize === 'number'
    ? after.usedSize - before.usedSize
    : undefined;

const roundedGltfLoadDiagnostics = (snapshot) => {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const assets = Array.isArray(snapshot.assets)
    ? snapshot.assets.map((asset) => ({
        animationCount: asset.animationCount ?? 0,
        ...(typeof asset.error === 'string' ? { error: asset.error } : {}),
        imageFailures: asset.imageFailures ?? 0,
        imageLoaded: asset.imageLoaded ?? 0,
        imageRequests: asset.imageRequests ?? 0,
        key: asset.key,
        lightCount: asset.lightCount ?? 0,
        nodeCount: asset.nodeCount ?? 0,
        phaseMs: Object.fromEntries(
          Object.entries(asset.phaseMs ?? {}).map(([key, value]) => [key, round(value)]),
        ),
        primitiveCount: asset.primitiveCount ?? 0,
        status: asset.status,
        variantCount: asset.variantCount ?? 0,
      }))
    : [];

  return {
    assets,
    errorAssets: snapshot.errorAssets ?? 0,
    loadingAssets: snapshot.loadingAssets ?? 0,
    sceneReadyAssets: snapshot.sceneReadyAssets ?? 0,
  };
};

const buildReport = ({
  afterFinalGcHeap,
  afterFullyLoadedHeap,
  beforeHeap,
  firstUsableHeap,
  firstUsableState,
  fullState,
  routeStartedAt,
  snapshot,
  vtFrameSample,
}) => {
  const counters = snapshot.counters ?? {};
  const resources = snapshot.resources ?? {};
  const resourceKinds = resources.byKind ?? {};
  const rendererVirtualTexturing = snapshot.renderer?.virtualTexturing ?? fullState.state?.renderer?.virtualTexturing ?? null;
  const firstDrawMs = snapshot.firstDrawAt ?? fullState.firstDrawAt ?? firstUsableState.firstDrawAt;
  const firstUsableDrawMs = snapshot.firstUsableAt ?? fullState.firstUsableAt ?? firstUsableState.firstUsableAt;
  const fullyLoadedMs = snapshot.fullyLoadedAt ?? fullState.fullyLoadedAt;
  const firstTextureUploadMs = snapshot.firstTextureUploadAt;
  const firstTexturedFrameMs = snapshot.firstTexturedFrameAt;
  const rendererGltfLoadDiagnostics = snapshot.renderer?.gltfLoadDiagnostics ?? fullState.state?.renderer?.gltfLoadDiagnostics ?? null;

  return {
    generatedAt: new Date().toISOString(),
    route: {
      path: routePath,
      url: baseUrl + routePath,
    },
    config: {
      fullyLoadedStableMs,
      readyTimeoutMs,
      vtFrameSampleEnabled,
      vtFrameSampleCount,
      vtFrameSampleTimeoutMs,
      vtCameraDragEnabled,
      forceGeneratedVirtualTexturing,
    },
    metrics: {
      firstDrawMs: round(firstDrawMs),
      firstTextureUploadMs: round(firstTextureUploadMs),
      firstTexturedFrameMs: round(firstTexturedFrameMs),
      textureUploadToFirstTexturedFrameMs: round(
        typeof firstTextureUploadMs === 'number' && typeof firstTexturedFrameMs === 'number'
          ? firstTexturedFrameMs - firstTextureUploadMs
          : undefined,
      ),
      firstUsableDrawMs: round(firstUsableDrawMs),
      fullyLoadedMs: round(fullyLoadedMs),
      usableToFullyLoadedMs: round(
        typeof fullyLoadedMs === 'number' && typeof firstUsableDrawMs === 'number'
          ? fullyLoadedMs - firstUsableDrawMs
          : undefined,
      ),
      wallNavigationAndFullyLoadedMs: round(performance.now() - routeStartedAt),
      timedOut: {
        firstUsable: firstUsableState.timedOut === true,
        fullyLoaded: fullState.timedOut === true,
      },
      gl: counters,
      gltfLoadDiagnostics: roundedGltfLoadDiagnostics(rendererGltfLoadDiagnostics),
      textures: {
        allocations: counters.createTexture ?? 0,
        allocationCalls: counters.textureAllocationCalls ?? 0,
        bindTexture: counters.bindTexture ?? 0,
        generateMipmap: counters.generateMipmap ?? 0,
        uploadBytesRough: counters.textureUploadBytesRough ?? 0,
        uploadCalls: counters.textureUploadCalls ?? 0,
        texImage2D: counters.texImage2D ?? 0,
        texStorage2D: counters.texStorage2D ?? 0,
        texSubImage2D: counters.texSubImage2D ?? 0,
      },
      textureResources: {
        imageCount: resourceKinds.image?.count ?? 0,
        imageTransferBytes: resourceKinds.image?.transferSize ?? 0,
        imageDecodedBytes: resourceKinds.image?.decodedBodySize ?? 0,
      },
      vt: {
        manifestResourceCount: resourceKinds.vtManifest?.count ?? 0,
        manifestTransferBytes: resourceKinds.vtManifest?.transferSize ?? 0,
        pageResourceCount: resourceKinds.vtPage?.count ?? 0,
        pageTransferBytes: resourceKinds.vtPage?.transferSize ?? 0,
        generatedPagePrep: rendererVirtualTexturing === null
          ? null
          : {
              generatedManifestUses: rendererVirtualTexturing.generatedManifestUses ?? 0,
              generatedPageFailures: rendererVirtualTexturing.generatedPageFailures ?? 0,
              generatedPageRasterizeMaxMs: rendererVirtualTexturing.generatedPageRasterizeMaxMs ?? 0,
              generatedPageRasterizeMs: rendererVirtualTexturing.generatedPageRasterizeMs ?? 0,
              generatedPageRequests: rendererVirtualTexturing.generatedPageRequests ?? 0,
              generatedPagesTarget: rendererVirtualTexturing.generatedPagesTarget ?? 0,
            },
        renderer: rendererVirtualTexturing,
      },
      vtFrameSample,
      heap: {
        afterFinalGc: afterFinalGcHeap,
        afterFullyLoaded: afterFullyLoadedHeap,
        before: beforeHeap,
        firstUsable: firstUsableHeap,
        firstUsableGrowthBytes: heapGrowth(firstUsableHeap, beforeHeap),
        retainedGrowthBytes: heapGrowth(afterFinalGcHeap, beforeHeap),
        transientGrowthBytes: heapGrowth(afterFullyLoadedHeap, beforeHeap),
      },
      resources,
    },
    page: {
      firstTexturedFrameSample: snapshot.firstTexturedFrameSample,
      firstUsableSample: snapshot.firstUsableSample ?? firstUsableState.firstUsableSample,
      fullyLoadedState: snapshot.fullyLoadedState ?? fullState.state,
      renderer: snapshot.renderer ?? null,
    },
  };
};

const printSummary = (report) => {
  const metrics = report.metrics;
  const firstLoadAsset = metrics.gltfLoadDiagnostics?.assets?.[0];
  const phaseMs = firstLoadAsset?.phaseMs ?? {};
  console.log(
    `gltf load ${report.route.path}: firstDraw=${metrics.firstDrawMs}ms` +
      ` firstTextureUpload=${metrics.firstTextureUploadMs ?? 'n/a'}ms` +
      ` firstTextured=${metrics.firstTexturedFrameMs ?? 'n/a'}ms` +
      ` firstUsable=${metrics.firstUsableDrawMs}ms` +
      ` fullyLoaded=${metrics.fullyLoadedMs}ms` +
      ` toSceneReady=${phaseMs.toSceneReady ?? 'n/a'}ms` +
      ` document=${phaseMs.document ?? 'n/a'}ms` +
      ` buffers=${phaseMs.buffers ?? 'n/a'}ms` +
      ` meshopt=${phaseMs.meshopt ?? 'n/a'}ms` +
      ` draco=${phaseMs.draco ?? 'n/a'}ms` +
      ` scene=${phaseMs.scene ?? 'n/a'}ms` +
      ` imagesComplete=${phaseMs.imagesComplete ?? 'n/a'}ms` +
      ` vtManifests=${metrics.vt.manifestResourceCount}` +
      ` vtPages=${metrics.vt.pageResourceCount}` +
      ` generatedVtPages=${metrics.vt.generatedPagePrep?.generatedPageRequests ?? 'n/a'}` +
      ` textures=${metrics.textures.allocations}` +
      ` textureUploads=${metrics.textures.uploadCalls}` +
      ` vtFrameP95=${metrics.vtFrameSample?.frameStats?.p95Ms?.toFixed?.(1) ?? 'n/a'}ms` +
      ` retainedHeap=${metrics.heap.retainedGrowthBytes ?? 'n/a'}B`,
  );
};

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-gltf-load-bench-'));
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
    if (managePreview) await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    session.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'warning' && event.type !== 'error') return;
      const text = event.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
      if (text !== '') consoleMessages.push(`${event.type}: ${text}`);
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('HeapProfiler.enable');
    if (forceGeneratedVirtualTexturing) {
      await session.call('Fetch.enable', {
        patterns: [{ requestStage: 'Request', urlPattern: '*.vt.json*' }],
      });
      session.on('Fetch.requestPaused', (event) => {
        void session.call('Fetch.failRequest', {
          errorReason: 'Failed',
          requestId: event.requestId,
        });
      });
    }
    await installBenchmarkHooks(session);
    await session.call('HeapProfiler.collectGarbage');
    const beforeHeap = await session.call('Runtime.getHeapUsage');

    const loaded = session.once('Page.loadEventFired');
    const routeStartedAt = performance.now();
    await session.call('Page.navigate', { url: baseUrl + routePath });
    await Promise.race([loaded, sleep(10_000)]);
    if (!await waitForHook(session)) throw new Error('Browser load benchmark hook was not installed');

    const firstUsableState = await evaluate(session, `
(async () => globalThis.__royalGltfLoadBench.waitForFirstUsable(${readyTimeoutMs}))()
`);
    const firstUsableHeap = await session.call('Runtime.getHeapUsage');
    const vtFrameSample = vtFrameSampleEnabled
      ? await evaluate(session, `
(async () => globalThis.__royalGltfLoadBench.sampleVtUploadFrames(${vtFrameSampleCount}, ${vtFrameSampleTimeoutMs}, ${vtCameraDragEnabled ? 'true' : 'false'}))()
`)
      : null;
    const fullState = await evaluate(session, `
(async () => globalThis.__royalGltfLoadBench.waitForFullyLoaded(${readyTimeoutMs}, ${fullyLoadedStableMs}))()
`);
    const afterFullyLoadedHeap = await session.call('Runtime.getHeapUsage');
    await session.call('HeapProfiler.collectGarbage');
    const afterFinalGcHeap = await session.call('Runtime.getHeapUsage');
    const snapshot = await evaluate(session, 'globalThis.__royalGltfLoadBench.snapshot()');

    if (exceptions.length > 0) {
      throw new Error('Browser runtime exceptions: ' + exceptions.join('; '));
    }

    const report = buildReport({
      afterFinalGcHeap,
      afterFullyLoadedHeap,
      beforeHeap,
      firstUsableHeap,
      firstUsableState,
      fullState,
      routeStartedAt,
      snapshot,
      vtFrameSample,
    });
    printSummary(report);

    if (consoleMessages.length > 0) {
      report.browserConsole = consoleMessages;
    }
    if (outputPath !== '') {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`wrote ${outputPath}`);
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
