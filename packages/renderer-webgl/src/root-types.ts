import type {
  GltfAssetRef,
  PickInput,
  PickResult,
  RenderRoot,
  TextureAssetRef,
  VirtualTextureAssetRef,
} from "@royal/renderer-core";
import type {
  ResourceGovernorPolicyInput,
} from "./resource-governor";
import type { WebGlResourcePressureSnapshot } from "./resource-pressure";
export type { WebGlResourcePressureSnapshot } from "./resource-pressure";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /**
   * Generate VTs for ordinary base-color image textures used by triangle
   * geometry with `TEXCOORD_0`. Decoded raster sources qualify when their
   * longest dimension is at least 257 px. Browser-decoded SVG sources use the
   * same page-source path.
   * The ordinary texture remains active until generated coverage is ready.
   * Authored `virtualTexture(...)` resources are unaffected.
   * @defaultValue `false`
   */
  readonly automaticVirtualTextures?: boolean;
}

export type ResolvedWebGlRootOptions = Required<WebGlRootOptions>;

/** @internal Budget injection retained for deterministic backend tests. */
export interface InternalWebGlRootOptions extends WebGlRootOptions {
  readonly resourceGovernorPolicy?: ResourceGovernorPolicyInput;
}

export type WebGlContextLifecycle = "active" | "lost" | "restoring" | "disposed";

export interface WebGlContextSnapshot {
  readonly generation: number;
  readonly lastError?: string;
  readonly lifecycle: WebGlContextLifecycle;
  readonly losses: number;
  readonly restores: number;
}

/** One bounded, deduplicated renderer diagnostic. */
export interface WebGlDiagnosticMessage {
  /** Stable semantic identity used to deduplicate repeated occurrences. */
  readonly key: string;
  readonly message: string;
  readonly occurrences: number;
}

/** Fixed-capacity renderer diagnostic log. */
export interface WebGlDiagnosticLogSnapshot {
  readonly capacity: number;
  /** Diagnostic occurrences rejected after the fixed capacity was reached. */
  readonly dropped: number;
  readonly entries: readonly WebGlDiagnosticMessage[];
}

/** Snapshot of renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly context: WebGlContextSnapshot;
  readonly diagnosticLog: WebGlDiagnosticLogSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  /** Renderer-owned glTF load timing, intended for tests, examples benchmarks, and host diagnostics. */
  readonly gltfLoadDiagnostics: WebGlGltfLoadDiagnosticsSnapshot;
  /** Renderer-owned counters for tests, examples benchmarks, and host diagnostics. */
  readonly gltfInstancing: WebGlGltfInstancingSnapshot;
  readonly options: ResolvedWebGlRootOptions;
  readonly planning: WebGlFramePlanningSnapshot;
  readonly resourceLifetime: WebGlResourceLifetimeSnapshot;
  /** Root-wide resource pressure and admission diagnostics. */
  readonly resourcePressure: WebGlResourcePressureSnapshot;
  readonly picking: WebGlPickingSnapshot;
  readonly textureResidency: WebGlTextureResidencySnapshot;
  readonly virtualTexturing: WebGlVirtualTexturingSnapshot;
}

export interface WebGlResourceLifetimeSnapshot {
  readonly assetPlanCompiles: number;
  readonly preparedAssetAcquires: number;
  readonly preparedAssetEvents: number;
  readonly preparedAssetReleases: number;
  readonly preparedAssetUpdates: number;
  readonly sceneLeaseAcquires: number;
  readonly sceneLeaseReleases: number;
  readonly gltfPreparationQueueHighWater: number;
  readonly imageQueueHighWater: number;
  readonly iblImageQueueHighWater: number;
}

export interface WebGlFramePlanningSnapshot {
  readonly compileNodeVisits: number;
  readonly planCompiles: number;
  readonly planRevision: number;
  readonly sceneCommits: number;
}

export interface WebGlPickingSnapshot {
  /** Highest retained lightweight candidate capacity reached by this root. */
  readonly candidateHighWater: number;
  /** Broad-phase candidates admitted by the most recent pick. */
  readonly candidates: number;
  /** Triangle-level tests run by the most recent pick. */
  readonly exactTests: number;
}

export interface WebGlTextureResidencySnapshot {
  /** Distinct ordinary texture identities retained by the committed scene. */
  readonly activeLeases: number;
  /** Total committed-scene references sharing those identities. */
  readonly activeReferences: number;
  /** Approximate decoded CPU bytes retained for upload/context restoration. */
  readonly preparedBytes: number;
  /** Distinct decoded sources retained for upload/context restoration. */
  readonly preparedSources: number;
  /** Ordinary WebGL texture resources, including resources awaiting upload. */
  readonly resources: number;
}

/** Focused readiness for one exact ordinary or authored virtual-texture identity. */
export type WebGlTextureAssetSnapshot =
  | Readonly<{
    readonly error?: never;
    readonly kind: "ordinary";
    readonly state: "idle" | "loading" | "ready";
  }>
  | Readonly<{
    readonly error: string;
    readonly kind: "ordinary";
    readonly state: "error";
  }>
  | Readonly<{
    readonly error?: never;
    readonly kind: "virtual";
    /** Pages currently loading, decoding, or queued for GPU publication. */
    readonly pendingPages: number;
    /** `ready` means the manifest is accepted; visible detail may continue streaming. */
    readonly state: "idle" | "loading" | "ready";
  }>
  | Readonly<{
    readonly error: string;
    readonly kind: "virtual";
    readonly pendingPages: number;
    readonly state: "error" | "unsupported";
  }>;

export interface WebGlGltfLoadDiagnosticsAssetSnapshot {
  readonly error?: string;
  readonly imageFailures: number;
  readonly imagesLoaded: number;
  readonly imageRequests: number;
  readonly lightCount: number;
  readonly nodeCount: number;
  readonly phaseMs: {
    readonly buffers?: number;
    readonly document?: number;
    readonly draco?: number;
    readonly firstImageComplete?: number;
    readonly imagesComplete?: number;
    readonly meshopt?: number;
    readonly scene?: number;
    readonly toSceneReady?: number;
  };
  readonly primitiveCount: number;
  /** Source URI supplied by the public glTF descriptor. */
  readonly sourceUri: string;
  /** Optional application-supplied asset version used for cache identity. */
  readonly sourceVersion?: number | string;
  /** `sceneReady` is renderable; image completion metrics may still advance afterward. */
  readonly status: "loading" | "sceneReady" | "error";
  /** Ordered `KHR_materials_variants` names accepted by public glTF descriptors. */
  readonly variantNames: readonly string[];
  readonly variantCount: number;
}

export interface WebGlGltfLoadDiagnosticsSnapshot {
  readonly assets: readonly WebGlGltfLoadDiagnosticsAssetSnapshot[];
  readonly errorAssets: number;
  readonly loadingAssets: number;
  readonly sceneReadyAssets: number;
}

export type WebGlGltfLoadDiagnosticsPhaseKey = keyof WebGlGltfLoadDiagnosticsAssetSnapshot["phaseMs"];

export interface WebGlGltfInstancingSnapshot {
  /** Transient batch plans built while grouping compatible glTF draws. */
  readonly batchPlansBuilt: number;
  readonly batchInstancesTotal: number;
  readonly drawCalls: number;
  readonly instancesDrawn: number;
  readonly localModelUploadBytes: number;
  readonly localModelUploadCalls: number;
  readonly rootPoseUploadBytes: number;
  readonly rootPoseUploadCalls: number;
  readonly rootScaleUploadBytes: number;
  readonly rootScaleUploadCalls: number;
}

export interface WebGlVirtualTexturingSnapshot {
  /**
   * Pages currently mapped for shader sampling. May temporarily include fallback
   * or transition coverage while the latest committed frame demand converges.
   */
  readonly activePages: number;
  /** Active page counts across all virtual textures, indexed by logical mip (mip 0 is finest). */
  readonly activePagesByMip: readonly number[];
  /**
   * Physically usable atlas pages, including every active page and inactive pages
   * retained for reuse. In-flight uploads do not count until their texels are usable.
   */
  readonly cachedPages: number;
  /** Cached page counts across all virtual textures, indexed by logical mip (mip 0 is finest). */
  readonly cachedPagesByMip: readonly number[];
  readonly atlasTextures: number;
  /** Newly desired pages admitted across committed demand publications. */
  readonly demandAdmissions: number;
  /** Distinct pages in each virtual texture's last successfully published bounded demand. */
  readonly publishedDemandPages: number;
  /** Draw-demand passes that exceeded the fixed retained-polygon workspace. */
  readonly demandRetentionOverflows: number;
  /** Prior resident pages temporarily retained by demand hysteresis. */
  readonly demandRetentions: number;
  /** Automatic image VTs whose generated manifest is currently in use. */
  readonly automaticManifestUses: number;
  /** Logical pages across the automatic image VTs currently in use. */
  readonly automaticPagesTarget: number;
  /** Full decoded automatic-VT sources retained on CPU; also charged to ordinary-texture ownership. */
  readonly automaticSourceBytes: number;
  readonly manifestFailures: number;
  readonly gpuAdmissionFailures: number;
  readonly pageLoadFailures: number;
  /** Mean source fetch/decode/raster time for completed VT page requests. */
  readonly pageLoadDurationAverageMs: number;
  /** Slowest source fetch/decode/raster time for a completed VT page request. */
  readonly pageLoadDurationMaxMs: number;
  /** Completed page requests represented by the duration metrics. */
  readonly pageLoadDurationSamples: number;
  /** VT page-source requests, including authored and automatic sources. */
  readonly pageLoadRequests: number;
  readonly manifestRequests: number;
  readonly manifestsReady: number;
  readonly pageTableTextures: number;
  readonly pageTableUpdates: number;
  /** Retained per-page request lifecycle entries across all virtual textures. */
  readonly pageLifecycleEntries: number;
  /** Pages currently loading, decoding, or queued/in-flight for GPU upload. */
  readonly pendingPages: number;
  /** Allocated VT atlas and page-table storage, in GPU bytes. Excludes quarantined bytes. */
  readonly physicalAllocatedBytes: number;
  /** Effective VT allocation maximum derived from the resource governor, in GPU bytes. */
  readonly physicalBudgetBytes: number;
  /** GPU bytes still charged after a failed resource release; reset by context recreation. */
  readonly physicalQuarantinedBytes: number;
  readonly preparedResidencyResolutions: number;
  /** Pages with a live loading or queued-GPU claim; excludes backoff, capacity-blocked, and terminal work. */
  readonly outstandingPageRequests: number;
  readonly shaderBinds: number;
  readonly unreadyDraws: number;
  readonly unsupportedDraws: number;
  readonly uploadedPageBytes: number;
  readonly uploadedPages: number;
  /** Largest and smallest completed atlas upload calls, in bytes. */
  readonly textureUploadBytesPerChunkMax: number;
  readonly textureUploadBytesPerChunkMin: number;
  readonly textureUploadChunkSamples: number;
  /** Queue-to-resident completion timing for decoded pages. */
  readonly uploadQueueWaitAverageMs: number;
  readonly uploadQueueWaitMaxMs: number;
  /** Average wait indexed by virtual mip priority (mip 0 is finest). */
  readonly uploadQueueWaitMsByMip: readonly number[];
  readonly uploadQueueWaitSamples: number;
}

export interface WebGlRenderViewport {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface WebGlRenderView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly viewMatrix: ArrayLike<number>;
  readonly viewport: WebGlRenderViewport;
}

export interface WebGlRenderViewsOptions {
  readonly framebuffer?: WebGLFramebuffer | null;
  readonly views: readonly WebGlRenderView[];
}

/** Token-bound ownership of one external renderer frame clock. */
export interface WebGlExternalRenderClock {
  /** Flushes queued demand only while this token is the sole active external owner. */
  flushInvalidated(): void;
  /** Idempotently returns this token's scheduling ownership to the root. */
  release(): void;
}

/** Imperative WebGL2 renderer root. */
export interface WebGlRoot {
  readonly canvas: HTMLCanvasElement;
  readonly contextLifecycle: WebGlContextLifecycle;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: ResolvedWebGlRootOptions;
  contextSnapshot(): WebGlContextSnapshot;
  /** Suspends default-framebuffer scheduling until the returned release function runs. */
  acquireExternalRenderClock(): WebGlExternalRenderClock;
  dispose(): void;
  /** Immediately renders queued demand on the caller's current frame, regardless of clock ownership. */
  flushInvalidated(): void;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  /** Reads focused diagnostics for one retained glTF asset. */
  gltfAssetSnapshot(asset: GltfAssetRef): WebGlGltfLoadDiagnosticsAssetSnapshot | undefined;
  /** Reads focused readiness for one retained texture asset. */
  textureAssetSnapshot(texture: TextureAssetRef | VirtualTextureAssetRef): WebGlTextureAssetSnapshot;
  /** Observes immutable context lifecycle transitions. Calls back immediately with the current state. */
  observeContextLifecycle(callback: (snapshot: WebGlContextSnapshot) => void): () => void;
  /** Observes failures from renderer-owned scheduled frames. Explicit render calls still throw synchronously. */
  observeRenderFailures(callback: (failure: unknown) => void): () => void;
  /** Observes completed renderer frames. Calls back immediately with the current frame index. */
  observeFrame(callback: (frame: number) => void): () => void;
  /** Observes one retained glTF asset without scanning the full diagnostics snapshot. */
  observeGltfAsset(
    asset: GltfAssetRef,
    callback: (snapshot: WebGlGltfLoadDiagnosticsAssetSnapshot | undefined) => void,
  ): () => void;
  /** Observes one exact texture identity. Calls back immediately and after relevant frames. */
  observeTextureAsset(
    texture: TextureAssetRef | VirtualTextureAssetRef,
    callback: (snapshot: WebGlTextureAssetSnapshot) => void,
  ): () => void;
  pick(input: PickInput): PickResult | undefined;
  render(scene: RenderRoot): void;
  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void;
  snapshot(): WebGlRootSnapshot;
}
