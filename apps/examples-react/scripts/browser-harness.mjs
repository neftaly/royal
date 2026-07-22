import { spawn } from 'node:child_process';
import { once } from 'node:events';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const gltfRendererSnapshotSettled = (snapshot, minImagesLoaded = 0) => {
  const assets = snapshot?.gltfLoadDiagnostics?.assets;
  if (!Array.isArray(assets) || assets.length === 0) return false;
  const assetSettled = assets.some((asset) =>
    (asset.status === 'degraded' || asset.status === 'ready')
    && asset.imagesLoaded >= minImagesLoaded
    && asset.imagesLoaded + asset.imageFailures >= asset.imageRequests);
  if (!assetSettled) return false;
  return ![
    'activePreparationJobs',
    'activeTexturePreparations',
    'deferredGeometryUploads',
    'deferredOrdinaryTextureUploads',
    'pendingOrdinaryTextureStorageRepresentations',
    'pendingSurfaceUploads',
    'queuedPreparationJobs',
    'sourceReservations',
  ].some((field) => (snapshot.resourcePressure?.[field] ?? 0) > 0);
};

const fetchWithTimeout = async (url, timeoutMs, read, fetchImpl) => {
  const controller = new AbortController();
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`Timed out fetching ${url}`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { signal: controller.signal });
        return {
          response,
          value: response.ok ? await read(response) : undefined,
        };
      })(),
      timedOut,
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const waitForResponse = async (url, timeoutMs, read, fetchImpl = fetch) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const { response, value } = await fetchWithTimeout(
        url,
        Math.min(1_000, remainingMs),
        read,
        fetchImpl,
      );
      if (response.ok) return value;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

export const waitForHttp = async (url, timeoutMs, fetchImpl) => {
  await waitForResponse(url, timeoutMs, () => undefined, fetchImpl);
};

export const waitForJson = (url, timeoutMs, fetchImpl) =>
  waitForResponse(url, timeoutMs, (response) => response.json(), fetchImpl);

const sourceIdentityFields = ['buildId', 'builtAt', 'dirty', 'revision'];

/** Requires the server to expose the exact immutable identity emitted by the current build. */
export const waitForExactSourceIdentity = async (
  baseUrl,
  expected,
  timeoutMs,
  fetchImpl,
) => {
  const url = new URL('/__royal-source.json', baseUrl);
  url.searchParams.set('requestedAt', String(Date.now()));
  const actual = await waitForJson(url.href, timeoutMs, fetchImpl);
  for (const field of sourceIdentityFields) {
    if (actual?.[field] !== expected?.[field]) {
      throw new Error(
        `Royal served build ${JSON.stringify(actual?.buildId)} does not match `
        + `the current build ${JSON.stringify(expected?.buildId)} (${field} differs)`,
      );
    }
  }
  return actual;
};

/** Also rejects an occupied port whose newly spawned preview exits behind a live old server. */
export const waitForPreviewBuild = async ({
  baseUrl,
  expected,
  fetchImpl,
  preview,
  timeoutMs,
}) => {
  if (preview === undefined) {
    return waitForExactSourceIdentity(baseUrl, expected, timeoutMs, fetchImpl);
  }
  if (preview.royalReady === undefined) {
    throw new TypeError('Royal managed preview must expose an explicit readiness promise');
  }
  const [identity] = await Promise.all([
    waitForExactSourceIdentity(baseUrl, expected, timeoutMs, fetchImpl),
    preview.royalReady,
  ]);
  return identity;
};

export const replaceWebSocketAuthority = (webSocketUrl, host, port) => {
  const url = new URL(webSocketUrl);
  url.hostname = host;
  url.port = String(port);
  return url.href;
};

export const selectCdpPage = async ({
  closeExtraPages = false,
  debugHost,
  debugPort,
  fetchImpl = fetch,
}) => {
  const pages = await waitForJson(
    `http://${debugHost}:${debugPort}/json/list`,
    10_000,
    fetchImpl,
  );
  const pageTargets = pages.filter((entry) => entry.type === 'page');
  const page = pageTargets[0];
  if (page?.webSocketDebuggerUrl === undefined) {
    throw new Error('Chromium did not expose a debuggable page target');
  }

  if (closeExtraPages) {
    await Promise.all(pageTargets.slice(1).map(async (entry) => {
      if (entry.id === undefined) return;
      const url = `http://${debugHost}:${debugPort}/json/close/${encodeURIComponent(entry.id)}`;
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }
    }));
  }

  return page;
};

export class CdpSession {
  #commandTimeoutMs;
  #handlers = new Map();
  #nextId = 1;
  #pending = new Map();

  constructor(socket, { commandTimeoutMs } = {}) {
    this.socket = socket;
    this.#commandTimeoutMs = commandTimeoutMs;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (pending.timeout !== undefined) clearTimeout(pending.timeout);
        if (message.error === undefined) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
        }
        return;
      }

      for (const handler of this.#handlers.get(message.method) ?? []) {
        handler(message.params);
      }
    });
    socket.addEventListener('close', () => {
      this.#rejectPending(new Error('CDP socket closed'));
    });
    socket.addEventListener('error', () => {
      this.#rejectPending(new Error('CDP socket error'));
    });
  }

  on(method, handler) {
    this.#handlers.set(method, [...(this.#handlers.get(method) ?? []), handler]);
  }

  once(method) {
    return this.wait(method, () => true);
  }

  wait(method, predicate, { timeoutMs } = {}) {
    return new Promise((resolve) => {
      let timeout;
      const remove = (handler) => {
        this.#handlers.set(
          method,
          (this.#handlers.get(method) ?? []).filter((entry) => entry !== handler),
        );
        if (timeout !== undefined) clearTimeout(timeout);
      };
      const handler = (params) => {
        if (!predicate(params)) return;
        remove(handler);
        resolve(params);
      };
      this.on(method, handler);
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          remove(handler);
          resolve(undefined);
        }, timeoutMs);
      }
    });
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = this.#commandTimeoutMs === undefined
        ? undefined
        : setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`${method} timed out after ${this.#commandTimeoutMs}ms`));
        }, this.#commandTimeoutMs);
      this.#pending.set(id, { method, reject, resolve, timeout });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        if (timeout !== undefined) clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.socket.close();
  }

  #rejectPending(error) {
    const pending = this.#pending;
    this.#pending = new Map();
    for (const entry of pending.values()) {
      if (entry.timeout !== undefined) clearTimeout(entry.timeout);
      entry.reject(error);
    }
  }
}

export const openCdpSocket = (url, {
  timeoutMs = 10_000,
  WebSocketImpl = WebSocket,
} = {}) => new Promise((resolve, reject) => {
  const socket = new WebSocketImpl(url);
  const cleanup = () => {
    clearTimeout(timeout);
    socket.removeEventListener('close', onClose);
    socket.removeEventListener('error', onError);
    socket.removeEventListener('open', onOpen);
  };
  const fail = (error) => {
    cleanup();
    try {
      socket.close();
    } catch {
      // A failed connection may not have reached a closable state.
    }
    reject(error);
  };
  const onClose = () => fail(new Error(`CDP socket closed before opening: ${url}`));
  const onError = () => fail(new Error(`CDP socket failed before opening: ${url}`));
  const onOpen = () => {
    cleanup();
    resolve(socket);
  };
  const timeout = setTimeout(
    () => fail(new Error(`Timed out opening CDP socket after ${timeoutMs}ms: ${url}`)),
    timeoutMs,
  );
  socket.addEventListener('close', onClose, { once: true });
  socket.addEventListener('error', onError, { once: true });
  socket.addEventListener('open', onOpen, { once: true });
});

export const connectCdpPage = async ({
  closeExtraPages = false,
  commandTimeoutMs,
  debugHost,
  debugPort,
  rewriteWebSocketAuthority = false,
}) => {
  await waitForJson(`http://${debugHost}:${debugPort}/json/version`, 10_000);
  const page = await selectCdpPage({ closeExtraPages, debugHost, debugPort });

  const webSocketUrl = rewriteWebSocketAuthority
    ? replaceWebSocketAuthority(page.webSocketDebuggerUrl, debugHost, debugPort)
    : page.webSocketDebuggerUrl;
  const socket = await openCdpSocket(webSocketUrl);
  return new CdpSession(socket, { commandTimeoutMs });
};

export const evaluate = async (session, expression, options = {}) => {
  const result = await session.call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
    ...options,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  return result.result.value;
};

const remoteObjectText = (value) => {
  if (value.value !== undefined) {
    if (typeof value.value === 'string') return value.value;
    try {
      return JSON.stringify(value.value);
    } catch {
      return String(value.value);
    }
  }
  return value.unserializableValue ?? value.description ?? value.type;
};

const stackFrames = (stackTrace) => stackTrace?.callFrames?.map((frame) => ({
  columnNumber: frame.columnNumber,
  functionName: frame.functionName,
  lineNumber: frame.lineNumber,
  url: frame.url,
})) ?? [];

/**
 * Retains bounded, structured browser diagnostics for both successful reports
 * and failure artifacts. Register this before Runtime/Log are enabled so the
 * first application message is not lost.
 */
export const captureBrowserDiagnostics = (session, { maxEntries = 500 } = {}) => {
  const entries = [];
  let droppedEntries = 0;

  const append = (entry) => {
    if (entries.length >= maxEntries) {
      entries.shift();
      droppedEntries += 1;
    }
    entries.push(entry);
  };

  session.on('Runtime.consoleAPICalled', (event) => {
    append({
      kind: 'console',
      level: event.type,
      text: event.args.map(remoteObjectText).join(' '),
      timestamp: event.timestamp,
      stack: stackFrames(event.stackTrace),
    });
  });
  session.on('Runtime.exceptionThrown', (event) => {
    const details = event.exceptionDetails ?? {};
    append({
      kind: 'exception',
      level: 'error',
      text: details.exception?.description ?? details.text ?? 'Runtime exception',
      timestamp: event.timestamp,
      url: details.url,
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
      stack: stackFrames(details.stackTrace),
    });
  });
  session.on('Log.entryAdded', ({ entry }) => {
    append({
      kind: 'browser-log',
      level: entry.level,
      source: entry.source,
      text: entry.text,
      timestamp: entry.timestamp,
      url: entry.url,
      lineNumber: entry.lineNumber,
      stack: stackFrames(entry.stackTrace),
    });
  });

  return {
    reset: () => {
      droppedEntries = 0;
      entries.length = 0;
    },
    snapshot: () => ({ droppedEntries, entries: [...entries] }),
  };
};

const defaultTraceCategories = [
  'blink.user_timing',
  'cc',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.screenshot',
  'disabled-by-default-v8.cpu_profiler',
  'gpu',
  'loading',
  'toplevel',
  'v8',
];

/**
 * Starts an opt-in DevTools trace. The returned trace can be opened directly
 * in Chrome DevTools or Perfetto to inspect main-thread and GPU flame graphs.
 */
export const startPerformanceTrace = async (session, options = {}) => {
  const events = [];
  const categories = options.categories ?? defaultTraceCategories;
  let stopPromise;
  session.on('Tracing.dataCollected', ({ value }) => {
    events.push(...(value ?? []));
  });
  await session.call('Tracing.start', {
    categories: categories.join(','),
    transferMode: 'ReportEvents',
  });

  return {
    stop: () => {
      stopPromise ??= (async () => {
        const complete = session.once('Tracing.tracingComplete');
        await session.call('Tracing.end');
        await complete;
        return {
          metadata: { categories },
          traceEvents: events,
        };
      })();
      return stopPromise;
    },
  };
};

/** Retains matching complete process-output lines without depending on stream chunk boundaries. */
export const createBoundedProcessDiagnostics = (pattern, maxEntries = 16) => {
  if (!(pattern instanceof RegExp)) throw new TypeError('Process diagnostic pattern must be a RegExp');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('Process diagnostic capacity must be a positive safe integer');
  }
  let pending = '';
  const entries = [];
  const matches = (line) => {
    pattern.lastIndex = 0;
    return pattern.test(line);
  };
  const append = (line) => {
    if (!matches(line)) return;
    if (entries.length === maxEntries) entries.shift();
    entries.push(line);
  };
  return {
    snapshot: () => {
      const snapshot = [...entries];
      if (pending !== '' && matches(pending)) {
        if (snapshot.length === maxEntries) snapshot.shift();
        snapshot.push(pending);
      }
      return snapshot;
    },
    write: (chunk) => {
      const lines = (pending + String(chunk)).split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) append(line);
    },
  };
};

export const spawnLogged = (command, args, options = {}) => {
  const { onStderr, onStdout, ...spawnOptions } = options;
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions });
  child.stdout.on('data', (chunk) => {
    onStdout?.(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    onStderr?.(chunk);
    process.stderr.write(chunk);
  });
  return child;
};

export const startVitePreview = ({ appRoot, host, port }) => {
  let readyOutput = '';
  let resolveReady;
  let rejectReady;
  const royalReady = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void royalReady.catch(() => undefined);
  const child = spawnLogged('pnpm', [
    'exec',
    'vite',
    'preview',
    '--config',
    'vite.config.ts',
    '--host',
    host,
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: appRoot,
    onStdout: (chunk) => {
      readyOutput = (readyOutput + String(chunk)).slice(-2_000);
      if (/\bLocal:\s+https?:\/\//u.test(readyOutput)) resolveReady();
    },
  });
  child.once('exit', (code, signal) => rejectReady(new Error(
    `Royal Vite preview exited before readiness (code ${String(code)}, signal ${String(signal)})`,
  )));
  Object.defineProperty(child, 'royalReady', { value: royalReady });
  return child;
};

export const stopProcess = async (child) => {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};
