type SharedByteReadEntry<Consumer> = {
  copyOnDelivery: boolean;
  readonly consumers: Set<Consumer>;
  readonly controller: AbortController;
  readonly promise: Promise<Uint8Array>;
  retainedBytes: number;
  waiterCount: number;
};

/**
 * Root-scoped byte transport with claim-based cancellation.
 *
 * The retained result is never handed to a consumer directly: preparation may
 * transfer or mutate its input, so each call receives caller-owned storage.
 */
export class SharedByteReadOwner<Consumer> {
  #disposed = false;
  readonly #entries = new Map<string, SharedByteReadEntry<Consumer>>();
  readonly #keysByConsumer = new Map<Consumer, Set<string>>();
  readonly #maxRetainedBytes: number;
  #retainedBytes = 0;

  constructor(maxRetainedBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 0) {
      throw new RangeError("Shared byte reader maxRetainedBytes must be a non-negative safe integer");
    }
    this.#maxRetainedBytes = maxRetainedBytes;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) entry.controller.abort();
    this.#entries.clear();
    this.#keysByConsumer.clear();
    this.#retainedBytes = 0;
  }

  read(
    key: string,
    consumer: Consumer,
    start: (signal: AbortSignal) => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    if (this.#disposed) return Promise.reject(new Error("Shared byte reader is disposed"));
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      const controller = new AbortController();
      let promise: Promise<Uint8Array>;
      try {
        promise = start(controller.signal);
      } catch (error) {
        promise = Promise.reject(error);
      }
      entry = {
        consumers: new Set(),
        controller,
        copyOnDelivery: false,
        promise,
        retainedBytes: 0,
        waiterCount: 0,
      };
      this.#entries.set(key, entry);
      void promise.then(
        (bytes) => this.#retainSettled(key, entry!, bytes.byteLength),
        () => this.#retireRejected(key, entry!),
      );
    }
    else if (entry.retainedBytes > 0) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    entry.waiterCount += 1;
    if (entry.waiterCount > 1) entry.copyOnDelivery = true;
    entry.consumers.add(consumer);
    let keys = this.#keysByConsumer.get(consumer);
    if (keys === undefined) {
      keys = new Set();
      this.#keysByConsumer.set(consumer, keys);
    }
    keys.add(key);
    return entry.promise.then((bytes) => entry.copyOnDelivery ? bytes.slice() : bytes);
  }

  release(consumer: Consumer): void {
    const keys = this.#keysByConsumer.get(consumer);
    if (keys === undefined) return;
    this.#keysByConsumer.delete(consumer);
    for (const key of keys) {
      const entry = this.#entries.get(key);
      if (entry === undefined) continue;
      entry.consumers.delete(consumer);
      if (entry.consumers.size > 0) continue;
      this.#retire(key, entry);
    }
  }

  #retireRejected(key: string, entry: SharedByteReadEntry<Consumer>): void {
    if (this.#entries.get(key) !== entry) return;
    this.#retire(key, entry);
  }

  #retainSettled(
    key: string,
    entry: SharedByteReadEntry<Consumer>,
    byteLength: number,
  ): void {
    if (this.#entries.get(key) !== entry) return;
    if (!entry.copyOnDelivery) {
      this.#retire(key, entry);
      return;
    }
    if (byteLength > this.#maxRetainedBytes) {
      this.#retire(key, entry);
      return;
    }
    entry.retainedBytes = byteLength;
    this.#retainedBytes += byteLength;
    // Map insertion order is the LRU order; pending reads rotate past eviction.
    while (this.#retainedBytes > this.#maxRetainedBytes) {
      const oldest = this.#entries.entries().next().value as
        | [string, SharedByteReadEntry<Consumer>]
        | undefined;
      if (oldest === undefined) break;
      const [oldestKey, oldestEntry] = oldest;
      if (oldestEntry.retainedBytes === 0) {
        // Pending reads remain claim-owned and cannot be evicted safely.
        this.#entries.delete(oldestKey);
        this.#entries.set(oldestKey, oldestEntry);
        continue;
      }
      this.#retire(oldestKey, oldestEntry);
    }
  }

  #retire(key: string, entry: SharedByteReadEntry<Consumer>): void {
    if (this.#entries.get(key) !== entry) return;
    this.#entries.delete(key);
    this.#retainedBytes -= entry.retainedBytes;
    entry.controller.abort();
    for (const consumer of entry.consumers) {
      const keys = this.#keysByConsumer.get(consumer);
      keys?.delete(key);
      if (keys?.size === 0) this.#keysByConsumer.delete(consumer);
    }
  }
}
