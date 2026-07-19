import type {
  TextureAssetRef,
  TextureContentKey,
  TextureVersion,
} from "@royal/renderer-core";

export type DecodedTextureSource = Readonly<{
  close?: () => void;
  height: number;
  source: TexImageSource;
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
  decode(asset: TextureSourceRef, signal: AbortSignal): Promise<DecodedTextureSource>;
  onAssetChanged(key: string): void;
  onListenerError(error: unknown): void;
}>;

type AssetEntry = {
  readonly asset: TextureSourceRef;
  readonly controller: AbortController;
  readonly key: string;
  decoded: DecodedTextureSource | undefined;
  snapshot: TextureAssetSnapshot;
};

const IDLE: TextureAssetSnapshot = { state: "idle" };

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

const diagnosticLabel = (asset: TextureSourceRef): string => {
  if (asset.kind === "embedded-asset") return asset.label;
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `texture ${JSON.stringify(source)}`;
};

/** Owns exact decoded-content claims, asynchronous decode, and focused status publication. */
export class TextureAssetOwner {
  #disposed = false;
  readonly #entries = new Map<string, AssetEntry>();
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #platform: TextureAssetOwnerPlatform;

  constructor(platform: TextureAssetOwnerPlatform) {
    this.#platform = platform;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      entry.controller.abort();
      entry.decoded?.close?.();
    }
    this.#entries.clear();
    this.#listeners.clear();
  }

  decoded(asset: TextureSourceRef): DecodedTextureSource | undefined {
    return this.#entries.get(decodedTextureKey(asset))?.decoded;
  }

  getSnapshot(asset: TextureAssetRef): TextureAssetSnapshot {
    return this.#entries.get(decodedTextureKey(asset))?.snapshot ?? IDLE;
  }

  getSourceSnapshot(asset: TextureSourceRef): TextureAssetSnapshot {
    return this.#entries.get(decodedTextureKey(asset))?.snapshot ?? IDLE;
  }

  reconcile(assets: readonly TextureSourceRef[]): void {
    if (this.#disposed) return;
    const claimed = new Set<string>();
    for (const asset of assets) {
      const key = decodedTextureKey(asset);
      claimed.add(key);
      if (!this.#entries.has(key)) this.#start(asset, key);
    }
    for (const [key, entry] of this.#entries) {
      if (claimed.has(key)) continue;
      entry.controller.abort();
      entry.decoded?.close?.();
      this.#entries.delete(key);
      this.#publish(key);
    }
  }

  subscribe(asset: TextureAssetRef, listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Royal texture asset subscriber must be a function");
    }
    const key = decodedTextureKey(asset);
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

  #start(asset: TextureSourceRef, key: string): void {
    const entry: AssetEntry = {
      asset,
      controller: new AbortController(),
      decoded: undefined,
      key,
      snapshot: { state: "loading" },
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    void this.#platform.decode(asset, entry.controller.signal).then((decoded) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) {
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
      entry.decoded = decoded;
      entry.snapshot = { height: decoded.height, state: "ready", width: decoded.width };
      this.#platform.onAssetChanged(key);
      this.#publish(key);
    }).catch((error: unknown) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      entry.decoded = undefined;
      entry.snapshot = { error: formatFailure(error), state: "error" };
      this.#platform.onAssetChanged(key);
      this.#publish(key);
    });
  }
}
