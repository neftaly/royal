import { describe, expect, it } from 'vitest';

import { createWebKitNetworkRecorder } from './webkit-network-report.mjs';

describe('WebKit network recorder', () => {
  it('joins request, response, body, and terminal events without page allocations', () => {
    const recorder = createWebKitNetworkRecorder();
    recorder.handle({
      method: 'Network.requestWillBeSent',
      params: {
        documentURL: 'http://example.test/',
        initiator: { type: 'script' },
        request: { method: 'GET', url: 'http://example.test/wall.avif' },
        requestId: '1',
        timestamp: 10,
        type: 'Fetch',
        walltime: 100,
      },
    }, 1_000);
    recorder.handle({
      method: 'Network.responseReceived',
      params: {
        requestId: '1',
        response: {
          mimeType: 'image/avif',
          source: 'network',
          status: 200,
          statusText: 'OK',
        },
        timestamp: 10.01,
        type: 'Image',
      },
    }, 1_010);
    recorder.handle({
      method: 'Network.dataReceived',
      params: { dataLength: 40, encodedDataLength: 20, requestId: '1' },
    }, 1_020);
    recorder.handle({
      method: 'Network.loadingFinished',
      params: {
        metrics: {
          requestHeaderBytesSent: 10,
          responseBodyBytesReceived: 18,
          responseBodyDecodedSize: 38,
          responseHeaderBytesReceived: 12,
        },
        requestId: '1',
        timestamp: 0,
      },
    }, 1_050);

    expect(recorder.snapshot()).toEqual({
      entries: [expect.objectContaining({
        decodedBodySize: 38,
        duration: expect.closeTo(50),
        durationSource: 'host-observer',
        encodedBodySize: 18,
        mimeType: 'image/avif',
        name: 'http://example.test/wall.avif',
        resourceType: 'Image',
        responseSource: 'network',
        status: 200,
        transferSize: 40,
      })],
      failedCount: 0,
      pendingCount: 0,
    }, 1_000);
  });

  it('records redirects, failures, memory hits, and reset boundaries', () => {
    const recorder = createWebKitNetworkRecorder();
    recorder.handle({
      method: 'Network.requestWillBeSent',
      params: {
        request: { method: 'GET', url: '/old' },
        requestId: '1',
        timestamp: 1,
      },
    }, 2_000);
    recorder.handle({
      method: 'Network.requestWillBeSent',
      params: {
        redirectResponse: { status: 302 },
        request: { method: 'GET', url: '/new' },
        requestId: '1',
        timestamp: 2,
      },
    }, 3_000);
    recorder.handle({
      method: 'Network.loadingFailed',
      params: { canceled: false, errorText: 'boom', requestId: '1', timestamp: 3 },
    }, 4_000);
    recorder.handle({
      method: 'Network.requestServedFromMemoryCache',
      params: {
        requestId: '2',
        resource: { bodySize: 12, type: 'Image', url: '/cached.avif' },
        timestamp: 4,
      },
    });

    const snapshot = recorder.snapshot();
    expect(snapshot.entries).toHaveLength(3);
    expect(snapshot.entries[0]).toMatchObject({ name: '/old', redirected: true, status: 302 });
    expect(snapshot.entries[1]).toMatchObject({ errorText: 'boom', failed: true, name: '/new' });
    expect(snapshot.entries[2]).toMatchObject({
      decodedBodySize: 12,
      name: '/cached.avif',
      responseSource: 'memory-cache',
    });
    expect(snapshot.failedCount).toBe(1);

    recorder.reset();
    expect(recorder.snapshot()).toEqual({ entries: [], failedCount: 0, pendingCount: 0 });
  });
});
