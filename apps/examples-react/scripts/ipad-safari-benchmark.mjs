#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

const optionValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg === undefined ? fallback : arg.slice(prefix.length);
};

const numericOption = (name, fallback) => {
  const value = Number.parseInt(optionValue(name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
};

const proxyPort = numericOption('proxy-port', Number.parseInt(process.env.IPAD_WEBKIT_PORT ?? '9323', 10));
const route = optionValue('route', process.env.IPAD_BENCH_ROUTE ?? '/gltf-instancing');
const frames = numericOption('frames', Number.parseInt(process.env.IPAD_BENCH_FRAMES ?? '120', 10));
const warmup = numericOption('warmup', Number.parseInt(process.env.IPAD_BENCH_WARMUP ?? '20', 10));
const timeoutMs = numericOption('timeout-ms', Number.parseInt(process.env.IPAD_BENCH_TIMEOUT_MS ?? '30000', 10));
const coldCache = optionValue(
  'cold-cache',
  process.env.IPAD_BENCH_COLD_CACHE ?? 'false',
) === 'true';
const cameraDrag = optionValue(
  'camera-drag',
  process.env.IPAD_BENCH_CAMERA_DRAG ?? 'false',
) === 'true';
const waitForPhysicalOrientation = optionValue(
  'wait-for-orientation',
  process.env.IPAD_BENCH_WAIT_FOR_ORIENTATION ?? 'false',
) === 'true';
const orientationTimeoutMs = numericOption(
  'orientation-timeout-ms',
  Number.parseInt(process.env.IPAD_BENCH_ORIENTATION_TIMEOUT_MS ?? '120000', 10),
);
const host = optionValue('host', process.env.IPAD_BENCH_HOST);
const appPort = numericOption('app-port', Number.parseInt(process.env.IPAD_BENCH_APP_PORT ?? '4673', 10));
const outputDir = path.resolve(
  repoRoot,
  optionValue('output-dir', process.env.IPAD_BENCH_OUTPUT_DIR ?? 'research/examples-benchmarks/ipad-safari'),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastBenchmarkProgress;

const jsonGet = (url) =>
  new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });

const websocketConnect = (wsUrl) => {
  const url = new URL(wsUrl);
  const key = randomBytes(16).toString('base64');
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 80) });
  let buffer = Buffer.alloc(0);
  const waiters = [];
  const events = [];
  const listeners = new Set();
  let opened = false;

  const sendFrame = (text) => {
    const payload = Buffer.from(text);
    const header = [];
    header.push(0x81);
    if (payload.length < 126) {
      header.push(0x80 | payload.length);
    } else if (payload.length < 65536) {
      header.push(0x80 | 126, payload.length >> 8, payload.length & 0xff);
    } else {
      throw new Error('WebSocket payload too large');
    }

    const mask = randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4];
    }
    socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
  };

  const resolveWaiters = (message) => {
    for (const listener of listeners) listener(message);
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (!waiter.match(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
      return;
    }
    events.push(message);
  };

  const handleText = (text) => {
    resolveWaiters(JSON.parse(text));
  };

  const parseFrames = () => {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        const high = buffer.readUInt32BE(offset);
        const low = buffer.readUInt32BE(offset + 4);
        if (high !== 0) throw new Error('WebSocket frame too large');
        length = low;
        offset += 8;
      }
      const masked = (second & 0x80) !== 0;
      const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;

      let payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (mask !== undefined) {
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
          unmasked[index] = payload[index] ^ mask[index % 4];
        }
        payload = unmasked;
      }
      if (opcode === 0x1) handleText(payload.toString('utf8'));
      if (opcode === 0x8) socket.end();
    }
  };

  const openedPromise = new Promise((resolve, reject) => {
    socket.on('connect', () => {
      const requestPath = `${url.pathname}${url.search}`;
      socket.write([
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!opened) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          reject(new Error(header));
          return;
        }
        buffer = buffer.subarray(headerEnd + 4);
        opened = true;
        resolve();
      }
      parseFrames();
    });
  });

  const waitFor = (match, waitMs = timeoutMs) => {
    const existingIndex = events.findIndex(match);
    if (existingIndex >= 0) {
      const [event] = events.splice(existingIndex, 1);
      return Promise.resolve(event);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for WebKit response after ${waitMs}ms`));
      }, waitMs);
      waiters.push({ match, resolve, timeout });
    });
  };

  return {
    close: () => socket.end(),
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    opened: openedPromise,
    send: (message) => sendFrame(JSON.stringify(message)),
    waitFor,
  };
};

const captureWebKitDiagnostics = (client, targetId, { maxEntries = 500 } = {}) => {
  const entries = [];
  let droppedEntries = 0;
  const append = (entry) => {
    if (entries.length >= maxEntries) {
      entries.shift();
      droppedEntries += 1;
    }
    entries.push(entry);
  };
  const unsubscribe = client.onMessage((event) => {
    if (
      event.method !== 'Target.dispatchMessageFromTarget' &&
      event.method !== 'Target.receivedMessageFromTarget'
    ) return;
    if (event.params?.targetId !== targetId || typeof event.params?.message !== 'string') return;
    const message = JSON.parse(event.params.message);
    if (message.method === 'Console.messageAdded') {
      const value = message.params?.message ?? {};
      append({
        kind: 'console',
        level: value.level ?? 'log',
        text: value.text ?? '',
        timestamp: value.timestamp,
        url: value.url,
        lineNumber: value.line,
        columnNumber: value.column,
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails ?? {};
      append({
        kind: 'exception',
        level: 'error',
        text: details.exception?.description ?? details.text ?? 'Runtime exception',
        timestamp: message.params?.timestamp,
        url: details.url,
        lineNumber: details.lineNumber,
        columnNumber: details.columnNumber,
      });
    }
  });
  return {
    close: unsubscribe,
    reset: () => {
      droppedEntries = 0;
      entries.length = 0;
    },
    snapshot: () => ({ droppedEntries, entries: [...entries] }),
  };
};

let currentRunToken = '';

const benchmarkUrl = () => {
  if (host === undefined || host.trim() === '') {
    throw new Error('Set IPAD_BENCH_HOST=<laptop-lan-ip> or pass --host=<laptop-lan-ip>.');
  }
  currentRunToken = String(Date.now());
  const url = new URL(`http://${host}:${appPort}${route.startsWith('/') ? route : `/${route}`}`);
  url.searchParams.set('bench', 'auto');
  if (cameraDrag) url.searchParams.set('cameraDrag', '1');
  url.searchParams.set('frames', String(frames));
  url.searchParams.set('warmup', String(warmup));
  url.searchParams.set('timeoutMs', String(timeoutMs));
  url.searchParams.set('run', currentRunToken);
  return url.toString();
};

const findPage = async () => {
  const pages = await jsonGet(`http://127.0.0.1:${proxyPort}/json`);
  if (!Array.isArray(pages)) throw new Error('ios_webkit_debug_proxy did not return a page list');
  const page = pages.find((candidate) => typeof candidate.webSocketDebuggerUrl === 'string');
  if (page === undefined) {
    throw new Error('No inspectable iPad Safari page found. Open Safari with Web Inspector enabled.');
  }
  return page;
};

const sendToTarget = async (client, targetId, message, waitMs = timeoutMs) => {
  const id = sendToTarget.nextId++;
  const innerId = id;
  client.send({
    id,
    method: 'Target.sendMessageToTarget',
    params: {
      message: JSON.stringify({ ...message, id: innerId }),
      targetId,
    },
  });
  const envelope = await client.waitFor((event) => {
    if (
      event.method !== 'Target.dispatchMessageFromTarget' &&
      event.method !== 'Target.receivedMessageFromTarget'
    ) {
      return false;
    }
    if (event.params?.targetId !== targetId || typeof event.params?.message !== 'string') return false;
    return JSON.parse(event.params.message).id === innerId;
  }, waitMs);
  return JSON.parse(envelope.params.message);
};
sendToTarget.nextId = 1;

const targetCommand = async (client, targetId, method, params = {}) => {
  const response = await sendToTarget(client, targetId, { method, params });
  if (response.error !== undefined) throw new Error(JSON.stringify(response.error));
  return response.result;
};

const evaluate = async (client, targetId, expression, waitMs = timeoutMs) => {
  const response = await sendToTarget(client, targetId, {
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true },
  }, waitMs);
  if (response.error !== undefined) throw new Error(JSON.stringify(response.error));
  if (response.result?.wasThrown === true) throw new Error(JSON.stringify(response.result.result));
  return response.result?.result?.value;
};

const waitForNavigationCommit = async (client, targetId) => {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  let lastUrl;
  let lastTransportError;
  while (Date.now() < deadline) {
    try {
      lastUrl = await evaluate(client, targetId, 'location.href', 5_000);
      lastTransportError = undefined;
      if (
        typeof lastUrl === 'string'
        && new URL(lastUrl).searchParams.get('run') === currentRunToken
      ) return;
    } catch (error) {
      lastTransportError = error;
    }
    await sleep(250);
  }
  const transport = lastTransportError instanceof Error
    ? `; transport=${lastTransportError.message}`
    : '';
  throw new Error(`iPad navigation did not commit; lastUrl=${String(lastUrl)}${transport}`);
};

const waitForReport = async (client, targetId) => {
  const deadline = Date.now() + timeoutMs + frames * 1000;
  let lastTransportError;
  while (Date.now() < deadline) {
    let value;
    try {
      value = await evaluate(
        client,
        targetId,
        [
          'JSON.stringify((() => {',
          'if (globalThis.__royalBrowserBenchmarkError !== undefined)',
          'return { error: globalThis.__royalBrowserBenchmarkError };',
          'if (globalThis.__royalBrowserBenchmarkReport !== undefined)',
          'return { report: globalThis.__royalBrowserBenchmarkReport };',
          'return { progress: {',
          'elapsedMs: performance.now(),',
          'readyState: document.readyState,',
          'renderer: globalThis.__royalExamplesRendererBenchmarkSnapshot?.() ?? null,',
          'resourceCount: performance.getEntriesByType("resource").length,',
          'url: location.href',
          '} };',
          '})())',
        ].join(' '),
        5_000,
      );
      lastTransportError = undefined;
    } catch (error) {
      // Mobile WebKit can briefly stop servicing inspector commands while a
      // navigation commits or Safari swaps processes. The run already has a
      // hard deadline, so a single missed poll is not evidence of failure.
      lastTransportError = error;
      await sleep(500);
      continue;
    }
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      if (typeof parsed.error === 'string') throw new Error(parsed.error);
      if (parsed.progress !== undefined) lastBenchmarkProgress = parsed.progress;
      if (parsed.report !== undefined) {
        const reportUrl = new URL(parsed.report.url);
        if (
          reportUrl.searchParams.get('run') === currentRunToken &&
          parsed.report.frameStats?.requestedSampleCount === frames
        ) {
          return parsed.report;
        }
      }
    }
    await sleep(500);
  }
  const detail = lastTransportError instanceof Error ? `: ${lastTransportError.message}` : '';
  throw new Error(`Timed out waiting for iPad benchmark report${detail}`);
};

const physicalOrientationSample = async (client, targetId) => {
  const value = await evaluate(
    client,
    targetId,
    `JSON.stringify((() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect();
      const renderer = globalThis.__royalExamplesRendererBenchmarkSnapshot?.() ?? null;
      return {
        canvas: {
          cssHeight: rect?.height ?? null,
          cssWidth: rect?.width ?? null,
          height: canvas?.height ?? null,
          width: canvas?.width ?? null
        },
        dpr: globalThis.devicePixelRatio,
        renderer,
        viewport: { height: globalThis.innerHeight, width: globalThis.innerWidth }
      };
    })())`,
    5_000,
  );
  if (typeof value !== 'string') throw new Error('iPad orientation sample was unavailable');
  return JSON.parse(value);
};

const physicalOrientationKind = (sample) =>
  sample.viewport.width > sample.viewport.height ? 'landscape' : 'portrait';

const canvasTracksPhysicalViewport = (sample) => {
  const { canvas, dpr } = sample;
  if (
    !Number.isFinite(canvas.cssWidth)
    || !Number.isFinite(canvas.cssHeight)
    || !Number.isFinite(canvas.width)
    || !Number.isFinite(canvas.height)
    || !Number.isFinite(dpr)
  ) return false;
  return Math.abs(canvas.width - Math.ceil(canvas.cssWidth * dpr)) <= 1
    && Math.abs(canvas.height - Math.ceil(canvas.cssHeight * dpr)) <= 1;
};

const waitForPhysicalOrientationChange = async (client, targetId) => {
  const before = await physicalOrientationSample(client, targetId);
  const beforeKind = physicalOrientationKind(before);
  const beforeFrame = before.renderer?.frame;
  if (!Number.isFinite(beforeFrame)) {
    throw new Error('Renderer frame evidence was unavailable before physical iPad rotation');
  }
  const deadline = Date.now() + orientationTimeoutMs;
  console.log(`Waiting up to ${orientationTimeoutMs}ms for the iPad to rotate from ${beforeKind}...`);

  let lastTransportError;
  let changed;
  while (Date.now() < deadline) {
    try {
      const sample = await physicalOrientationSample(client, targetId);
      lastTransportError = undefined;
      if (physicalOrientationKind(sample) !== beforeKind) {
        changed = sample;
        break;
      }
    } catch (error) {
      lastTransportError = error;
    }
    await sleep(250);
  }
  if (changed === undefined) {
    const detail = lastTransportError instanceof Error ? `: ${lastTransportError.message}` : '';
    throw new Error(`Timed out waiting for physical iPad orientation change${detail}`);
  }

  const settleDeadline = Date.now() + Math.min(orientationTimeoutMs, 30_000);
  while (Date.now() < settleDeadline) {
    try {
      await evaluate(client, targetId, 'globalThis.__royalExamplesRenderNow?.(); "invalidated";', 5_000);
      const sample = await physicalOrientationSample(client, targetId);
      const renderer = sample.renderer;
      lastTransportError = undefined;
      if (
        canvasTracksPhysicalViewport(sample)
        && renderer?.lifecycle?.state === 'available'
        && renderer.frame > beforeFrame
        && renderer.virtualTexturing?.pendingPages === 0
      ) {
        return {
          after: sample,
          before,
          changed: true,
          settled: true,
        };
      }
      changed = sample;
    } catch (error) {
      lastTransportError = error;
    }
    await sleep(250);
  }
  const detail = lastTransportError instanceof Error ? `; transport=${lastTransportError.message}` : '';
  throw new Error(
    `Physical iPad orientation changed but Royal did not reconverge: ${JSON.stringify(changed)}${detail}`,
  );
};

const safeSegment = (value) =>
  String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'unknown';

const incompleteRendererEvidence = (report) => {
  const failures = [];
  if (report.ready !== true) failures.push('route readiness did not complete');
  if (report.warmupComplete !== true) failures.push('frame warmup did not complete');
  if (report.frameStats?.complete !== true) failures.push('frame sampling did not complete');
  if (report.device?.webgl === null || typeof report.device?.webgl !== 'object') {
    failures.push('final WebGL device evidence is missing');
  }
  if (report.renderer?.after === null || typeof report.renderer?.after !== 'object') {
    failures.push('final renderer snapshot is missing');
  }
  if (cameraDrag) {
    if (report.options?.cameraDrag !== true) {
      failures.push('camera-drag sampling was not activated by the page');
    }
    const rendererFrames = report.renderer?.delta?.frame;
    const sampledFrames = report.frameStats?.sampleCount;
    if (
      !Number.isFinite(rendererFrames)
      || !Number.isFinite(sampledFrames)
      || rendererFrames < sampledFrames
    ) {
      failures.push('camera-drag samples did not each produce a Royal renderer frame');
    }
  }
  return failures;
};

const isExpectedDevTransportDiagnostic = (entry, entries) => {
  if (
    entry.kind !== 'console'
    || entry.level !== 'error'
    || !/^WebSocket connection to 'ws:\/\/[^/]+\/\?token=[^']+' failed: WebSocket is closed due to suspension\.$/u
      .test(entry.text)
  ) return false;
  return entries.some((candidate) =>
    candidate.kind === 'console'
    && candidate.level === 'debug'
    && candidate.text === '[vite] connecting...'
    && /\/@vite\/client(?:\?|$)/u.test(candidate.url)
    && candidate.timestamp >= entry.timestamp
    && candidate.timestamp - entry.timestamp < 2
  );
};

const run = async () => {
  const page = await findPage();
  const client = websocketConnect(page.webSocketDebuggerUrl);
  await client.opened;
  const targetEvent = await client.waitFor((event) => event.method === 'Target.targetCreated');
  const targetId = targetEvent.params?.targetInfo?.targetId;
  if (typeof targetId !== 'string') throw new Error('WebKit target id was missing');
  const browserDiagnostics = captureWebKitDiagnostics(client, targetId);
  let report;
  let physicalOrientation;

  try {
    await targetCommand(client, targetId, 'Console.enable');
    await targetCommand(client, targetId, 'Network.enable');
    await targetCommand(client, targetId, 'Runtime.enable');
    await targetCommand(client, targetId, 'Network.setResourceCachingDisabled', {
      disabled: coldCache,
    });
    const url = benchmarkUrl();
    console.log(`Navigating iPad Safari to ${url}`);
    await evaluate(
      client,
      targetId,
      [
        'delete globalThis.__royalBrowserBenchmarkError;',
        'delete globalThis.__royalBrowserBenchmarkReport;',
        // Prevent repeated physical-device runs from retaining prior WebGL
        // documents in Safari's back-forward cache on memory-constrained iPads.
        'globalThis.addEventListener("unload", () => undefined, { once: true });',
        '"cleared";',
      ].join(' '),
      5_000,
    );
    browserDiagnostics.reset();
    await targetCommand(client, targetId, 'Page.navigate', { url });
    await waitForNavigationCommit(client, targetId);
    report = await waitForReport(client, targetId);
    const evidenceFailures = incompleteRendererEvidence(report);
    if (evidenceFailures.length > 0) {
      const pageState = await evaluate(
        client,
        targetId,
        `JSON.stringify({
          benchmarkError: globalThis.__royalBrowserBenchmarkError ?? null,
          bodyText: document.body?.innerText?.slice(0, 1200) ?? null,
          loadError: document.querySelector('.example-load-error')?.textContent ?? null
        })`,
        5_000,
      );
      throw new Error(
        `iPad benchmark evidence incomplete: ${evidenceFailures.join('; ')}; page=${String(pageState)}`,
      );
    }
    if (waitForPhysicalOrientation) {
      physicalOrientation = await waitForPhysicalOrientationChange(client, targetId);
    }
    const diagnosticSnapshot = browserDiagnostics.snapshot();
    const browserErrors = diagnosticSnapshot.entries.filter((entry) =>
      (entry.kind === 'exception' || entry.level === 'error')
      && !isExpectedDevTransportDiagnostic(entry, diagnosticSnapshot.entries)
    );
    if (browserErrors.length > 0) {
      throw new Error(
        `iPad benchmark browser errors: ${browserErrors.map((entry) => entry.text).join('; ')}`,
      );
    }
    const generatedAt = typeof report.generatedAt === 'string' ? report.generatedAt : new Date().toISOString();
    const filename = `${generatedAt.replace(/[:.]/gu, '-')}-${safeSegment(report.example?.id)}.json`;
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, filename);
    await writeFile(outputPath, `${JSON.stringify({
      browserDiagnostics: diagnosticSnapshot,
      cameraDrag,
      coldCache,
      physicalOrientation,
      receivedAt: new Date().toISOString(),
      report,
    }, null, 2)}\n`);
    console.log(`Wrote ${outputPath}`);
    console.log(`mode=${cameraDrag ? 'camera-drag' : 'idle'} p95=${report.frameStats?.p95Ms?.toFixed?.(1) ?? 'n/a'}ms frames=${report.frameStats?.sampleCount ?? 0}/${report.frameStats?.requestedSampleCount ?? 0}`);
  } catch (error) {
    let page;
    try {
      page = await evaluate(
        client,
        targetId,
        `JSON.stringify({
          benchmarkError: globalThis.__royalBrowserBenchmarkError ?? null,
          bodyText: document.body?.innerText?.slice(0, 4000) ?? null,
          loadError: document.querySelector('.example-load-error')?.textContent ?? null,
          url: location.href
        })`,
        5_000,
      );
    } catch (pageError) {
      page = JSON.stringify({
        captureError: pageError instanceof Error ? pageError.message : String(pageError),
      });
    }
    const generatedAt = new Date().toISOString();
    const filename = `${generatedAt.replace(/[:.]/gu, '-')}-${safeSegment(route)}.failure.json`;
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, filename);
    let parsedPage;
    try {
      parsedPage = typeof page === 'string' ? JSON.parse(page) : page;
    } catch {
      parsedPage = { raw: page };
    }
    await writeFile(outputPath, `${JSON.stringify({
      browserDiagnostics: browserDiagnostics.snapshot(),
      cameraDrag,
      coldCache,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      generatedAt,
      page: parsedPage,
      progress: lastBenchmarkProgress,
      report,
      route,
    }, null, 2)}\n`);
    console.error(`Wrote ${outputPath}`);
    throw error;
  } finally {
    browserDiagnostics.close();
    client.close();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
