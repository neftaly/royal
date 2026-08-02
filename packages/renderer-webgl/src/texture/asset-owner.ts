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
  type EncodedSvgTextureSource,
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
    /** Preferred-source failure when the ready pixels came from an authored fallback. */
    fallbackReason?: string;
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
  /** Encoded SVG bytes retained for an optional vector-backed representation. */
  retainedEncodedSourceBytes: number;
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
  onListenerError(error: unknown): void;
  onSnapshotChanged(key: string): void;
  now?(): number;
  preload?(asset: TextureSourceRef, signal: AbortSignal): void;
  readAheadSnapshot?(): StagedByteReadSnapshot | undefined;
}>;

type AssetEntry = {
  alpha: DecodedTextureAlpha | undefined;
  asset: TextureSourceRef;
  readonly claimedStorageKeys: Set<string>;
  controller: AbortController | undefined;
  preparationActive: boolean;
  preparationDeferred: boolean;
  decodedReservationBytes: number;
  readonly key: string;
  decoded: DecodedTextureSource | undefined;
  decodedClaims: number;
  decodedReleased: boolean;
  preparationRetainsAlpha: boolean;
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

/** Exact retained CPU bytes after browser decode has selected a representation. */
export const decodedTextureHandoffBytes = (
  decoded: DecodedTextureSource,
  alpha: DecodedTextureAlpha | undefined = decoded.alpha,
): number => {
  const textureBytes = decoded.kind === "ktx2-etc2"
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
  #activePreparations = 0;
  #sourceReservations = 0;
  #decodedHandoffBytes = 0;
  #disposed = false;
  readonly #preparationQueue = new RetainedFifo<AssetEntry>();
  readonly #entries = new Map<string, AssetEntry>();
  readonly #keys = new WeakMap<TextureSourceRef, string>();
  readonly #listeners = new KeyedRetainedListeners<string>();
  #maxStorageBytes: number | undefined;
  readonly #now: () => number;
  readonly #platform: TextureAssetOwnerPlatform;
  readonly #storageBudgetBytes: number | undefined;
  readonly #storageEntries = new Map<string, AssetEntry>();

  constructor(platform: TextureAssetOwnerPlatform, storageBudgetBytes?: number) {
    if (storageBudgetBytes !== undefined && (
      !Number.isSafeInteger(storageBudgetBytes) || storageBudgetBytes < 0
    )) throw new RangeError("Royal texture storage budget must be a non-negative safe integer");
    this.#platform = platform;
    this.#now = platform.now ?? (() => performance.now());
    this.#storageBudgetBytes = storageBudgetBytes;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      entry.controller?.abort();
      if (!entry.decodedReleased) entry.decoded?.close?.();
      entry.decodedReleased = true;
    }
    this.#preparationQueue.clear();
    this.#entries.clear();
    this.#listeners.clear();
    this.#storageEntries.clear();
  }

  decoded(asset: TextureSourceRef): DecodedTextureSource | undefined {
    const entry = this.#entries.get(this.#key(asset));
    if (entry === undefined || entry.decoded === undefined) return undefined;
    return !entry.decodedReleased || entry.residentStorageKeys.has(textureStorageKey(asset))
      ? entry.decoded
      : undefined;
  }

  /** Retains live decoded pixels until the returned idempotent lease is released. */
  acquireDecoded(asset: TextureSourceRef): DecodedTextureLease | undefined {
    if (this.#disposed) return undefined;
    const entry = this.#entries.get(this.#key(asset));
    if (entry?.decoded === undefined || entry.decodedReleased) return undefined;
    entry.decodedClaims += 1;
    // The optional representation now charges the retained source; this slot
    // only bounds decode handoff and must not starve unrelated asset decoding.
    this.#releaseSourceReservation(entry);
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
        this.#releaseDecodedIfUnused(entry);
      },
      source: entry.decoded,
    };
  }

  alpha(asset: TextureSourceRef): DecodedTextureAlpha | undefined {
    const entry = this.#entries.get(this.#key(asset));
    return entry?.retainAlpha === true
      && entry.residentStorageKeys.has(textureStorageKey(asset))
      ? entry.alpha
      : undefined;
  }

  getSnapshot(asset: TextureAssetRef): TextureAssetSnapshot {
    return this.#entries.get(this.#key(asset))?.snapshot ?? IDLE;
  }

  getSourceSnapshot(asset: TextureSourceRef): TextureAssetSnapshot {
    return this.#entries.get(this.#key(asset))?.snapshot ?? IDLE;
  }

  snapshot(): TexturePreparationSnapshot {
    let pendingStorageRepresentations = 0;
    let retainedEncodedSourceBytes = 0;
    let timedSources = 0;
    const timings = {
      decodeDurationMs: 0,
      decodeQueueDurationMs: 0,
      transportDurationMs: 0,
      transportQueueDurationMs: 0,
    };
    const encodedSourceReads = this.#platform.readAheadSnapshot?.();
    for (const entry of this.#entries.values()) {
      retainedEncodedSourceBytes += entry.decoded?.kind === "ktx2-etc2"
        ? 0
        : entry.decoded?.encodedSvg?.byteLength ?? 0;
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
      activePreparations: this.#activePreparations,
      ...(timedSources === 0 ? {} : {
        browserStageTimings: {
          sourceCount: timedSources,
          totals: timings,
        },
      }),
      decodedHandoffBytes: this.#decodedHandoffBytes,
      decodedHandoffThresholdBytes: DECODED_HANDOFF_BYTE_THRESHOLD,
      ...(encodedSourceReads === undefined ? {} : { encodedSourceReads }),
      pendingStorageRepresentations,
      retainedEncodedSourceBytes,
      sourceReservationLimit: DECODED_HANDOFF_SOURCE_LIMIT,
      sourceReservations: this.#sourceReservations,
    };
  }

  reconcile(
    assets: readonly TextureSourceRef[],
    alphaMaskAssets: readonly TextureSourceRef[] = [],
    storageBudgetBytes: number | undefined = this.#storageBudgetBytes,
  ): void {
    if (this.#disposed) return;
    this.#storageEntries.clear();
    const retainedAlphaKeys = new Set<string>();
    for (const asset of alphaMaskAssets) retainedAlphaKeys.add(this.#key(asset));
    const claimed = new Map<string, { asset: TextureSourceRef; storageKeys: Set<string> }>();
    for (const asset of assets) {
      const key = this.#key(asset);
      const storageKey = textureStorageKey(asset);
      const existing = claimed.get(key);
      if (existing === undefined) claimed.set(key, { asset, storageKeys: new Set([storageKey]) });
      else existing.storageKeys.add(storageKey);
    }
    let storageCount = 0;
    for (const claim of claimed.values()) storageCount += claim.storageKeys.size;
    const fairStorageBytes = storageBudgetBytes === undefined || storageCount === 0
      ? undefined
      : Math.floor(storageBudgetBytes / storageCount);
    this.#maxStorageBytes = fairStorageBytes === undefined
      ? undefined
      : Math.max(4, fairStorageBytes);
    for (const [key, claim] of claimed) {
      const entry = this.#entries.get(key);
      if (entry === undefined) {
        this.#start(claim.asset, key, claim.storageKeys, retainedAlphaKeys.has(key));
        continue;
      }
      entry.asset = claim.asset;
      entry.claimedStorageKeys.clear();
      for (const storageKey of claim.storageKeys) entry.claimedStorageKeys.add(storageKey);
      for (const storageKey of entry.residentStorageKeys) {
        if (!claim.storageKeys.has(storageKey)) entry.residentStorageKeys.delete(storageKey);
      }
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
      if (!entry.decodedReleased) entry.decoded?.close?.();
      entry.decodedReleased = true;
      entry.queued = false;
      this.#releaseSourceReservation(entry);
      this.#publish(key);
    }
  }

  /** Releases browser decode storage after the claimed WebGL copies are resident. */
  releaseUploaded(storageKeys: readonly string[]): void {
    if (this.#disposed || storageKeys.length === 0) return;
    const touched = new Set<AssetEntry>();
    for (const storageKey of storageKeys) {
      const entry = this.#storageEntries.get(storageKey);
      if (entry === undefined) continue;
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
      if (entry !== undefined) rejected.add(entry);
    }
    for (const entry of rejected) {
      entry.alpha = undefined;
      entry.claimedStorageKeys.clear();
      entry.preparationDeferred = false;
      if (!entry.decodedReleased && entry.decodedClaims === 0) entry.decoded?.close?.();
      entry.decodedReleased = entry.decodedClaims === 0;
      if (entry.decodedClaims === 0) this.#releaseSourceReservation(entry);
      this.#platform.onAssetChanged(entry.key);
    }
  }

  /** Invalidates GPU copies while preserving unrelated transport and CPU preparation. */
  invalidateResidency(): void {
    if (this.#disposed) return;
    for (const entry of this.#entries.values()) {
      entry.residentStorageKeys.clear();
      if (entry.decoded !== undefined && !entry.decodedReleased) {
        this.#platform.onAssetChanged(entry.key);
      } else if (
        !entry.preparationActive
        && !entry.queued
        && entry.snapshot.status !== "error"
      ) {
        entry.alpha = undefined;
        entry.snapshot = { status: "loading" };
        this.#queuePreparation(entry);
      }
      this.#platform.onSnapshotChanged(entry.key);
      this.#publish(entry.key);
    }
  }

  subscribe(asset: TextureAssetRef, listener: () => void): () => void {
    const key = this.#key(asset);
    if (this.#disposed) return () => undefined;
    return this.#listeners.subscribe(key, listener);
  }

  #publish(key: string): void {
    this.#listeners.publish(key, this.#platform.onListenerError);
  }

  #key(asset: TextureSourceRef): string {
    let key = this.#keys.get(asset);
    if (key === undefined) {
      key = decodedTextureKey(asset);
      this.#keys.set(asset, key);
    }
    return key;
  }

  #start(
    asset: TextureSourceRef,
    key: string,
    storageKeys: Set<string>,
    retainAlpha: boolean,
  ): void {
    const startedAt = this.#now();
    const entry: AssetEntry = {
      alpha: undefined,
      asset,
      claimedStorageKeys: new Set(storageKeys),
      controller: undefined,
      preparationActive: false,
      preparationDeferred: false,
      decodedReservationBytes: 0,
      decoded: undefined,
      decodedClaims: 0,
      decodedReleased: false,
      preparationRetainsAlpha: false,
      preparationQueuedAt: startedAt,
      preparationStartedAt: 0,
      key,
      queued: false,
      residentStorageKeys: new Set(),
      retainAlpha,
      snapshot: { status: "loading" },
      startedAt,
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    this.#queuePreparation(entry);
  }

  #queuePreparation(entry: AssetEntry): void {
    if (entry.preparationActive || entry.decodedReservationBytes !== 0) return;
    if (entry.decodedClaims > 0) {
      entry.preparationDeferred = true;
      return;
    }
    if (entry.queued) return;
    entry.controller ??= new AbortController();
    this.#platform.preload?.(entry.asset, entry.controller.signal);
    entry.preparationQueuedAt = this.#now();
    entry.queued = true;
    this.#preparationQueue.enqueue(entry);
    this.#drainPreparationQueue();
  }

  #drainPreparationQueue(): void {
    while (
      !this.#disposed
      && this.#activePreparations < ACTIVE_TEXTURE_PREPARATION_LIMIT
      && this.#sourceReservations < DECODED_HANDOFF_SOURCE_LIMIT
      && (
        this.#sourceReservations === this.#activePreparations
        || this.#decodedHandoffBytes < DECODED_HANDOFF_BYTE_THRESHOLD
      )
    ) {
      const entry = this.#preparationQueue.dequeue();
      if (entry === undefined) return;
      if (!entry.queued || this.#entries.get(entry.key) !== entry) continue;
      entry.queued = false;
      entry.preparationActive = true;
      entry.preparationStartedAt = this.#now();
      this.#activePreparations += 1;
      this.#sourceReservations += 1;
      this.#prepare(entry);
    }
  }

  #releaseSourceReservation(entry: AssetEntry): void {
    const bytes = entry.decodedReservationBytes;
    if (!entry.preparationActive && bytes === 0) return;
    if (entry.preparationActive) this.#activePreparations -= 1;
    else this.#decodedHandoffBytes -= bytes;
    entry.preparationActive = false;
    entry.decodedReservationBytes = 0;
    this.#sourceReservations -= 1;
    this.#drainPreparationQueue();
  }

  #retainDecodedHandoff(
    entry: AssetEntry,
    decoded: DecodedTextureSource,
    alpha: DecodedTextureAlpha | undefined,
  ): void {
    if (!entry.preparationActive) {
      throw new Error("Royal decoded texture completed without an active reservation");
    }
    const bytes = decodedTextureHandoffBytes(decoded, alpha);
    entry.preparationActive = false;
    entry.decodedReservationBytes = bytes;
    this.#activePreparations -= 1;
    this.#decodedHandoffBytes += bytes;
  }

  #releaseDecodedIfUnused(entry: AssetEntry): void {
    if (
      entry.decodedClaims !== 0
      || entry.decodedReleased
      || entry.decoded === undefined
      || storageIncomplete(entry.claimedStorageKeys, entry.residentStorageKeys)
    ) return;
    entry.decoded.close?.();
    entry.decodedReleased = true;
    this.#releaseSourceReservation(entry);
  }

  #prepare(entry: AssetEntry): void {
    const controller = entry.controller ?? new AbortController();
    entry.controller = controller;
    const asset = entry.asset;
    const key = entry.key;
    const retainAlpha = entry.retainAlpha;
    entry.preparationRetainsAlpha = retainAlpha;
    const decoding: Promise<DecodedTextureSource> = retainAlpha
      ? this.#platform.decode(asset, controller.signal, this.#maxStorageBytes, true)
      : this.#platform.decode(asset, controller.signal, this.#maxStorageBytes);
    void decoding.then((decoded) => {
      if (
        this.#disposed
        || this.#entries.get(key) !== entry
        || entry.controller !== controller
        || controller.signal.aborted
      ) {
        decoded.close?.();
        return;
      }
      if (
        !Number.isSafeInteger(decoded.width)
        || decoded.width < 1
        || !Number.isSafeInteger(decoded.height)
        || decoded.height < 1
      ) {
        decoded.close?.();
        throw new Error(`${diagnosticLabel(asset)} decoder returned invalid dimensions`);
      }
      const alpha = decoded.alpha;
      if (alpha !== undefined && (
        alpha.width !== decoded.width
        || alpha.height !== decoded.height
      )) {
        decoded.close?.();
        throw new Error(`${diagnosticLabel(asset)} decoder returned invalid retained alpha`);
      }
      if (alpha !== undefined) {
        try {
          validateTextureAlphaMipChain(alpha);
        } catch (error) {
          decoded.close?.();
          throw error;
        }
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
        decodedSource.close?.();
        throw error;
      }
      if (!entry.decodedReleased) entry.decoded?.close?.();
      entry.controller = undefined;
      entry.alpha = entry.retainAlpha ? alpha : undefined;
      entry.decoded = decodedSource;
      entry.decodedReleased = false;
      const completedAt = this.#now();
      entry.snapshot = {
        ...(decoded.fallbackReason === undefined
          ? {}
          : { fallbackReason: decoded.fallbackReason }),
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
        decodedSource.close?.();
        entry.decodedReleased = true;
        this.#releaseSourceReservation(entry);
      } else this.#drainPreparationQueue();
    }).catch((error: unknown) => {
      if (
        this.#disposed
        || this.#entries.get(key) !== entry
        || entry.controller !== controller
        || controller.signal.aborted
      ) return;
      entry.controller = undefined;
      this.#releaseSourceReservation(entry);
      if (entry.residentStorageKeys.size === 0) {
        entry.decoded = undefined;
        entry.decodedReleased = false;
        entry.snapshot = { error: formatFailure(error), status: "error" };
      }
      this.#platform.onAssetChanged(key);
      this.#platform.onSnapshotChanged(key);
      this.#publish(key);
    });
  }
}
