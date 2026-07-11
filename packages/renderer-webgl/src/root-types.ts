import type {
  PickInput,
  PickResult,
  RenderRoot,
} from "@royal/renderer-core";
import type { RendererOwnedWebGl2Context } from "./webgl/context-lane";
import type { RendererFrameViewLane } from "./webgl/frame-view-lane";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** Generate virtual-texture pages from ordinary large raster textures. Explicit virtual textures remain available. @defaultValue `false` */
  readonly generatedRasterVirtualTextures?: boolean;
}

export type NormalizedWebGlRootOptions = Required<WebGlRootOptions>;

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
  readonly options: Required<WebGlRootOptions>;
  readonly planning: WebGlFramePlanningSnapshot;
  readonly resourceLifetime: WebGlResourceLifetimeSnapshot;
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
  readonly key: string;
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
  readonly atlasTextures: number;
  readonly generatedManifestUses: number;
  readonly generatedPageFailures: number;
  readonly generatedPageRasterizeMaxMs: number;
  readonly generatedPageRasterizeMs: number;
  readonly generatedPageRequests: number;
  readonly generatedPagesTarget: number;
  readonly manifestFailures: number;
  readonly manifestRequests: number;
  readonly manifestsReady: number;
  readonly pageTableTextures: number;
  readonly pageTableUpdates: number;
  readonly pendingPages: number;
  readonly preparedResidencyResolutions: number;
  readonly requestedPages: number;
  readonly residentPages: number;
  readonly shaderBinds: number;
  readonly unreadyDraws: number;
  readonly unsupportedDraws: number;
  readonly uploadedPageBytes: number;
  readonly uploadedPages: number;
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

/** Imperative WebGL2 renderer root. */
export interface WebGlRoot extends RendererOwnedWebGl2Context, RendererFrameViewLane {
  readonly canvas: HTMLCanvasElement;
  readonly contextLifecycle: WebGlContextLifecycle;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
  contextSnapshot(): WebGlContextSnapshot;
  /** Suspends default-framebuffer scheduling until the returned release function runs. */
  acquireExternalRenderClock(): () => void;
  dispose(): void;
  /** Immediately renders queued demand on the caller's current frame, if any. */
  flushInvalidated(): void;
  /** Flushes demand only when exactly one external clock owns the renderer. */
  flushInvalidatedFromExternalClock(): void;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  /** Observes immutable context lifecycle transitions. Calls back immediately with the current state. */
  observeContextLifecycle(callback: (snapshot: WebGlContextSnapshot) => void): () => void;
  pick(input: PickInput): PickResult | undefined;
  render(scene: RenderRoot): void;
  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void;
  snapshot(): WebGlRootSnapshot;
}
