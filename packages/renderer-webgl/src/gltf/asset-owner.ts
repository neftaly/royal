import type {
  GltfAssetBounds,
  GltfAssetRef,
  GltfInstancesNode,
  GltfNode,
} from "@royal/renderer-core";
import type { PreparedStaticGltf } from "./static-asset";
import type { GltfDocumentScene } from "./static-node-selection";
import type {
  TextureAssetSnapshot,
} from "../texture/asset-owner";
import type { TextureSourceRef } from "../texture/source";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";
import { KeyedRetainedListeners } from "../resource/retained-listeners";
import { SharedByteReadOwner } from "../resource/shared-byte-read-owner";
import {
  StagedByteReadOwner,
  type StagedByteReadSnapshot,
} from "../resource/staged-byte-read-owner";
import type { StaticGltfResourceRequest } from "./static-buffer-demand";
import {
  SharedStaticGeometryOwner,
  type SharedStaticGeometrySnapshot,
} from "./shared-geometry-owner";
import type { GltfJsonValue } from "./gltf-values";
import type { EarlyStaticTextureClaims } from "./static-external-texture-demand";

export type GltfTextureProgress = Readonly<{
  /** Ready images which recovered from a preferred representation to an authored fallback. */
  fallback: number;
  /** Images whose transport or decode ended in failure. */
  failed: number;
  /** Images still awaiting transport or decode. */
  loading: number;
  /** Images decoded and available for progressive material publication. */
  ready: number;
  /** Unique image identities referenced by this prepared asset. */
  total: number;
}>;

/** Monotonic load milestones for one exact source/version/selected-scene claim. */
export type GltfAssetTimings = Readonly<{
  /** Elapsed time from claim until Royal began the root source read. */
  sourceReadStartedAfterMs: number;
  /** Wall time spent reading the root `.gltf` or `.glb` source. */
  sourceReadDurationMs: number;
  /** Time the completed root source waited for canonical preparation admission. */
  preparationQueueDurationMs: number;
  /** Wall span from the first referenced-resource read until the last completes. */
  externalResourceReadDurationMs: number;
  /** Remaining canonical preparation time outside the two resource-read spans. */
  preparationDurationMs: number;
  /** Elapsed time from claim until drawable geometry became available. */
  firstDrawableAfterMs: number;
  /** Elapsed time from claim until every requested image succeeded or failed. */
  imagesCompleteAfterMs?: number;
}>;

/**
 * Focused lifecycle for one exact glTF source/version/selected-scene identity.
 * `status` is the discriminant shared by every focused Royal lifecycle.
 * `streaming`, `ready`, and `degraded` all have drawable geometry. `streaming`
 * still has pending images; `degraded` finished with one or more image failures.
 */
export type GltfAssetSnapshot =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{
    /**
     * Conservative prepared asset-space AABB before node transform.
     * It is not contact, collision, resting-height, or support geometry.
     */
    bounds: GltfAssetBounds;
    /** Number of punctual lights reachable from the selected scene. */
    lightCount: number;
    /** Number of authored nodes reachable from the selected scene, including LOD members. */
    nodeCount: number;
    /** Number of prepared draw primitives, including authored LOD levels. */
    primitiveCount: number;
    /** Actual zero-based selected scene after resolving the document default. */
    sceneIndex: number;
    /** Complete document scene inventory without preparing unselected content. */
    scenes: readonly GltfDocumentScene[];
    /**
     * Uninterpreted glTF root `extras` for this exact asset identity.
     * The reference remains stable while texture progress changes.
     */
    rootExtras?: GltfJsonValue;
    status: "degraded" | "ready" | "streaming";
    timings: GltfAssetTimings;
    textures: GltfTextureProgress;
    /** Unique document-declared material variant names in authored order. */
    variantNames: readonly string[];
  }>
  | Readonly<{
    /** Bounded diagnostic message. */
    error: string;
    status: "error";
  }>;

export type GltfAssetNode = GltfNode | GltfInstancesNode;

export type GltfAssetOwnerPlatform = Readonly<{
  now?(): number;
  onAssetChanged(assetKey: string): void;
  onListenerError(error: unknown): void;
  onSourceReadsChanged?(): void;
  prepare?(
    bytes: Uint8Array,
    contentKey: string,
    label: string,
    sourceUri: string,
    signal: AbortSignal,
    readResource: (
      uri: string,
      request?: StaticGltfResourceRequest,
    ) => Promise<Uint8Array>,
    sceneIndex?: number,
    resourceVersion?: GltfAssetRef["version"],
  ): Promise<PreparedStaticGltf>;
  read(asset: GltfAssetRef, signal: AbortSignal): Promise<Uint8Array>;
  readResource(
    asset: GltfAssetRef,
    uri: string,
    signal: AbortSignal,
    request?: StaticGltfResourceRequest,
  ): Promise<Uint8Array>;
  /** Whether `readResource` consumes sparse selected-range requests. @defaultValue `true` */
  readResourceRanges?: boolean;
  schedule?: AsyncPreparationScheduler;
}>;

type AssetEntry = {
  readonly controller: AbortController;
  earlyTextureClaims: EarlyStaticTextureClaims;
  readonly key: string;
  prepared: PreparedStaticGltf | undefined;
  snapshot: GltfAssetSnapshot;
  readonly startedAt: number;
};

const IDLE: GltfAssetSnapshot = { status: "idle" };
const EMPTY_TEXTURE_CLAIMS: EarlyStaticTextureClaims = {
  alphaMaskTextureAssets: [],
  textureAssets: [],
};
const ACTIVE_ROOT_SOURCE_READ_LIMIT = 16;
const EARLY_TEXTURE_DISCOVERY_ROOT_BYTE_LIMIT = 256 * 1024;
const ROOT_SOURCE_RESERVATION_LIMIT = 64;
const STAGED_ROOT_SOURCE_BYTE_THRESHOLD = 32 * 1024 * 1024;

const textureProgress = (
  assets: readonly TextureSourceRef[],
  snapshot: (asset: TextureSourceRef) => TextureAssetSnapshot,
): GltfTextureProgress => {
  let fallback = 0;
  let failed = 0;
  let ready = 0;
  for (const asset of assets) {
    const state = snapshot(asset);
    const status = state.status;
    if (status === "ready") {
      ready += 1;
      if (state.fallbackReason !== undefined) fallback += 1;
    }
    else if (status === "error") failed += 1;
  }
  return {
    fallback,
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
  && left.fallback === right.fallback
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
  const { sceneIndex } = asset;
  if (sceneIndex !== undefined) {
    if (typeof sceneIndex !== "number" || !Number.isFinite(sceneIndex)) {
      throw new TypeError("glTF sceneIndex must be a finite number");
    }
    if (!Number.isSafeInteger(sceneIndex) || sceneIndex < 0) {
      throw new RangeError("glTF sceneIndex must be a non-negative safe integer");
    }
  }
};

const gltfSourceKey = (asset: GltfAssetRef): string => {
  validateAsset(asset);
  const version = asset.version;
  return JSON.stringify([
    asset.src,
    version === undefined ? "unversioned" : typeof version,
    version ?? null,
  ]);
};

const resourceReadKey = (
  asset: GltfAssetRef,
  uri: string,
  request: StaticGltfResourceRequest | undefined,
): string => JSON.stringify([
  uri,
  request ?? null,
  asset.version === undefined ? null : [typeof asset.version, asset.version],
]);

/** Exact prepared-view identity; source-derived resources deliberately exclude scene selection. */
export const gltfAssetKey = (asset: GltfAssetRef): string => JSON.stringify([
  gltfSourceKey(asset),
  asset.sceneIndex ?? "default",
]);

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
  request?: StaticGltfResourceRequest,
): Promise<Uint8Array> => {
  if (request === undefined) {
    const response = await fetch(uri, { signal });
    if (!response.ok) {
      throw new Error(`glTF resource ${JSON.stringify(uri)} failed with HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  const { readGltfResourceRangesWithFetch } = await import("./browser-static-preparation");
  return readGltfResourceRangesWithFetch(uri, signal, request);
};

/** Owns exact asset claims, asynchronous IO, preparation, and focused status publication. */
export class GltfAssetOwner {
  #disposed = false;
  readonly #entries = new Map<string, AssetEntry>();
  readonly #listeners = new KeyedRetainedListeners<string>();
  readonly #now: () => number;
  readonly #platform: GltfAssetOwnerPlatform;
  readonly #sharedGeometry = new SharedStaticGeometryOwner();
  readonly #sharedReads = new SharedByteReadOwner<string>();
  readonly #sourceReads: StagedByteReadOwner;

  constructor(platform: GltfAssetOwnerPlatform) {
    this.#platform = platform;
    this.#now = platform.now ?? (() => performance.now());
    this.#sourceReads = new StagedByteReadOwner(
      ACTIVE_ROOT_SOURCE_READ_LIMIT,
      ROOT_SOURCE_RESERVATION_LIMIT,
      STAGED_ROOT_SOURCE_BYTE_THRESHOLD,
      platform.onSourceReadsChanged,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) entry.controller.abort();
    this.#entries.clear();
    this.#sharedGeometry.clear();
    this.#sourceReads.dispose();
    this.#sharedReads.dispose();
    this.#listeners.clear();
  }

  getSnapshot(asset: GltfAssetRef): GltfAssetSnapshot {
    return this.#entries.get(gltfAssetKey(asset))?.snapshot ?? IDLE;
  }

  prepared(asset: GltfAssetRef): PreparedStaticGltf | undefined {
    return this.#entries.get(gltfAssetKey(asset))?.prepared;
  }

  textureClaims(asset: GltfAssetRef): EarlyStaticTextureClaims {
    const entry = this.#entries.get(gltfAssetKey(asset));
    return entry?.prepared ?? entry?.earlyTextureClaims ?? EMPTY_TEXTURE_CLAIMS;
  }

  sourceReadSnapshot(): StagedByteReadSnapshot {
    return this.#sourceReads.snapshot();
  }

  sharedGeometrySnapshot(): SharedStaticGeometrySnapshot {
    return this.#sharedGeometry.snapshot();
  }

  /** Recomputes focused image progress without changing geometry readiness. */
  refreshTextureProgress(
    snapshot: (asset: TextureSourceRef) => TextureAssetSnapshot,
  ): void {
    if (this.#disposed) return;
    for (const entry of this.#entries.values()) {
      if (entry.prepared === undefined || !("textures" in entry.snapshot)) continue;
      const textures = textureProgress(entry.prepared.textureAssets, snapshot);
      const status = usableState(textures);
      const complete = textures.loading === 0;
      const timings = complete
        && textures.total > 0
        && entry.snapshot.timings.imagesCompleteAfterMs === undefined
        ? {
            ...entry.snapshot.timings,
            imagesCompleteAfterMs: this.#now() - entry.startedAt,
          }
        : entry.snapshot.timings;
      if (
        sameTextureProgress(entry.snapshot.textures, textures)
        && timings === entry.snapshot.timings
      ) continue;
      entry.snapshot = { ...entry.snapshot, status, timings, textures };
      this.#publish(entry.key);
    }
  }

  reconcile(
    nodes: readonly GltfAssetNode[],
    nonVisualAssets: readonly GltfAssetRef[] = [],
  ): void {
    if (this.#disposed) return;
    const claimed = new Set<string>();
    const claim = (asset: GltfAssetRef): void => {
      const key = gltfAssetKey(asset);
      claimed.add(key);
      if (!this.#entries.has(key)) this.#start(asset, key);
    };
    for (const node of nodes) claim(node.asset);
    for (const asset of nonVisualAssets) claim(asset);
    let releasedPreparedGeometry = false;
    for (const [key, entry] of this.#entries) {
      if (claimed.has(key)) continue;
      entry.controller.abort();
      releasedPreparedGeometry = entry.prepared !== undefined || releasedPreparedGeometry;
      this.#entries.delete(key);
      this.#sharedReads.release(key);
      this.#publish(key);
    }
    if (releasedPreparedGeometry) this.#reconcileSharedGeometry();
  }

  subscribe(asset: GltfAssetRef, listener: () => void): () => void {
    const key = gltfAssetKey(asset);
    if (this.#disposed) return () => undefined;
    return this.#listeners.subscribe(key, listener);
  }

  #publish(key: string): void {
    this.#listeners.publish(key, this.#platform.onListenerError);
  }

  #start(asset: GltfAssetRef, key: string): void {
    const entry: AssetEntry = {
      controller: new AbortController(),
      earlyTextureClaims: EMPTY_TEXTURE_CLAIMS,
      key,
      prepared: undefined,
      snapshot: { status: "loading" },
      startedAt: this.#now(),
    };
    this.#entries.set(key, entry);
    this.#publish(key);
    const preparation = this.#platform.prepare === undefined
      ? import("./static-asset")
      : undefined;
    const load = async (): Promise<void> => {
      let sourceReadStartedAt = this.#now();
      const source = await this.#sourceReads.read(
        entry.controller.signal,
        () => {
          sourceReadStartedAt = this.#now();
          return this.#sharedReads.read(
            `root:${gltfSourceKey(asset)}`,
            key,
            (signal) => this.#platform.read(asset, signal),
          );
        },
      );
      if (
        this.#disposed
        || this.#entries.get(key) !== entry
        || entry.controller.signal.aborted
      ) {
        source.release();
        return;
      }
      const { bytes } = source;
      const readCompletedAt = this.#now();
      if (
        bytes.byteLength <= EARLY_TEXTURE_DISCOVERY_ROOT_BYTE_LIMIT
        && (
          bytes.byteLength < 4
          || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
            !== 0x46_54_6c_67
        )
      ) {
        const discoveryBytes = bytes.slice();
        void import("./static-external-texture-demand").then((module) =>
          module.discoverExternalStaticGltfTextures(
            discoveryBytes,
            gltfSourceKey(asset),
            diagnosticLabel(asset),
            asset.src,
            true,
            asset.sceneIndex,
            asset.version,
          )).then((claims) => {
          if (
            this.#disposed
            || this.#entries.get(key) !== entry
            || entry.controller.signal.aborted
            || entry.prepared !== undefined
          ) return;
          entry.earlyTextureClaims = claims;
          if (claims.textureAssets.length !== 0) this.#platform.onAssetChanged(key);
        }).catch(() => {
          // Canonical preparation remains the authority for validation errors.
        });
      }
      let externalReadCompletedAt = readCompletedAt;
      let externalReadStartedAt: number | undefined;
      const readResource = async (
        uri: string,
        request?: StaticGltfResourceRequest,
      ): Promise<Uint8Array> => {
        externalReadStartedAt ??= this.#now();
        const effectiveRequest = this.#platform.readResourceRanges === false
          ? undefined
          : request;
        try {
          return await this.#sharedReads.read(
            `resource:${resourceReadKey(asset, uri, effectiveRequest)}`,
            key,
            (signal) => effectiveRequest === undefined
              ? this.#platform.readResource(asset, uri, signal)
              : this.#platform.readResource(asset, uri, signal, effectiveRequest),
          );
        } finally {
          externalReadCompletedAt = Math.max(externalReadCompletedAt, this.#now());
        }
      };
      let preparationStartedAt = readCompletedAt;
      const prepare = async (): Promise<PreparedStaticGltf> => {
        preparationStartedAt = this.#now();
        source.release();
        return this.#platform.prepare === undefined
          ? preparation!.then((module) => module.prepareStaticGltfSource(
            bytes,
            gltfSourceKey(asset),
            diagnosticLabel(asset),
            asset.src,
            readResource,
            undefined,
            true,
            asset.sceneIndex,
            asset.version,
          ))
          : this.#platform.prepare(
            bytes,
            gltfSourceKey(asset),
            diagnosticLabel(asset),
            asset.src,
            entry.controller.signal,
            readResource,
            asset.sceneIndex,
            asset.version,
          );
      };
      let prepared: PreparedStaticGltf;
      try {
        prepared = this.#platform.schedule === undefined
          ? await prepare()
          : await this.#platform.schedule(entry.controller.signal, prepare);
      } finally {
        source.release();
      }
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      const preparedAt = this.#now();
      const externalResourceReadDurationMs = externalReadStartedAt === undefined
        ? 0
        : Math.max(0, externalReadCompletedAt - externalReadStartedAt);
      entry.prepared = this.#sharedGeometry.intern(prepared);
      this.#reconcileSharedGeometry();
      prepared = entry.prepared;
      const textures = {
        fallback: 0,
        failed: 0,
        loading: prepared.textureAssets.length,
        ready: 0,
        total: prepared.textureAssets.length,
      };
      entry.snapshot = {
        bounds: prepared.bounds,
        lightCount: prepared.lights.length,
        nodeCount: prepared.nodeCount,
        primitiveCount: prepared.primitives.length,
        ...(prepared.rootExtras === undefined
          ? {}
          : { rootExtras: structuredClone(prepared.rootExtras) }),
        sceneIndex: prepared.sceneIndex,
        scenes: prepared.scenes,
        status: usableState(textures),
        timings: {
          externalResourceReadDurationMs,
          firstDrawableAfterMs: preparedAt - entry.startedAt,
          preparationQueueDurationMs: Math.max(
            0,
            preparationStartedAt - readCompletedAt,
          ),
          preparationDurationMs: Math.max(
            0,
            preparedAt - preparationStartedAt - externalResourceReadDurationMs,
          ),
          sourceReadDurationMs: readCompletedAt - sourceReadStartedAt,
          sourceReadStartedAfterMs: sourceReadStartedAt - entry.startedAt,
        },
        textures,
        variantNames: prepared.variantNames,
      };
      this.#platform.onAssetChanged(key);
      this.#publish(key);
    };
    void load().catch((error: unknown) => {
      if (this.#disposed || this.#entries.get(key) !== entry || entry.controller.signal.aborted) return;
      entry.snapshot = { error: formatFailure(error), status: "error" };
      this.#publish(key);
    });
  }

  #reconcileSharedGeometry(): void {
    const prepared: PreparedStaticGltf[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.prepared !== undefined) prepared.push(entry.prepared);
    }
    this.#sharedGeometry.reconcile(prepared);
  }
}
