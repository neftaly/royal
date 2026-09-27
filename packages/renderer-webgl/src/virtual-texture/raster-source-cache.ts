import { ordinaryTextureStorageBytes } from "../texture/storage";
import { decodedTextureKey, type DecodedImageTextureSource, type DecodedTextureSource, type TextureSourceRef } from "../texture/source";

const abortError = (): DOMException => new DOMException("Texture paging was aborted", "AbortError");

/** Root-local LRU of reloadable raster pixels. Membership and GPU pages outlive it. */
export class RasterSourceCache {
  readonly #entries = new Map<string, { source: DecodedImageTextureSource; maxBytes: number }>();
  readonly #load: (asset: TextureSourceRef, signal: AbortSignal, maxBytes: number) => Promise<DecodedTextureSource>;
  readonly #limit: number;
  readonly #sourceLimit: number;
  #bytes = 0;
  #reserved = 0;
  #tail: Promise<void> = Promise.resolve();
  #active: AbortController | undefined;
  #loadingKey: string | undefined;
  #disposed = false;
  #generation = 0;
  #reads = 0;
  #hits = 0;
  #queued = 0;
  #queueMs = 0;
  #decodeMs = 0;
  #renderMs = 0;
  #peakBytes = 0;

  constructor(
    load: (asset: TextureSourceRef, signal: AbortSignal, maxBytes: number) => Promise<DecodedTextureSource>,
    limit = 32 * 1024 * 1024,
    sourceLimit = 16 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 4 || !Number.isSafeInteger(sourceLimit)
      || sourceLimit < 4 || sourceLimit > limit) throw new RangeError("Invalid raster cache limits");
    this.#load = load;
    this.#limit = limit;
    this.#sourceLimit = sourceLimit;
  }

  get snapshot() {
    return { bytes: this.#bytes, limit: this.#limit, queued: this.#queued, reads: this.#reads, hits: this.#hits,
      queueMs: this.#queueMs, decodeMs: this.#decodeMs, renderMs: this.#renderMs, peakBytes: this.#peakBytes };
  }

  has(asset: TextureSourceRef): boolean { return this.#entries.has(decodedTextureKey(asset)); }

  /** Adopt a bounded initial decode; the callback releases its asset-owner lease. */
  seed(asset: TextureSourceRef, source: DecodedImageTextureSource, release: () => void): boolean {
    const key = decodedTextureKey(asset), bytes = source.width * source.height * 4;
    if (this.#disposed || this.#loadingKey === key || this.#entries.has(key) || !Number.isSafeInteger(bytes)
      || !Number.isSafeInteger(source.width) || source.width < 1
      || !Number.isSafeInteger(source.height) || source.height < 1
      || bytes < 4 || bytes > this.#sourceLimit || bytes + this.#reserved > this.#limit) return false;
    this.#evict(bytes + this.#reserved);
    this.#entries.set(key, { source: { ...source, close: release },
      maxBytes: ordinaryTextureStorageBytes(source.width, source.height, true) });
    this.#bytes += bytes;
    this.#peakBytes = Math.max(this.#peakBytes, this.#bytes + this.#reserved);
    return true;
  }

  /** Serialize source misses and synchronous page rendering to bound decode peaks. */
  read<T>(asset: TextureSourceRef, signal: AbortSignal, render: (source: DecodedImageTextureSource) => T, maxBytes = this.#sourceLimit): Promise<T> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) return Promise.reject(new RangeError("Invalid raster read limit"));
    const reservation = Math.min(maxBytes, this.#sourceLimit);
    this.#queued++;
    const generation = this.#generation;
    const queuedAt = performance.now();
    const job = this.#tail.then(async () => {
      this.#queueMs += performance.now() - queuedAt;
      if (this.#disposed || signal.aborted || generation !== this.#generation) throw abortError();
      const key = decodedTextureKey(asset);
      let entry = this.#entries.get(key);
      if (entry !== undefined && entry.maxBytes < reservation) {
        this.#entries.delete(key);
        this.#bytes -= entry.source.width * entry.source.height * 4;
        entry.source.close?.();
        entry = undefined;
      }
      if (entry === undefined) {
        // Reserve the maximum decode result before starting the decoder.
        this.#evict(reservation);
        this.#reserved = reservation;
        this.#peakBytes = Math.max(this.#peakBytes, this.#bytes + this.#reserved);
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        this.#active = controller;
        this.#loadingKey = key;
        try {
          this.#reads++;
          const startedAt = performance.now();
          const decoded = await this.#load(asset, controller.signal, reservation).finally(() => {
            this.#decodeMs += performance.now() - startedAt;
          });
          const bytes = decoded.width * decoded.height * 4;
          if (this.#disposed || signal.aborted || controller.signal.aborted || generation !== this.#generation) {
            decoded.close?.();
            throw abortError();
          }
          if (decoded.kind !== undefined || !Number.isSafeInteger(decoded.width) || decoded.width < 1
            || !Number.isSafeInteger(decoded.height) || decoded.height < 1
            || !Number.isSafeInteger(bytes) || bytes < 4 || bytes > reservation) {
            decoded.close?.();
            throw new Error("Texture paging decoder exceeded its raster reservation");
          }
          entry = { source: decoded, maxBytes: reservation };
          this.#bytes += bytes;
          this.#entries.set(key, entry);
        } finally {
          signal.removeEventListener("abort", abort);
          this.#active = undefined;
          this.#loadingKey = undefined;
          this.#reserved = 0;
        }
      } else {
        this.#hits++;
        this.#entries.delete(key);
        this.#entries.set(key, entry);
      }
      const renderStartedAt = performance.now();
      try { return render(entry.source); }
      finally { this.#renderMs += performance.now() - renderStartedAt; }
    });
    this.#tail = job.then(() => { this.#queued--; }, () => { this.#queued--; });
    return job;
  }

  retain(keys: ReadonlySet<string>): void {
    for (const [key, { source }] of this.#entries) if (!keys.has(key)) {
      this.#entries.delete(key);
      this.#bytes -= source.width * source.height * 4;
      source.close?.();
    }
  }

  /** Browser canvases/bitmaps may also lose pixels when the GPU process exits. */
  invalidate(): void {
    this.#generation++;
    this.#active?.abort();
    this.retain(new Set());
  }

  dispose(): void {
    this.#disposed = true;
    this.invalidate();
  }

  #evict(reserved: number): void {
    for (const [key, { source }] of this.#entries) {
      if (this.#bytes + reserved <= this.#limit) break;
      this.#entries.delete(key);
      this.#bytes -= source.width * source.height * 4;
      source.close?.();
    }
  }
}
