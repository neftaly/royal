import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_VT_BENCH_PORT ?? 4673);
const debugPort = Number(process.env.EXAMPLES_VT_BENCH_DEBUG_PORT ?? 4674);
const baseUrl = `http://${host}:${previewPort}`;
const routePath = '/virtual-texturing-plane';
const routeUrl = baseUrl + routePath;
const privateVirtualTextureStatsSymbolName =
  'royal.renderer-webgl.private.virtualTextureStats.v1';
const expectedStaticProbe = {
  activeGrid: '4x4',
  activeMip: 1,
  activePages: 16,
};

const cliGate = process.argv.includes('--smoke')
  ? 'smoke'
  : process.argv.includes('--default-on')
    ? 'default-on'
    : undefined;
const requestedGate = process.env.VT_SMOOTHNESS_GATE ?? cliGate ?? 'smoke';
const gates = {
  'default-on': {
    maxLongFrameRatio: 0.03,
    maxP95Ms: 24,
    maxP99Ms: 48,
    requireRuntimeBehavior: true,
  },
  smoke: {
    maxLongFrameRatio: 0.5,
    maxP95Ms: 260,
    maxP99Ms: 420,
    requireRuntimeBehavior: false,
  },
};
const gate = gates[requestedGate];
if (gate === undefined) {
  throw new Error(
    `VT_SMOOTHNESS_GATE must be one of ${Object.keys(gates).join(', ')}, ` +
      `received ${JSON.stringify(requestedGate)}`,
  );
}

const envNumber = (names, fallback) => {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
    throw new Error(`${name} must be a finite number, received ${JSON.stringify(raw)}`);
  }
  return fallback;
};

const thresholds = {
  maxLongFrameRatio: envNumber(
    ['VT_SMOOTHNESS_MAX_LONG_FRAME_RATIO', 'EXAMPLES_VT_BENCH_MAX_LONG_FRAME_RATIO'],
    gate.maxLongFrameRatio,
  ),
  maxP95Ms: envNumber(
    ['VT_SMOOTHNESS_RAF_P95_MS', 'EXAMPLES_VT_BENCH_MAX_P95_MS'],
    gate.maxP95Ms,
  ),
  maxP99Ms: envNumber(
    ['VT_SMOOTHNESS_RAF_P99_MS', 'EXAMPLES_VT_BENCH_MAX_P99_MS'],
    gate.maxP99Ms,
  ),
};
const longFrameThresholdMs = envNumber(
  ['VT_SMOOTHNESS_LONG_FRAME_MS', 'EXAMPLES_VT_BENCH_LONG_FRAME_MS'],
  50,
);

const formatMs = (value) => Number.isFinite(value) ? value.toFixed(1) : 'n/a';
const formatRatio = (value) => Number.isFinite(value) ? value.toFixed(3) : 'n/a';
const printGate = () => {
  console.log(
    'virtual-texturing smoothness-gate ' +
      `gate=${requestedGate} ` +
      `p95Ms<=${thresholds.maxP95Ms} ` +
      `p99Ms<=${thresholds.maxP99Ms} ` +
      `longFrameRatio>${longFrameThresholdMs}ms<=${thresholds.maxLongFrameRatio} ` +
      `runtimeBehavior=${gate.requireRuntimeBehavior ? 'required' : 'observed-only'}`,
  );
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
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Runtime evaluation failed',
    );
  }

  return result.result.value;
};

const vtStateExpression = `
(() => {
  const sampleCanvas = (canvas, maxSize = 160) => {
    const width = Math.max(1, Math.min(maxSize, canvas.width));
    const height = Math.max(1, Math.min(maxSize, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return { error: 'missing 2d sample context' };

    try {
      context.drawImage(canvas, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const bucketCounts = new Map();
      let hash = 2166136261;
      let paintedPixels = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        if (alpha === 0) continue;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        if (red > 8 || green > 8 || blue > 8) paintedPixels += 1;
        const bucket = \`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`;
        bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
        hash = Math.imul(hash ^ red, 16777619);
        hash = Math.imul(hash ^ green, 16777619);
        hash = Math.imul(hash ^ blue, 16777619);
        hash = Math.imul(hash ^ alpha, 16777619);
      }

      const topBuckets = Array.from(bucketCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 6)
        .map(([bucket, count]) => \`\${bucket}:\${count}\`);

      return {
        bucketHash: (hash >>> 0).toString(16).padStart(8, '0'),
        colorBuckets: bucketCounts.size,
        paintedPixels,
        paintedRatio: paintedPixels / (width * height),
        topBuckets,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const canvas = document.querySelector('canvas');
  const path = window.location.pathname.replace(/\\/$/, '') || '/';
  if (!(canvas instanceof HTMLCanvasElement)) {
    return { ready: false, route: { path }, reason: 'missing canvas' };
  }

  const rect = canvas.getBoundingClientRect();
  const sample = sampleCanvas(canvas);
  const virtualTexturing = {
    activeGrid: canvas.dataset.virtualTextureActiveGrid ?? '',
    activeMip: Number(canvas.dataset.virtualTextureActiveMip ?? Number.NaN),
    activePages: Number(canvas.dataset.virtualTextureActivePages ?? Number.NaN),
    format: canvas.dataset.virtualTextureFormat ?? '',
    generator: canvas.dataset.virtualTextureGenerator ?? '',
    manifestUri: canvas.dataset.virtualTextureManifest ?? '',
    pageSourceKind: canvas.dataset.virtualTexturePageSourceKind ?? '',
    pageSize: Number(canvas.dataset.virtualTexturePageSize ?? Number.NaN),
    physicalSlots: Number(canvas.dataset.virtualTexturePhysicalSlots ?? Number.NaN),
    probe: canvas.dataset.virtualTextureProbe ?? '',
    virtualSize: canvas.dataset.virtualTextureVirtualSize ?? '',
  };
  const painted = sample.error === undefined &&
    sample.paintedRatio >= 0.01 &&
    sample.colorBuckets >= 4;
  const vtReady = virtualTexturing.probe === 'generated-debug-rgba-pages' &&
    virtualTexturing.activeGrid === '${expectedStaticProbe.activeGrid}' &&
    virtualTexturing.activeMip === ${expectedStaticProbe.activeMip} &&
    virtualTexturing.activePages === ${expectedStaticProbe.activePages} &&
    virtualTexturing.format === 'rgba8' &&
    virtualTexturing.generator === 'debug-rgba' &&
    virtualTexturing.pageSourceKind === 'generated';
  const canvasReady = canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;

  return {
    canvas: {
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      rect: {
        bottom: Number(rect.bottom.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
      },
      sample,
    },
    ready: path === '${routePath}' && canvasReady && painted && vtReady,
    route: { path },
    virtualTexturing,
  };
})()
`;

const installVtProbeExpression = `
(() => {
  const finiteNumber = (value) => Number.isFinite(value) ? value : null;
  const sampleCanvas = (canvas, maxSize = 160) => {
    const width = Math.max(1, Math.min(maxSize, canvas.width));
    const height = Math.max(1, Math.min(maxSize, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return { error: 'missing 2d sample context' };

    try {
      context.drawImage(canvas, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const bucketCounts = new Map();
      let hash = 2166136261;
      let paintedPixels = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        if (alpha === 0) continue;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        if (red > 8 || green > 8 || blue > 8) paintedPixels += 1;
        const bucket = \`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`;
        bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
        hash = Math.imul(hash ^ red, 16777619);
        hash = Math.imul(hash ^ green, 16777619);
        hash = Math.imul(hash ^ blue, 16777619);
        hash = Math.imul(hash ^ alpha, 16777619);
      }

      const topBuckets = Array.from(bucketCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 6)
        .map(([bucket, count]) => \`\${bucket}:\${count}\`);

      return {
        bucketHash: (hash >>> 0).toString(16).padStart(8, '0'),
        colorBuckets: bucketCounts.size,
        paintedPixels,
        paintedRatio: paintedPixels / (width * height),
        topBuckets,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  const readCanvasProbe = (canvas) => ({
    activeGrid: canvas.dataset.virtualTextureActiveGrid ?? '',
    activeMip: finiteNumber(Number(canvas.dataset.virtualTextureActiveMip ?? Number.NaN)),
    activePages: finiteNumber(Number(canvas.dataset.virtualTextureActivePages ?? Number.NaN)),
    format: canvas.dataset.virtualTextureFormat ?? '',
    generator: canvas.dataset.virtualTextureGenerator ?? '',
    manifestUri: canvas.dataset.virtualTextureManifest ?? '',
    pageSourceKind: canvas.dataset.virtualTexturePageSourceKind ?? '',
    pageSize: finiteNumber(Number(canvas.dataset.virtualTexturePageSize ?? Number.NaN)),
    physicalSlots: finiteNumber(Number(canvas.dataset.virtualTexturePhysicalSlots ?? Number.NaN)),
    probe: canvas.dataset.virtualTextureProbe ?? '',
    virtualSize: canvas.dataset.virtualTextureVirtualSize ?? '',
  });
  const readRuntimeStats = (canvas) => {
    const reader = canvas[Symbol.for('${privateVirtualTextureStatsSymbolName}')];
    if (typeof reader !== 'function') {
      return { error: 'missing private virtual texture runtime stats reader', exposed: false };
    }

    try {
      const stats = reader();
      if (stats === null || typeof stats !== 'object') {
        return { error: 'private virtual texture runtime stats reader returned a non-object', exposed: false };
      }
      return { exposed: true, stats };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        exposed: false,
      };
    }
  };
  const parseManifest = (manifest) => {
    const entries = Array.isArray(manifest?.pages?.entries)
      ? manifest.pages.entries.map((entry) => ({
        mip: Number(entry?.mip ?? -1),
        uri: String(entry?.uri ?? ''),
        x: Number(entry?.x ?? -1),
        y: Number(entry?.y ?? -1),
      }))
      : [];
    const entriesByMip = {};
    for (const entry of entries) {
      const key = 'mip' + entry.mip;
      entriesByMip[key] = (entriesByMip[key] ?? 0) + 1;
    }

    return {
      borderTexels: finiteNumber(Number(manifest?.borderTexels ?? Number.NaN)),
      bytesPerTexel: finiteNumber(Number(manifest?.bytesPerTexel ?? Number.NaN)),
      entries,
      entriesByMip,
      format: String(manifest?.format ?? ''),
      generator: String(manifest?.pages?.generator ?? ''),
      id: String(manifest?.id ?? ''),
      mipCount: finiteNumber(Number(manifest?.mipCount ?? Number.NaN)),
      pageSize: finiteNumber(Number(manifest?.pageSize ?? Number.NaN)),
      pageSourceKind: String(manifest?.pages?.kind ?? 'uri'),
      physicalSlots: finiteNumber(Number(manifest?.physicalSlots ?? Number.NaN)),
      virtualSize: Array.isArray(manifest?.virtualSize)
        ? manifest.virtualSize.map((value) => finiteNumber(Number(value)))
        : [],
    };
  };
  const fetchManifest = async (manifestUri) => {
    if (manifestUri === '') return { error: 'missing virtual texture manifest dataset' };

    try {
      const response = await fetch(manifestUri);
      if (!response.ok) return { error: 'manifest fetch returned ' + response.status };
      return { manifest: parseManifest(await response.json()), uri: response.url };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  const expectedMipGrids = (manifest) => {
    const [virtualWidth, virtualHeight] = manifest?.virtualSize ?? [];
    const pageSize = manifest?.pageSize;
    const mipCount = manifest?.mipCount;

    if (
      !Number.isFinite(virtualWidth) ||
      !Number.isFinite(virtualHeight) ||
      !Number.isFinite(pageSize) ||
      !Number.isFinite(mipCount) ||
      pageSize <= 0 ||
      mipCount <= 0
    ) {
      return [];
    }

    return Array.from({ length: mipCount }, (_, mip) => {
      const scale = 2 ** mip;
      const mipWidth = Math.max(1, Math.ceil(virtualWidth / scale));
      const mipHeight = Math.max(1, Math.ceil(virtualHeight / scale));
      const pagesX = Math.max(1, Math.ceil(mipWidth / pageSize));
      const pagesY = Math.max(1, Math.ceil(mipHeight / pageSize));
      const explicitEntries = manifest.entriesByMip?.['mip' + mip] ?? 0;

      return {
        explicitEntries,
        grid: \`\${pagesX}x\${pagesY}\`,
        mip,
        pages: pagesX * pagesY,
        textureSize: \`\${mipWidth}x\${mipHeight}\`,
      };
    });
  };
  const expectedCapacitySelection = (mipGrids, manifest) => {
    const capacity = manifest?.physicalSlots;
    if (!Array.isArray(mipGrids) || mipGrids.length === 0 || !Number.isFinite(capacity) || capacity <= 0) {
      return null;
    }

    const effectiveCapacity = Math.max(1, capacity - 1);
    const selected = mipGrids.find((entry) =>
      Number.isFinite(entry.pages) && entry.pages <= effectiveCapacity
    ) ?? mipGrids[mipGrids.length - 1];

    return {
      effectiveCapacity,
      grid: selected?.grid ?? '',
      mip: selected?.mip ?? null,
      pages: selected?.pages ?? null,
      physicalSlots: capacity,
      reservedSlots: capacity - effectiveCapacity,
    };
  };
  const read = async () => {
    const canvas = document.querySelector('canvas');
    const path = window.location.pathname.replace(/\\/$/, '') || '/';

    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        measurement: {
          realStreamingObserved: false,
          runtimeStatsExposed: false,
          scope: 'missing-canvas',
        },
        ready: false,
        reason: 'missing canvas',
        route: { path },
      };
    }

    const dataset = readCanvasProbe(canvas);
    const runtimeStatsResult = readRuntimeStats(canvas);
    const manifestResult = await fetchManifest(dataset.manifestUri);
    const manifest = manifestResult.manifest;
    const mipGrids = manifest === undefined ? [] : expectedMipGrids(manifest);
    const activeExpected = mipGrids.find((entry) => entry.mip === dataset.activeMip);
    const capacityExpected = manifest === undefined ? null : expectedCapacitySelection(mipGrids, manifest);
    const active = {
      capacityExpected,
      matchesCapacityExpected: capacityExpected === null
        ? false
        : dataset.activeMip === capacityExpected.mip &&
          dataset.activeGrid === capacityExpected.grid &&
          dataset.activePages === capacityExpected.pages,
      expectedGrid: activeExpected?.grid ?? '',
      expectedPages: activeExpected?.pages ?? null,
      grid: dataset.activeGrid,
      matchesExpectedGrid: activeExpected === undefined ? false : dataset.activeGrid === activeExpected.grid,
      matchesExpectedPages: activeExpected === undefined ? false : dataset.activePages === activeExpected.pages,
      mip: dataset.activeMip,
      pages: dataset.activePages,
    };
    const streamSignal = manifest === undefined
      ? 'manifest-unavailable'
      : manifest.pageSourceKind === 'generated'
        ? 'static-generated-pages'
        : manifest.entries.length > 0
          ? 'manifest-page-entries'
          : 'manifest-page-source';
    const materialRuntime = runtimeStatsResult.stats?.lastMaterial;
    const resourceRuntime = materialRuntime?.resource;
    const realStreamingObserved = runtimeStatsResult.exposed === true && (
      Number(materialRuntime?.requestPages?.scheduled ?? 0) > 0 ||
      Number(materialRuntime?.uploadFrame?.bytesUploaded ?? 0) > 0 ||
      Number(resourceRuntime?.requests?.sourceRequests ?? 0) > 0 ||
      Number(resourceRuntime?.uploads?.physicalAtlasPagesUploaded ?? 0) > 0
    );

    return {
      active,
      canvas: {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        sample: sampleCanvas(canvas),
      },
      dataset,
      manifest: manifestResult.error === undefined
        ? {
          ...manifest,
          expectedMipGrids: mipGrids,
          fetchedUri: manifestResult.uri,
        }
        : { error: manifestResult.error },
      measurement: {
        realStreamingObserved,
        runtimeStatsExposed: runtimeStatsResult.exposed === true,
        scope: 'bootstrap-readiness plus post-ready repeated interaction overhead',
        streamSignal,
      },
      ready: true,
      route: { path },
      runtimeStats: runtimeStatsResult.exposed === true
        ? runtimeStatsResult.stats
        : { error: runtimeStatsResult.error },
    };
  };

  window.__royalVtSmoothnessProbe = { read };
  return true;
})()
`;
const readVtProbeExpression = 'window.__royalVtSmoothnessProbe.read()';

const installRecorderExpression = `
(() => {
  window.__royalVtSmoothnessRecorder?.stop?.();

  const samples = [];
  let active = false;
  let frameId = 0;
  let last;

  const tick = (now) => {
    if (!active) return;
    if (last !== undefined) samples.push(now - last);
    last = now;
    frameId = requestAnimationFrame(tick);
  };

  window.__royalVtSmoothnessRecorder = {
    read() {
      return { active, samples: samples.slice() };
    },
    start() {
      samples.length = 0;
      active = true;
      last = undefined;
      frameId = requestAnimationFrame(tick);
      return { startedAt: performance.now() };
    },
    stop() {
      active = false;
      cancelAnimationFrame(frameId);
      return { samples: samples.slice(), stoppedAt: performance.now() };
    },
  };

  return true;
})()
`;

const waitFramesExpression = (count) => `
new Promise((resolve) => {
  let remaining = ${count};
  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) {
      resolve(true);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})
`;

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

const waitForVtReady = async (session, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let state;

  while (Date.now() < deadline) {
    state = await evaluate(session, vtStateExpression);
    if (state.ready === true) return state;
    await sleep(100);
  }

  throw new Error(`Timed out waiting for virtual texturing plane readiness: ${JSON.stringify(state)}`);
};

const pointOnRect = (rect, xRatio, yRatio) => ({
  x: Number((rect.left + rect.width * xRatio).toFixed(2)),
  y: Number((rect.top + rect.height * yRatio).toFixed(2)),
});

const dispatchMouse = async (session, type, point, params = {}) => {
  await session.call('Input.dispatchMouseEvent', {
    pointerType: 'mouse',
    type,
    x: point.x,
    y: point.y,
    ...params,
  });
};

const dispatchWheel = async (session, point, deltaY, deltaX = 0) => {
  await dispatchMouse(session, 'mouseWheel', point, {
    deltaX,
    deltaY,
  });
};

const drag = async (session, from, to, steps, durationMs) => {
  await dispatchMouse(session, 'mouseMoved', from, { button: 'none', buttons: 0 });
  await sleep(40);
  await dispatchMouse(session, 'mousePressed', from, {
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const point = {
      x: Number((from.x + (to.x - from.x) * progress).toFixed(2)),
      y: Number((from.y + (to.y - from.y) * progress).toFixed(2)),
    };
    await sleep(durationMs / steps);
    await dispatchMouse(session, 'mouseMoved', point, {
      button: 'left',
      buttons: 1,
    });
  }

  await dispatchMouse(session, 'mouseReleased', to, {
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
};

const runInteractionSequence = async (session, rect) => {
  const center = pointOnRect(rect, 0.5, 0.5);
  const leftUpper = pointOnRect(rect, 0.36, 0.42);
  const rightLower = pointOnRect(rect, 0.65, 0.62);
  const rightUpper = pointOnRect(rect, 0.68, 0.38);
  const leftLower = pointOnRect(rect, 0.32, 0.64);

  await dispatchMouse(session, 'mouseMoved', center, { button: 'none', buttons: 0 });
  await sleep(80);

  for (const deltaY of [-360, -300, -240]) {
    await dispatchWheel(session, center, deltaY);
    await sleep(120);
  }

  await drag(session, leftUpper, rightLower, 24, 520);
  await sleep(160);

  for (const deltaY of [280, 220, -180]) {
    await dispatchWheel(session, rightLower, deltaY);
    await sleep(120);
  }

  await drag(session, rightUpper, leftLower, 24, 520);
  await sleep(700);
};

const percentile = (sortedValues, percentileValue) => {
  if (sortedValues.length === 0) return Number.NaN;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );
  return sortedValues[index];
};

const calculateMetrics = (samples) => {
  const finiteSamples = samples.filter((sample) => Number.isFinite(sample) && sample >= 0);
  const sorted = [...finiteSamples].sort((left, right) => left - right);
  const ratioOver = (thresholdMs) =>
    finiteSamples.filter((sample) => sample > thresholdMs).length / Math.max(1, finiteSamples.length);

  return {
    longFrameRatio: ratioOver(longFrameThresholdMs),
    longFrameRatio50: ratioOver(50),
    longFrameRatio66: ratioOver(66),
    maxMs: sorted.length === 0 ? Number.NaN : sorted[sorted.length - 1],
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    sampleCount: finiteSamples.length,
  };
};

const formatValue = (value) =>
  value === undefined || value === null || value === '' ? 'n/a' : String(value);
const formatBool = (value) => value === true ? 'true' : value === false ? 'false' : 'n/a';
const formatOptionalNumber = (value) => Number.isFinite(value) ? String(value) : 'n/a';
const formatDelta = (value) => Number.isFinite(value) ? (value >= 0 ? `+${value}` : String(value)) : 'n/a';
const formatVirtualSize = (value) => {
  if (Array.isArray(value)) return value.map(formatValue).join('x');
  return formatValue(value);
};
const formatByMip = (byMip) => {
  if (byMip === null || typeof byMip !== 'object') return 'n/a';
  const entries = Object.entries(byMip)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mip, count]) => `${mip}:${count}`);
  return entries.length === 0 ? 'empty' : entries.join(',');
};
const formatMipGrids = (mipGrids) => {
  if (!Array.isArray(mipGrids) || mipGrids.length === 0) return 'n/a';

  return mipGrids
    .map((entry) =>
      `mip${entry.mip}=${entry.grid}/${entry.pages}` +
        `(texture=${entry.textureSize},entries=${entry.explicitEntries})`,
    )
    .join(',');
};
const formatSample = (sample) => {
  if (sample?.error !== undefined) return `error=${sample.error}`;

  return (
    `buckets=${formatOptionalNumber(sample?.colorBuckets)} ` +
    `paintedRatio=${formatRatio(sample?.paintedRatio)} ` +
    `hash=${formatValue(sample?.bucketHash)} ` +
    `top=${Array.isArray(sample?.topBuckets) && sample.topBuckets.length > 0
      ? sample.topBuckets.join(',')
      : 'n/a'}`
  );
};
const formatRuntimeStats = (stats) => {
  if (stats?.error !== undefined) return `error=${stats.error}`;

  const cache = stats?.cache ?? {};
  const material = stats?.lastMaterial ?? {};
  const request = material.requestPages ?? {};
  const upload = material.uploadFrame ?? {};
  const resource = material.resource ?? {};
  const resourceCache = resource.cache ?? {};
  const mappings = resource.mappings ?? {};
  const resourceRequests = resource.requests ?? {};
  const resourceUploads = resource.uploads ?? {};
  const source = material.source ?? {};
  const pageTableSize = Array.isArray(material.pageTableSize)
    ? material.pageTableSize.join('x')
    : 'n/a';
  const requestedPages = Array.isArray(request.pages) ? request.pages.length : Number.NaN;

  return (
    `version=${formatOptionalNumber(stats?.version)} ` +
    `frame=${formatOptionalNumber(stats?.frame)} ` +
    `cacheEntries=${formatOptionalNumber(cache.entries)} ` +
    `cacheReady=${formatOptionalNumber(cache.ready)} ` +
    `cacheLoading=${formatOptionalNumber(cache.loading)} ` +
    `cacheError=${formatOptionalNumber(cache.error)} ` +
    `selectedMip=${formatOptionalNumber(material.selectedMip)} ` +
    `pageTableSize=${formatValue(pageTableSize)} ` +
    `requestedPages=${formatOptionalNumber(requestedPages)} ` +
    `requestScheduled=${formatOptionalNumber(request.scheduled)} ` +
    `requestPending=${formatOptionalNumber(request.pending)} ` +
    `requestReady=${formatOptionalNumber(request.ready)} ` +
    `requestResident=${formatOptionalNumber(request.resident)} ` +
    `uploadBytes=${formatOptionalNumber(upload.bytesUploaded)} ` +
    `pageTableUploads=${formatOptionalNumber(upload.pageTableUploads)} ` +
    `physicalAtlasUploads=${formatOptionalNumber(upload.physicalAtlasUploads)} ` +
    `pendingUploads=${formatOptionalNumber(upload.pendingUploadCount)} ` +
    `residentPages=${formatOptionalNumber(resourceCache.residentPages)} ` +
    `cacheCapacity=${formatOptionalNumber(resourceCache.capacity)} ` +
    `cacheByMip=${formatByMip(resourceCache.byMip)} ` +
    `mappedPages=${formatOptionalNumber(mappings.mappedPages)} ` +
    `exactPages=${formatOptionalNumber(mappings.exactPages)} ` +
    `fallbackPages=${formatOptionalNumber(mappings.fallbackPages)} ` +
    `dirtyEntriesPending=${formatOptionalNumber(mappings.dirtyEntriesPending)} ` +
    `sourceRequests=${formatOptionalNumber(resourceRequests.sourceRequests)} ` +
    `pagesRequested=${formatOptionalNumber(resourceRequests.pagesRequested)} ` +
    `pagesLoaded=${formatOptionalNumber(resourceRequests.pagesLoaded)} ` +
    `pendingPages=${formatOptionalNumber(resourceRequests.pendingPages)} ` +
    `readyPages=${formatOptionalNumber(resourceRequests.readyPages)} ` +
    `totalUploadBytes=${formatOptionalNumber(resourceUploads.bytesUploaded)} ` +
    `totalPageTableTexels=${formatOptionalNumber(resourceUploads.pageTableTexelsUploaded)} ` +
    `totalPhysicalAtlasPages=${formatOptionalNumber(resourceUploads.physicalAtlasPagesUploaded)} ` +
    `sourceId=${formatValue(source.id)} ` +
    `manifestUri=${formatValue(source.manifestUri)}`
  );
};
const finiteStat = (value) => Number.isFinite(value) ? value : Number.NaN;
const runtimeSummary = (state) => {
  const stats = state?.runtimeStats;
  const material = stats?.lastMaterial;
  const resource = material?.resource;
  const resourceCache = resource?.cache ?? {};
  const mappings = resource?.mappings ?? {};
  const requests = resource?.requests ?? {};
  const uploads = resource?.uploads ?? {};

  return {
    cacheByMip: resourceCache.byMip ?? null,
    frame: finiteStat(material?.frame),
    mappedPages: finiteStat(mappings.mappedPages),
    pageTableSize: Array.isArray(material?.pageTableSize)
      ? material.pageTableSize.join('x')
      : '',
    pagesLoaded: finiteStat(requests.pagesLoaded),
    pagesRequested: finiteStat(requests.pagesRequested),
    physicalAtlasPagesUploaded: finiteStat(uploads.physicalAtlasPagesUploaded),
    requestedPages: Array.isArray(material?.requestPages?.pages)
      ? material.requestPages.pages.length
      : Number.NaN,
    residentPages: finiteStat(resourceCache.residentPages),
    selectedMip: finiteStat(material?.selectedMip),
    sourceRequests: finiteStat(requests.sourceRequests),
    totalUploadBytes: finiteStat(uploads.bytesUploaded),
  };
};
const numberDelta = (before, after, key) =>
  Number.isFinite(before?.[key]) && Number.isFinite(after?.[key])
    ? after[key] - before[key]
    : Number.NaN;
const sameByMip = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const runtimeDelta = (beforeState, afterState) => {
  const before = runtimeSummary(beforeState);
  const after = runtimeSummary(afterState);
  const selectedMipChanged = Number.isFinite(before.selectedMip) &&
    Number.isFinite(after.selectedMip) &&
    before.selectedMip !== after.selectedMip;
  const pageTableChanged = before.pageTableSize !== '' &&
    after.pageTableSize !== '' &&
    before.pageTableSize !== after.pageTableSize;
  const requestedPageCountChanged = Number.isFinite(before.requestedPages) &&
    Number.isFinite(after.requestedPages) &&
    before.requestedPages !== after.requestedPages;
  const cacheByMipChanged = !sameByMip(before.cacheByMip, after.cacheByMip);
  const streamingDeltas = [
    numberDelta(before, after, 'sourceRequests'),
    numberDelta(before, after, 'pagesRequested'),
    numberDelta(before, after, 'pagesLoaded'),
    numberDelta(before, after, 'totalUploadBytes'),
    numberDelta(before, after, 'physicalAtlasPagesUploaded'),
    numberDelta(before, after, 'residentPages'),
    numberDelta(before, after, 'mappedPages'),
  ];

  return {
    after,
    before,
    cacheByMipChanged,
    dynamicMipObserved: selectedMipChanged ||
      pageTableChanged ||
      requestedPageCountChanged ||
      cacheByMipChanged,
    frameDelta: numberDelta(before, after, 'frame'),
    mappedPagesDelta: numberDelta(before, after, 'mappedPages'),
    pageTableChanged,
    pagesLoadedDelta: numberDelta(before, after, 'pagesLoaded'),
    pagesRequestedDelta: numberDelta(before, after, 'pagesRequested'),
    physicalAtlasPagesUploadedDelta: numberDelta(before, after, 'physicalAtlasPagesUploaded'),
    requestedPageCountChanged,
    residentPagesDelta: numberDelta(before, after, 'residentPages'),
    selectedMipChanged,
    sourceRequestsDelta: numberDelta(before, after, 'sourceRequests'),
    streamingObserved: streamingDeltas.some((delta) => Number.isFinite(delta) && delta > 0),
    totalUploadBytesDelta: numberDelta(before, after, 'totalUploadBytes'),
  };
};
const printVtObservability = (before, after) => {
  const dataset = before?.dataset ?? {};
  const manifest = before?.manifest ?? {};
  const active = before?.active ?? {};
  const capacityExpected = active.capacityExpected ?? {};
  const measurement = before?.measurement ?? {};
  const delta = runtimeDelta(before, after);
  const beforeSample = before?.canvas?.sample;
  const afterSample = after?.canvas?.sample;
  const sampleHashChanged = beforeSample?.bucketHash !== undefined &&
    afterSample?.bucketHash !== undefined &&
    beforeSample.bucketHash !== afterSample.bucketHash;
  const sampleBucketDelta = Number.isFinite(beforeSample?.colorBuckets) &&
    Number.isFinite(afterSample?.colorBuckets)
    ? afterSample.colorBuckets - beforeSample.colorBuckets
    : Number.NaN;

  console.log(
    'virtual-texturing observability ' +
      `scope="${formatValue(measurement.scope)}" ` +
      `runtimeStatsExposed=${formatBool(measurement.runtimeStatsExposed)} ` +
      `realStreamingObserved=${formatBool(measurement.realStreamingObserved)} ` +
      `streamSignal=${formatValue(measurement.streamSignal)}`,
  );
  console.log(
    'virtual-texturing canvas-data ' +
      `probe=${formatValue(dataset.probe)} ` +
      `manifestUri=${formatValue(dataset.manifestUri)} ` +
      `kind=${formatValue(dataset.pageSourceKind)} ` +
      `generator=${formatValue(dataset.generator)} ` +
      `format=${formatValue(dataset.format)} ` +
      `virtualSize=${formatVirtualSize(dataset.virtualSize)} ` +
      `pageSize=${formatOptionalNumber(dataset.pageSize)} ` +
      `physicalSlots=${formatOptionalNumber(dataset.physicalSlots)} ` +
      `activeStatic=mip${formatOptionalNumber(dataset.activeMip)}/` +
        `${formatValue(dataset.activeGrid)}/${formatOptionalNumber(dataset.activePages)}`,
  );
  if (manifest.error !== undefined) {
    console.log(`virtual-texturing manifest error=${manifest.error}`);
  } else {
    console.log(
      'virtual-texturing manifest ' +
        `id=${formatValue(manifest.id)} ` +
        `fetchedUri=${formatValue(manifest.fetchedUri)} ` +
        `kind=${formatValue(manifest.pageSourceKind)} ` +
        `generator=${formatValue(manifest.generator)} ` +
        `format=${formatValue(manifest.format)} ` +
        `virtualSize=${formatVirtualSize(manifest.virtualSize)} ` +
        `pageSize=${formatOptionalNumber(manifest.pageSize)} ` +
        `physicalSlots=${formatOptionalNumber(manifest.physicalSlots)} ` +
        `mipCount=${formatOptionalNumber(manifest.mipCount)} ` +
        `explicitEntries=${Array.isArray(manifest.entries) ? manifest.entries.length : 'n/a'}`,
    );
    console.log(
      'virtual-texturing expected-mips ' +
        formatMipGrids(manifest.expectedMipGrids),
    );
  }
  console.log(
    'virtual-texturing active-static ' +
      `mip=${formatOptionalNumber(active.mip)} ` +
      `grid=${formatValue(active.grid)} ` +
      `pages=${formatOptionalNumber(active.pages)} ` +
      `expectedGrid=${formatValue(active.expectedGrid)} ` +
      `expectedPages=${formatOptionalNumber(active.expectedPages)} ` +
      `gridMatches=${formatBool(active.matchesExpectedGrid)} ` +
      `pagesMatch=${formatBool(active.matchesExpectedPages)}`,
  );
  console.log(
    'virtual-texturing capacity-selected ' +
      `mip=${capacityExpected.mip === undefined || capacityExpected.mip === null
        ? 'n/a'
        : 'mip' + capacityExpected.mip} ` +
      `grid=${formatValue(capacityExpected.grid)} ` +
      `pages=${formatOptionalNumber(capacityExpected.pages)} ` +
      `physicalSlots=${formatOptionalNumber(capacityExpected.physicalSlots)} ` +
      `effectiveSlots=${formatOptionalNumber(capacityExpected.effectiveCapacity)} ` +
      `reservedSlots=${formatOptionalNumber(capacityExpected.reservedSlots)} ` +
      `staticMatches=${formatBool(active.matchesCapacityExpected)}`,
  );
  console.log(
    'virtual-texturing sample-before ' +
      formatSample(beforeSample),
  );
  console.log(
    'virtual-texturing sample-after ' +
      formatSample(afterSample),
  );
  console.log(
    'virtual-texturing sample-change ' +
      `bucketDelta=${formatOptionalNumber(sampleBucketDelta)} ` +
      `hashChanged=${formatBool(sampleHashChanged)}`,
  );
  console.log(
    'virtual-texturing runtime-before ' +
      formatRuntimeStats(before?.runtimeStats),
  );
  console.log(
    'virtual-texturing runtime-after ' +
      formatRuntimeStats(after?.runtimeStats),
  );
  console.log(
    'virtual-texturing runtime-transition ' +
      `beforeMip=mip${formatOptionalNumber(delta.before.selectedMip)} ` +
      `afterMip=mip${formatOptionalNumber(delta.after.selectedMip)} ` +
      `selectedMipChanged=${formatBool(delta.selectedMipChanged)} ` +
      `beforePageTable=${formatValue(delta.before.pageTableSize)} ` +
      `afterPageTable=${formatValue(delta.after.pageTableSize)} ` +
      `pageTableChanged=${formatBool(delta.pageTableChanged)} ` +
      `beforeRequestedPages=${formatOptionalNumber(delta.before.requestedPages)} ` +
      `afterRequestedPages=${formatOptionalNumber(delta.after.requestedPages)} ` +
      `requestedPageCountChanged=${formatBool(delta.requestedPageCountChanged)} ` +
      `streamingObserved=${formatBool(delta.streamingObserved)} ` +
      `dynamicMipObserved=${formatBool(delta.dynamicMipObserved)}`,
  );
  console.log(
    'virtual-texturing runtime-delta ' +
      `frames=${formatDelta(delta.frameDelta)} ` +
      `sourceRequests=${formatDelta(delta.sourceRequestsDelta)} ` +
      `pagesRequested=${formatDelta(delta.pagesRequestedDelta)} ` +
      `pagesLoaded=${formatDelta(delta.pagesLoadedDelta)} ` +
      `uploadBytes=${formatDelta(delta.totalUploadBytesDelta)} ` +
      `physicalAtlasPages=${formatDelta(delta.physicalAtlasPagesUploadedDelta)} ` +
      `residentPages=${formatDelta(delta.residentPagesDelta)} ` +
      `mappedPages=${formatDelta(delta.mappedPagesDelta)} ` +
      `cacheByMipBefore=${formatByMip(delta.before.cacheByMip)} ` +
      `cacheByMipAfter=${formatByMip(delta.after.cacheByMip)} ` +
      `cacheByMipChanged=${formatBool(delta.cacheByMipChanged)}`,
  );
};

const assertRuntimeStatsExposed = (state, label) => {
  if (state?.measurement?.runtimeStatsExposed === true) return;
  throw new Error(
    `VT runtime stats were not exposed on ${label}: ` +
      JSON.stringify(state?.runtimeStats ?? state?.measurement ?? null),
  );
};

const assertRuntimeBehavior = (before, after) => {
  const delta = runtimeDelta(before, after);
  const failures = [];

  if (!Number.isFinite(delta.before.selectedMip)) {
    failures.push('pre-interaction selectedMip was not reported');
  }
  if (!Number.isFinite(delta.after.selectedMip)) {
    failures.push('post-interaction selectedMip was not reported');
  }
  if (!Number.isFinite(delta.frameDelta) || delta.frameDelta <= 0) {
    failures.push(`runtime frame did not advance (${formatDelta(delta.frameDelta)})`);
  }
  if (!delta.streamingObserved) {
    failures.push('no runtime streaming/upload/cache counter increased during the benchmark');
  }
  if (!delta.dynamicMipObserved) {
    failures.push('no dynamic mip/page-table/request/cache change was observed during zoom interaction');
  }

  if (failures.length > 0) {
    throw new Error(`VT runtime behavior checks failed: ${failures.join('; ')}`);
  }
};

const assertMetrics = (metrics) => {
  const failures = [];
  if (metrics.sampleCount === 0) {
    failures.push('sample count was 0');
  }
  if (metrics.p95Ms > thresholds.maxP95Ms) {
    failures.push(`p95 ${formatMs(metrics.p95Ms)}ms > ${thresholds.maxP95Ms}ms`);
  }
  if (metrics.p99Ms > thresholds.maxP99Ms) {
    failures.push(`p99 ${formatMs(metrics.p99Ms)}ms > ${thresholds.maxP99Ms}ms`);
  }
  if (metrics.longFrameRatio > thresholds.maxLongFrameRatio) {
    failures.push(
      `longFrameRatio>${longFrameThresholdMs}ms ` +
        `${formatRatio(metrics.longFrameRatio)} > ${thresholds.maxLongFrameRatio}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`VT smoothness ${requestedGate} thresholds failed: ${failures.join('; ')}`);
  }
};

const main = async () => {
  printGate();

  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-examples-vt-bench-'));
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

  try {
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('Page.addScriptToEvaluateOnNewDocument', {
      source: 'globalThis.__ROYAL_ENABLE_PRIVATE_VT_STATS__ = true;',
    });
    await session.call('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: 720,
      mobile: false,
      width: 1280,
    });

    const navigationStarted = Date.now();
    const routeLoaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: routeUrl });
    await Promise.race([routeLoaded, sleep(5_000)]);
    const navigationMs = Date.now() - navigationStarted;

    const readyStarted = Date.now();
    const readyState = await waitForVtReady(session);
    const readyMs = Date.now() - readyStarted;
    await evaluate(session, installVtProbeExpression);
    const beforeObservability = await evaluate(session, readVtProbeExpression);
    if (gate.requireRuntimeBehavior) {
      assertRuntimeStatsExposed(beforeObservability, 'pre-interaction read');
    }

    await evaluate(session, installRecorderExpression);
    await evaluate(session, waitFramesExpression(12));
    await evaluate(session, 'window.__royalVtSmoothnessRecorder.start()');
    await runInteractionSequence(session, readyState.canvas.rect);
    const recording = await evaluate(session, 'window.__royalVtSmoothnessRecorder.stop()');
    const afterObservability = await evaluate(session, readVtProbeExpression);
    if (gate.requireRuntimeBehavior) {
      assertRuntimeStatsExposed(afterObservability, 'post-interaction read');
    }
    const metrics = calculateMetrics(recording.samples ?? []);

    console.log(
      'virtual-texturing smoothness ' +
        `samples=${metrics.sampleCount} ` +
        `navigationMs=${navigationMs} ` +
        `readyMs=${readyMs} ` +
        `p95Ms=${formatMs(metrics.p95Ms)} ` +
        `p99Ms=${formatMs(metrics.p99Ms)} ` +
        `maxMs=${formatMs(metrics.maxMs)} ` +
        `longFrameRatio>${longFrameThresholdMs}ms=${formatRatio(metrics.longFrameRatio)} ` +
        `longFrameRatio50=${formatRatio(metrics.longFrameRatio50)} ` +
        `longFrameRatio66=${formatRatio(metrics.longFrameRatio66)}`,
    );
    printVtObservability(beforeObservability, afterObservability);

    if (gate.requireRuntimeBehavior) {
      assertRuntimeBehavior(beforeObservability, afterObservability);
    }
    assertMetrics(metrics);

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
