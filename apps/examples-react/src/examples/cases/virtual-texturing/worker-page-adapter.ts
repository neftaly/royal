import type { VirtualTexturePhysicalAtlasPageUpload } from '../../../../../../packages/renderer-webgl/src/virtual-texturing';
import {
  createTerrainPhysicalPagePixels,
  type TerrainPageGenerationRequest,
} from './terrain-page-generator';
import type { TerrainPageWorkerGenerateMessage, TerrainPageWorkerGeneratedMessage } from './terrain-page-worker';

export type PreparedTerrainPageUpload = {
  readonly allocationMs: number;
  readonly fillMs: number;
  readonly generationMs: number;
  readonly pixels: Uint8Array;
  readonly upload: VirtualTexturePhysicalAtlasPageUpload;
  readonly workerLatencyMs: number;
};

export type WorkerPageGenerationMetrics = {
  readonly available: boolean;
  readonly buffersAllocated: number;
  readonly buffersReused: number;
  readonly completedPages: number;
  readonly fallbackPages: number;
  readonly inFlightBytes: number;
  readonly lastError: string;
  readonly lastWorkerGenerationLatencyMs: number;
  readonly maxWorkerGenerationLatencyMs: number;
  readonly queueDepth: number;
  readonly staleDrops: number;
  readonly workerCount: number;
};

type MutableWorkerPageGenerationMetrics = {
  available: boolean;
  buffersAllocated: number;
  buffersReused: number;
  completedPages: number;
  fallbackPages: number;
  inFlightBytes: number;
  lastError: string;
  lastWorkerGenerationLatencyMs: number;
  maxWorkerGenerationLatencyMs: number;
  queueDepth: number;
  staleDrops: number;
  workerCount: number;
};

export type WorkerBackedTerrainPageGenerator = {
  readonly dispose: () => void;
  readonly dropStale: (isCurrent: (upload: VirtualTexturePhysicalAtlasPageUpload) => boolean) => void;
  readonly metrics: () => WorkerPageGenerationMetrics;
  readonly prepareSync: (upload: VirtualTexturePhysicalAtlasPageUpload) => PreparedTerrainPageUpload;
  readonly release: (page: PreparedTerrainPageUpload) => void;
  readonly request: (upload: VirtualTexturePhysicalAtlasPageUpload) => boolean;
  readonly takeReady: (
    uploads: readonly VirtualTexturePhysicalAtlasPageUpload[],
    maxCount: number,
    isCurrent: (upload: VirtualTexturePhysicalAtlasPageUpload) => boolean,
  ) => readonly PreparedTerrainPageUpload[];
};

type PendingPageRequest = {
  readonly byteLength: number;
  readonly key: string;
  readonly requestId: number;
  readonly sentAtMs: number;
  readonly upload: VirtualTexturePhysicalAtlasPageUpload;
};

type QueuedPageRequest = {
  readonly key: string;
  readonly requestId: number;
  readonly upload: VirtualTexturePhysicalAtlasPageUpload;
};

type WorkerSlot = {
  busy: boolean;
  readonly worker: Worker;
};

const protocol = 'royal-vt-page-v1' as const;
const maxQueuedRequests = 96;
const maxPooledBuffers = 32;

const atlasUploadKey = (upload: VirtualTexturePhysicalAtlasPageUpload): string =>
  `${upload.residentPageId}:${upload.uploadSerial}`;

const toTerrainPageGenerationRequest = (
  upload: VirtualTexturePhysicalAtlasPageUpload,
): TerrainPageGenerationRequest => ({
  height: upload.height,
  sourcePage: upload.sourcePage,
  width: upload.width,
});

const emptyMetrics = (
  available: boolean,
  workerCount: number,
  lastError = '',
): MutableWorkerPageGenerationMetrics => ({
  available,
  buffersAllocated: 0,
  buffersReused: 0,
  completedPages: 0,
  fallbackPages: 0,
  inFlightBytes: 0,
  lastError,
  lastWorkerGenerationLatencyMs: 0,
  maxWorkerGenerationLatencyMs: 0,
  queueDepth: 0,
  staleDrops: 0,
  workerCount,
});

export const createWorkerBackedTerrainPageGenerator = (): WorkerBackedTerrainPageGenerator => {
  const workers: WorkerSlot[] = [];
  const metricsState = emptyMetrics(false, 0);

  if (typeof Worker === 'undefined') {
    metricsState.lastError = 'Worker constructor is unavailable';
    return createSynchronousTerrainPageGenerator(metricsState);
  }

  try {
    const workerCount = Math.max(1, Math.min(2, navigator.hardwareConcurrency > 1 ? navigator.hardwareConcurrency - 1 : 1));
    for (let index = 0; index < workerCount; index += 1) {
      workers.push({
        busy: false,
        worker: new Worker(new URL('./terrain-page-worker.ts', import.meta.url), { type: 'module' }),
      });
    }
    metricsState.available = true;
    metricsState.workerCount = workers.length;
  } catch (error) {
    metricsState.lastError = error instanceof Error ? error.message : String(error);
    for (const slot of workers) slot.worker.terminate();
    return createSynchronousTerrainPageGenerator(metricsState);
  }

  return createAsynchronousTerrainPageGenerator(workers, metricsState);
};

const createSynchronousTerrainPageGenerator = (
  metricsState: MutableWorkerPageGenerationMetrics,
): WorkerBackedTerrainPageGenerator => ({
  dispose: () => undefined,
  dropStale: () => undefined,
  metrics: () => metricsState,
  prepareSync: (upload) => {
    const started = performance.now();
    const pixels = createTerrainPhysicalPagePixels(toTerrainPageGenerationRequest(upload));
    metricsState.fallbackPages += 1;
    return {
      generationMs: performance.now() - started,
      allocationMs: 0,
      fillMs: 0,
      pixels,
      upload,
      workerLatencyMs: 0,
    };
  },
  release: () => undefined,
  request: () => false,
  takeReady: () => [],
});

const createAsynchronousTerrainPageGenerator = (
  workers: WorkerSlot[],
  metricsState: MutableWorkerPageGenerationMetrics,
): WorkerBackedTerrainPageGenerator => {
  const queue: QueuedPageRequest[] = [];
  const pending = new Map<number, PendingPageRequest>();
  const pendingByKey = new Set<string>();
  const completed = new Map<string, PreparedTerrainPageUpload>();
  const staleRequestIds = new Set<number>();
  const bufferPool: ArrayBuffer[] = [];
  let nextRequestId = 1;

  const updateQueueDepth = (): void => {
    metricsState.queueDepth = queue.length + pending.size;
  };

  const releaseBuffer = (buffer: ArrayBuffer): void => {
    if (bufferPool.length < maxPooledBuffers) bufferPool.push(buffer);
  };

  const takeBuffer = (byteLength: number): ArrayBuffer => {
    const pooledIndex = bufferPool.findIndex((buffer) => buffer.byteLength >= byteLength);
    if (pooledIndex >= 0) {
      const [buffer] = bufferPool.splice(pooledIndex, 1);
      if (buffer !== undefined) {
        metricsState.buffersReused += 1;
        return buffer;
      }
    }

    metricsState.buffersAllocated += 1;
    return new ArrayBuffer(byteLength);
  };

  const dispatch = (): void => {
    for (const slot of workers) {
      if (slot.busy || queue.length === 0) continue;
      const queued = queue.shift();
      if (queued === undefined) continue;
      const byteLength = queued.upload.width * queued.upload.height * 4;
      const buffer = takeBuffer(byteLength);
      const message: TerrainPageWorkerGenerateMessage = {
        buffer,
        bufferMode: 'transfer',
        op: 'generate',
        protocol,
        request: toTerrainPageGenerationRequest(queued.upload),
        requestId: queued.requestId,
      };

      slot.busy = true;
      pending.set(queued.requestId, {
        byteLength,
        key: queued.key,
        requestId: queued.requestId,
        sentAtMs: performance.now(),
        upload: queued.upload,
      });
      metricsState.inFlightBytes += byteLength;
      slot.worker.postMessage(message, [message.buffer]);
    }
    updateQueueDepth();
  };

  const onWorkerMessage = (slot: WorkerSlot, message: TerrainPageWorkerGeneratedMessage): void => {
    if (message.protocol !== protocol || message.op !== 'generated') return;

    const request = pending.get(message.requestId);
    slot.busy = false;
    if (request === undefined) {
      releaseBuffer(message.buffer);
      dispatch();
      return;
    }

    pending.delete(message.requestId);
    pendingByKey.delete(request.key);
    metricsState.inFlightBytes = Math.max(0, metricsState.inFlightBytes - request.byteLength);

    const workerLatencyMs = performance.now() - request.sentAtMs;
    metricsState.lastWorkerGenerationLatencyMs = Number(workerLatencyMs.toFixed(2));
    metricsState.maxWorkerGenerationLatencyMs = Math.max(
      metricsState.maxWorkerGenerationLatencyMs,
      metricsState.lastWorkerGenerationLatencyMs,
    );

    if (staleRequestIds.delete(message.requestId)) {
      metricsState.staleDrops += 1;
      releaseBuffer(message.buffer);
      dispatch();
      return;
    }

    completed.set(request.key, {
      allocationMs: 0,
      fillMs: 0,
      generationMs: message.generationMs,
      pixels: new Uint8Array(message.buffer, 0, message.byteLength),
      upload: request.upload,
      workerLatencyMs,
    });
    metricsState.completedPages += 1;
    dispatch();
  };

  for (const slot of workers) {
    slot.worker.addEventListener('message', (event: MessageEvent<TerrainPageWorkerGeneratedMessage>) => {
      onWorkerMessage(slot, event.data);
    });
    slot.worker.addEventListener('error', (event) => {
      metricsState.lastError = event.message;
    });
  }

  return {
    dispose: () => {
      for (const slot of workers) slot.worker.terminate();
      queue.length = 0;
      pending.clear();
      pendingByKey.clear();
      completed.clear();
      staleRequestIds.clear();
      bufferPool.length = 0;
      metricsState.inFlightBytes = 0;
      updateQueueDepth();
    },
    dropStale: (isCurrent) => {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const queued = queue[index];
        if (queued === undefined || isCurrent(queued.upload)) continue;
        queue.splice(index, 1);
        pendingByKey.delete(queued.key);
        metricsState.staleDrops += 1;
      }

      for (const request of pending.values()) {
        if (isCurrent(request.upload)) continue;
        staleRequestIds.add(request.requestId);
      }

      for (const [key, page] of completed) {
        if (isCurrent(page.upload)) continue;
        completed.delete(key);
        releaseBuffer(page.pixels.buffer);
        metricsState.staleDrops += 1;
      }

      updateQueueDepth();
      dispatch();
    },
    metrics: () => ({
      ...metricsState,
      lastWorkerGenerationLatencyMs: Number(metricsState.lastWorkerGenerationLatencyMs.toFixed(2)),
      maxWorkerGenerationLatencyMs: Number(metricsState.maxWorkerGenerationLatencyMs.toFixed(2)),
      queueDepth: queue.length + pending.size,
    }),
    prepareSync: (upload) => {
      const started = performance.now();
      const pixels = createTerrainPhysicalPagePixels(toTerrainPageGenerationRequest(upload));
      metricsState.fallbackPages += 1;
      return {
        generationMs: performance.now() - started,
        allocationMs: 0,
        fillMs: 0,
        pixels,
        upload,
        workerLatencyMs: 0,
      };
    },
    release: (page) => {
      if (page.workerLatencyMs > 0) releaseBuffer(page.pixels.buffer);
    },
    request: (upload) => {
      const key = atlasUploadKey(upload);
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
    takeReady: (uploads, maxCount, isCurrent) => {
      const ready: PreparedTerrainPageUpload[] = [];
      for (const upload of uploads) {
        if (ready.length >= maxCount) break;
        const key = atlasUploadKey(upload);
        const page = completed.get(key);
        if (page === undefined) continue;
        completed.delete(key);
        pendingByKey.delete(key);
        if (!isCurrent(page.upload)) {
          metricsState.staleDrops += 1;
          releaseBuffer(page.pixels.buffer);
          continue;
        }
        ready.push(page);
      }
      return ready;
    },
  };
};
