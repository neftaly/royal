import { describe, expect, it } from 'vitest';

import {
  CdpSession,
  captureBrowserDiagnostics,
  createBoundedProcessDiagnostics,
  replaceWebSocketAuthority,
  selectCdpPage,
  startPerformanceTrace,
  waitForHttp,
  waitForJson,
} from './browser-harness.mjs';

const fakeSession = () => {
  const handlers = new Map();
  const calls = [];
  return {
    calls,
    emit(method, params) {
      for (const handler of handlers.get(method) ?? []) handler(params);
    },
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) ?? []), handler]);
    },
    once(method) {
      return new Promise((resolve) => {
        const handler = (params) => {
          handlers.set(method, (handlers.get(method) ?? []).filter((entry) => entry !== handler));
          resolve(params);
        };
        this.on(method, handler);
      });
    },
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'Tracing.end') queueMicrotask(() => this.emit('Tracing.tracingComplete', {}));
      return {};
    },
  };
};

describe('browser harness', () => {
  it('matches diagnostics across chunks and retains bounded complete lines', () => {
    const diagnostics = createBoundedProcessDiagnostics(/GL_INVALID_OPERATION/u, 2);
    diagnostics.write('benign warning\nGL_INVALID_');
    diagnostics.write('OPERATION first\nGL_INVALID_OPERATION second\n');
    diagnostics.write('GL_INVALID_OPERATION third');
    expect(diagnostics.snapshot()).toEqual([
      'GL_INVALID_OPERATION second',
      'GL_INVALID_OPERATION third',
    ]);
  });

  it('validates process diagnostic configuration', () => {
    expect(() => createBoundedProcessDiagnostics('error'))
      .toThrow('pattern must be a RegExp');
    expect(() => createBoundedProcessDiagnostics(/error/u, 0))
      .toThrow('capacity must be a positive safe integer');
  });

  it('waits for the first CDP event matching a lifecycle predicate', async () => {
    const socket = new EventTarget();
    socket.send = () => undefined;
    const session = new CdpSession(socket);
    const loaded = session.wait('Page.lifecycleEvent', (event) => event.name === 'DOMContentLoaded');
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ method: 'Page.lifecycleEvent', params: { name: 'init' } }),
    }));
    let settled = false;
    void loaded.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ method: 'Page.lifecycleEvent', params: { name: 'DOMContentLoaded' } }),
    }));
    await expect(loaded).resolves.toEqual({ name: 'DOMContentLoaded' });
  });

  it('removes a CDP event wait after its timeout', async () => {
    const socket = new EventTarget();
    socket.send = () => undefined;
    const session = new CdpSession(socket);
    const loaded = session.wait(
      'Page.lifecycleEvent',
      (event) => event.name === 'DOMContentLoaded',
      { timeoutMs: 0 },
    );
    await expect(loaded).resolves.toBeUndefined();
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ method: 'Page.lifecycleEvent', params: { name: 'DOMContentLoaded' } }),
    }));
  });

  it('rewrites a remote CDP authority without changing the target path', () => {
    expect(replaceWebSocketAuthority(
      'ws://127.0.0.1:9222/devtools/page/abc?token=123',
      'quest.local',
      4774,
    )).toBe('ws://quest.local:4774/devtools/page/abc?token=123');
  });

  it('retries HTTP readiness checks and parses the successful JSON response', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('not ready');
      return {
        json: async () => ({ ready: true }),
        ok: true,
        status: 200,
      };
    };

    await expect(waitForJson('http://example.test/status', 1_000, fetchImpl))
      .resolves.toEqual({ ready: true });
    expect(attempts).toBe(2);
  });

  it('reports the final unsuccessful HTTP status', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });

    await expect(waitForHttp('http://example.test/status', 1, fetchImpl))
      .rejects.toThrow('http://example.test/status returned 503');
  });

  it('retains one CDP page and closes surplus page targets only', async () => {
    const requestedUrls = [];
    const fetchImpl = async (url) => {
      requestedUrls.push(url);
      if (url.endsWith('/json/list')) {
        return {
          json: async () => [
            { id: 'kept', type: 'page', webSocketDebuggerUrl: 'ws://example.test/kept' },
            { id: 'old tab/2', type: 'page', webSocketDebuggerUrl: 'ws://example.test/old' },
            { id: 'browser-ui', type: 'other' },
          ],
          ok: true,
          status: 200,
        };
      }
      return { ok: true, status: 200 };
    };

    await expect(selectCdpPage({
      closeExtraPages: true,
      debugHost: 'example.test',
      debugPort: 9222,
      fetchImpl,
    })).resolves.toMatchObject({ id: 'kept' });
    expect(requestedUrls).toEqual([
      'http://example.test:9222/json/list',
      'http://example.test:9222/json/close/old%20tab%2F2',
    ]);
  });

  it('captures structured console, exception, and browser log diagnostics', () => {
    const session = fakeSession();
    const diagnostics = captureBrowserDiagnostics(session, { maxEntries: 3 });
    session.emit('Runtime.consoleAPICalled', {
      args: [{ type: 'string', value: 'ready' }, { type: 'number', value: 2 }],
      timestamp: 1,
      type: 'log',
    });
    session.emit('Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught', url: 'example.test/app.js' },
      timestamp: 2,
    });
    session.emit('Log.entryAdded', {
      entry: { level: 'warning', source: 'security', text: 'blocked', timestamp: 3 },
    });
    session.emit('Runtime.consoleAPICalled', {
      args: [{ description: 'last message', type: 'object' }],
      timestamp: 4,
      type: 'debug',
    });

    expect(diagnostics.snapshot()).toEqual({
      droppedEntries: 1,
      entries: [
        expect.objectContaining({ kind: 'exception', text: 'Uncaught' }),
        expect.objectContaining({ kind: 'browser-log', text: 'blocked' }),
        expect.objectContaining({ kind: 'console', text: 'last message' }),
      ],
    });
    diagnostics.reset();
    expect(diagnostics.snapshot()).toEqual({ droppedEntries: 0, entries: [] });
  });

  it('collects a DevTools trace until tracing completes', async () => {
    const session = fakeSession();
    const trace = await startPerformanceTrace(session, { categories: ['devtools.timeline'] });
    session.emit('Tracing.dataCollected', { value: [{ name: 'RunTask' }] });

    const firstStop = trace.stop();
    const secondStop = trace.stop();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).resolves.toEqual({
      metadata: { categories: ['devtools.timeline'] },
      traceEvents: [{ name: 'RunTask' }],
    });
    expect(session.calls).toEqual([
      {
        method: 'Tracing.start',
        params: { categories: 'devtools.timeline', transferMode: 'ReportEvents' },
      },
      { method: 'Tracing.end', params: undefined },
    ]);
  });

  it('retains a failed trace-stop result instead of issuing duplicate end commands', async () => {
    const session = fakeSession();
    session.call = async (method, params) => {
      session.calls.push({ method, params });
      if (method === 'Tracing.end') throw new Error('trace transport closed');
      return {};
    };
    const trace = await startPerformanceTrace(session);

    await expect(trace.stop()).rejects.toThrow('trace transport closed');
    await expect(trace.stop()).rejects.toThrow('trace transport closed');
    expect(session.calls.filter(({ method }) => method === 'Tracing.end')).toHaveLength(1);
  });
});
