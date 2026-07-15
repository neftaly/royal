import type { ResourceGovernorLease } from "../resource-governor";
import { captureFirstFailure, type CapturedFailure } from "../captured-failure";
import {
  decodedTextureLevels,
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./sources";

type Lane<Source extends object> = {
  readonly close: (source: Source) => void;
  readonly closers: WeakMap<Source, () => void>;
  readonly closed: WeakSet<Source>;
  readonly leases: WeakMap<Source, ResourceGovernorLease>;
  readonly pending: Set<Source>;
};

const lane = <Source extends object>(close: (source: Source) => void): Lane<Source> => ({
  close,
  closers: new WeakMap(),
  closed: new WeakSet(),
  leases: new WeakMap(),
  pending: new Set(),
});

export type DecodedTextureSourceLifetimeOptions = {
  readonly closeOrdinary?: (source: LoadedTextureSource) => void;
  readonly closeVirtualTexture?: (source: object) => void;
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
  readonly #virtualTexture: Lane<object>;

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

  retainVirtualTexture(source: object, lease: ResourceGovernorLease, close?: () => void): void {
    this.#retain(this.#virtualTexture, source, lease, close);
  }

  closeOrdinary(source: LoadedTextureSource): void {
    if (this.#ordinaryReferenceCount(source) !== 0) {
      this.#ordinary.pending.delete(source);
      return;
    }
    this.#close(this.#ordinary, source);
  }

  closeVirtualTexture(source: object, close?: () => void): void {
    this.#close(this.#virtualTexture, source, close);
  }

  closeVirtualTextureAsync(source: object, close?: () => void): void {
    try {
      this.closeVirtualTexture(source, close);
    } catch {
      this.#scheduleRetry();
    }
  }

  retryPendingOrdinary(): void {
    this.#retry(this.#ordinary);
  }

  hasPendingOrdinary(): boolean {
    return this.#ordinary.pending.size > 0;
  }

  retryPendingVirtualTexture(): void {
    this.#retry(this.#virtualTexture);
  }

  retryPending(): void {
    let failure: CapturedFailure | undefined;
    failure = captureFirstFailure(failure, () => this.retryPendingOrdinary());
    failure = captureFirstFailure(failure, () => this.retryPendingVirtualTexture());
    if (failure !== undefined) throw failure.value;
  }

  #close<Source extends object>(owner: Lane<Source>, source: Source, close?: () => void): void {
    if (!owner.closed.has(source)) {
      if (close !== undefined) owner.closers.set(source, close);
      try {
        const ownedClose = owner.closers.get(source);
        if (ownedClose === undefined) owner.close(source);
        else ownedClose();
      } catch (error) {
        owner.pending.add(source);
        throw error;
      }
      owner.closed.add(source);
      owner.closers.delete(source);
    }
    owner.pending.delete(source);
    owner.leases.get(source)?.release();
    owner.leases.delete(source);
  }

  #retain<Source extends object>(
    owner: Lane<Source>,
    source: Source,
    lease: ResourceGovernorLease,
    close?: () => void,
  ): void {
    if (owner.closed.has(source) || owner.leases.has(source)) lease.release();
    else {
      owner.leases.set(source, lease);
      if (close !== undefined) owner.closers.set(source, close);
    }
  }

  #retry<Source extends object>(owner: Lane<Source>): void {
    let failure: CapturedFailure | undefined;
    for (const source of owner.pending) {
      failure = captureFirstFailure(failure, () => this.#close(owner, source));
    }
    if (failure !== undefined) throw failure.value;
  }
}

export const decodedTextureSourceBytes = (source: LoadedTextureSource): number => {
  if (isDecodedRgbaTexture(source) || isDecodedCompressedTexture(source)) {
    const bytes = decodedTextureLevels(source)
      .reduce((sum, level) => sum + level.data.byteLength, 0);
    if (!Number.isSafeInteger(bytes)) {
      throw new RangeError("Decoded texture source byte size exceeds safe integer capacity");
    }
    return bytes;
  }
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
