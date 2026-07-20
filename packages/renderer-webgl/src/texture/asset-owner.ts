import type {
  TextureAssetRef,
  TextureColorSpace,
  TextureContentKey,
  TextureVersion,
} from "@royal/renderer-core";
import type { Ktx2Etc2Level } from "./etc2-storage";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";

export type DecodedImageTextureSource = Readonly<{
  alpha?: DecodedTextureAlpha;
  close?: () => void;
  height: number;
  kind?: never;
  source: TexImageSource;
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
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
  mimeType: "image/avif" | "image/jpeg" | "image/png" | "image/webp";
  sampler?: TextureAssetRef["sampler"];
}>;

/** Cold source recipe shared by direct assets and container-embedded images. */
export type TextureSourceRef = TextureAssetRef | EmbeddedTextureAssetRef;

export type TextureAssetSnapshot =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "loading" }>
  | Readonly<{ height: number; state: "ready"; width: number }>
  | Readonly<{ error: string; state: "error" }>;

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
  decodeDeferred: boolean;
  decodeReservation: boolean;
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

const IDLE: TextureAssetSnapshot = { state: "idle" };
const DEFAULT_DECODED_TEXTURE_RESERVATIONS = 8;

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
  if (asset.kind === "embedded-asset") return JSON.stringify(["content", asset.contentKey]);
  const content = asset.contentKey === undefined
    ? ["src", asset.src] as const
    : ["content", ...identityPart(asset.contentKey, "contentKey")] as const;
  return JSON.stringify([content, identityPart(asset.version, "version")]);
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
  #activeDecodeReservations = 0;
  #disposed = false;
  readonly #decodeQueue: AssetEntry[] = [];
  readonly #entries = new Map<string, AssetEntry>();
  readonly #keys = new WeakMap<TextureSourceRef, string>();
  readonly #listeners = new Map<string, Set<() => void>>();
  #maxStorageBytes: number | undefined;
  readonly #platform: TextureAssetOwnerPlatform;
  readonly #storageBudgetBytes: number | undefined;
  readonly #storageEntries = new Map<string, AssetEntry>();

  constructor(platform: TextureAssetOwnerPlatform, storageBudgetBytes?: number) {
    if (storageBudgetBytes !== undefined && (
      !Number.isSafeInteger(storageBudgetBytes) || storageBudgetBytes < 1
    )) throw new RangeError("Royal texture storage budget must be a positive safe integer");
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
    this.#decodeQueue.length = 0;
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

  reconcile(
    assets: readonly TextureSourceRef[],
    alphaMaskAssets: readonly TextureSourceRef[] = [],
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
    const fairStorageBytes = this.#storageBudgetBytes === undefined || storageCount === 0
      ? undefined
      : Math.floor(this.#storageBudgetBytes / storageCount);
    this.#maxStorageBytes = fairStorageBytes !== undefined && fairStorageBytes >= 4
      ? fairStorageBytes
      : undefined;
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
        } else if (entry.alpha === undefined && entry.snapshot.state !== "error") {
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
        && entry.snapshot.state !== "error"
        && [...claim.storageKeys].some((storageKey) => !entry.residentStorageKeys.has(storageKey))
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

  /** Settles denied GPU representations without retaining their decoded pixels. */
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
      entry.snapshot = {
        error: "Royal persistent GPU budget denied texture storage",
        state: "error",
      };
      this.#platform.onAssetChanged(entry.key);
      this.#platform.onSnapshotChanged(entry.key);
      this.#publish(entry.key);
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
        entry.snapshot = { state: "loading" };
        this.#queueDecode(entry);
      }
      this.#platform.onAssetChanged(entry.key);
      this.#platform.onSnapshotChanged(entry.key);
      this.#publish(entry.key);
    }
  }

  subscribe(asset: TextureAssetRef, listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Royal texture asset subscriber must be a function");
    }
    const key = this.#key(asset);
    if (this.#disposed) return () => undefined;
    let listeners = this.#listeners.get(key);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(key, listeners);
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(key);
    };
  }

  #publish(key: string): void {
    const listeners = this.#listeners.get(key);
    if (listeners === undefined) return;
    const snapshot = [...listeners];
    for (const listener of snapshot) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        try {
          this.#platform.onListenerError(error);
        } catch {
          // Diagnostic sinks cannot interrupt later asset observers.
        }
      }
    }
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
      decodeDeferred: false,
      decodeReservation: false,
      decoded: undefined,
      decodedClaims: 0,
      decodedReleased: false,
      decodeRetainsAlpha: false,
      key,
      queued: false,
      residentStorageKeys: new Set(),
      retainAlpha,
      snapshot: { state: "loading" },
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    this.#queueDecode(entry);
  }

  #queueDecode(entry: AssetEntry): void {
    if (entry.controller !== undefined || entry.decodeReservation) return;
    if (entry.decodedClaims > 0) {
      entry.decodeDeferred = true;
      return;
    }
    if (entry.queued) return;
    entry.queued = true;
    this.#decodeQueue.push(entry);
    this.#drainDecodeQueue();
  }

  #drainDecodeQueue(): void {
    while (
      !this.#disposed
      && this.#activeDecodeReservations < DEFAULT_DECODED_TEXTURE_RESERVATIONS
    ) {
      const entry = this.#decodeQueue.shift();
      if (entry === undefined) return;
      if (!entry.queued || this.#entries.get(entry.key) !== entry) continue;
      entry.queued = false;
      entry.decodeReservation = true;
      this.#activeDecodeReservations += 1;
      this.#decode(entry);
    }
  }

  #releaseDecodeReservation(entry: AssetEntry): void {
    if (!entry.decodeReservation) return;
    entry.decodeReservation = false;
    this.#activeDecodeReservations -= 1;
    this.#drainDecodeQueue();
  }

  #releaseDecodedIfUnused(entry: AssetEntry): void {
    if (
      entry.decodedClaims !== 0
      || entry.decodedReleased
      || entry.decoded === undefined
      || [...entry.claimedStorageKeys].some(
        (storageKey) => !entry.residentStorageKeys.has(storageKey),
      )
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
      if (!entry.decodedReleased) entry.decoded?.close?.();
      entry.controller = undefined;
      entry.alpha = entry.retainAlpha ? alpha : undefined;
      entry.decoded = decodedSource;
      entry.decodedReleased = false;
      entry.snapshot = { height: decoded.height, state: "ready", width: decoded.width };
      this.#platform.onAssetChanged(key);
      this.#platform.onSnapshotChanged(key);
      this.#publish(key);
      if (
        [...entry.claimedStorageKeys].every(
          (storageKey) => entry.residentStorageKeys.has(storageKey),
        )
      ) {
        decodedSource.close?.();
        entry.decodedReleased = true;
        this.#releaseDecodeReservation(entry);
      }
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
        entry.snapshot = { error: formatFailure(error), state: "error" };
      }
      this.#platform.onSnapshotChanged(key);
      this.#publish(key);
    });
  }
}
