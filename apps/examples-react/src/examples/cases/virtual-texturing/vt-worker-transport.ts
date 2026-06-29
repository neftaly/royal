export const vtWorkerTransportProtocol = 'royal-vt-page-v1' as const;

export type VtWorkerTransportGenerateMessage<Request> = {
  readonly buffer: ArrayBuffer;
  readonly bufferMode: 'transfer';
  readonly op: 'generate';
  readonly protocol: typeof vtWorkerTransportProtocol;
  readonly request: Request;
  readonly requestId: number;
};

export type VtWorkerTransportGeneratedMessage = {
  readonly buffer: ArrayBuffer;
  readonly bufferMode: 'transfer';
  readonly byteLength: number;
  readonly generationMs: number;
  readonly op: 'generated';
  readonly protocol: typeof vtWorkerTransportProtocol;
  readonly requestId: number;
};

export type VtWorkerTransportErrorEvent = {
  readonly message: string;
};

export type VtWorkerTransportWorker<Request> = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<VtWorkerTransportGeneratedMessage>) => void,
  ): void;
  addEventListener(
    type: 'error',
    listener: (event: VtWorkerTransportErrorEvent) => void,
  ): void;
  postMessage(message: VtWorkerTransportGenerateMessage<Request>, transfer: Transferable[]): void;
  terminate(): void;
};

export type VtWorkerTransportReadyPage<Upload> = {
  readonly generationMs: number;
  readonly pixels: Uint8Array;
  readonly upload: Upload;
  readonly workerLatencyMs: number;
};

export type VtWorkerTransportStats = {
  readonly available: boolean;
  readonly buffersAllocated: number;
  readonly buffersReused: number;
  readonly completedPages: number;
  readonly inFlightBytes: number;
  readonly lastError: string;
  readonly lastWorkerGenerationLatencyMs: number;
  readonly maxWorkerGenerationLatencyMs: number;
  readonly queueDepth: number;
  readonly staleDrops: number;
  readonly workerCount: number;
};

type MutableVtWorkerTransportStats = {
  available: boolean;
  buffersAllocated: number;
  buffersReused: number;
  completedPages: number;
  inFlightBytes: number;
  lastError: string;
  lastWorkerGenerationLatencyMs: number;
  maxWorkerGenerationLatencyMs: number;
  queueDepth: number;
  staleDrops: number;
  workerCount: number;
};

export type VtWorkerTransport<Upload> = {
  readonly dispose: () => void;
  readonly dropStale: (isCurrent: (upload: Upload) => boolean) => void;
  readonly release: (page: VtWorkerTransportReadyPage<Upload>) => void;
  readonly request: (upload: Upload) => boolean;
  readonly stats: () => VtWorkerTransportStats;
  readonly takeReady: (
    uploads: readonly Upload[],
    maxCount: number,
    isCurrent: (upload: Upload) => boolean,
  ) => readonly VtWorkerTransportReadyPage<Upload>[];
};

export type VtWorkerTransportOptions<Upload, Request> = {
  readonly createWorker: () => VtWorkerTransportWorker<Request>;
  readonly maxPooledBuffers?: number;
  readonly maxQueuedRequests?: number;
  readonly now?: () => number;
  readonly toRequest: (upload: Upload) => Request;
  readonly uploadByteLength: (upload: Upload) => number;
  readonly uploadKey: (upload: Upload) => string;
  readonly workerCount: number;
};

type PendingPageRequest<Upload> = {
  readonly byteLength: number;
  readonly key: string;
  readonly requestId: number;
  readonly sentAtMs: number;
  readonly upload: Upload;
};

type QueuedPageRequest<Upload> = {
  readonly key: string;
  readonly requestId: number;
  readonly upload: Upload;
};

type WorkerSlot<Request> = {
  busy: boolean;
  readonly worker: VtWorkerTransportWorker<Request>;
};

const defaultMaxQueuedRequests = 96;
const defaultMaxPooledBuffers = 32;

const emptyStats = (
  available: boolean,
  workerCount: number,
  lastError = '',
): MutableVtWorkerTransportStats => ({
  available,
  buffersAllocated: 0,
  buffersReused: 0,
  completedPages: 0,
  inFlightBytes: 0,
  lastError,
  lastWorkerGenerationLatencyMs: 0,
  maxWorkerGenerationLatencyMs: 0,
  queueDepth: 0,
  staleDrops: 0,
  workerCount,
});

const snapshotStats = (stats: MutableVtWorkerTransportStats, queueDepth = stats.queueDepth): VtWorkerTransportStats => ({
  ...stats,
  lastWorkerGenerationLatencyMs: Number(stats.lastWorkerGenerationLatencyMs.toFixed(2)),
  maxWorkerGenerationLatencyMs: Number(stats.maxWorkerGenerationLatencyMs.toFixed(2)),
  queueDepth,
});

const createUnavailableTransport = <Upload>(
  stats: MutableVtWorkerTransportStats,
): VtWorkerTransport<Upload> => ({
  dispose: () => undefined,
  dropStale: () => undefined,
  release: () => undefined,
  request: () => false,
  stats: () => snapshotStats(stats),
  takeReady: () => [],
});

export const createVtWorkerTransport = <Upload, Request>(
  options: VtWorkerTransportOptions<Upload, Request>,
): VtWorkerTransport<Upload> => {
  const requestedWorkerCount = Math.max(0, Math.floor(options.workerCount));
  const stats = emptyStats(false, 0);
  const workers: WorkerSlot<Request>[] = [];

  if (requestedWorkerCount === 0) {
    stats.lastError = 'Worker count is zero';
    return createUnavailableTransport<Upload>(stats);
  }

  try {
    for (let index = 0; index < requestedWorkerCount; index += 1) {
      workers.push({
        busy: false,
        worker: options.createWorker(),
      });
    }
    stats.available = true;
    stats.workerCount = workers.length;
  } catch (error) {
    stats.lastError = error instanceof Error ? error.message : String(error);
    for (const slot of workers) slot.worker.terminate();
    return createUnavailableTransport<Upload>(stats);
  }

  return createAvailableTransport(workers, stats, options);
};

const createAvailableTransport = <Upload, Request>(
  workers: WorkerSlot<Request>[],
  stats: MutableVtWorkerTransportStats,
  options: VtWorkerTransportOptions<Upload, Request>,
): VtWorkerTransport<Upload> => {
  const maxPooledBuffers = options.maxPooledBuffers ?? defaultMaxPooledBuffers;
  const maxQueuedRequests = options.maxQueuedRequests ?? defaultMaxQueuedRequests;
  const now = options.now ?? (() => performance.now());
  const queue: QueuedPageRequest<Upload>[] = [];
  const pending = new Map<number, PendingPageRequest<Upload>>();
  const pendingByKey = new Set<string>();
  const completed = new Map<string, VtWorkerTransportReadyPage<Upload>>();
  const staleRequestIds = new Set<number>();
  const bufferPool: ArrayBuffer[] = [];
  let disposed = false;
  let nextRequestId = 1;

  const updateQueueDepth = (): void => {
    stats.queueDepth = queue.length + pending.size;
  };

  const releaseBuffer = (buffer: ArrayBuffer): void => {
    if (buffer.byteLength === 0) return;
    if (bufferPool.length < maxPooledBuffers) bufferPool.push(buffer);
  };

  const releasePixelsBuffer = (pixels: Uint8Array): void => {
    const buffer = pixels.buffer;
    if (buffer instanceof ArrayBuffer) releaseBuffer(buffer);
  };

  const takeBuffer = (byteLength: number): ArrayBuffer => {
    const pooledIndex = bufferPool.findIndex((buffer) => buffer.byteLength >= byteLength);
    if (pooledIndex >= 0) {
      const [buffer] = bufferPool.splice(pooledIndex, 1);
      if (buffer !== undefined) {
        stats.buffersReused += 1;
        return buffer;
      }
    }

    stats.buffersAllocated += 1;
    return new ArrayBuffer(byteLength);
  };

  const dispatch = (): void => {
    if (disposed) return;
    for (const slot of workers) {
      if (slot.busy || queue.length === 0) continue;
      const queued = queue.shift();
      if (queued === undefined) continue;
      const byteLength = options.uploadByteLength(queued.upload);
      const buffer = takeBuffer(byteLength);
      const message: VtWorkerTransportGenerateMessage<Request> = {
        buffer,
        bufferMode: 'transfer',
        op: 'generate',
        protocol: vtWorkerTransportProtocol,
        request: options.toRequest(queued.upload),
        requestId: queued.requestId,
      };

      slot.busy = true;
      pending.set(queued.requestId, {
        byteLength,
        key: queued.key,
        requestId: queued.requestId,
        sentAtMs: now(),
        upload: queued.upload,
      });
      stats.inFlightBytes += byteLength;
      slot.worker.postMessage(message, [message.buffer]);
    }
    updateQueueDepth();
  };

  const onWorkerMessage = (slot: WorkerSlot<Request>, message: VtWorkerTransportGeneratedMessage): void => {
    if (
      message.protocol !== vtWorkerTransportProtocol ||
      message.op !== 'generated' ||
      message.bufferMode !== 'transfer'
    ) {
      return;
    }

    slot.busy = false;
    if (disposed) return;

    const request = pending.get(message.requestId);
    if (request === undefined) {
      releaseBuffer(message.buffer);
      dispatch();
      return;
    }

    pending.delete(message.requestId);
    pendingByKey.delete(request.key);
    stats.inFlightBytes = Math.max(0, stats.inFlightBytes - request.byteLength);

    const workerLatencyMs = now() - request.sentAtMs;
    stats.lastWorkerGenerationLatencyMs = Number(workerLatencyMs.toFixed(2));
    stats.maxWorkerGenerationLatencyMs = Math.max(
      stats.maxWorkerGenerationLatencyMs,
      stats.lastWorkerGenerationLatencyMs,
    );

    if (staleRequestIds.delete(message.requestId)) {
      stats.staleDrops += 1;
      releaseBuffer(message.buffer);
      dispatch();
      return;
    }

    completed.set(request.key, {
      generationMs: message.generationMs,
      pixels: new Uint8Array(message.buffer, 0, message.byteLength),
      upload: request.upload,
      workerLatencyMs,
    });
    stats.completedPages += 1;
    dispatch();
  };

  for (const slot of workers) {
    slot.worker.addEventListener('message', (event: MessageEvent<VtWorkerTransportGeneratedMessage>) => {
      onWorkerMessage(slot, event.data);
    });
    slot.worker.addEventListener('error', (event) => {
      stats.lastError = event.message;
    });
  }

  return {
    dispose: () => {
      disposed = true;
      for (const slot of workers) slot.worker.terminate();
      queue.length = 0;
      pending.clear();
      pendingByKey.clear();
      completed.clear();
      staleRequestIds.clear();
      bufferPool.length = 0;
      stats.available = false;
      stats.inFlightBytes = 0;
      updateQueueDepth();
    },
    dropStale: (isCurrent) => {
      if (disposed) return;
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const queued = queue[index];
        if (queued === undefined || isCurrent(queued.upload)) continue;
        queue.splice(index, 1);
        pendingByKey.delete(queued.key);
        stats.staleDrops += 1;
      }

      for (const request of pending.values()) {
        if (isCurrent(request.upload)) continue;
        staleRequestIds.add(request.requestId);
      }

      for (const [key, page] of completed) {
        if (isCurrent(page.upload)) continue;
        completed.delete(key);
        releasePixelsBuffer(page.pixels);
        stats.staleDrops += 1;
      }

      updateQueueDepth();
      dispatch();
    },
    release: (page) => {
      if (disposed) return;
      releasePixelsBuffer(page.pixels);
    },
    request: (upload) => {
      if (disposed) return false;
      const key = options.uploadKey(upload);
      if (pendingByKey.has(key) || completed.has(key)) return true;
      if (queue.length + pending.size >= maxQueuedRequests) {
        updateQueueDepth();
        return false;
      }

      queue.push({
        key,
        requestId: nextRequestId,
        upload,
      });
      nextRequestId += 1;
      pendingByKey.add(key);
      updateQueueDepth();
      dispatch();
      return true;
    },
    stats: () => snapshotStats(stats, queue.length + pending.size),
    takeReady: (uploads, maxCount, isCurrent) => {
      if (disposed) return [];
      const ready: VtWorkerTransportReadyPage<Upload>[] = [];
      for (const upload of uploads) {
        if (ready.length >= maxCount) break;
        const key = options.uploadKey(upload);
        const page = completed.get(key);
        if (page === undefined) continue;
        completed.delete(key);
        pendingByKey.delete(key);
        if (!isCurrent(page.upload)) {
          stats.staleDrops += 1;
          releasePixelsBuffer(page.pixels);
          continue;
        }
        ready.push(page);
      }
      return ready;
    },
  };
};
