import type {
  GltfAssetBounds,
  GltfAssetRef,
  GltfInstancesNode,
  GltfNode,
} from "@royal/renderer-core";
import type { PreparedStaticGltf } from "./static-asset";
import type {
  TextureAssetSnapshot,
  TextureSourceRef,
} from "../texture/asset-owner";

export type GltfTextureProgress = Readonly<{
  failed: number;
  loading: number;
  ready: number;
  total: number;
}>;

/** Monotonic load milestones for one exact source/version claim. */
export type GltfAssetTimings = Readonly<{
  /** Time spent reading the root `.gltf` or `.glb` source. */
  sourceReadDurationMs: number;
  /** Time spent resolving resources and preparing canonical render data. */
  preparationDurationMs: number;
  /** Elapsed time from claim until every requested image succeeded or failed. */
  imagesCompleteAfterMs?: number;
}>;

export type GltfAssetSnapshot =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "loading" }>
  | Readonly<{
    bounds: GltfAssetBounds;
    primitiveCount: number;
    state: "degraded" | "ready" | "streaming";
    timings: GltfAssetTimings;
    textures: GltfTextureProgress;
  }>
  | Readonly<{ error: string; state: "error" }>;

export type GltfAssetNode = GltfNode | GltfInstancesNode;

export type GltfAssetOwnerPlatform = Readonly<{
  onAssetChanged(): void;
  onListenerError(error: unknown): void;
  prepare?(
    bytes: Uint8Array,
    contentKey: string,
    label: string,
    sourceUri: string,
    signal: AbortSignal,
    readResource: (uri: string) => Promise<Uint8Array>,
  ): Promise<PreparedStaticGltf>;
  read(asset: GltfAssetRef, signal: AbortSignal): Promise<Uint8Array>;
  readResource(uri: string, signal: AbortSignal): Promise<Uint8Array>;
}>;

type AssetEntry = {
  readonly controller: AbortController;
  readonly key: string;
  prepared: PreparedStaticGltf | undefined;
  snapshot: GltfAssetSnapshot;
  readonly startedAt: number;
};

const IDLE: GltfAssetSnapshot = { state: "idle" };

const textureProgress = (
  assets: readonly TextureSourceRef[],
  snapshot: (asset: TextureSourceRef) => TextureAssetSnapshot,
): GltfTextureProgress => {
  let failed = 0;
  let ready = 0;
  for (const asset of assets) {
    const state = snapshot(asset).state;
    if (state === "ready") ready += 1;
    else if (state === "error") failed += 1;
  }
  return {
    failed,
    loading: assets.length - ready - failed,
    ready,
    total: assets.length,
  };
};

const sameTextureProgress = (
  left: GltfTextureProgress,
  right: GltfTextureProgress,
): boolean => left.failed === right.failed
  && left.loading === right.loading
  && left.ready === right.ready;

const usableState = (
  progress: GltfTextureProgress,
): "degraded" | "ready" | "streaming" => progress.loading > 0
  ? "streaming"
  : progress.failed > 0 ? "degraded" : "ready";

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

export const readGltfResourceWithFetch = async (
  uri: string,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const response = await fetch(uri, { signal });
  if (!response.ok) throw new Error(`glTF resource ${JSON.stringify(uri)} failed with HTTP ${response.status}`);
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

  /** Recomputes focused image progress without changing geometry readiness. */
  refreshTextureProgress(
    snapshot: (asset: TextureSourceRef) => TextureAssetSnapshot,
  ): void {
    if (this.#disposed) return;
    for (const entry of this.#entries.values()) {
      if (entry.prepared === undefined || !("textures" in entry.snapshot)) continue;
      const textures = textureProgress(entry.prepared.textureAssets, snapshot);
      const state = usableState(textures);
      const complete = textures.loading === 0;
      const timings = complete
        && textures.total > 0
        && entry.snapshot.timings.imagesCompleteAfterMs === undefined
        ? {
            ...entry.snapshot.timings,
            imagesCompleteAfterMs: performance.now() - entry.startedAt,
          }
        : entry.snapshot.timings;
      if (
        sameTextureProgress(entry.snapshot.textures, textures)
        && timings === entry.snapshot.timings
      ) continue;
      entry.snapshot = { ...entry.snapshot, state, timings, textures };
      this.#publish(entry.key);
    }
  }

  reconcile(nodes: readonly GltfAssetNode[]): void {
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
      controller: new AbortController(),
      key,
      prepared: undefined,
      snapshot: { state: "loading" },
      startedAt: performance.now(),
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    const preparation = this.#platform.prepare === undefined
      ? import("./static-asset")
      : undefined;
    void this.#platform.read(asset, entry.controller.signal).then(async (bytes) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      const readCompletedAt = performance.now();
      const readResource = (uri: string) =>
        this.#platform.readResource(uri, entry.controller.signal);
      const prepared = this.#platform.prepare === undefined
        ? await preparation!.then((module) =>
          module.prepareStaticGltfSource(
            bytes,
            key,
            diagnosticLabel(asset),
            asset.src,
            readResource,
          ))
        : await this.#platform.prepare(
          bytes,
          key,
          diagnosticLabel(asset),
          asset.src,
          entry.controller.signal,
          readResource,
        );
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      const preparedAt = performance.now();
      entry.prepared = prepared;
      const textures = {
        failed: 0,
        loading: prepared.textureAssets.length,
        ready: 0,
        total: prepared.textureAssets.length,
      };
      entry.snapshot = {
        bounds: prepared.bounds,
        primitiveCount: prepared.primitives.length,
        state: usableState(textures),
        timings: {
          preparationDurationMs: preparedAt - readCompletedAt,
          sourceReadDurationMs: readCompletedAt - entry.startedAt,
        },
        textures,
      };
      this.#platform.onAssetChanged();
      this.#publish(key);
    }).catch((error: unknown) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      entry.snapshot = { error: formatFailure(error), state: "error" };
      this.#publish(key);
    });
  }
}
