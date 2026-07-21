import type {
  TextureAssetRef,
  TextureColorSpace,
  TextureContentKey,
  TextureVersion,
} from "@royal/renderer-core";
import type { Ktx2Etc2Level } from "./etc2-storage";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";
import { RetainedFifo } from "../resource/retained-fifo";
import { KeyedRetainedListeners } from "../resource/retained-listeners";

export type DecodedImageTextureSource = Readonly<{
  alpha?: DecodedTextureAlpha;
  close?: () => void;
  /** Encoded vector authority retained only when another representation needs it. */
  encodedSvg?: EncodedSvgTextureSource;
  height: number;
  kind?: never;
  source: TexImageSource;
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
}>;

export type EncodedSvgTextureSource = Readonly<{
  blob: Blob;
  byteLength: number;
}>;

export type DecodedKtx2Etc2TextureSource = Readonly<{
  alpha?: DecodedTextureAlpha;
  close?: () => void;
  colorSpace: TextureColorSpace;
  height: number;
  kind: "ktx2-etc2";
  levels: readonly Ktx2Etc2Level[];
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
}>;

/** Canonical CPU upload source: a browser image or already-GPU-native ETC2 levels. */
export type DecodedTextureSource = DecodedImageTextureSource | DecodedKtx2Etc2TextureSource;

/** Explicit CPU-source claim used by optional representations such as automatic VT. */
export type DecodedTextureLease = Readonly<{
  release(): void;
  source: DecodedTextureSource;
}>;

/** Compact CPU representation retained only while an alpha-mask pick claim exists. */
export type DecodedTextureAlpha = Readonly<{
  height: number;
  values: Uint8Array;
  width: number;
}>;

export type EmbeddedTextureAssetRef = Readonly<{
  bytes: Uint8Array;
  colorSpace?: "linear" | "srgb";
  contentKey: string;
  kind: "embedded-asset";
  label: string;
  mimeType: "image/avif" | "image/jpeg" | "image/ktx2" | "image/png" | "image/webp";
  sampler?: TextureAssetRef["sampler"];
  sourceEncoding?: "ktx2-etc2";
}>;

/** Cold source recipe shared by direct assets and container-embedded images. */
export type TextureSourceRef =
  | (TextureAssetRef & Readonly<{ sourceEncoding?: "ktx2-etc2" }>)
  | EmbeddedTextureAssetRef;

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
    /** Fitted upload width in texels. */
    width: number;
  }>
  | Readonly<{ error: string; status: "error" }>;

export type TexturePreparationSnapshot = Readonly<{
  /** Browser texture decodes currently executing. */
  activeDecodes: number;
  /** Maximum simultaneous active-decode and decoded-handoff source reservations. */
  decodeReservationLimit: number;
  /** Active decodes plus decoded sources currently retaining a handoff reservation. */
  decodeReservations: number;
  /** Estimated CPU bytes currently retained for decoded GPU handoff. */
  decodedHandoffBytes: number;
  /** Soft decoded-handoff byte ceiling; one source may exceed it alone. */
  decodedHandoffThresholdBytes: number;
  /** Claimed color-space/sampler storage representations not yet GPU-resident. */
  pendingStorageRepresentations: number;
  /** Encoded SVG bytes retained for an optional vector-backed representation. */
  retainedEncodedSourceBytes: number;
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
  schedule?: AsyncPreparationScheduler;
}>;

type AssetEntry = {
  alpha: DecodedTextureAlpha | undefined;
  asset: TextureSourceRef;
  readonly claimedStorageKeys: Set<string>;
  controller: AbortController | undefined;
  decodeActive: boolean;
  decodeDeferred: boolean;
  decodedReservationBytes: number;
  readonly key: string;
  decoded: DecodedTextureSource | undefined;
  decodedClaims: number;
  decodedReleased: boolean;
  decodeRetainsAlpha: boolean;
  queued: boolean;
  readonly residentStorageKeys: Set<string>;
  retainAlpha: boolean;
  snapshot: TextureAssetSnapshot;
};

const IDLE: TextureAssetSnapshot = { status: "idle" };
const ACTIVE_TEXTURE_DECODE_LIMIT = 8;
const DECODED_HANDOFF_BYTE_THRESHOLD = 64 * 1024 * 1024;
const DECODED_HANDOFF_SOURCE_LIMIT = 32;

/** Exact retained CPU bytes after browser decode has selected a representation. */
export const decodedTextureHandoffBytes = (
  decoded: DecodedTextureSource,
  alpha: DecodedTextureAlpha | undefined = decoded.alpha,
): number => {
  const textureBytes = decoded.kind === "ktx2-etc2"
    ? decoded.levels.reduce((total, level) => total + level.blocks.byteLength, 0)
    : decoded.width * decoded.height * 4;
  const bytes = textureBytes + (alpha?.values.byteLength ?? 0);
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

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

const identityPart = (
  value: TextureContentKey | TextureVersion | undefined,
  label: string,
): readonly [string, number | string | null] => {
  if (value === undefined) return ["unset", null];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Royal texture ${label} must be finite`);
    return ["number", value];
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Royal texture ${label} must be a non-empty string or finite number`);
  }
  return ["string", value];
};

const validateAsset = (asset: TextureSourceRef): void => {
  if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
    throw new TypeError("Royal texture asset identity must be an object");
  }
  if (asset.sourceEncoding !== undefined && asset.sourceEncoding !== "ktx2-etc2") {
    throw new TypeError("Royal texture sourceEncoding must be ktx2-etc2 when present");
  }
  if (asset.kind === "embedded-asset") {
    if (asset.contentKey.length === 0) {
      throw new TypeError("Royal embedded texture contentKey must not be empty");
    }
    if (asset.bytes.byteLength === 0) {
      throw new TypeError("Royal embedded texture bytes must not be empty");
    }
    return;
  }
  if (asset.kind !== "asset") throw new TypeError("Royal ordinary texture asset kind must be asset");
  if (typeof asset.src !== "string" || asset.src.length === 0) {
    throw new TypeError("Royal texture asset src must be a non-empty string");
  }
};

/** Identity of decoded pixels; color interpretation and sampling deliberately do not participate. */
export const decodedTextureKey = (asset: TextureSourceRef): string => {
  validateAsset(asset);
  if (asset.kind === "embedded-asset") {
    return JSON.stringify(["content", asset.contentKey, asset.sourceEncoding ?? asset.mimeType]);
  }
  const content = asset.contentKey === undefined
    ? ["src", asset.src] as const
    : ["content", ...identityPart(asset.contentKey, "contentKey")] as const;
  return JSON.stringify([
    content,
    identityPart(asset.version, "version"),
    asset.sourceEncoding ?? "auto",
  ]);
};

/** GPU storage identity; one decoded image may be interpreted in both color spaces. */
export const textureStorageKey = (asset: TextureSourceRef): string =>
  JSON.stringify([decodedTextureKey(asset), asset.colorSpace ?? "srgb"]);

const diagnosticLabel = (asset: TextureSourceRef): string => {
  if (asset.kind === "embedded-asset") return asset.label;
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `texture ${JSON.stringify(source)}`;
};

/** Owns exact decoded-content claims, asynchronous decode, and focused status publication. */
export class TextureAssetOwner {
  #activeDecodes = 0;
  #decodeReservations = 0;
  #decodedHandoffBytes = 0;
  #disposed = false;
  readonly #decodeQueue = new RetainedFifo<AssetEntry>();
  readonly #entries = new Map<string, AssetEntry>();
  readonly #keys = new WeakMap<TextureSourceRef, string>();
  readonly #listeners = new KeyedRetainedListeners<string>();
  #maxStorageBytes: number | undefined;
  readonly #platform: TextureAssetOwnerPlatform;
  readonly #storageBudgetBytes: number | undefined;
  readonly #storageEntries = new Map<string, AssetEntry>();

  constructor(platform: TextureAssetOwnerPlatform, storageBudgetBytes?: number) {
    if (storageBudgetBytes !== undefined && (
      !Number.isSafeInteger(storageBudgetBytes) || storageBudgetBytes < 0
    )) throw new RangeError("Royal texture storage budget must be a non-negative safe integer");
    this.#platform = platform;
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
    this.#decodeQueue.clear();
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
    this.#releaseDecodeReservation(entry);
    let active = true;
    return {
      release: () => {
        if (!active) return;
        active = false;
        if (this.#disposed) return;
        entry.decodedClaims -= 1;
        if (entry.decodedClaims === 0 && entry.decodeDeferred) {
          entry.decodeDeferred = false;
          this.#queueDecode(entry);
          return;
        }
        this.#releaseDecodedIfUnused(entry);
      },
      source: entry.decoded,
    };
  }

  alpha(asset: TextureSourceRef): DecodedTextureAlpha | undefined {
    const entry = this.#entries.get(this.#key(asset));
    return entry?.retainAlpha === true ? entry.alpha : undefined;
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
    for (const entry of this.#entries.values()) {
      retainedEncodedSourceBytes += entry.decoded?.kind === "ktx2-etc2"
        ? 0
        : entry.decoded?.encodedSvg?.byteLength ?? 0;
      for (const storageKey of entry.claimedStorageKeys) {
        if (!entry.residentStorageKeys.has(storageKey)) pendingStorageRepresentations += 1;
      }
    }
    return {
      activeDecodes: this.#activeDecodes,
      decodeReservationLimit: DECODED_HANDOFF_SOURCE_LIMIT,
      decodeReservations: this.#decodeReservations,
      decodedHandoffBytes: this.#decodedHandoffBytes,
      decodedHandoffThresholdBytes: DECODED_HANDOFF_BYTE_THRESHOLD,
      pendingStorageRepresentations,
      retainedEncodedSourceBytes,
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
          if (entry.controller !== undefined && !entry.decodeRetainsAlpha) {
            entry.controller.abort();
            entry.controller = undefined;
            this.#releaseDecodeReservation(entry);
          }
          this.#queueDecode(entry);
        }
      }
      if (
        entry.decodedReleased
        && entry.snapshot.status !== "error"
        && storageIncomplete(claim.storageKeys, entry.residentStorageKeys)
      ) this.#queueDecode(entry);
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
      this.#releaseDecodeReservation(entry);
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
        && !entry.decodeRetainsAlpha
      ) this.#queueDecode(entry);
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
      entry.decodeDeferred = false;
      if (!entry.decodedReleased && entry.decodedClaims === 0) entry.decoded?.close?.();
      entry.decodedReleased = entry.decodedClaims === 0;
      if (entry.decodedClaims === 0) this.#releaseDecodeReservation(entry);
      this.#platform.onAssetChanged(entry.key);
    }
  }

  /** Context restoration needs fresh upload sources, not retained decoded pixels. */
  invalidateResidency(): void {
    if (this.#disposed) return;
    for (const entry of this.#entries.values()) {
      entry.alpha = undefined;
      entry.residentStorageKeys.clear();
      entry.controller?.abort();
      entry.controller = undefined;
      if (!entry.decodedReleased && entry.decodedClaims === 0) entry.decoded?.close?.();
      entry.decodedReleased = entry.decodedClaims === 0;
      entry.queued = false;
      entry.decodeDeferred = false;
      if (entry.decodedClaims === 0) {
        this.#releaseDecodeReservation(entry);
        entry.snapshot = { status: "loading" };
        this.#queueDecode(entry);
      }
      this.#platform.onAssetChanged(entry.key);
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
    const entry: AssetEntry = {
      alpha: undefined,
      asset,
      claimedStorageKeys: new Set(storageKeys),
      controller: undefined,
      decodeActive: false,
      decodeDeferred: false,
      decodedReservationBytes: 0,
      decoded: undefined,
      decodedClaims: 0,
      decodedReleased: false,
      decodeRetainsAlpha: false,
      key,
      queued: false,
      residentStorageKeys: new Set(),
      retainAlpha,
      snapshot: { status: "loading" },
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    this.#queueDecode(entry);
  }

  #queueDecode(entry: AssetEntry): void {
    if (entry.decodeActive || entry.decodedReservationBytes !== 0) return;
    if (entry.decodedClaims > 0) {
      entry.decodeDeferred = true;
      return;
    }
    if (entry.queued) return;
    entry.queued = true;
    this.#decodeQueue.enqueue(entry);
    this.#drainDecodeQueue();
  }

  #drainDecodeQueue(): void {
    while (
      !this.#disposed
      && this.#activeDecodes < ACTIVE_TEXTURE_DECODE_LIMIT
      && this.#decodeReservations < DECODED_HANDOFF_SOURCE_LIMIT
      && (
        this.#decodeReservations === this.#activeDecodes
        || this.#decodedHandoffBytes < DECODED_HANDOFF_BYTE_THRESHOLD
      )
    ) {
      const entry = this.#decodeQueue.dequeue();
      if (entry === undefined) return;
      if (!entry.queued || this.#entries.get(entry.key) !== entry) continue;
      entry.queued = false;
      entry.decodeActive = true;
      this.#activeDecodes += 1;
      this.#decodeReservations += 1;
      this.#decode(entry);
    }
  }

  #releaseDecodeReservation(entry: AssetEntry): void {
    const bytes = entry.decodedReservationBytes;
    if (!entry.decodeActive && bytes === 0) return;
    if (entry.decodeActive) this.#activeDecodes -= 1;
    else this.#decodedHandoffBytes -= bytes;
    entry.decodeActive = false;
    entry.decodedReservationBytes = 0;
    this.#decodeReservations -= 1;
    this.#drainDecodeQueue();
  }

  #retainDecodedHandoff(
    entry: AssetEntry,
    decoded: DecodedTextureSource,
    alpha: DecodedTextureAlpha | undefined,
  ): void {
    if (!entry.decodeActive) {
      throw new Error("Royal decoded texture completed without an active reservation");
    }
    const bytes = decodedTextureHandoffBytes(decoded, alpha);
    entry.decodeActive = false;
    entry.decodedReservationBytes = bytes;
    this.#activeDecodes -= 1;
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
    this.#releaseDecodeReservation(entry);
  }

  #decode(entry: AssetEntry): void {
    const controller = new AbortController();
    entry.controller = controller;
    const asset = entry.asset;
    const key = entry.key;
    const retainAlpha = entry.retainAlpha;
    entry.decodeRetainsAlpha = retainAlpha;
    const decode = (): Promise<DecodedTextureSource> => retainAlpha
      ? this.#platform.decode(asset, controller.signal, this.#maxStorageBytes, true)
      : this.#platform.decode(asset, controller.signal, this.#maxStorageBytes);
    const decoding = this.#platform.schedule === undefined
      ? decode()
      : this.#platform.schedule(controller.signal, decode);
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
        || alpha.values.length !== decoded.width * decoded.height
      )) {
        decoded.close?.();
        throw new Error(`${diagnosticLabel(asset)} decoder returned invalid retained alpha`);
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
      entry.snapshot = { height: decoded.height, status: "ready", width: decoded.width };
      this.#platform.onAssetChanged(key);
      this.#platform.onSnapshotChanged(key);
      this.#publish(key);
      if (!storageIncomplete(entry.claimedStorageKeys, entry.residentStorageKeys)) {
        decodedSource.close?.();
        entry.decodedReleased = true;
        this.#releaseDecodeReservation(entry);
      } else this.#drainDecodeQueue();
    }).catch((error: unknown) => {
      if (
        this.#disposed
        || this.#entries.get(key) !== entry
        || entry.controller !== controller
        || controller.signal.aborted
      ) return;
      entry.controller = undefined;
      this.#releaseDecodeReservation(entry);
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
