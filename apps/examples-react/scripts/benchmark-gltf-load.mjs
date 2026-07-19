import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  connectCdpPage,
  evaluate,
  spawnLogged,
  startVitePreview,
  stopProcess,
  waitForHttp,
} from './browser-harness.mjs';
import { rendererSnapshotExpression } from './example-contract.mjs';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_GLTF_LOAD_PORT ?? 4773);
const debugPort = Number(process.env.EXAMPLES_GLTF_LOAD_DEBUG_PORT ?? 4774);
const baseUrl = process.env.EXAMPLES_GLTF_LOAD_BASE_URL?.trim() || `http://${host}:${previewPort}`;
const routePathInput = process.env.EXAMPLES_GLTF_LOAD_ROUTE?.trim() || '/gltf-helmet';
const routePath = routePathInput.startsWith('/') ? routePathInput : `/${routePathInput}`;
const outputPath = process.env.EXAMPLES_GLTF_LOAD_OUTPUT?.trim() ?? '';
const cpuProfilePath = process.env.EXAMPLES_GLTF_LOAD_CPU_PROFILE?.trim() ?? '';
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
const glErrorDebugEnabled = process.env.EXAMPLES_GLTF_LOAD_GL_ERROR_DEBUG === '1';
const resourceTimingBufferSize = envNumber('EXAMPLES_GLTF_LOAD_RESOURCE_TIMINGS', 10_000);
if (!Number.isInteger(resourceTimingBufferSize)) {
  throw new Error('EXAMPLES_GLTF_LOAD_RESOURCE_TIMINGS must be a positive integer');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectPage = () => connectCdpPage({ debugHost: host, debugPort });

const installBenchmarkHooks = async (session) => {
  const hookConfig = JSON.stringify({
    glCallTimingEnabled: cpuProfilePath !== '',
    firstUsableMinColorBuckets: 16,
    firstUsableMinPaintedRatio: 0.01,
    firstUsableSampleSize: 96,
    glErrorDebugEnabled,
    readyTimeoutMs,
    resourceTimingBufferSize,
    vtCameraDragStepPixels,
  });
  await session.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
(() => {
  if (globalThis.__royalGltfLoadBenchInstalled === true) return;
  Object.defineProperty(globalThis, '__royalGltfLoadBenchInstalled', { value: true });
  const config = ${hookConfig};
  performance.setResourceTimingBufferSize(config.resourceTimingBufferSize);
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
  const glErrors = [];
  const slowGlCalls = [];
  const textureUploadByteChunks = [];
  let gpuTimerContext = null;
  let gpuTimerExtension = null;
  let gpuTimerSupported = false;
  let gpuTimerDisjointSamples = 0;
  const gpuTimerPending = [];
  const gpuFrameDurationMs = [];
  const loadFrameDeltas = [];
  let loadFramePreviousAt = performance.now();
  let loadFrameRequest = null;
  let loadHitchSampling = true;
  let longTaskCount = 0;
  let longTaskMaxMs = 0;
  let longTaskTotalMs = 0;
  let longTaskObserver = null;

  const recordLongTasks = (entries) => {
    for (const entry of entries) {
      const duration = Number(entry.duration);
      if (!Number.isFinite(duration) || duration < 0) continue;
      longTaskCount += 1;
      longTaskTotalMs += duration;
      longTaskMaxMs = Math.max(longTaskMaxMs, duration);
    }
  };
  try {
    longTaskObserver = new PerformanceObserver((list) => recordLongTasks(list.getEntries()));
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    longTaskObserver = null;
  }
  const sampleLoadFrame = () => {
    if (!loadHitchSampling) return;
    // Use one clock source throughout. A RAF timestamp describes the start of
    // the browser frame and can precede performance.now() captured while this
    // document-start script itself was running.
    const now = performance.now();
    const delta = now - loadFramePreviousAt;
    if (delta > 0) loadFrameDeltas.push(delta);
    loadFramePreviousAt = now;
    loadFrameRequest = requestAnimationFrame(sampleLoadFrame);
  };
  loadFrameRequest = requestAnimationFrame(sampleLoadFrame);

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
  const texImagePayload = (args) => args.length >= 9 ? args[8] : args[5];
  const texImageBytes = (args) => {
    if (args.length >= 9) {
      return roughBytes(args[3], args[4], args[6], args[7]);
    }
    const size = sourceSize(args[5]);
    return size === null ? 0 : roughBytes(size.width, size.height, args[3], args[4]);
  };
  const texSubImagePayload = (args) => args.length >= 9 ? args[8] : args[6];
  const texSubImageBytes = (args) => {
    if (args.length >= 9) {
      return roughBytes(args[4], args[5], args[6], args[7]);
    }
    const size = sourceSize(args[6]);
    return size === null ? 0 : roughBytes(size.width, size.height, args[4], args[5]);
  };
  const compressedBytes = (args) => {
    const payload = args.find((value) => value?.byteLength !== undefined);
    if (typeof payload?.byteLength === 'number') return payload.byteLength;
    // WebGL 2 pixel-unpack-buffer overloads pass imageSize followed by an
    // integer byte offset instead of an ArrayBufferView.
    return args.length >= 8 && finiteDimension(args[6]) ? args[6] : 0;
  };
  const recordDraw = (gl) => {
    if (gpuTimerContext === null && typeof gl?.createQuery === 'function') {
      gpuTimerContext = gl;
      try {
        gpuTimerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        gpuTimerSupported = gpuTimerExtension !== null;
      } catch {
        gpuTimerExtension = null;
      }
    }
    if (firstDrawAt === null) firstDrawAt = performance.now();
  };
  const pollGpuTimers = () => {
    const gl = gpuTimerContext;
    const extension = gpuTimerExtension;
    if (gl === null || extension === null) return;
    let write = 0;
    for (const sample of gpuTimerPending) {
      let available = false;
      try {
        available = gl.getQueryParameter(sample.query, gl.QUERY_RESULT_AVAILABLE) === true;
      } catch {
        available = true;
      }
      if (!available) {
        gpuTimerPending[write++] = sample;
        continue;
      }
      try {
        const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) === true;
        if (disjoint) gpuTimerDisjointSamples += 1;
        else if (sample.drew) {
          const nanoseconds = Number(gl.getQueryParameter(sample.query, gl.QUERY_RESULT));
          if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
            gpuFrameDurationMs.push(nanoseconds / 1_000_000);
          }
        }
      } catch {
        // A lost context or invalidated query makes this sample unusable but
        // must not perturb the page being measured.
      } finally {
        try { gl.deleteQuery(sample.query); } catch {}
      }
    }
    gpuTimerPending.length = write;
  };
  const bytesForIndexType = (gl, type) => {
    if (type === gl.UNSIGNED_BYTE) return 1;
    if (type === gl.UNSIGNED_SHORT) return 2;
    if (type === gl.UNSIGNED_INT) return 4;
    return 0;
  };
  const recordGlError = (gl, name, args) => {
    if (config.glErrorDebugEnabled !== true || glErrors.length >= 32) return;
    const error = gl.getError();
    if (error === gl.NO_ERROR) return;
    const count = Number(args[1]);
    const type = Number(args[2]);
    const offset = Number(args[3] ?? 0);
    let elementBufferSize = null;
    try {
      elementBufferSize = gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE);
    } catch {
      elementBufferSize = null;
    }
    glErrors.push({
      count,
      elementBufferSize,
      error,
      name,
      offset,
      requiredIndexBytes: offset + count * bytesForIndexType(gl, type),
      type,
    });
  };
  const recordTextureUpload = () => {
    if (firstTextureUploadAt === null) firstTextureUploadAt = performance.now();
  };
  const recordTextureUploadChunk = (bytes) => {
    const value = Number(bytes);
    if (Number.isFinite(value) && value >= 0) textureUploadByteChunks.push(value);
  };
  const recordSlowGlCall = (name, args, durationMs) => {
    if (config.glCallTimingEnabled !== true || durationMs < 1) return;
    const source = sourceSize(args.at(-1));
    slowGlCalls.push({
      durationMs,
      name,
      numericArgs: args.filter((value) => typeof value === 'number').slice(0, 8),
      ...(source === null ? {} : source),
      ...(args.length >= 9 && typeof args[3] === 'number' && typeof args[4] === 'number'
        ? { height: args[4], width: args[3] }
        : {}),
    });
    slowGlCalls.sort((left, right) => right.durationMs - left.durationMs);
    if (slowGlCalls.length > 32) slowGlCalls.length = 32;
  };
  const patch = (prototype, name, handler) => {
    const original = prototype?.[name];
    if (typeof original !== 'function' || original.__royalGltfLoadBenchPatched === true) return;
    const wrapped = function (...args) {
      const startedAt = config.glCallTimingEnabled === true ? performance.now() : 0;
      const result = original.apply(this, args);
      const durationMs = config.glCallTimingEnabled === true ? performance.now() - startedAt : 0;
      handler(args, this, durationMs);
      recordSlowGlCall(name, args, durationMs);
      return result;
    };
    Object.defineProperty(wrapped, '__royalGltfLoadBenchPatched', { value: true });
    prototype[name] = wrapped;
  };
  const patchPrototype = (prototype) => {
    patch(prototype, 'bindTexture', () => { counters.bindTexture += 1; });
    patch(prototype, 'createTexture', () => { counters.createTexture += 1; });
    patch(prototype, 'deleteTexture', () => { counters.deleteTexture += 1; });
    patch(prototype, 'drawArrays', (_args, gl) => { counters.drawArrays += 1; recordDraw(gl); });
    patch(prototype, 'drawElements', (args, gl) => { counters.drawElements += 1; recordDraw(gl); recordGlError(gl, 'drawElements', args); });
    patch(prototype, 'drawArraysInstanced', (_args, gl) => { counters.drawArraysInstanced += 1; recordDraw(gl); });
    patch(prototype, 'drawElementsInstanced', (args, gl) => { counters.drawElementsInstanced += 1; recordDraw(gl); recordGlError(gl, 'drawElementsInstanced', args); });
    patch(prototype, 'texImage2D', (args) => {
      counters.texImage2D += 1;
      counters.textureAllocationCalls += 1;
      const payload = texImagePayload(args);
      if (payload === null || payload === undefined) return;
      const bytes = texImageBytes(args);
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += bytes;
      recordTextureUploadChunk(bytes);
      recordTextureUpload();
    });
    patch(prototype, 'texSubImage2D', (args) => {
      if (texSubImagePayload(args) === null || texSubImagePayload(args) === undefined) return;
      const bytes = texSubImageBytes(args);
      counters.texSubImage2D += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += bytes;
      recordTextureUploadChunk(bytes);
      recordTextureUpload();
    });
    patch(prototype, 'texStorage2D', () => {
      counters.texStorage2D += 1;
      counters.textureAllocationCalls += 1;
    });
    patch(prototype, 'compressedTexImage2D', (args) => {
      const bytes = compressedBytes(args);
      counters.compressedTexImage2D += 1;
      counters.textureAllocationCalls += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += bytes;
      recordTextureUploadChunk(bytes);
      recordTextureUpload();
    });
    patch(prototype, 'compressedTexSubImage2D', (args) => {
      const bytes = compressedBytes(args);
      counters.compressedTexSubImage2D += 1;
      counters.textureUploadCalls += 1;
      counters.textureUploadBytesRough += bytes;
      recordTextureUploadChunk(bytes);
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
    patch(prototype, 'getProgramParameter', () => {});
  };
  patchPrototype(globalThis.WebGLRenderingContext?.prototype);
  patchPrototype(globalThis.WebGL2RenderingContext?.prototype);
  const nativeRequestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (callback) => nativeRequestAnimationFrame((time) => {
    pollGpuTimers();
    const gl = gpuTimerContext;
    const extension = gpuTimerExtension;
    const drawsBefore = counters.drawArrays + counters.drawElements
      + counters.drawArraysInstanced + counters.drawElementsInstanced;
    let query = null;
    if (gl !== null && extension !== null) {
      try {
        query = gl.createQuery();
        if (query !== null) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      } catch {
        if (query !== null) {
          try { gl.deleteQuery(query); } catch {}
        }
        query = null;
      }
    }
    try {
      callback(time);
    } finally {
      if (query !== null && gl !== null && extension !== null) {
        try {
          gl.endQuery(extension.TIME_ELAPSED_EXT);
          const drawsAfter = counters.drawArrays + counters.drawElements
            + counters.drawArraysInstanced + counters.drawElementsInstanced;
          gpuTimerPending.push({ drew: drawsAfter > drawsBefore, query });
        } catch {
          try { gl.deleteQuery(query); } catch {}
        }
      }
    }
  });

  const renderBeforeCanvasReadback = () => {
    // Demand-rendered canvases normally keep preserveDrawingBuffer disabled. A
    // later copy may therefore see an undefined (commonly transparent) back
    // buffer after compositing. Flush one renderer-owned demand frame so this
    // readback observes current output without changing production settings.
    globalThis.__royalExamplesRenderNow?.();
  };
  const sampleCanvas = (renderFirst = false) => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return null;
    if (renderFirst) renderBeforeCanvasReadback();
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
  const usableGltfStatus = (status) =>
    status === 'streaming' || status === 'degraded' || status === 'ready';
  const rendererGltfUsable = (renderer) => {
    const assets = renderer?.gltfLoadDiagnostics?.assets;
    return Array.isArray(assets)
      && assets.length > 0
      && assets.every((asset) => usableGltfStatus(asset.status));
  };
  const rendererGltfAssetsSettled = (renderer, requireSuccess) => {
    const diagnostics = renderer?.gltfLoadDiagnostics;
    if (diagnostics === undefined || diagnostics === null) return false;
    const assets = Array.isArray(diagnostics.assets) ? diagnostics.assets : [];
    if (assets.length === 0 || (diagnostics.loadingAssets ?? 0) !== 0) return false;
    if (requireSuccess && (diagnostics.errorAssets ?? 0) !== 0) return false;
    return assets.every((asset) =>
      asset.status !== 'loading' &&
      (!requireSuccess || asset.status === 'ready') &&
      (asset.imagesLoaded ?? 0) + (asset.imageFailures ?? 0) >= (asset.imageRequests ?? 0) &&
      (!requireSuccess || (asset.imageFailures ?? 0) === 0));
  };
  const updateFirstUsable = () => {
    const renderer = readRendererSnapshot();
    if (!rendererGltfUsable(renderer)) return false;
    const textureReady = (renderer?.textureResidency?.resources ?? 0) > 0;
    const needsUsableSample = firstUsableAt === null;
    const needsTexturedSample = firstTexturedFrameAt === null
      && firstTextureUploadAt !== null
      && textureReady;
    if (!needsUsableSample && !needsTexturedSample) return true;
    const sample = sampleCanvas(true);
    if (needsTexturedSample && isUsableSample(sample)) {
      firstTexturedFrameAt = performance.now();
      firstTexturedFrameSample = sample;
    }
    if (needsUsableSample && firstDrawAt !== null && isUsableSample(sample)) {
      firstUsableAt = performance.now();
      firstUsableSample = sample;
    }
    return firstUsableAt !== null;
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
      lastSample: sampleCanvas(true),
    };
  };
  const readRendererSnapshot = () => ${rendererSnapshotExpression};
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
      (virtualTexturing?.automaticManifestUses ?? 0) > 0 &&
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
    let resources = resourceSummary();
    await waitForFirstUsable(timeoutMs);
    while (performance.now() < deadline) {
      const resourceCount = performance.getEntriesByType('resource').length;
      if (resourceCount !== stableResourceCount) {
        stableResourceCount = resourceCount;
        stableSince = performance.now();
        resources = resourceSummary();
      }
      const renderer = readRendererSnapshot();
      updateFirstUsable();
      const rendererSettled = rendererGltfAssetsSettled(renderer, false);
      const rendererReady = rendererGltfAssetsSettled(renderer, true);
      const sample = firstUsableSample ?? sampleCanvas(rendererReady);
      lastState = {
        documentReadyState: document.readyState,
        renderer,
        rendererSettled,
        resourceCount,
        resources,
        resourceStableForMs: performance.now() - stableSince,
        sample,
      };
      if (
        document.readyState === 'complete' &&
        rendererSettled &&
        rendererReady &&
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
          resources,
        };
        finishLoadHitchSampling();
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
    finishLoadHitchSampling();
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
  const finishLoadHitchSampling = () => {
    if (!loadHitchSampling) return;
    loadHitchSampling = false;
    if (loadFrameRequest !== null) cancelAnimationFrame(loadFrameRequest);
    loadFrameRequest = null;
    if (longTaskObserver !== null) {
      recordLongTasks(longTaskObserver.takeRecords());
      longTaskObserver.disconnect();
    }
  };
  const loadHitchSnapshot = () => ({
    framesOver100Ms: loadFrameDeltas.filter((delta) => delta > 100).length,
    framesOver25Ms: loadFrameDeltas.filter((delta) => delta > 25).length,
    framesOver50Ms: loadFrameDeltas.filter((delta) => delta > 50).length,
    frameStats: statsFromDeltas(loadFrameDeltas),
    longTasks: {
      count: longTaskCount,
      maxMs: longTaskMaxMs,
      supported: longTaskObserver !== null,
      totalMs: longTaskTotalMs,
    },
  });
  const gpuTimingSnapshot = () => {
    pollGpuTimers();
    return {
      disjointSamples: gpuTimerDisjointSamples,
      gpuMs: statsFromDeltas(gpuFrameDurationMs),
      pendingSamples: gpuTimerPending.length,
      supported: gpuTimerSupported,
    };
  };
  const textureUploadChunkSnapshot = () => {
    const stats = statsFromDeltas(textureUploadByteChunks);
    return {
      averageBytes: stats.averageMs,
      maxBytes: stats.maxMs,
      minBytes: stats.minMs,
      p50Bytes: stats.p50Ms,
      p95Bytes: stats.p95Ms,
      p99Bytes: stats.p99Ms,
      sampleCount: stats.sampleCount,
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
    const startedAt = performance.now();
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
    return performance.now() - startedAt;
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
    const cameraInputHandlerDurationMs = [];
    let previous = performance.now();
    let dragStarted = false;
    let settledFrame = null;
    try {
      for (let index = 0; index < requestedFrames && performance.now() < deadline; index += 1) {
        if (cameraDrag === true) {
          const handlerDurationMs = dispatchCameraDragMove(index);
          if (handlerDurationMs !== false) {
            dragStarted = true;
            cameraInputHandlerDurationMs.push(handlerDurationMs);
          }
        }
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
      cameraInput: {
        handlerDurationMs: statsFromDeltas(cameraInputHandlerDurationMs),
      },
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
        glErrors: [...glErrors],
        slowGlCalls: [...slowGlCalls],
        textureUpload: {
          bytesPerChunk: textureUploadChunkSnapshot(),
        },
        loadHitches: loadHitchSnapshot(),
        renderFrame: gpuTimingSnapshot(),
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

const roundedLoadHitches = (snapshot) => {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const frameStats = snapshot.frameStats ?? {};
  const longTasks = snapshot.longTasks ?? {};
  return {
    framesOver100Ms: snapshot.framesOver100Ms ?? 0,
    framesOver25Ms: snapshot.framesOver25Ms ?? 0,
    framesOver50Ms: snapshot.framesOver50Ms ?? 0,
    frameStats: Object.fromEntries(
      Object.entries(frameStats).map(([key, value]) => [key, round(value)]),
    ),
    longTasks: {
      count: longTasks.count ?? 0,
      maxMs: round(longTasks.maxMs ?? 0),
      supported: longTasks.supported === true,
      totalMs: round(longTasks.totalMs ?? 0),
    },
  };
};

const roundedGltfLoadDiagnostics = (snapshot) => {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const assets = Array.isArray(snapshot.assets)
    ? snapshot.assets.map((asset) => ({
        ...(typeof asset.error === 'string' ? { error: asset.error } : {}),
        imageFailures: asset.imageFailures ?? 0,
        imagesLoaded: asset.imagesLoaded ?? 0,
        imageRequests: asset.imageRequests ?? 0,
        lightCount: asset.lightCount ?? 0,
        nodeCount: asset.nodeCount ?? 0,
        phaseMs: Object.fromEntries(
          Object.entries(asset.phaseMs ?? {}).map(([key, value]) => [key, round(value)]),
        ),
        primitiveCount: asset.primitiveCount ?? 0,
        sourceUri: asset.sourceUri ?? asset.src,
        ...(asset.sourceVersion === undefined && asset.version === undefined
          ? {}
          : { sourceVersion: asset.sourceVersion ?? asset.version }),
        status: asset.status,
        variantCount: asset.variantCount
          ?? (Array.isArray(asset.variantNames) ? asset.variantNames.length : 0),
      }))
    : [];

  return {
    assets,
    errorAssets: snapshot.errorAssets
      ?? assets.filter((asset) => asset.status === 'error').length,
    loadingAssets: snapshot.loadingAssets
      ?? assets.filter((asset) => asset.status === 'loading').length,
    usableAssets: snapshot.usableAssets
      ?? assets.filter((asset) => (
        asset.status === 'streaming'
        || asset.status === 'degraded'
        || asset.status === 'ready'
      )).length,
  };
};

const phaseValue = (asset, phase) => {
  const value = asset?.phaseMs?.[phase];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const assetPhaseSummary = (asset, phase) => ({
  nodeCount: asset.nodeCount,
  primitiveCount: asset.primitiveCount,
  sourceUri: asset.sourceUri,
  ...(asset.sourceVersion === undefined ? {} : { sourceVersion: asset.sourceVersion }),
  status: asset.status,
  valueMs: phaseValue(asset, phase),
});

const topAssetsByPhase = (assets, phase, limit = 8) =>
  assets
    .filter((asset) => phaseValue(asset, phase) !== undefined)
    .sort((left, right) => phaseValue(right, phase) - phaseValue(left, phase))
    .slice(0, limit)
    .map((asset) => assetPhaseSummary(asset, phase));

const topAssetsByCount = (assets, key, limit = 8) =>
  assets
    .filter((asset) => typeof asset[key] === 'number' && asset[key] > 0)
    .sort((left, right) => right[key] - left[key])
    .slice(0, limit)
    .map((asset) => ({
      count: asset[key],
      imageFailures: asset.imageFailures,
      nodeCount: asset.nodeCount,
      primitiveCount: asset.primitiveCount,
      sourceUri: asset.sourceUri,
      ...(asset.sourceVersion === undefined ? {} : { sourceVersion: asset.sourceVersion }),
      status: asset.status,
    }));

const gltfLoadDiagnosticsSummary = (diagnostics) => {
  if (diagnostics === null || typeof diagnostics !== 'object') return null;
  const assets = Array.isArray(diagnostics?.assets) ? diagnostics.assets : [];
  const totals = assets.reduce((next, asset) => ({
    imageFailures: next.imageFailures + asset.imageFailures,
    imagesLoaded: next.imagesLoaded + asset.imagesLoaded,
    imageRequests: next.imageRequests + asset.imageRequests,
    lights: next.lights + asset.lightCount,
    nodes: next.nodes + asset.nodeCount,
    primitives: next.primitives + asset.primitiveCount,
    variants: next.variants + asset.variantCount,
  }), {
    imageFailures: 0,
    imagesLoaded: 0,
    imageRequests: 0,
    lights: 0,
    nodes: 0,
    primitives: 0,
    variants: 0,
  });

  return {
    assets: assets.length,
    errorAssets: diagnostics?.errorAssets ?? 0,
    loadingAssets: diagnostics?.loadingAssets ?? 0,
    usableAssets: diagnostics?.usableAssets ?? 0,
    slowestImagesComplete: topAssetsByPhase(assets, 'imagesComplete'),
    topImageRequestAssets: topAssetsByCount(assets, 'imageRequests'),
    totals,
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
  const gltfLoadDiagnostics = roundedGltfLoadDiagnostics(rendererGltfLoadDiagnostics);

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
      glErrorDebugEnabled,
      resourceTimingBufferSize,
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
      glErrors: glErrorDebugEnabled && Array.isArray(snapshot.glErrors) ? snapshot.glErrors : null,
      slowGlCalls: Array.isArray(snapshot.slowGlCalls)
        ? snapshot.slowGlCalls.map((call) => ({ ...call, durationMs: round(call.durationMs) }))
        : [],
      gltfLoadDiagnostics,
      gltfLoadSummary: gltfLoadDiagnosticsSummary(gltfLoadDiagnostics),
      loadHitches: roundedLoadHitches(snapshot.loadHitches),
      renderFrame: snapshot.renderFrame ?? null,
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
        bytesPerChunk: snapshot.textureUpload?.bytesPerChunk ?? null,
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
              generatedManifestUses: rendererVirtualTexturing.automaticManifestUses ?? 0,
              generatedPageFailures: rendererVirtualTexturing.pageLoadFailures ?? 0,
              generatedPageRasterizeMaxMs: rendererVirtualTexturing.pageLoadDurationMaxMs ?? 0,
              generatedPageRasterizeMs: (rendererVirtualTexturing.pageLoadDurationAverageMs ?? 0)
                * (rendererVirtualTexturing.pageLoadDurationSamples ?? 0),
              generatedPageRequests: rendererVirtualTexturing.pageLoadRequests ?? 0,
              generatedPagesTarget: rendererVirtualTexturing.automaticPagesTarget ?? 0,
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
  const summary = metrics.gltfLoadSummary;
  const slowestImages = summary?.slowestImagesComplete?.[0];
  const shortKey = (key) => {
    if (typeof key !== 'string') return 'n/a';
    const name = key.split('/').pop() ?? key;
    return name.length > 38 ? `${name.slice(0, 35)}...` : name;
  };
  const topPhaseText = (asset) =>
    asset?.valueMs === undefined ? 'n/a' : `${shortKey(asset.sourceUri)}:${asset.valueMs}ms`;
  console.log(
    `gltf load ${report.route.path}: firstDraw=${metrics.firstDrawMs}ms` +
      ` firstTextureUpload=${metrics.firstTextureUploadMs ?? 'n/a'}ms` +
      ` firstTextured=${metrics.firstTexturedFrameMs ?? 'n/a'}ms` +
      ` firstUsable=${metrics.firstUsableDrawMs}ms` +
      ` fullyLoaded=${metrics.fullyLoadedMs}ms` +
      ` gltfAssets=${summary?.assets ?? 0}` +
      ` usableAssets=${summary?.usableAssets ?? 0}` +
      ` imageRequests=${summary?.totals?.imageRequests ?? 0}` +
      ` imagesLoaded=${summary?.totals?.imagesLoaded ?? 0}` +
      ` imageFailures=${summary?.totals?.imageFailures ?? 0}` +
      ` slowImages=${topPhaseText(slowestImages)}` +
      ` vtManifests=${metrics.vt.manifestResourceCount}` +
      ` vtPages=${metrics.vt.pageResourceCount}` +
      ` generatedVtPages=${metrics.vt.generatedPagePrep?.generatedPageRequests ?? 'n/a'}` +
      ` textures=${metrics.textures.allocations}` +
      ` textureUploads=${metrics.textures.uploadCalls}` +
      ` loadFrameP95=${metrics.loadHitches?.frameStats?.p95Ms ?? 'n/a'}ms` +
      ` loadFrameMax=${metrics.loadHitches?.frameStats?.maxMs ?? 'n/a'}ms` +
      ` loadLongTasks=${metrics.loadHitches?.longTasks?.count ?? 'n/a'}` +
      ` vtFrameP95=${metrics.vtFrameSample?.frameStats?.p95Ms?.toFixed?.(1) ?? 'n/a'}ms` +
      ` retainedHeap=${metrics.heap.retainedGrowthBytes ?? 'n/a'}B`,
  );
};

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-gltf-load-bench-'));
  const preview = managePreview
    ? startVitePreview({ appRoot, host, port: previewPort })
    : undefined;
  const browser = spawnLogged('chromium', [
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
  ], { cwd: appRoot });

  let session;
  const exceptions = [];
  const consoleMessages = [];

  try {
    if (managePreview) await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      const details = event.exceptionDetails;
      exceptions.push(
        details?.exception?.description
        ?? details?.exception?.value
        ?? details?.text
        ?? 'Runtime exception',
      );
    });
    session.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'warning' && event.type !== 'error') return;
      const text = event.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
      if (text !== '') consoleMessages.push(`${event.type}: ${text}`);
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('HeapProfiler.enable');
    if (cpuProfilePath !== '') {
      await session.call('Profiler.enable');
      await session.call('Profiler.setSamplingInterval', { interval: 100 });
      await session.call('Profiler.start');
    }
    const gpu = await evaluate(session, `
      (() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return gl === null || debug === null ? null : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
      })()
    `);
    if (gpu === null || /SwiftShader|Subzero|llvmpipe|lavapipe|software/iu.test(gpu)) {
      throw new Error(`Hardware GPU glTF load benchmark resolved to software rendering: ${gpu ?? 'unknown renderer'}`);
    }
    console.log(`gpu ${gpu ?? 'renderer unavailable'}`);
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
    const cpuProfile = cpuProfilePath === '' ? null : (await session.call('Profiler.stop')).profile;

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
    if (cpuProfilePath !== '' && cpuProfile !== null) {
      await mkdir(path.dirname(cpuProfilePath), { recursive: true });
      await writeFile(cpuProfilePath, `${JSON.stringify(cpuProfile)}\n`);
      console.log(`wrote ${cpuProfilePath}`);
    }
  } finally {
    session?.close();
    await stopProcess(browser);
    await stopProcess(preview);
    await rm(profileDir, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
};

await main();
