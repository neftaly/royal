import {
  createTerrainPhysicalPagePixels,
  type TerrainPageGenerationRequest,
} from './terrain-page-generator';
import {
  vtWorkerTransportProtocol,
  type VtWorkerTransportGenerateMessage,
  type VtWorkerTransportGeneratedMessage,
} from './vt-worker-transport';

export type TerrainPageWorkerGenerateMessage = VtWorkerTransportGenerateMessage<TerrainPageGenerationRequest>;

export type TerrainPageWorkerGeneratedMessage = VtWorkerTransportGeneratedMessage;

type TerrainPageWorkerScope = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<TerrainPageWorkerGenerateMessage>) => void,
  ): void;
  postMessage(message: TerrainPageWorkerGeneratedMessage, transfer: readonly Transferable[]): void;
};

const workerScope = self as unknown as TerrainPageWorkerScope;

workerScope.addEventListener('message', (event: MessageEvent<TerrainPageWorkerGenerateMessage>) => {
  const message = event.data;
  if (
    message.protocol !== vtWorkerTransportProtocol ||
    message.op !== 'generate' ||
    message.bufferMode !== 'transfer'
  ) {
    return;
  }

  const started = performance.now();
  const pixels = createTerrainPhysicalPagePixels(message.request, message.buffer);
  const buffer = pixels.buffer;
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Terrain page worker generated a non-transferable buffer');
  const response: TerrainPageWorkerGeneratedMessage = {
    buffer,
    bufferMode: 'transfer',
    byteLength: pixels.byteLength,
    generationMs: performance.now() - started,
    op: 'generated',
    protocol: vtWorkerTransportProtocol,
    requestId: message.requestId,
  };

  workerScope.postMessage(response, [response.buffer]);
});
