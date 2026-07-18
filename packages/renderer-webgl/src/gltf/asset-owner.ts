import type { GltfAssetRef, GltfNode } from "@royal/renderer-core";
import type { PreparedStaticGltf } from "./static-asset";

export type GltfAssetSnapshot =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "loading" }>
  | Readonly<{ primitiveCount: number; state: "ready" }>
  | Readonly<{ error: string; state: "error" }>;

export type GltfAssetOwnerPlatform = Readonly<{
  onAssetChanged(): void;
  onListenerError(error: unknown): void;
  read(asset: GltfAssetRef, signal: AbortSignal): Promise<Uint8Array>;
}>;

type AssetEntry = {
  readonly asset: GltfAssetRef;
  readonly controller: AbortController;
  readonly key: string;
  prepared: PreparedStaticGltf | undefined;
  snapshot: GltfAssetSnapshot;
};

const IDLE: GltfAssetSnapshot = { state: "idle" };

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

const validateAsset = (asset: GltfAssetRef): void => {
  if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
    throw new TypeError("Royal glTF asset identity must be an object");
  }
  if (typeof asset.src !== "string" || asset.src.length === 0) {
    throw new TypeError("Royal glTF asset src must be a non-empty string");
  }
  if (asset.version !== undefined && (
    (typeof asset.version !== "string" || asset.version.length === 0)
    && (typeof asset.version !== "number" || !Number.isFinite(asset.version))
  )) {
    throw new TypeError("Royal glTF asset version must be a non-empty string or finite number");
  }
};

export const gltfAssetKey = (asset: GltfAssetRef): string => {
  validateAsset(asset);
  const version = asset.version;
  return JSON.stringify([
    asset.src,
    version === undefined ? "unversioned" : typeof version,
    version ?? null,
  ]);
};

const diagnosticLabel = (asset: GltfAssetRef): string => {
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `glTF ${JSON.stringify(source)}`;
};

export const readGltfWithFetch = async (
  asset: GltfAssetRef,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const response = await fetch(asset.src, { signal });
  if (!response.ok) {
    throw new Error(`${diagnosticLabel(asset)} fetch failed with HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

/** Owns exact asset claims, asynchronous IO, preparation, and focused status publication. */
export class GltfAssetOwner {
  #disposed = false;
  readonly #entries = new Map<string, AssetEntry>();
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #platform: GltfAssetOwnerPlatform;

  constructor(platform: GltfAssetOwnerPlatform) {
    this.#platform = platform;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) entry.controller.abort();
    this.#entries.clear();
    this.#listeners.clear();
  }

  getSnapshot(asset: GltfAssetRef): GltfAssetSnapshot {
    return this.#entries.get(gltfAssetKey(asset))?.snapshot ?? IDLE;
  }

  prepared(asset: GltfAssetRef): PreparedStaticGltf | undefined {
    return this.#entries.get(gltfAssetKey(asset))?.prepared;
  }

  reconcile(nodes: readonly GltfNode[]): void {
    if (this.#disposed) return;
    const claimed = new Set<string>();
    for (const node of nodes) {
      const key = gltfAssetKey(node.asset);
      claimed.add(key);
      if (!this.#entries.has(key)) this.#start(node.asset, key);
    }
    for (const [key, entry] of this.#entries) {
      if (claimed.has(key)) continue;
      entry.controller.abort();
      this.#entries.delete(key);
      this.#publish(key);
    }
  }

  subscribe(asset: GltfAssetRef, listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Royal glTF asset subscriber must be a function");
    }
    const key = gltfAssetKey(asset);
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
    const snapshot = Array.from(listeners);
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

  #start(asset: GltfAssetRef, key: string): void {
    const entry: AssetEntry = {
      asset,
      controller: new AbortController(),
      key,
      prepared: undefined,
      snapshot: { state: "loading" },
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    void Promise.all([
      (async () => this.#platform.read(asset, entry.controller.signal))(),
      import("./static-asset"),
    ]).then(([bytes, preparation]) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      const prepared = preparation.prepareStaticGlb(bytes, key, diagnosticLabel(asset), asset.src);
      entry.prepared = prepared;
      entry.snapshot = { primitiveCount: prepared.primitives.length, state: "ready" };
      this.#platform.onAssetChanged();
      this.#publish(key);
    }).catch((error: unknown) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      entry.prepared = undefined;
      entry.snapshot = { error: formatFailure(error), state: "error" };
      this.#publish(key);
    });
  }
}
