import type {
  PickInput,
  PickResult,
  RenderRoot,
} from "@royal/renderer-core";
import type {
  ResourceGovernorPolicy,
  ResourceGovernorPolicyInput,
  ResourceGovernorSnapshot,
} from "./resource-governor";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /**
   * Generate VTs for ordinary base-color image textures used by triangle
   * geometry with `TEXCOORD_0`. SVG sources are not subject to the raster size
   * threshold; decoded raster sources qualify when their longest dimension is
   * at least 257 px. The ordinary texture remains active until generated
   * coverage is ready. Authored `virtualTexture(...)` resources are unaffected.
   * @defaultValue `false`
   */
  readonly generatedImageVirtualTextures?: boolean;
  /**
   * Maximum mip-0 detail for generated SVG VTs, in logical texels per authored
   * SVG CSS pixel. This changes close-zoom texture detail, not layout or world size.
   * Must be finite and in `(0, 16]`; generated dimensions preserve aspect ratio
   * and are capped at 16384 logical texels on their longest side. Only used when
   * `generatedImageVirtualTextures` is enabled.
   * @defaultValue `4`
   */
  readonly generatedSvgVirtualTextureRasterDensity?: number;
  /**
   * Nested overrides for the immutable cross-class CPU/GPU/job/upload budget
   * policy. Omitted fields inherit Royal's exported default policy. VT atlas
   * and page-table storage uses the `virtual-texture` persistent-GPU class budget.
   */
  readonly resourceGovernorPolicy?: ResourceGovernorPolicyInput;
}

export type NormalizedWebGlRootOptions = Required<Omit<WebGlRootOptions, "resourceGovernorPolicy">>
  & { readonly resourceGovernorPolicy: ResourceGovernorPolicy };

export type WebGlContextLifecycle = "active" | "lost" | "restoring" | "disposed";

export interface WebGlContextSnapshot {
  readonly generation: number;
  readonly lastError?: string;
  readonly lifecycle: WebGlContextLifecycle;
  readonly losses: number;
  readonly restores: number;
}

/** Snapshot of renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly context: WebGlContextSnapshot;
  readonly diagnostics: readonly string[];
  readonly diagnosticStats: {
    readonly capacity: number;
    readonly dropped: number;
    readonly occurrences: readonly {
      readonly count: number;
      readonly key: string;
    }[];
    readonly retained: number;
  };
  readonly disposed: boolean;
  readonly frame: number;
  /** Renderer-owned glTF load timing, intended for tests, examples benchmarks, and host diagnostics. */
  readonly gltfLoadDiagnostics: WebGlGltfLoadDiagnosticsSnapshot;
  /** Renderer-owned counters for tests, examples benchmarks, and host diagnostics. */
  readonly gltfInstancing: WebGlGltfInstancingSnapshot;
  readonly latestScene: RenderRoot | undefined;
  readonly options: NormalizedWebGlRootOptions;
  readonly planning: WebGlFramePlanningSnapshot;
  readonly resourceLifetime: WebGlResourceLifetimeSnapshot;
  /** Root-wide resource pressure and admission diagnostics. */
  readonly resourceGovernor: ResourceGovernorSnapshot;
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

export interface WebGlGltfLoadDiagnosticsAssetSnapshot {
  readonly error?: string;
  readonly imageFailures: number;
  readonly imageLoaded: number;
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
  readonly status: "loading" | "sceneReady" | "error";
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
  readonly generatedManifestUses: number;
  readonly generatedPageFailures: number;
  readonly generatedPageRasterizeMaxMs: number;
  readonly generatedPageRasterizeMs: number;
  readonly generatedPageRequests: number;
  readonly generatedPagesTarget: number;
  readonly manifestFailures: number;
  readonly gpuAdmissionFailures: number;
  readonly pageLoadFailures: number;
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
  readonly options: NormalizedWebGlRootOptions;
  contextSnapshot(): WebGlContextSnapshot;
  /** Suspends default-framebuffer scheduling until the returned release function runs. */
  acquireExternalRenderClock(): WebGlExternalRenderClock;
  dispose(): void;
  /** Immediately renders queued demand on the caller's current frame, regardless of clock ownership. */
  flushInvalidated(): void;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  /** Observes immutable context lifecycle transitions. Calls back immediately with the current state. */
  observeContextLifecycle(callback: (snapshot: WebGlContextSnapshot) => void): () => void;
  /** Observes failures from renderer-owned scheduled frames. Explicit render calls still throw synchronously. */
  observeRenderFailures(callback: (failure: unknown) => void): () => void;
  /** Observes completed renderer frames. Calls back immediately with the current frame index. */
  observeFrame(callback: (frame: number) => void): () => void;
  pick(input: PickInput): PickResult | undefined;
  render(scene: RenderRoot): void;
  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void;
  snapshot(): WebGlRootSnapshot;
}
