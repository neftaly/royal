import { describe, expect, it } from 'vitest';
import {
  createVtWorkerTransport,
  vtWorkerTransportProtocol,
  type VtWorkerTransportErrorEvent,
  type VtWorkerTransportGenerateMessage,
  type VtWorkerTransportGeneratedMessage,
  type VtWorkerTransportWorker,
} from './vt-worker-transport';

type TestUpload = {
  readonly current: boolean;
  readonly height: number;
  readonly key: string;
  readonly width: number;
};

type TestRequest = {
  readonly height: number;
  readonly key: string;
  readonly width: number;
};

type SentWorkerMessage = {
  readonly message: VtWorkerTransportGenerateMessage<TestRequest>;
  readonly transfer: Transferable[];
};

type MessageListener = (event: MessageEvent<VtWorkerTransportGeneratedMessage>) => void;
type ErrorListener = (event: VtWorkerTransportErrorEvent) => void;

class FakeWorker implements VtWorkerTransportWorker<TestRequest> {
  readonly sent: SentWorkerMessage[] = [];
  terminated = false;
  private errorListener: ErrorListener | null = null;
  private messageListener: MessageListener | null = null;

  addEventListener(type: 'message', listener: MessageListener): void;
  addEventListener(type: 'error', listener: ErrorListener): void;
  addEventListener(type: 'message' | 'error', listener: MessageListener | ErrorListener): void {
    if (type === 'message') {
      this.messageListener = listener as MessageListener;
      return;
    }
    this.errorListener = listener as ErrorListener;
  }

  emitError(message: string): void {
    this.errorListener?.({ message });
  }

  postMessage(message: VtWorkerTransportGenerateMessage<TestRequest>, transfer: Transferable[]): void {
    this.sent.push({ message, transfer });
  }

  respond(sentIndex: number, fillValue: number, generationMs: number): void {
    const sent = this.sent[sentIndex];
    if (sent === undefined) throw new Error('No sent message at index ' + sentIndex);
    const pixels = new Uint8Array(sent.message.buffer);
    pixels.fill(fillValue);
    const response: VtWorkerTransportGeneratedMessage = {
      buffer: sent.message.buffer,
      bufferMode: 'transfer',
      byteLength: pixels.byteLength,
      generationMs,
      op: 'generated',
      protocol: vtWorkerTransportProtocol,
      requestId: sent.message.requestId,
    };

    this.messageListener?.({ data: response } as MessageEvent<VtWorkerTransportGeneratedMessage>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const upload = (key: string, current = true): TestUpload => ({
  current,
  height: 2,
  key,
  width: 2,
});

const createTransportFixture = (
  options: {
    readonly maxPooledBuffers?: number;
    readonly maxQueuedRequests?: number;
    readonly workerCount?: number;
  } = {},
): {
  readonly setNow: (value: number) => void;
  readonly transport: ReturnType<typeof createVtWorkerTransport<TestUpload, TestRequest>>;
  readonly workers: FakeWorker[];
} => {
  const workers: FakeWorker[] = [];
  let nowMs = 0;
  const transport = createVtWorkerTransport<TestUpload, TestRequest>({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    ...(options.maxPooledBuffers === undefined ? {} : { maxPooledBuffers: options.maxPooledBuffers }),
    ...(options.maxQueuedRequests === undefined ? {} : { maxQueuedRequests: options.maxQueuedRequests }),
    now: () => nowMs,
    toRequest: ({ height, key, width }) => ({ height, key, width }),
    uploadByteLength: ({ height, width }) => height * width * 4,
    uploadKey: ({ key }) => key,
    workerCount: options.workerCount ?? 1,
  });

  return {
    setNow: (value) => {
      nowMs = value;
    },
    transport,
    workers,
  };
};

describe('createVtWorkerTransport', () => {
  it('uses transfer buffers and reuses released worker pages', () => {
    const { setNow, transport, workers } = createTransportFixture({ maxPooledBuffers: 1 });
    const firstUpload = upload('first');

    expect(transport.request(firstUpload)).toBe(true);
    const worker = workers[0];
    expect(worker).toBeDefined();
    const firstSent = worker?.sent[0];
    expect(firstSent?.message).toMatchObject({
      bufferMode: 'transfer',
      op: 'generate',
      protocol: vtWorkerTransportProtocol,
      request: { height: 2, key: 'first', width: 2 },
      requestId: 1,
    });
    expect(firstSent?.message.buffer).toBeInstanceOf(ArrayBuffer);
    expect(firstSent?.transfer).toEqual([firstSent?.message.buffer]);

    setNow(12);
    worker?.respond(0, 7, 3.25);
    const ready = transport.takeReady([firstUpload], 1, ({ current }) => current);
    expect(ready).toHaveLength(1);
    const firstPage = ready[0];
    expect(firstPage?.generationMs).toBe(3.25);
    expect(firstPage?.pixels[0]).toBe(7);
    expect(firstPage?.upload).toBe(firstUpload);
    expect(firstPage?.workerLatencyMs).toBe(12);
    expect(transport.stats()).toMatchObject({
      available: true,
      buffersAllocated: 1,
      completedPages: 1,
      inFlightBytes: 0,
      queueDepth: 0,
      workerCount: 1,
    });

    if (firstPage === undefined) throw new Error('Expected a ready page');
    const releasedBuffer = firstPage.pixels.buffer;
    transport.release(firstPage);
    expect(transport.request(upload('second'))).toBe(true);
    expect(worker?.sent[1]?.message.buffer).toBe(releasedBuffer);
    expect(transport.stats().buffersReused).toBe(1);
  });

  it('drops stale queued, pending, and completed work', () => {
    const { setNow, transport, workers } = createTransportFixture();
    const firstUpload = upload('first', false);
    const secondUpload = upload('second');
    const thirdUpload = upload('third', false);

    expect(transport.request(firstUpload)).toBe(true);
    expect(transport.request(firstUpload)).toBe(true);
    expect(transport.request(secondUpload)).toBe(true);
    expect(workers[0]?.sent).toHaveLength(1);

    transport.dropStale(({ current }) => current);
    expect(transport.stats()).toMatchObject({
      queueDepth: 2,
      staleDrops: 0,
    });

    setNow(5);
    workers[0]?.respond(0, 1, 1);
    expect(workers[0]?.sent).toHaveLength(2);
    expect(transport.takeReady([firstUpload], 1, () => true)).toHaveLength(0);
    expect(transport.stats().staleDrops).toBe(1);

    setNow(9);
    workers[0]?.respond(1, 2, 1);
    expect(transport.takeReady([secondUpload], 1, ({ current }) => current)).toHaveLength(1);

    expect(transport.request(thirdUpload)).toBe(true);
    setNow(14);
    workers[0]?.respond(2, 3, 1);
    transport.dropStale(({ current }) => current);
    expect(transport.takeReady([thirdUpload], 1, () => true)).toHaveLength(0);
    expect(transport.stats().staleDrops).toBe(2);
  });

  it('reports capacity, worker errors, and unavailable workers', () => {
    const { transport, workers } = createTransportFixture({ maxQueuedRequests: 1 });

    expect(transport.request(upload('first'))).toBe(true);
    expect(transport.request(upload('second'))).toBe(false);
    expect(transport.stats().queueDepth).toBe(1);

    workers[0]?.emitError('worker exploded');
    expect(transport.stats().lastError).toBe('worker exploded');
    transport.dispose();
    expect(workers[0]?.terminated).toBe(true);
    expect(transport.request(upload('after-dispose'))).toBe(false);

    const unavailable = createVtWorkerTransport<TestUpload, TestRequest>({
      createWorker: () => {
        throw new Error('blocked');
      },
      toRequest: ({ height, key, width }) => ({ height, key, width }),
      uploadByteLength: ({ height, width }) => height * width * 4,
      uploadKey: ({ key }) => key,
      workerCount: 1,
    });
    expect(unavailable.request(upload('never'))).toBe(false);
    expect(unavailable.stats()).toMatchObject({
      available: false,
      lastError: 'blocked',
      workerCount: 0,
    });
  });
});
