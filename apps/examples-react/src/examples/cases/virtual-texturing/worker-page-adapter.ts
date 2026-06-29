// Temporary: the terrain demo still queues low-level atlas upload work until it migrates to the public VT resource facade.
import type { VirtualTexturePhysicalAtlasPageUpload } from '@royal/renderer-webgl/virtual-texturing/testing';
import {
  createTerrainPhysicalPagePixels,
  type TerrainPageGenerationRequest,
} from './terrain-page-generator';
import {
  createVtWorkerTransport,
  type VtWorkerTransport,
  type VtWorkerTransportReadyPage,
  type VtWorkerTransportStats,
  type VtWorkerTransportWorker,
} from './vt-worker-transport';

export type PreparedTerrainPageUpload = {
  readonly allocationMs: number;
  readonly fillMs: number;
  readonly generationMs: number;
  readonly pixels: Uint8Array;
  readonly upload: VirtualTexturePhysicalAtlasPageUpload;
  readonly workerLatencyMs: number;
};

export type WorkerPageGenerationMetrics = VtWorkerTransportStats & {
  readonly fallbackPages: number;
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

type MutableFallbackMetrics = {
  fallbackPages: number;
};

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

const terrainWorkerCount = (): number => {
  const hardwareConcurrency = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency;
  return Math.max(1, Math.min(2, hardwareConcurrency > 1 ? hardwareConcurrency - 1 : 1));
};

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

const metricsFromTransportStats = (
  stats: VtWorkerTransportStats,
  fallbackPages: number,
): WorkerPageGenerationMetrics => ({
  ...stats,
  fallbackPages,
});

const toPreparedTerrainPageUpload = (
  page: VtWorkerTransportReadyPage<VirtualTexturePhysicalAtlasPageUpload>,
): PreparedTerrainPageUpload => ({
  allocationMs: 0,
  fillMs: 0,
  generationMs: page.generationMs,
  pixels: page.pixels,
  upload: page.upload,
  workerLatencyMs: page.workerLatencyMs,
});

export const createWorkerBackedTerrainPageGenerator = (): WorkerBackedTerrainPageGenerator => {
  const metricsState = emptyMetrics(false, 0);

  if (typeof Worker === 'undefined') {
    metricsState.lastError = 'Worker constructor is unavailable';
    return createSynchronousTerrainPageGenerator(metricsState);
  }

  const transport = createVtWorkerTransport<VirtualTexturePhysicalAtlasPageUpload, TerrainPageGenerationRequest>({
    createWorker: () =>
      new Worker(new URL('./terrain-page-worker.ts', import.meta.url), { type: 'module' }) as VtWorkerTransportWorker<TerrainPageGenerationRequest>,
    maxPooledBuffers,
    maxQueuedRequests,
    toRequest: toTerrainPageGenerationRequest,
    uploadByteLength: (upload) => upload.width * upload.height * 4,
    uploadKey: atlasUploadKey,
    workerCount: terrainWorkerCount(),
  });
  const transportStats = transport.stats();
  if (!transportStats.available) {
    return createSynchronousTerrainPageGenerator(metricsFromTransportStats(transportStats, 0));
  }

  return createAsynchronousTerrainPageGenerator(transport, { fallbackPages: 0 });
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
  transport: VtWorkerTransport<VirtualTexturePhysicalAtlasPageUpload>,
  fallbackMetrics: MutableFallbackMetrics,
): WorkerBackedTerrainPageGenerator => ({
  dispose: () => transport.dispose(),
  dropStale: (isCurrent) => transport.dropStale(isCurrent),
  metrics: () => metricsFromTransportStats(transport.stats(), fallbackMetrics.fallbackPages),
  prepareSync: (upload) => {
    const started = performance.now();
    const pixels = createTerrainPhysicalPagePixels(toTerrainPageGenerationRequest(upload));
    fallbackMetrics.fallbackPages += 1;
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
    if (page.workerLatencyMs > 0) transport.release(page);
  },
  request: (upload) => transport.request(upload),
  takeReady: (uploads, maxCount, isCurrent) =>
    transport.takeReady(uploads, maxCount, isCurrent).map(toPreparedTerrainPageUpload),
});
