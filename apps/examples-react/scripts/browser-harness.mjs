import { spawn } from 'node:child_process';
import { once } from 'node:events';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForResponse = async (url, timeoutMs, read, fetchImpl = fetch) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return await read(response);
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

export const replaceWebSocketAuthority = (webSocketUrl, host, port) => {
  const url = new URL(webSocketUrl);
  url.hostname = host;
  url.port = String(port);
  return url.href;
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

export const connectCdpPage = async ({
  commandTimeoutMs,
  debugHost,
  debugPort,
  rewriteWebSocketAuthority = false,
}) => {
  await waitForJson(`http://${debugHost}:${debugPort}/json/version`, 10_000);
  const pages = await waitForJson(`http://${debugHost}:${debugPort}/json/list`, 10_000);
  const page = pages.find((entry) => entry.type === 'page');
  if (page?.webSocketDebuggerUrl === undefined) {
    throw new Error('Chromium did not expose a debuggable page target');
  }

  const webSocketUrl = rewriteWebSocketAuthority
    ? replaceWebSocketAuthority(page.webSocketDebuggerUrl, debugHost, debugPort)
    : page.webSocketDebuggerUrl;
  const socket = new WebSocket(webSocketUrl);
  await once(socket, 'open');
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

export const spawnLogged = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
};

export const startVitePreview = ({ appRoot, host, port }) => spawnLogged('pnpm', [
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
], { cwd: appRoot });

export const stopProcess = async (child) => {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};
