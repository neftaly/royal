import type {
  PickInput,
  PickResult,
  RenderRoot,
} from "@royal/renderer-core";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

export type NormalizedWebGlRootOptions = Required<WebGlRootOptions>;

/** Snapshot of renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly diagnostics: readonly string[];
  readonly disposed: boolean;
  readonly frame: number;
  /** Renderer-owned glTF load timing, intended for tests, examples benchmarks, and host diagnostics. */
  readonly gltfLoadDiagnostics: WebGlGltfLoadDiagnosticsSnapshot;
  /** Renderer-owned counters for tests, examples benchmarks, and host diagnostics. */
  readonly gltfInstancing: WebGlGltfInstancingSnapshot;
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
  readonly virtualTexturing: WebGlVirtualTexturingSnapshot;
}

export interface WebGlGltfLoadDiagnosticsAssetSnapshot {
  readonly animationCount: number;
  readonly error?: string;
  readonly imageFailures: number;
  readonly imageLoaded: number;
  readonly imageRequests: number;
  readonly key: string;
  readonly lightCount: number;
  readonly nodeCount: number;
  readonly phaseMs: {
    readonly animations?: number;
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
export interface WebGlRoot {
  readonly canvas: HTMLCanvasElement;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
  /** Suspends default-framebuffer scheduling until the returned release function runs. */
  acquireExternalRenderClock(): () => void;
  dispose(): void;
  /** Immediately renders queued demand on the caller's current frame, if any. */
  flushInvalidated(): void;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  pick(input: PickInput): PickResult | undefined;
  render(scene: RenderRoot): void;
  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void;
  snapshot(): WebGlRootSnapshot;
}
