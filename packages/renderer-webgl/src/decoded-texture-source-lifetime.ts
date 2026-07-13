import type { ResourceGovernorLease } from "./resource-governor";
import { isDecodedRgbaTexture, loadedTextureSourceSize, type LoadedTextureSource } from "./texture-sources";

type Lane<Source extends object> = {
  readonly close: (source: Source) => void;
  readonly closed: WeakSet<Source>;
  readonly leases: WeakMap<Source, ResourceGovernorLease>;
  readonly pending: Set<Source>;
};

const lane = <Source extends object>(close: (source: Source) => void): Lane<Source> => ({
  close,
  closed: new WeakSet(),
  leases: new WeakMap(),
  pending: new Set(),
});

export type DecodedTextureSourceLifetimeOptions = {
  readonly closeOrdinary?: (source: LoadedTextureSource) => void;
  readonly closeVirtualTexture?: (source: TexImageSource) => void;
  readonly ordinaryReferenceCount: (source: LoadedTextureSource) => number;
  readonly reserveOrdinaryDecodedBytes: (decodedBytes: number) => ResourceGovernorLease;
  readonly scheduleRetry: () => void;
};

/**
 * Owns close-once, retry, and decoded CPU leases. Resource-arena sources and
 * renderer-owned VT page images are disjoint ownership lanes by construction;
 * the same object must never be passed to both lane-specific methods.
 */
export class DecodedTextureSourceLifetime {
  readonly #ordinary: Lane<LoadedTextureSource>;
  readonly #ordinaryReferenceCount: (source: LoadedTextureSource) => number;
  readonly #reserveOrdinary: (bytes: number) => ResourceGovernorLease;
  readonly #scheduleRetry: () => void;
  readonly #virtualTexture: Lane<TexImageSource>;

  constructor(options: DecodedTextureSourceLifetimeOptions) {
    this.#ordinary = lane(options.closeOrdinary ?? closeDecodedTextureSource);
    this.#ordinaryReferenceCount = options.ordinaryReferenceCount;
    this.#reserveOrdinary = options.reserveOrdinaryDecodedBytes;
    this.#scheduleRetry = options.scheduleRetry;
    this.#virtualTexture = lane(options.closeVirtualTexture ?? closeDecodedTextureSource);
  }

  retainOrdinary(source: LoadedTextureSource): void {
    if (this.#ordinary.leases.has(source)) return;
    this.#retain(this.#ordinary, source, this.#reserveOrdinary(decodedTextureSourceBytes(source)));
  }

  retainVirtualTexture(source: TexImageSource, lease: ResourceGovernorLease): void {
    this.#retain(this.#virtualTexture, source, lease);
  }

  closeOrdinary(source: LoadedTextureSource): void {
    if (this.#ordinaryReferenceCount(source) !== 0) {
      this.#ordinary.pending.delete(source);
      return;
    }
    this.#close(this.#ordinary, source);
  }

  closeVirtualTexture(source: TexImageSource): void {
    this.#close(this.#virtualTexture, source);
  }

  closeVirtualTextureAsync(source: TexImageSource): void {
    try {
      this.closeVirtualTexture(source);
    } catch {
      this.#scheduleRetry();
    }
  }

  retryPendingOrdinary(): void {
    this.#retry(this.#ordinary);
  }

  retryPendingVirtualTexture(): void {
    this.#retry(this.#virtualTexture);
  }

  retryPending(): void {
    let firstFailure: unknown;
    try {
      this.retryPendingOrdinary();
    } catch (error) {
      firstFailure = error;
    }
    try {
      this.retryPendingVirtualTexture();
    } catch (error) {
      firstFailure ??= error;
    }
    if (firstFailure !== undefined) throw firstFailure;
  }

  #close<Source extends object>(owner: Lane<Source>, source: Source): void {
    if (!owner.closed.has(source)) {
      try {
        owner.close(source);
      } catch (error) {
        owner.pending.add(source);
        throw error;
      }
      owner.closed.add(source);
    }
    owner.pending.delete(source);
    owner.leases.get(source)?.release();
    owner.leases.delete(source);
  }

  #retain<Source extends object>(owner: Lane<Source>, source: Source, lease: ResourceGovernorLease): void {
    if (owner.closed.has(source) || owner.leases.has(source)) lease.release();
    else owner.leases.set(source, lease);
  }

  #retry<Source extends object>(owner: Lane<Source>): void {
    let firstFailure: unknown;
    for (const source of owner.pending) {
      try {
        this.#close(owner, source);
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
  }
}

export const decodedTextureSourceBytes = (source: LoadedTextureSource): number => {
  if (isDecodedRgbaTexture(source)) return source.data.byteLength;
  const [width, height] = loadedTextureSourceSize(source);
  const bytes = Math.ceil(width) * Math.ceil(height) * 4;
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError("Decoded texture source byte size exceeds safe integer capacity");
  }
  return bytes;
};

export const closeDecodedTextureSource = (source: object): void => {
  const ImageBitmapConstructor = globalThis.ImageBitmap;
  if (typeof ImageBitmapConstructor === "function" && source instanceof ImageBitmapConstructor) source.close();
};
