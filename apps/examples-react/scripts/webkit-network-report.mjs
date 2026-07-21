const finite = (value) => Number.isFinite(value) ? value : 0;

const responseFields = (response) => response === undefined ? {} : {
  mimeType: response.mimeType,
  responseSource: response.source,
  status: response.status,
  statusText: response.statusText,
};

export const createWebKitNetworkRecorder = () => {
  const complete = [];
  const pending = new Map();

  const finish = (requestId, timestamp, receivedAtMs, terminal = {}) => {
    const row = pending.get(requestId);
    if (row === undefined) return;
    pending.delete(requestId);
    const metrics = terminal.metrics ?? {};
    const { metrics: _metrics, ...terminalFields } = terminal;
    const decodedBodySize = finite(metrics.responseBodyDecodedSize) || row.dataLength;
    const encodedBodySize = finite(metrics.responseBodyBytesReceived) || row.encodedDataLength;
    const protocolDurationMs = (finite(timestamp) - row.protocolStartTime) * 1_000;
    complete.push({
      ...row,
      ...terminalFields,
      decodedBodySize,
      duration: protocolDurationMs > 0
        ? protocolDurationMs
        : Math.max(0, receivedAtMs - row.observerStartTime),
      durationSource: protocolDurationMs > 0 ? 'protocol' : 'host-observer',
      encodedBodySize,
      transferSize:
        finite(metrics.requestHeaderBytesSent)
        + finite(metrics.requestBodyBytesSent)
        + finite(metrics.responseHeaderBytesReceived)
        + encodedBodySize,
    });
  };

  const handle = (message, receivedAtMs = performance.now()) => {
    const params = message.params ?? {};
    if (message.method === 'Network.requestWillBeSent') {
      if (pending.has(params.requestId)) {
        finish(params.requestId, params.timestamp, receivedAtMs, {
          redirected: true,
          ...responseFields(params.redirectResponse),
        });
      }
      pending.set(params.requestId, {
        dataLength: 0,
        documentURL: params.documentURL,
        encodedDataLength: 0,
        initiatorType: params.initiator?.type ?? 'unknown',
        method: params.request?.method,
        name: params.request?.url,
        observerStartTime: receivedAtMs,
        protocolStartTime: finite(params.timestamp),
        requestId: params.requestId,
        resourceType: params.type,
        wallTime: params.walltime,
      });
      return;
    }
    const row = pending.get(params.requestId);
    if (message.method === 'Network.responseReceived' && row !== undefined) {
      Object.assign(row, responseFields(params.response), {
        responseTime: params.timestamp,
        observerResponseTime: receivedAtMs,
        resourceType: params.type ?? row.resourceType,
      });
      return;
    }
    if (message.method === 'Network.dataReceived' && row !== undefined) {
      row.dataLength += finite(params.dataLength);
      row.encodedDataLength += finite(params.encodedDataLength);
      return;
    }
    if (message.method === 'Network.loadingFinished') {
      finish(params.requestId, params.timestamp, receivedAtMs, { metrics: params.metrics });
      return;
    }
    if (message.method === 'Network.loadingFailed') {
      finish(params.requestId, params.timestamp, receivedAtMs, {
        canceled: params.canceled === true,
        errorText: params.errorText,
        failed: true,
      });
      return;
    }
    if (message.method === 'Network.requestServedFromMemoryCache') {
      const resource = params.resource ?? {};
      complete.push({
        dataLength: finite(resource.bodySize),
        decodedBodySize: finite(resource.bodySize),
        documentURL: params.documentURL,
        duration: 0,
        encodedBodySize: finite(resource.bodySize),
        initiatorType: params.initiator?.type ?? 'unknown',
        name: resource.url,
        observerStartTime: receivedAtMs,
        protocolStartTime: finite(params.timestamp),
        requestId: params.requestId,
        resourceType: resource.type,
        responseSource: 'memory-cache',
        transferSize: 0,
        durationSource: 'memory-cache',
        ...responseFields(resource.response),
      });
    }
  };

  return {
    handle,
    reset: () => {
      complete.length = 0;
      pending.clear();
    },
    snapshot: () => ({
      entries: [...complete].sort(
        (left, right) => left.protocolStartTime - right.protocolStartTime,
      ),
      failedCount: complete.filter((row) => row.failed === true).length,
      pendingCount: pending.size,
    }),
  };
};
