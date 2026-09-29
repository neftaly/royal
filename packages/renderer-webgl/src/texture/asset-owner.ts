import { reloadableRasterPagingEligible } from "../virtual-texture/automatic-policy";
import { ordinaryTextureStorageBytes } from "./storage";
import { textureStorageShare } from "./storage-share";
import { fitOrdinaryTextureStorage } from "./storage-fit";
import {
  canReserveTextureSource,
  replaceTextureReservationInto,
  preparingTextureReservation,
  type TextureReservation,
} from "./preparation-reservation";
import type {
  TextureAssetRef,
} from "@royal/renderer-core";
import { formatFailure } from "../diagnostics/format-failure";
import { RetainedFifo } from "../resource/retained-fifo";
import { KeyedRetainedListeners } from "../resource/retained-listeners";
import type { StagedByteReadSnapshot } from "../resource/staged-byte-read-owner";
import {
  textureAlphaStorageBytes,
  validateTextureAlphaMipChain,
  type DecodedTextureAlpha,
} from "./alpha-mipmap";
import {
  releaseDecodedTextureSource,
  decodedTextureKey,
  textureStorageKey,
  type DecodedTextureLease,
  type DecodedTextureSource,
  type TextureDecodeStageTimings,
  type TextureSourceRef,
} from "./source";

export type { DecodedTextureAlpha } from "./alpha-mipmap";
export {
  decodedTextureKey,
  textureStorageKey,
  type DecodedImageTextureSource,
  type DecodedKtx2Etc2TextureSource,
  type DecodedTextureLease,
  type DecodedTextureSource,
  type EmbeddedTextureAssetRef,
  type TextureLeafSourceRef,
  type TextureSourceEncoding,
  type TextureSourceRef,
} from "./source";

/**
 * Focused decode lifecycle for one exact texture identity. `ready` means a
 * decoder established fitted dimensions successfully. The bounded CPU handoff
 * may already be released; GPU admission and residency are root diagnostics.
 * `status` is the discriminant shared by every focused Royal lifecycle.
 */
export type TextureAssetSnapshot =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{
    /** Fitted upload height in texels. */
    height: number;
    status: "ready";
    /** Cold lifecycle attribution for the successful preparation attempt. */
    timings?: TextureAssetTimings;
    /** Fitted upload width in texels. */
    width: number;
  }>
  | Readonly<{ error: string; status: "error" }>;

export type TextureAssetTimings = TextureDecodeStageTimings & Readonly<{
  /** Elapsed time from the initial claim until this source became ready. */
  firstReadyAfterMs: number;
  /** Time spent waiting for a root texture-source reservation. */
  preparationQueueDurationMs: number;
  /** Total successful source preparation span, including transport and decode queues. */
  preparationDurationMs: number;
}>;

export type TexturePreparationSnapshot = Readonly<{
  /** GPU representations denied admission; preparation may still report ready. */
  deniedStorageRepresentations?: number;
  /** Texture source lifecycles currently executing transport or decode work. */
  activePreparations: number;
  /** Retained ready built-in sources and their summed cold-stage durations. */
  browserStageTimings?: Readonly<{
    sourceCount: number;
    totals: TextureDecodeStageTimings;
  }>;
  /** Estimated CPU bytes currently retained for decoded GPU handoff. */
  decodedHandoffBytes: number;
  /** Soft decoded-handoff byte ceiling; one source may exceed it alone. */
  decodedHandoffThresholdBytes: number;
  /** Built-in browser encoded transport and completed-blob staging pressure. */
  encodedSourceReads?: StagedByteReadSnapshot;
  /** Claimed color-space/sampler storage representations not yet GPU-resident. */
  pendingStorageRepresentations: number;
  /** Maximum simultaneous active-preparation and decoded-handoff reservations. */
  sourceReservationLimit: number;
  /** Active preparations plus decoded sources retaining a handoff reservation. */
  sourceReservations: number;
}>;

export type TextureAssetOwnerPlatform = Readonly<{
  decode(
    asset: TextureSourceRef,
    signal: AbortSignal,
    maxStorageBytes?: number,
    retainAlpha?: boolean,
  ): Promise<DecodedTextureSource>;
  onAssetChanged(key: string): void;
  /** Release optional raster consumers before a larger fitted decode replaces their source. */
  releaseDecoded?(asset: TextureSourceRef): void;
  onListenerError(error: unknown): void;
  onSnapshotChanged(key: string): void;
  now?(): number;
  preload?(asset: TextureSourceRef, signal: AbortSignal, retainAlpha?: boolean): void;
  readAheadSnapshot?(): StagedByteReadSnapshot | undefined;
}>;

type AssetEntry = {
  active: boolean;
  alpha: DecodedTextureAlpha | undefined;
  asset: TextureSourceRef;
  readonly claimedStorageKeys: Set<string>;
  readonly fallbackStorageKeys: Set<string>;
  controller: AbortController | undefined;
  reservation: TextureReservation;
  preparationDeferred: boolean;
  preparationStorageBytes: number | undefined;
  initialDecodeExtraBytes: number;
  readonly key: string;
  decoded: DecodedTextureSource | undefined;
  decodedClaims: number;
  decodedReleased: boolean;
  preparationRetainsAlpha: boolean;
  preparationAlphaOnly: boolean;
  preparationQueuedAt: number;
  preparationStartedAt: number;
  queued: boolean;
  readonly residentStorageKeys: Set<string>;
  retainAlpha: boolean;
  snapshot: TextureAssetSnapshot;
  readonly startedAt: number;
};

const IDLE: TextureAssetSnapshot = { status: "idle" };
const ACTIVE_TEXTURE_PREPARATION_LIMIT = 32;
const DECODED_HANDOFF_BYTE_THRESHOLD = 64 * 1024 * 1024;
const DECODED_HANDOFF_SOURCE_LIMIT = 64;
const INITIAL_DECODE_EXTRA_BYTE_LIMIT = 32 * 1024 * 1024;

/** Exact retained CPU bytes after browser decode has selected a representation. */
export const decodedTextureHandoffBytes = (
  decoded: DecodedTextureSource,
  alpha: DecodedTextureAlpha | undefined = decoded.alpha,
): number => {
  const textureBytes = decoded.kind !== undefined
    ? decoded.levels.reduce((total, level) => total + level.blocks.byteLength, 0)
    : decoded.width * decoded.height * 4;
  const bytes = textureBytes + (alpha === undefined ? 0 : textureAlphaStorageBytes(alpha));
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new RangeError("Royal decoded texture handoff exceeds safe integer range");
  }
  return bytes;
};

const storageIncomplete = (
  claimed: ReadonlySet<string>,
  resident: ReadonlySet<string>,
): boolean => {
  for (const key of claimed) {
    if (!resident.has(key)) return true;
  }
  return false;
};

const diagnosticLabel = (asset: TextureSourceRef): string => {
  if (asset.kind === "embedded-asset") return asset.label;
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `texture ${JSON.stringify(source)}`;
};

/** Owns exact decoded-content claims, asynchronous decode, and focused status publication. */
export class TextureAssetOwner {
  readonly #reservations = { activePreparations: 0, sourceReservations: 0, decodedHandoffBytes: 0 };
  #disposed = false;
  #residencyGeneration = 0;
  readonly #preparationQueue = new RetainedFifo<AssetEntry>();
  readonly #entries = new Map<string, AssetEntry>();
  readonly #listeners = new KeyedRetainedListeners<string>();
  #maxStorageBytes: number | undefined;
  #currentStorageBudgetBytes: number | undefined;
  #initialDecodeBytes: ReadonlyMap<string, number> = new Map();
  #initialDecodeExtraBytes = 0;
  #redistributionQueued = false;
  readonly #pageableKeys = new Set<string>();
  readonly #deniedStorageKeys = new Set<string>();
  readonly #now: () => number;
  readonly #platform: TextureAssetOwnerPlatform;
  readonly #storageBudgetBytes: number | undefined;
  readonly #activeLimit: number;
  readonly #storageEntries = new Map<string, AssetEntry>();

  constructor(platform: TextureAssetOwnerPlatform, storageBudgetBytes?: number, activeLimit = ACTIVE_TEXTURE_PREPARATION_LIMIT) {
    if (storageBudgetBytes !== undefined && (
      !Number.isSafeInteger(storageBudgetBytes) || storageBudgetBytes < 0
    )) throw new RangeError("Royal texture storage budget must be a non-negative safe integer");
    this.#platform = platform;
    this.#now = platform.now ?? (() => performance.now());
    this.#storageBudgetBytes = storageBudgetBytes;
    this.#activeLimit = activeLimit;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      entry.controller?.abort();
      if (!entry.decodedReleased) releaseDecodedTextureSource(entry.decoded);
      entry.decodedReleased = true;
    }
    this.#preparationQueue.clear();
    this.#entries.clear();
    this.#initialDecodeBytes = new Map();
    this.#listeners.clear();
    this.#storageEntries.clear();
  }

  decoded(asset: TextureSourceRef): DecodedTextureSource | undefined {
    const entry = this.#entries.get(decodedTextureKey(asset));
    if (entry === undefined || entry.decoded === undefined) return undefined;
    return !entry.decodedReleased || entry.residentStorageKeys.has(textureStorageKey(asset))
      ? entry.decoded
      : undefined;
  }

  /** Retains live decoded pixels until the returned idempotent lease is released. */
  acquireDecoded(asset: TextureSourceRef): DecodedTextureLease | undefined {
    if (this.#disposed) return undefined;
    const entry = this.#entries.get(decodedTextureKey(asset));
    if (entry?.decoded === undefined || entry.decodedReleased) return undefined;
    if (entry.reservation?.phase === "preparing" && !entry.preparationAlphaOnly) return undefined;
    // A queued replacement must also exclude new leases: otherwise VT can pin
    // the old pixels before a decode slot becomes available.
    if ((entry.queued || entry.preparationDeferred)
      && !(entry.decodedClaims > 0 && entry.retainAlpha && entry.alpha === undefined)) return undefined;
    entry.decodedClaims += 1;
    // The optional representation now charges the retained source; this slot
    // only bounds decode handoff and must not starve unrelated asset decoding.
    if (entry.reservation?.phase !== "preparing") this.#releaseSourceReservation(entry);
    let active = true;
    return {
      release: () => {
        if (!active) return;
        active = false;
        if (this.#disposed) return;
        entry.decodedClaims -= 1;
        if (entry.decodedClaims === 0 && entry.preparationDeferred) {
          entry.preparationDeferred = false;
          this.#queuePreparation(entry);
          return;
        }
        // An evicted page-cache lease can return pixels before the ordinary
        // upload finishes. Charge that handoff again instead of orphaning it.
        if (entry.decodedClaims === 0 && entry.reservation === undefined
          && !entry.decodedReleased && entry.decoded !== undefined
          && storageIncomplete(entry.claimedStorageKeys, entry.residentStorageKeys)) {
          this.#replaceReservation(entry, { phase: "handoff", bytes: decodedTextureHandoffBytes(entry.decoded, entry.alpha) });
        }
        this.#releaseDecodedIfUnused(entry);
      },
      source: entry.decoded,
    };
  }

  /** Reload through the same reader and inspection policy, outside ordinary GPU ownership. */
  decodeForPaging(asset: TextureSourceRef, signal: AbortSignal, maxBytes: number): Promise<DecodedTextureSource> {
    if (this.#disposed || signal.aborted) return Promise.reject(new DOMException("Texture paging was aborted", "AbortError"));
    return this.#platform.decode(asset, signal, maxBytes);
  }

  alpha(asset: TextureSourceRef): DecodedTextureAlpha | undefined {
    const entry = this.#entries.get(decodedTextureKey(asset));
    return entry?.retainAlpha === true
      && entry.residentStorageKeys.has(textureStorageKey(asset))
      ? entry.alpha
      : undefined;
  }

  getSnapshot(asset: TextureAssetRef): TextureAssetSnapshot {
    return this.#entries.get(decodedTextureKey(asset))?.snapshot ?? IDLE;
  }

  getSourceSnapshot(asset: TextureSourceRef): TextureAssetSnapshot {
    return this.#entries.get(decodedTextureKey(asset))?.snapshot ?? IDLE;
  }

  snapshot(): TexturePreparationSnapshot {
    let pendingStorageRepresentations = 0;
    let timedSources = 0;
    const timings = {
      decodeDurationMs: 0,
      decodeQueueDurationMs: 0,
      transportDurationMs: 0,
      transportQueueDurationMs: 0,
    };
    const encodedSourceReads = this.#platform.readAheadSnapshot?.();
    for (const entry of this.#entries.values()) {
      if (!entry.active) continue;
      for (const storageKey of entry.claimedStorageKeys) {
        if (!entry.residentStorageKeys.has(storageKey)) pendingStorageRepresentations += 1;
      }
      if (entry.snapshot.status === "ready" && entry.snapshot.timings !== undefined) {
        timedSources += 1;
        timings.decodeDurationMs += entry.snapshot.timings.decodeDurationMs;
        timings.decodeQueueDurationMs += entry.snapshot.timings.decodeQueueDurationMs;
        timings.transportDurationMs += entry.snapshot.timings.transportDurationMs;
        timings.transportQueueDurationMs += entry.snapshot.timings.transportQueueDurationMs;
      }
    }
    return {
      ...(this.#deniedStorageKeys.size === 0 ? {} : { deniedStorageRepresentations: this.#deniedStorageKeys.size }),
      activePreparations: this.#reservations.activePreparations,
      ...(timedSources === 0 ? {} : {
        browserStageTimings: {
          sourceCount: timedSources,
          totals: timings,
        },
      }),
      decodedHandoffBytes: this.#reservations.decodedHandoffBytes,
      decodedHandoffThresholdBytes: DECODED_HANDOFF_BYTE_THRESHOLD,
      ...(encodedSourceReads === undefined ? {} : { encodedSourceReads }),
      pendingStorageRepresentations,
      sourceReservationLimit: DECODED_HANDOFF_SOURCE_LIMIT,
      sourceReservations: this.#reservations.sourceReservations,
    };
  }

  reconcile(
    assets: readonly TextureSourceRef[],
    alphaMaskAssets: readonly TextureSourceRef[] = [],
    storageBudgetBytes: number | undefined = this.#storageBudgetBytes,
    pageableStorageKeys: ReadonlySet<string> = new Set(),
    activeStorageKeys?: ReadonlySet<string>,
    initialDecodeBytes: ReadonlyMap<string, number> = new Map(),
  ): void {
    if (this.#disposed) return;
    this.#storageEntries.clear();
    const retainedAlphaKeys = new Set<string>();
    for (const asset of alphaMaskAssets) retainedAlphaKeys.add(decodedTextureKey(asset));
    const claimed = new Map<string, { asset: TextureSourceRef; storageKeys: Set<string>; active: boolean; pageable: boolean }>();
    const claimedStorage = new Set<string>();
    for (const asset of assets) {
      const key = decodedTextureKey(asset);
      const storageKey = textureStorageKey(asset);
      const active = activeStorageKeys === undefined || activeStorageKeys.has(storageKey);
      const pageable = pageableStorageKeys.has(storageKey);
      claimedStorage.add(storageKey);
      const existing = claimed.get(key);
      if (existing === undefined) claimed.set(key, { asset, storageKeys: new Set([storageKey]), active, pageable });
      else {
        existing.storageKeys.add(storageKey);
        existing.active ||= active;
        existing.pageable &&= pageable;
      }
    }
    for (const key of this.#deniedStorageKeys) if (!claimedStorage.has(key)
      || activeStorageKeys?.has(key) === false) this.#deniedStorageKeys.delete(key);
    this.#pageableKeys.clear();
    const storageClaims: Array<{ source: DecodedTextureSource | undefined; copies: number }> = [];
    for (const [key, claim] of claimed) {
      if (claim.pageable) this.#pageableKeys.add(key);
      if (claim.active) storageClaims.push({ source: this.#entries.get(key)?.decoded, copies: claim.storageKeys.size });
    }
    this.#currentStorageBudgetBytes = storageBudgetBytes;
    this.#initialDecodeBytes = initialDecodeBytes;
    let snapshotChangedKey: string | undefined;
    this.#updateStorageShare(storageClaims);
    for (const [key, claim] of claimed) {
      const active = claim.active;
      const entry = this.#entries.get(key);
      if (entry === undefined) {
        this.#start(claim.asset, key, claim.storageKeys, retainedAlphaKeys.has(key), active);
        continue;
      }
      const wasActive = entry.active;
      entry.active = active;
      if (!active) {
        entry.queued = false;
        entry.controller?.abort();
        entry.controller = undefined;
        if (entry.reservation?.phase === "preparing") this.#releaseSourceReservation(entry);
        this.#releaseDecodedIfUnused(entry);
        if (entry.decoded === undefined && entry.snapshot.status !== "error") entry.snapshot = IDLE;
      } else if (entry.decoded === undefined && entry.snapshot.status !== "error") {
        entry.snapshot = { status: "loading" };
        this.#queuePreparation(entry);
      }
      if (wasActive !== active) {
        snapshotChangedKey = key;
        this.#publish(key);
      }
      entry.asset = claim.asset;
      entry.claimedStorageKeys.clear();
      for (const storageKey of claim.storageKeys) entry.claimedStorageKeys.add(storageKey);
      for (const storageKey of entry.residentStorageKeys) {
        if (!claim.storageKeys.has(storageKey)) entry.residentStorageKeys.delete(storageKey);
      }
      for (const storageKey of entry.fallbackStorageKeys) {
        if (!claim.storageKeys.has(storageKey)) entry.fallbackStorageKeys.delete(storageKey);
      }
      this.#refreshStorageFit(entry);
      const retainAlpha = retainedAlphaKeys.has(key);
      if (entry.retainAlpha !== retainAlpha) {
        entry.retainAlpha = retainAlpha;
        if (!retainAlpha) {
          entry.alpha = undefined;
        } else if (entry.alpha === undefined && entry.snapshot.status !== "error") {
          if (entry.controller !== undefined && !entry.preparationRetainsAlpha) {
            entry.controller.abort();
            entry.controller = undefined;
            this.#releaseSourceReservation(entry);
          }
          this.#queuePreparation(entry);
        }
      }
      if (
        entry.decodedReleased
        && entry.snapshot.status !== "error"
        && storageIncomplete(claim.storageKeys, entry.residentStorageKeys)
      ) this.#queuePreparation(entry);
    }
    for (const [key, claim] of claimed) {
      const entry = this.#entries.get(key)!;
      for (const storageKey of claim.storageKeys) this.#storageEntries.set(storageKey, entry);
    }
    for (const [key, entry] of this.#entries) {
      if (claimed.has(key)) continue;
      this.#entries.delete(key);
      entry.controller?.abort();
      entry.alpha = undefined;
      if (!entry.decodedReleased) releaseDecodedTextureSource(entry.decoded);
      entry.decodedReleased = true;
      entry.queued = false;
      this.#releaseSourceReservation(entry);
      this.#publish(key);
    }
    if (snapshotChangedKey !== undefined) this.#platform.onSnapshotChanged(snapshotChangedKey);
  }

  /** Compact GPU fallbacks still need the approved source for full-storage restoration. */
  requestUploadSource(storageKey: string): void {
    const entry = this.#storageEntries.get(storageKey);
    if (!this.#disposed && entry?.decodedReleased === true && entry.snapshot.status !== "error") {
      this.#queuePreparation(entry);
    }
  }

  setStorageFallback(storageKey: string, compact: boolean): void {
    const entry = this.#storageEntries.get(storageKey);
    if (entry === undefined || this.#disposed) return;
    if (compact) entry.fallbackStorageKeys.add(storageKey);
    else entry.fallbackStorageKeys.delete(storageKey);
    this.#releaseDecodedIfUnused(entry);
  }

  /** Releases browser decode storage after the claimed WebGL copies are resident. */
  releaseUploaded(storageKeys: readonly string[]): void {
    if (this.#disposed || storageKeys.length === 0) return;
    const touched = new Set<AssetEntry>();
    for (const storageKey of storageKeys) {
      const entry = this.#storageEntries.get(storageKey);
      if (entry === undefined) continue;
      this.#deniedStorageKeys.delete(storageKey);
      entry.residentStorageKeys.add(storageKey);
      touched.add(entry);
    }
    for (const entry of touched) {
      this.#releaseDecodedIfUnused(entry);
      if (
        entry.retainAlpha
        && entry.alpha === undefined
        && !entry.preparationRetainsAlpha
      ) this.#queuePreparation(entry);
    }
  }

  /** Reacquires decoded pixels when a previously resident WebGL copy is retired. */
  invalidateStorageResidency(storageKeys: readonly string[]): void {
    if (this.#disposed || storageKeys.length === 0) return;
    const touched = new Set<AssetEntry>();
    for (const storageKey of storageKeys) {
      const entry = this.#storageEntries.get(storageKey);
      if (entry === undefined || !entry.residentStorageKeys.delete(storageKey)) continue;
      touched.add(entry);
    }
    for (const entry of touched) {
      if (
        !entry.decodedReleased
        || entry.snapshot.status === "error"
        || !storageIncomplete(entry.claimedStorageKeys, entry.residentStorageKeys)
      ) continue;
      entry.snapshot = { status: "loading" };
      this.#platform.onSnapshotChanged(entry.key);
      this.#publish(entry.key);
      this.#queuePreparation(entry);
    }
  }

  /** Settles denied GPU representations without misclassifying decode readiness. */
  rejectGpuStorage(storageKeys: readonly string[]): void {
    if (this.#disposed || storageKeys.length === 0) return;
    const rejected = new Set<AssetEntry>();
    for (const storageKey of storageKeys) {
      const entry = this.#storageEntries.get(storageKey);
      if (entry !== undefined) {
        this.#deniedStorageKeys.add(storageKey);
        rejected.add(entry);
      }
    }
    for (const entry of rejected) {
      entry.alpha = undefined;
      entry.claimedStorageKeys.clear();
      entry.preparationDeferred = false;
      if (!entry.decodedReleased && entry.decodedClaims === 0) releaseDecodedTextureSource(entry.decoded);
      entry.decodedReleased = entry.decodedClaims === 0;
      if (entry.decodedClaims === 0) this.#releaseSourceReservation(entry);
      this.#platform.onAssetChanged(entry.key);
    }
  }

  /** Invalidates GPU copies while preserving unrelated transport and CPU preparation. */
  invalidateResidency(): void {
    if (this.#disposed) return;
    this.#residencyGeneration += 1;
    let changedKey: string | undefined;
    for (const entry of this.#entries.values()) {
      entry.residentStorageKeys.clear();
      if (entry.decoded?.kind === undefined && entry.decoded?.contextBound === true) {
        this.#platform.releaseDecoded?.(entry.asset);
        if (entry.decodedClaims === 0 && !entry.decodedReleased) {
          releaseDecodedTextureSource(entry.decoded);
          entry.decodedReleased = true;
          this.#releaseSourceReservation(entry);
        }
      }
      if (!entry.active) continue;
      if (
        (entry.decoded === undefined || entry.decodedReleased)
        && entry.reservation?.phase !== "preparing"
        && !entry.queued
        && entry.snapshot.status !== "error"
      ) {
        entry.alpha = undefined;
        entry.snapshot = { status: "loading" };
        this.#queuePreparation(entry);
      }
      // Materials must discard closed pixel references while re-decode is pending.
      this.#platform.onAssetChanged(entry.key);
      changedKey = entry.key;
      this.#publish(entry.key);
    }
    if (changedKey !== undefined) this.#platform.onSnapshotChanged(changedKey);
  }

  subscribe(asset: TextureAssetRef, listener: () => void): () => void {
    const key = decodedTextureKey(asset);
    if (this.#disposed) return () => undefined;
    return this.#listeners.subscribe(key, listener);
  }

  #publish(key: string): void {
    this.#listeners.publish(key, this.#platform.onListenerError);
  }

  #start(
    asset: TextureSourceRef,
    key: string,
    storageKeys: Set<string>,
    retainAlpha: boolean,
    active = true,
  ): void {
    const startedAt = this.#now();
    const entry: AssetEntry = {
      active,
      alpha: undefined,
      asset,
      claimedStorageKeys: new Set(storageKeys),
      controller: undefined,
      reservation: undefined,
      preparationDeferred: false,
      preparationStorageBytes: undefined,
      initialDecodeExtraBytes: 0,
      decoded: undefined,
      decodedClaims: 0,
      decodedReleased: false,
      preparationRetainsAlpha: false,
      preparationAlphaOnly: false,
      fallbackStorageKeys: new Set(),
      preparationQueuedAt: startedAt,
      preparationStartedAt: 0,
      key,
      queued: false,
      residentStorageKeys: new Set(),
      retainAlpha,
      snapshot: active ? { status: "loading" } : IDLE,
      startedAt,
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    this.#queuePreparation(entry);
  }

  #updateStorageShare(claims: readonly { source: DecodedTextureSource | undefined; copies: number }[]): void {
    const budget = this.#currentStorageBudgetBytes;
    if (budget === undefined) { this.#maxStorageBytes = undefined; return; }
    const demands = claims.filter(claim => claim.copies > 0).map(({ source, copies }) => {
      // A fitted native mip chain does not describe the discarded levels' byte cost.
      const fittedNative = source?.kind !== undefined && source.sourceWidth !== undefined
        && (source.sourceWidth > source.width || (source.sourceHeight ?? source.height) > source.height);
      const bytes = source === undefined || fittedNative ? Infinity
        : source.kind === undefined
          ? ordinaryTextureStorageBytes(source.sourceWidth ?? source.width, source.sourceHeight ?? source.height, true)
          : source.levels.reduce((total, level) => total + level.blocks.byteLength, 0);
      return { bytes, copies };
    });
    const share = textureStorageShare(budget, demands);
    // Match the existing raster-detail ceiling: a fitted RGBA mip chain leaves
    // its base pixels within both the 64 MiB VT source pool and inspection limit.
    this.#maxStorageBytes = share === undefined ? undefined : Math.min(share, 64 * 1024 * 1024);
  }

  #redistributeStorage(): void {
    if (this.#redistributionQueued) return;
    this.#redistributionQueued = true;
    queueMicrotask(() => {
      this.#redistributionQueued = false;
      if (this.#disposed) return;
      this.#updateStorageShare([...this.#entries.values()].filter(entry => entry.active).map(entry => ({
        source: entry.decoded, copies: entry.claimedStorageKeys.size,
      })));
      for (const entry of this.#entries.values()) this.#refreshStorageFit(entry);
    });
  }

  #usesPageCache(entry: AssetEntry): boolean {
    const source = entry.decoded;
    return this.#pageableKeys.has(entry.key) && (source === undefined
      || reloadableRasterPagingEligible(source));
  }

  #refreshStorageFit(entry: AssetEntry): void {
    const source = entry.decoded;
    if (this.#usesPageCache(entry)) return;
    if (source === undefined || source.sourceWidth === undefined || source.preview !== undefined
      || entry.snapshot.status === "error" || entry.reservation?.phase === "preparing"
      || (this.#maxStorageBytes ?? Infinity) <= (entry.preparationStorageBytes ?? Infinity)) return;
    const fit = source.kind === undefined
      ? fitOrdinaryTextureStorage(source.sourceWidth, source.sourceHeight ?? source.height, this.#maxStorageBytes ?? Number.MAX_SAFE_INTEGER)
      : { width: source.sourceWidth, height: source.sourceHeight ?? source.height };
    if (fit.width <= source.width && fit.height <= source.height) {
      entry.preparationStorageBytes = this.#maxStorageBytes;
      return;
    }
    const hadLease = entry.decodedClaims > 0;
    if (hadLease) this.#platform.releaseDecoded?.(entry.asset);
    if (hadLease && entry.decodedClaims === 0 && entry.reservation?.phase === "handoff") {
      releaseDecodedTextureSource(entry.decoded);
      entry.decodedReleased = true;
      this.#releaseSourceReservation(entry);
    }
    this.#queuePreparation(entry);
  }

  #queuePreparation(entry: AssetEntry): void {
    if (!entry.active) return;
    if (entry.reservation !== undefined) return;
    if (entry.decodedClaims > 0 && !(entry.retainAlpha && entry.alpha === undefined)) {
      entry.preparationDeferred = true;
      return;
    }
    entry.preparationDeferred = false;
    if (entry.queued) return;
    entry.controller ??= new AbortController();
    this.#platform.preload?.(entry.asset, entry.controller.signal, entry.retainAlpha);
    entry.preparationQueuedAt = this.#now();
    entry.queued = true;
    this.#preparationQueue.enqueue(entry);
    this.#drainPreparationQueue();
  }

  #drainPreparationQueue(): void {
    while (
      !this.#disposed
      && canReserveTextureSource(
        this.#reservations,
        this.#activeLimit,
        DECODED_HANDOFF_SOURCE_LIMIT,
        DECODED_HANDOFF_BYTE_THRESHOLD,
      )
    ) {
      const entry = this.#preparationQueue.dequeue();
      if (entry === undefined) return;
      if (!entry.active || !entry.queued || this.#entries.get(entry.key) !== entry) continue;
      entry.queued = false;
      if (entry.decodedClaims > 0 && !(entry.retainAlpha && entry.alpha === undefined)) {
        entry.preparationDeferred = true;
        continue;
      }
      this.#replaceReservation(entry, preparingTextureReservation);
      entry.preparationStartedAt = this.#now();
      this.#prepare(entry);
    }
  }

  #replaceReservation(entry: AssetEntry, next: TextureReservation): void {
    if (next === undefined) {
      this.#initialDecodeExtraBytes -= entry.initialDecodeExtraBytes;
      entry.initialDecodeExtraBytes = 0;
    }
    replaceTextureReservationInto(this.#reservations, entry.reservation, next);
    entry.reservation = next;
  }

  #releaseSourceReservation(entry: AssetEntry): void {
    if (entry.reservation === undefined) return;
    this.#replaceReservation(entry, undefined);
    this.#drainPreparationQueue();
  }

  #retainDecodedHandoff(
    entry: AssetEntry, decoded: DecodedTextureSource, alpha: DecodedTextureAlpha | undefined,
  ): void {
    if (entry.reservation?.phase !== "preparing") {
      throw new Error("Royal decoded texture completed without an active reservation");
    }
    this.#replaceReservation(entry, { phase: "handoff", bytes: decodedTextureHandoffBytes(decoded, alpha) });
  }

  #releaseDecodedIfUnused(entry: AssetEntry): void {
    if (
      entry.decodedClaims !== 0
      || entry.reservation?.phase === "preparing"
      || entry.decodedReleased
      || entry.decoded === undefined
      || (entry.active && storageIncomplete(entry.claimedStorageKeys, entry.residentStorageKeys))
    ) return;
    if (entry.fallbackStorageKeys.size > 0 && !this.#usesPageCache(entry)) {
      this.#releaseSourceReservation(entry);
      return;
    }
    releaseDecodedTextureSource(entry.decoded);
    entry.decodedReleased = true;
    this.#releaseSourceReservation(entry);
    this.#refreshStorageFit(entry);
  }

  #prepare(entry: AssetEntry): void {
    const controller = entry.controller ?? new AbortController();
    entry.controller = controller;
    const asset = entry.asset;
    const key = entry.key;
    const retainAlpha = entry.retainAlpha;
    const alphaOnly = entry.decodedClaims > 0;
    const residencyGeneration = this.#residencyGeneration;
    entry.preparationRetainsAlpha = retainAlpha;
    entry.preparationAlphaOnly = alphaOnly;
    const seedBytes = ordinaryTextureStorageBytes(256, 256, true);
    if (!alphaOnly) entry.preparationStorageBytes = this.#usesPageCache(entry)
      // Seed at least coarse coverage and its adjacent mip; camera hints can
      // supply larger initial detail without a second read.
      // This remains CPU cache storage; GPU safety fallbacks have their own fit.
      ? Math.min(this.#maxStorageBytes ?? Infinity, 16 * 1024 * 1024,
        seedBytes + INITIAL_DECODE_EXTRA_BYTE_LIMIT - this.#initialDecodeExtraBytes,
        Math.max(seedBytes, this.#initialDecodeBytes.get(key) ?? 0))
      : this.#maxStorageBytes;
    if (!alphaOnly && this.#usesPageCache(entry)) {
      // Reserve extra seed pixels across both in-flight decodes and handoffs.
      // The old seed floor remains available when the optional budget is full.
      entry.initialDecodeExtraBytes = Math.max(0, entry.preparationStorageBytes! - seedBytes);
      this.#initialDecodeExtraBytes += entry.initialDecodeExtraBytes;
    }
    const decoding: Promise<DecodedTextureSource> = retainAlpha
      ? this.#platform.decode(asset, controller.signal, entry.preparationStorageBytes, true)
      : this.#platform.decode(asset, controller.signal, entry.preparationStorageBytes);
    void decoding.then((decoded) => {
      if (
        this.#disposed
        || this.#entries.get(key) !== entry
        || entry.controller !== controller
        || controller.signal.aborted
      ) {
        releaseDecodedTextureSource(decoded);
        return;
      }
      if (decoded.kind === undefined && decoded.contextBound === true
        && residencyGeneration !== this.#residencyGeneration) {
        // A native decode begun before restoration can complete with stale pixels.
        releaseDecodedTextureSource(decoded);
        entry.controller = undefined;
        this.#releaseSourceReservation(entry);
        this.#queuePreparation(entry);
        return;
      }
      if (
        !Number.isSafeInteger(decoded.width)
        || decoded.width < 1
        || !Number.isSafeInteger(decoded.height)
        || decoded.height < 1
      ) {
        releaseDecodedTextureSource(decoded);
        throw new Error(`${diagnosticLabel(asset)} decoder returned invalid dimensions`);
      }
      if (decoded.sourceWidth !== undefined || decoded.sourceHeight !== undefined) {
        try {
          ordinaryTextureStorageBytes(decoded.sourceWidth ?? decoded.width, decoded.sourceHeight ?? decoded.height, true);
        } catch (error) { releaseDecodedTextureSource(decoded); throw error; }
      }
      const alpha = decoded.alpha;
      if (alpha !== undefined && (
        alpha.width !== decoded.width
        || alpha.height !== decoded.height
      )) {
        releaseDecodedTextureSource(decoded);
        throw new Error(`${diagnosticLabel(asset)} decoder returned invalid retained alpha`);
      }
      if (alpha !== undefined) {
        try {
          validateTextureAlphaMipChain(alpha);
        } catch (error) {
          releaseDecodedTextureSource(decoded);
          throw error;
        }
      }
      if (alphaOnly) {
        // A VT source can be leased for the whole scene lifetime. Publish the
        // auxiliary alpha plane without replacing or closing those live pixels.
        entry.alpha = entry.retainAlpha ? alpha : undefined;
        releaseDecodedTextureSource(decoded);
        entry.controller = undefined;
        this.#releaseSourceReservation(entry);
        this.#platform.onAssetChanged(key);
        this.#platform.onSnapshotChanged(key);
        this.#publish(key);
        this.#redistributeStorage();
        return;
      }
      let decodedSource: DecodedTextureSource = decoded;
      if (alpha !== undefined) {
        const { alpha: _discardedAlpha, ...sourceWithoutAlpha } = decoded;
        decodedSource = sourceWithoutAlpha;
      }
      try {
        this.#retainDecodedHandoff(
          entry,
          decodedSource,
          entry.retainAlpha ? alpha : undefined,
        );
      } catch (error) {
        releaseDecodedTextureSource(decodedSource);
        throw error;
      }
      if (entry.decoded !== undefined && (entry.decoded.width !== decodedSource.width || entry.decoded.height !== decodedSource.height)) entry.residentStorageKeys.clear();
      if (!entry.decodedReleased) releaseDecodedTextureSource(entry.decoded);
      entry.controller = undefined;
      entry.alpha = entry.retainAlpha ? alpha : undefined;
      entry.decoded = decodedSource;
      entry.decodedReleased = false;
      const completedAt = this.#now();
      entry.snapshot = {
        height: decoded.height,
        status: "ready",
        ...(decoded.timings === undefined ? {} : {
          timings: {
            decodeDurationMs: decoded.timings.decodeDurationMs,
            decodeQueueDurationMs: decoded.timings.decodeQueueDurationMs,
            firstReadyAfterMs: completedAt - entry.startedAt,
            preparationDurationMs: completedAt - entry.preparationStartedAt,
            preparationQueueDurationMs:
              entry.preparationStartedAt - entry.preparationQueuedAt,
            transportDurationMs: decoded.timings.transportDurationMs,
            transportQueueDurationMs: decoded.timings.transportQueueDurationMs,
          },
        }),
        width: decoded.width,
      };
      this.#platform.onAssetChanged(key);
      this.#platform.onSnapshotChanged(key);
      this.#publish(key);
      if (!storageIncomplete(entry.claimedStorageKeys, entry.residentStorageKeys)) {
        this.#releaseDecodedIfUnused(entry);
      } else this.#drainPreparationQueue();
      this.#redistributeStorage();
    }).catch((error: unknown) => {
      if (
        this.#disposed
        || this.#entries.get(key) !== entry
        || entry.controller !== controller
        || controller.signal.aborted
      ) return;
      entry.controller = undefined;
      this.#releaseSourceReservation(entry);
      if (!alphaOnly && entry.residentStorageKeys.size === 0) {
        entry.decoded = undefined;
        entry.decodedReleased = false;
        entry.snapshot = { error: formatFailure(error), status: "error" };
      }
      this.#platform.onAssetChanged(key);
      this.#platform.onSnapshotChanged(key);
      this.#publish(key);
    }).finally(() => {
      if (alphaOnly && !this.#disposed && this.#entries.get(key) === entry) {
        this.#releaseDecodedIfUnused(entry);
      }
    });
  }
}
