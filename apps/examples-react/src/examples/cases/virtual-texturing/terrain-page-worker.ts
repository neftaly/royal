import {
  createTerrainPhysicalPagePixels,
  type TerrainPageGenerationRequest,
} from './terrain-page-generator';

export type TerrainPageWorkerGenerateMessage = {
  readonly buffer: ArrayBuffer;
  readonly bufferMode: 'transfer';
  readonly op: 'generate';
  readonly protocol: 'royal-vt-page-v1';
  readonly request: TerrainPageGenerationRequest;
  readonly requestId: number;
};

export type TerrainPageWorkerGeneratedMessage = {
  readonly buffer: ArrayBuffer;
  readonly bufferMode: 'transfer';
  readonly byteLength: number;
  readonly generationMs: number;
  readonly op: 'generated';
  readonly protocol: 'royal-vt-page-v1';
  readonly requestId: number;
};

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', (event: MessageEvent<TerrainPageWorkerGenerateMessage>) => {
  const message = event.data;
  if (message.protocol !== 'royal-vt-page-v1' || message.op !== 'generate') return;

  const started = performance.now();
  const pixels = createTerrainPhysicalPagePixels(message.request, message.buffer);
  const response: TerrainPageWorkerGeneratedMessage = {
    buffer: pixels.buffer,
    bufferMode: 'transfer',
    byteLength: pixels.byteLength,
    generationMs: performance.now() - started,
    op: 'generated',
    protocol: 'royal-vt-page-v1',
    requestId: message.requestId,
  };

  workerScope.postMessage(response, [response.buffer]);
});
