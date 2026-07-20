import {
  validatePickInput,
  type GltfInstanceTransforms,
  type GltfAssetRef,
  type GltfInstancesNode,
  type GltfNode,
  type PickInput,
  type PickResult,
  type PrefilteredEnvironmentLight,
  type Scene,
  type TextureAssetRef,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import type { ContextLifecycleSnapshot } from "../context/context-lifecycle";
import { ContextLifecycleOwner } from "../context/context-lifecycle-owner";
import type {
  ClearFrameIntent,
  LinearRgba,
  MutableClearFrameIntent,
} from "../frame/clear-frame";
import { validateClearFrameIntent, validateLinearRgba } from "../frame/clear-frame";
import {
  resolveCanvasSize,
  type CanvasSizeInput,
  type CanvasSizeLimits,
  type ResolvedCanvasSize,
} from "../frame/canvas-size";
import { FrameClockOwner, type ExternalFrameClock } from "../frame/frame-clock-owner";
import { ProgressivePresentationOwner } from "../frame/progressive-presentation-owner";
import {
  rendererOwnedWebGl2Context,
  rendererSubmitExternalFrame,
  type ExternalSurfaceFrame,
} from "../frame/external-frame";
import {
  GltfAssetOwner,
  readGltfResourceWithFetch,
  readGltfWithFetch,
  type GltfAssetSnapshot,
  type GltfAssetOwnerPlatform,
} from "../gltf/asset-owner";
import type { PreparedStaticGltf } from "../gltf/static-asset";
import {
  identityMat4,
  multiplyMat4Into,
  projectionMat4Into,
  viewMat4Into,
} from "../math/mat4";
import { CameraSourceOwner } from "../surface/camera-source-owner";
import {
  prepareCanonicalSurfaceScene,
  refreshCanonicalSurfaceTexture,
  type CanonicalSurfaceScene,
} from "../surface/scene-lowering";
import {
  SurfaceGpuOwner,
  type SurfaceFrameView,
  type SurfaceGeometryUploadSnapshot,
} from "../surface/surface-gpu-owner";
import { SurfacePicker } from "../surface/surface-picker";
import {
  TextureAssetOwner,
  type DecodedTextureAlpha,
  type DecodedTextureSource,
  type TextureAssetSnapshot,
  type TexturePreparationSnapshot,
  type TextureSourceRef,
} from "../texture/asset-owner";
import { WebGlStateOwner } from "../webgl/state-owner";
import {
  resolveRendererRootOptions,
  type RendererRootOptions,
  type ResolvedRendererRootOptions,
} from "./root-options";
import {
  virtualTextureAssetKey,
  type VirtualTextureAssetSnapshot,
  type VirtualTextureRuntime,
  type VirtualTextureRuntimeSnapshot,
} from "../virtual-texture/runtime-contract";
import {
  PersistentGpuBudgetOwner,
  type PersistentGpuBudgetSnapshot,
} from "../resource/persistent-gpu-budget";
import type { OrdinaryTextureGpuSnapshot } from "../texture/gpu-owner";
import {
  PrefilteredEnvironmentAssetOwner,
  type PrefilteredEnvironmentAssetSnapshot,
} from "../environment/asset-owner";
import type { PreparedRoyalEnvironment } from "../environment/royal-environment-ktx1";
import {
  AsyncPreparationOwner,
  type AsyncPreparationSnapshot,
} from "../resource/async-preparation-owner";
import {
  DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME,
  FrameUploadBudgetOwner,
  type FrameUploadBudgetSnapshot,
} from "../resource/frame-upload-budget";
import {
  KeyedRetainedListeners,
  RetainedListeners,
} from "../resource/retained-listeners";

export type { RendererRootOptions, ResolvedRendererRootOptions } from "./root-options";

export type CanvasRootSnapshot = Readonly<{
  /** WebGL context lifecycle, including loss/restoration generations. */
  context: ContextLifecycleSnapshot;
  /** Successfully submitted canvas or external frames since root creation. */
  frame: number;
  /** Bounded message from the latest scheduled frame failure, if any. */
  lastFrameFailure?: string;
  /** Cold operational diagnostics; use focused asset hooks for product UI. */
  resources: Readonly<{
    asyncPreparation: AsyncPreparationSnapshot;
    geometryUploads: SurfaceGeometryUploadSnapshot;
    ordinaryTexturePreparation: TexturePreparationSnapshot;
    ordinaryTextureUploads: FrameUploadBudgetSnapshot;
    ordinaryTextures: OrdinaryTextureGpuSnapshot;
    persistentGpu: PersistentGpuBudgetSnapshot;
    virtualTextures: VirtualTextureRuntimeSnapshot;
  }>;
  /** Current CSS/backing size, or `null` before the host supplies a size. */
  size: ResolvedCanvasSize | null;
}>;

/** Complete cold diagnostic snapshot returned by a Royal renderer root. */
export type RendererRootSnapshot = CanvasRootSnapshot;

/** Imperative renderer lifetime owned by one canvas and one WebGL2 context. */
export interface RoyalRendererRoot {
  /** Canvas whose context and backing dimensions are owned by this root. */
  readonly canvas: HTMLCanvasElement;
  /** Temporarily transfers frame authority to an external host such as WebXR. */
  acquireExternalClock(): ExternalFrameClock;
  /** Idempotently releases all subscriptions, asynchronous work, and GPU resources. */
  dispose(): void;
  /** Immediately presents already-invalidated work from an imperative host. */
  flushInvalidated(): void;
  /** Stable getter for a cached, cold operational snapshot. */
  readonly getSnapshot: () => RendererRootSnapshot;
  /** Stable getter for one exact source/version identity. */
  readonly getGltfAssetSnapshot: (asset: GltfAssetRef) => GltfAssetSnapshot;
  /** Stable getter for the current context lifecycle. */
  readonly getLifecycleSnapshot: () => ContextLifecycleSnapshot;
  /** Stable getter for one exact offline environment identity. */
  readonly getPrefilteredEnvironmentSnapshot: (
    environment: PrefilteredEnvironmentLight,
  ) => PrefilteredEnvironmentAssetSnapshot;
  /** Stable getter for canvas size, or `null` before the host supplies one. */
  readonly getSizeSnapshot: () => ResolvedCanvasSize | null;
  /** Stable getter for one exact decoded texture identity. */
  readonly getTextureAssetSnapshot: (asset: TextureAssetRef) => TextureAssetSnapshot;
  /** Stable getter for one exact authored VT identity. */
  readonly getVirtualTextureAssetSnapshot: (
    asset: VirtualTextureAssetRef,
  ) => VirtualTextureAssetSnapshot;
  /** Requests one coalesced presentation frame without replacing scene intent. */
  invalidate(): void;
  /** Returns the nearest visible hit at one canvas-relative pointer position. */
  pick(input: PickInput): PickResult | undefined;
  /** Installs complete scene intent and requests one coalesced presentation frame. */
  setScene(scene: Scene): void;
  /** Sets CSS size and pixel density; Royal derives bounded backing dimensions. */
  setSize(input: CanvasSizeInput): void;
  /** Stable subscription function for broad operational snapshot changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Stable subscription function for one exact glTF source/version identity. */
  readonly subscribeGltfAsset: (asset: GltfAssetRef, listener: () => void) => () => void;
  /** Stable subscription function for context lifecycle changes. */
  readonly subscribeLifecycle: (listener: () => void) => () => void;
  /** Stable subscription function for one exact offline environment identity. */
  readonly subscribePrefilteredEnvironment: (
    environment: PrefilteredEnvironmentLight,
    listener: () => void,
  ) => () => void;
  /** Stable subscription function for semantic canvas-size changes. */
  readonly subscribeSize: (listener: () => void) => () => void;
  /** Stable subscription function for one exact decoded texture identity. */
  readonly subscribeTextureAsset: (
    asset: TextureAssetRef,
    listener: () => void,
  ) => () => void;
  /** Stable subscription function for one exact authored VT identity. */
  readonly subscribeVirtualTextureAsset: (
    asset: VirtualTextureAssetRef,
    listener: () => void,
  ) => () => void;
}

export type CanvasRootPlatform = Readonly<{
  cancelDelay?(handle: unknown): void;
  now?(): number;
  onListenerError(error: unknown): void;
  reportScheduledFailure(error: unknown): void;
  requestDelay?(callback: () => void, delayMs: number): unknown;
  requestFrame(callback: () => void): void;
  decodeTexture?(
    asset: TextureSourceRef,
    signal: AbortSignal,
    maxStorageBytes?: number,
    retainAlpha?: boolean,
  ): Promise<DecodedTextureSource>;
  readGltf?(asset: GltfAssetRef, signal: AbortSignal): Promise<Uint8Array>;
  readGltfResource?(uri: string, signal: AbortSignal): Promise<Uint8Array>;
  preparePrefilteredEnvironment?(source: ArrayBuffer): Promise<PreparedRoyalEnvironment>;
  readPrefilteredEnvironment?(src: string, signal: AbortSignal): Promise<ArrayBuffer>;
}>;

const defaultPlatform = (): CanvasRootPlatform => ({
  cancelDelay: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
  onListenerError: (error) => {
    try {
      console.error("Royal renderer listener failed", error);
    } catch {
      // Listener isolation must not depend on a console implementation.
    }
  },
  reportScheduledFailure: (error) => {
    try {
      console.error("Royal scheduled frame failed", error);
    } catch {
      // Scheduled failure isolation must not depend on a console implementation.
    }
  },
  requestDelay: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  requestFrame: (callback) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(callback);
    } else {
      queueMicrotask(callback);
    }
  },
});

const lazyBrowserTextureDecoder = (): NonNullable<CanvasRootPlatform["decodeTexture"]> => {
  let decoder: Promise<NonNullable<CanvasRootPlatform["decodeTexture"]>> | undefined;
  return async (asset, signal, maxStorageBytes, retainAlpha) => {
    decoder ??= import("../texture/browser-decode")
      .then((module) => module.createBrowserTextureDecoder());
    return (await decoder)(asset, signal, maxStorageBytes, retainAlpha);
  };
};

const lazyBrowserGltfPreparer = (): NonNullable<GltfAssetOwnerPlatform["prepare"]> => {
  let prepare: Promise<NonNullable<GltfAssetOwnerPlatform["prepare"]>> | undefined;
  return async (bytes, contentKey, label, sourceUri, signal, readResource) => {
    prepare ??= import("../gltf/browser-static-preparation")
      .then((module) => module.prepareStaticGltfInBrowser);
    return (await prepare)(
      bytes,
      contentKey,
      label,
      sourceUri,
      signal,
      readResource,
    );
  };
};

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

const IDLE_VIRTUAL_TEXTURE: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  state: "idle",
};
const LOADING_VIRTUAL_TEXTURE: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  state: "loading",
};
const IDLE_VIRTUAL_TEXTURE_RUNTIME: VirtualTextureRuntimeSnapshot = {
  admittedUploadBytes: 0,
  automaticCandidates: 0,
  automaticDecodedBytes: 0,
  automaticEnabled: 0,
  automaticIneligible: 0,
  automaticResources: 0,
  automaticWaiting: 0,
  deferredUploads: 0,
  failedPages: 0,
  pageRequests: 0,
  pendingPages: 0,
  residentPages: 0,
  uploadedPages: 0,
  uploadBudgetBytes: DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME,
};

const sameColor = (left: LinearRgba, right: LinearRgba): boolean =>
  left[0] === right[0]
  && left[1] === right[1]
  && left[2] === right[2]
  && left[3] === right[3];

const readSizeLimits = (gl: WebGL2RenderingContext): CanvasSizeLimits => {
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as unknown;
  const renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as unknown;
  if (
    !(viewport instanceof Int32Array)
    || viewport.length < 2
    || !Number.isSafeInteger(viewport[0])
    || !Number.isSafeInteger(viewport[1])
    || viewport[0]! < 1
    || viewport[1]! < 1
    || typeof renderbuffer !== "number"
    || !Number.isSafeInteger(renderbuffer)
    || renderbuffer < 1
  ) {
    throw new Error("Royal renderer received invalid WebGL2 size limits");
  }
  return {
    maxHeight: Math.min(viewport[1]!, renderbuffer),
    maxWidth: Math.min(viewport[0]!, renderbuffer),
  };
};

const createContext = (
  canvas: HTMLCanvasElement,
  options: ResolvedRendererRootOptions,
): WebGL2RenderingContext => {
  const gl = canvas.getContext("webgl2", {
    alpha: options.alpha,
    antialias: options.antialias,
    depth: true,
    stencil: false,
  });
  if (gl === null) throw new Error("Royal renderer could not create a WebGL2 context");
  return gl;
};

/** Root-local lifecycle, canonical surface, picking, and WebGL state authority. */
export class CanvasRoot implements RoyalRendererRoot {
  readonly #asyncPreparation: AsyncPreparationOwner;
  readonly #canvas: HTMLCanvasElement;
  readonly #cameraSource: CameraSourceOwner;
  readonly #clock: FrameClockOwner;
  readonly #context: ContextLifecycleOwner;
  readonly #environmentAssets: PrefilteredEnvironmentAssetOwner;
  #clearColor: LinearRgba = [0, 0, 0, 0];
  #disposed = false;
  #frame = 0;
  #frameIntent: ClearFrameIntent | null = null;
  readonly #gl: WebGL2RenderingContext;
  readonly #gltfAssets: GltfAssetOwner;
  readonly #frameUploadBudget: FrameUploadBudgetOwner;
  readonly #getDecodedAlpha = (asset: TextureSourceRef): DecodedTextureAlpha | undefined =>
    this.#textureAssets.alpha(asset);
  readonly #getDecodedTexture = (asset: TextureSourceRef): DecodedTextureSource | undefined =>
    this.#textureAssets.decoded(asset);
  readonly #getGltfAsset = (node: GltfNode | GltfInstancesNode): PreparedStaticGltf | undefined =>
    this.#gltfAssets.prepared(node.asset);
  readonly #getTextureSnapshot = (asset: TextureSourceRef): TextureAssetSnapshot =>
    this.#textureAssets.getSourceSnapshot(asset);
  readonly #isTexturePending = (asset: TextureSourceRef): boolean => {
    const state = this.#getTextureSnapshot(asset).state;
    return state === "idle" || state === "loading";
  };
  #lastFrameFailure: string | undefined;
  readonly #listeners = new RetainedListeners();
  #instanceSceneDirty = false;
  readonly #instanceSubscriptions = new Map<GltfInstanceTransforms, () => void>();
  readonly #onContextLost: (event: Event) => void;
  readonly #onContextRestored: () => void;
  readonly #platform: CanvasRootPlatform;
  readonly #persistentGpuBudget: PersistentGpuBudgetOwner;
  #presentationRequired = false;
  readonly #progressiveTexturePresentation: ProgressivePresentationOwner;
  #revision = 0;
  #size: ResolvedCanvasSize | null = null;
  #sizeInput: CanvasSizeInput | null = null;
  #sizeLimits: CanvasSizeLimits;
  readonly #sizeListeners = new RetainedListeners();
  #snapshot: CanvasRootSnapshot | undefined;
  #snapshotRevision = -1;
  readonly #state: WebGlStateOwner;
  readonly #surfaceGpu: SurfaceGpuOwner;
  readonly #surfacePicker = new SurfacePicker(this.#getDecodedAlpha);
  readonly #textureAssets: TextureAssetOwner;
  #textureResourcesPending = false;
  readonly #unsubscribeContext: () => void;
  readonly #projection = identityMat4();
  readonly #view = identityMat4();
  readonly #viewProjection = identityMat4();
  readonly #canvasViewport = { height: 1, width: 1, x: 0, y: 0 };
  readonly #canvasViews: readonly SurfaceFrameView[] = [{
    view: this.#view,
    viewProjection: this.#viewProjection,
    viewport: this.#canvasViewport,
  }];
  readonly #externalClearIntent: MutableClearFrameIntent = {
    clearColor: this.#clearColor,
    clearDepth: 1,
    framebuffer: null,
    scissor: null,
    size: { height: 1, width: 1 },
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #surfaceScene: ReturnType<typeof prepareCanonicalSurfaceScene> | null = null;
  #surfaceSceneInput: Scene | null = null;
  readonly #automaticVirtualTexturing: boolean;
  #virtualTextureActive = false;
  #virtualTextureLoadGeneration = 0;
  #virtualTextureRequested = false;
  #virtualTextureRuntime: VirtualTextureRuntime | null = null;
  readonly #virtualTextureListeners = new KeyedRetainedListeners<string>();

  /** Canvas whose context and backing dimensions are owned by this root. */
  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  /** @internal Dedicated optional renderers borrow, but never own, this context. */
  get [rendererOwnedWebGl2Context](): WebGL2RenderingContext {
    return this.#gl;
  }

  constructor(
    canvas: HTMLCanvasElement,
    options: RendererRootOptions = {},
    platform: CanvasRootPlatform = defaultPlatform(),
  ) {
    const resolvedOptions = resolveRendererRootOptions(options);
    this.#canvas = canvas;
    this.#platform = platform;
    this.#automaticVirtualTexturing = resolvedOptions.automaticVirtualTexturing;
    this.#gl = createContext(canvas, resolvedOptions);
    this.#persistentGpuBudget = new PersistentGpuBudgetOwner(
      resolvedOptions.persistentGpuByteBudget,
    );
    this.#asyncPreparation = new AsyncPreparationOwner(
      resolvedOptions.maxConcurrentPreparationJobs,
      () => {
        if (!this.#disposed) this.#publish();
      },
    );
    this.#frameUploadBudget = new FrameUploadBudgetOwner(
      resolvedOptions.ordinaryTextureUploadByteBudgetPerFrame,
    );
    this.#sizeLimits = readSizeLimits(this.#gl);
    this.#state = new WebGlStateOwner(this.#gl);
    this.#surfaceGpu = new SurfaceGpuOwner(
      this.#gl,
      this.#persistentGpuBudget,
      () => this.#invalidatePresentation(),
      (error) => this.#captureScheduledFailure(error),
      this.#frameUploadBudget,
    );
    this.#environmentAssets = new PrefilteredEnvironmentAssetOwner({
      onAssetChanged: () => {
        try {
          this.#refreshPrefilteredEnvironment();
        } catch (error) {
          this.#captureScheduledFailure(error);
        }
      },
      onListenerError: (error) => platform.onListenerError(error),
      ...(platform.preparePrefilteredEnvironment === undefined
        ? {}
        : { prepare: platform.preparePrefilteredEnvironment }),
      ...(platform.readPrefilteredEnvironment === undefined
        ? {}
        : { read: platform.readPrefilteredEnvironment }),
      schedule: this.#asyncPreparation.run,
    });
    this.#gltfAssets = new GltfAssetOwner({
      onAssetChanged: () => this.#refreshPreparedScene(),
      onListenerError: (error) => platform.onListenerError(error),
      prepare: lazyBrowserGltfPreparer(),
      read: platform.readGltf ?? readGltfWithFetch,
      readResource: platform.readGltfResource ?? readGltfResourceWithFetch,
      schedule: this.#asyncPreparation.run,
    });
    this.#textureAssets = new TextureAssetOwner({
      decode: platform.decodeTexture ?? lazyBrowserTextureDecoder(),
      onAssetChanged: (key) => this.#refreshPreparedTexture(key),
      onListenerError: (error) => platform.onListenerError(error),
      onSnapshotChanged: () => this.#refreshGltfTextureProgress(),
      schedule: this.#asyncPreparation.run,
    }, Math.floor(this.#persistentGpuBudget.snapshot().budgetBytes * 0.75));
    this.#context = new ContextLifecycleOwner(platform.onListenerError);
    this.#unsubscribeContext = this.#context.subscribe(() => this.#publish());
    this.#clock = new FrameClockOwner({
      render: () => this.#renderFrame(),
      reportScheduledFailure: (error) => this.#captureScheduledFailure(error),
      requestFrame: platform.requestFrame,
    });
    this.#progressiveTexturePresentation = new ProgressivePresentationOwner({
      cancelDelay: platform.cancelDelay
        ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)),
      intervalMs: 250,
      now: platform.now ?? (() => performance.now()),
      onFailure: (error) => this.#captureScheduledFailure(error),
      present: () => this.#invalidatePresentation(),
      requestDelay: platform.requestDelay
        ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
    });
    this.#cameraSource = new CameraSourceOwner({
      onCameraChanged: () => this.#invalidatePresentation(),
      onFailure: (error) => this.#captureScheduledFailure(error),
    });
    this.#onContextLost = (event) => {
      if (this.#disposed) return;
      event.preventDefault();
      this.#clock.block();
      this.#state.invalidate();
      this.#surfaceGpu.invalidate();
      this.#context.transition({ kind: "context-lost" });
    };
    this.#onContextRestored = () => this.#restoreContext();
    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    canvas.addEventListener("webglcontextrestored", this.#onContextRestored);
  }

  acquireExternalClock(): ExternalFrameClock {
    this.#assertLive("acquire an external clock");
    return this.#clock.acquireExternalClock();
  }

  /** @internal Submits one already-validated multi-view transaction. */
  [rendererSubmitExternalFrame](frame: ExternalSurfaceFrame): boolean {
    this.#assertLive("submit an external frame");
    if (this.#context.getSnapshot().phase !== "active" || frame.views.length === 0) return false;
    this.#flushInstanceScene();
    this.#surfaceGpu.beginFrame();
    const intent = this.#externalClearIntent;
    intent.clearColor = this.#clearColor;
    intent.framebuffer = frame.framebuffer;
    intent.size.height = frame.size.height;
    intent.size.width = frame.size.width;
    intent.viewport.height = frame.size.height;
    intent.viewport.width = frame.size.width;
    this.#state.invalidate();
    this.#state.clear(intent);
    let pending: boolean;
    try {
      pending = this.#surfaceGpu.drawViews(
        frame.views,
        frame.framebuffer,
        this.#state,
        this.#clearColor,
      );
    } finally {
      this.#releaseUploadedTextures();
    }
    this.#textureResourcesPending = this.#surfaceGpu.texturePublicationsPending();
    this.#presentationRequired = false;
    this.#frame += 1;
    this.#lastFrameFailure = undefined;
    this.#publish();
    return pending;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#canvas.removeEventListener("webglcontextlost", this.#onContextLost);
    this.#canvas.removeEventListener("webglcontextrestored", this.#onContextRestored);
    this.#progressiveTexturePresentation.dispose();
    this.#clock.dispose();
    this.#cameraSource.dispose();
    this.#environmentAssets.dispose();
    this.#gltfAssets.dispose();
    this.#surfaceGpu.dispose();
    this.#textureAssets.dispose();
    this.#asyncPreparation.dispose();
    for (const unsubscribe of this.#instanceSubscriptions.values()) unsubscribe();
    this.#instanceSubscriptions.clear();
    this.#context.transition({ kind: "dispose" });
    this.#unsubscribeContext();
    this.#listeners.clear();
    this.#sizeListeners.clear();
    this.#virtualTextureListeners.clear();
  }

  flushInvalidated(): void {
    this.#assertLive("flush invalidated work");
    this.#clock.flushInvalidated();
  }

  getSnapshot = (): CanvasRootSnapshot => {
    if (this.#snapshot === undefined || this.#snapshotRevision !== this.#revision) {
      this.#snapshot = {
        context: this.#context.getSnapshot(),
        frame: this.#frame,
        ...(this.#lastFrameFailure === undefined
          ? {}
          : { lastFrameFailure: this.#lastFrameFailure }),
        resources: {
          asyncPreparation: this.#asyncPreparation.snapshot(),
          geometryUploads: this.#surfaceGpu.geometryUploadSnapshot(),
          ordinaryTexturePreparation: this.#textureAssets.snapshot(),
          ordinaryTextureUploads: this.#frameUploadBudget.snapshot(),
          ordinaryTextures: this.#surfaceGpu.ordinaryTextureSnapshot(),
          persistentGpu: this.#persistentGpuBudget.snapshot(),
          virtualTextures: this.#virtualTextureRuntime?.runtimeSnapshot()
            ?? IDLE_VIRTUAL_TEXTURE_RUNTIME,
        },
        size: this.#size,
      };
      this.#snapshotRevision = this.#revision;
    }
    return this.#snapshot;
  };

  /** Focused context lifecycle snapshot for product observation. */
  getLifecycleSnapshot = (): ContextLifecycleSnapshot => this.#context.getSnapshot();

  /** Focused canvas-size snapshot for product observation. */
  getSizeSnapshot = (): ResolvedCanvasSize | null => this.#size;

  /** Focused readiness for one exact source/version identity. */
  getGltfAssetSnapshot = (asset: GltfAssetRef): GltfAssetSnapshot =>
    this.#gltfAssets.getSnapshot(asset);

  /** Focused readiness for one exact offline environment source/version identity. */
  getPrefilteredEnvironmentSnapshot = (
    environment: PrefilteredEnvironmentLight,
  ): PrefilteredEnvironmentAssetSnapshot => this.#environmentAssets.getSnapshot(environment);

  /** Focused readiness for one exact decoded texture identity. */
  getTextureAssetSnapshot = (asset: TextureAssetRef): TextureAssetSnapshot =>
    this.#textureAssets.getSnapshot(asset);

  /** Focused readiness and residency for one exact authored VT identity. */
  getVirtualTextureAssetSnapshot = (asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot => {
    if (this.#virtualTextureRuntime !== null) return this.#virtualTextureRuntime.snapshot(asset);
    const key = virtualTextureAssetKey(asset);
    const claimed = this.#surfaceScene?.virtualTextureAssets.some(
      (candidate) => virtualTextureAssetKey(candidate) === key,
    ) ?? false;
    return claimed ? LOADING_VIRTUAL_TEXTURE : IDLE_VIRTUAL_TEXTURE;
  };

  invalidate(): void {
    this.#assertLive("invalidate");
    this.#invalidatePresentation();
  }

  pick(input: PickInput): PickResult | undefined {
    this.#assertLive("pick");
    validatePickInput(input);
    if (this.#context.getSnapshot().phase !== "active") return undefined;
    this.#flushInstanceScene();
    const scene = this.#surfaceScene;
    const size = this.#size;
    if (scene === null || size === null || size.backingWidth === 0 || size.backingHeight === 0) {
      return undefined;
    }
    projectionMat4Into(this.#projection, scene.camera, size.backingWidth, size.backingHeight);
    viewMat4Into(this.#view, scene.camera);
    multiplyMat4Into(this.#viewProjection, this.#projection, this.#view);
    return this.#surfacePicker.pick(
      input,
      scene,
      this.#viewProjection,
      this.#canvas.getBoundingClientRect(),
      this.#surfaceGpu.lodSelections(),
    );
  }

  /** Installs complete scene intent and requests a coalesced presentation frame. */
  setScene(scene: Scene): void {
    this.#assertLive("set a scene");
    if (
      typeof scene !== "object"
      || scene === null
      || scene.kind !== "scene"
      || !Array.isArray(scene.nodes)
    ) {
      throw new TypeError("Royal render requires a validated scene");
    }
    if (scene === this.#surfaceSceneInput) return;
    const camera = this.#cameraSource.prepare(scene.camera);
    const prepared = prepareCanonicalSurfaceScene(
      scene,
      this.#getGltfAsset,
      camera.camera,
      this.#getDecodedTexture,
      this.#isTexturePending,
    );
    this.#updateClearColor(scene.clearColor);
    this.#surfaceScene = prepared;
    this.#surfaceSceneInput = scene;
    this.#instanceSceneDirty = false;
    this.#progressiveTexturePresentation.reset();
    this.#textureResourcesPending = false;
    this.#surfaceGpu.setScene(prepared);
    this.#reconcilePrefilteredEnvironment(prepared);
    this.#reconcileVirtualTextureRuntime(prepared);
    this.#cameraSource.commit(camera);
    this.#gltfAssets.reconcile(prepared.gltfNodes);
    this.#reconcileInstanceSources(scene);
    this.#textureAssets.reconcile(prepared.textureAssets, prepared.alphaMaskTextureAssets);
    this.#refreshGltfTextureProgress();
    this.#invalidatePresentation();
  }

  setSize(input: CanvasSizeInput): void {
    this.#assertLive("set size");
    const resolved = resolveCanvasSize(input, this.#sizeLimits);
    const previous = this.#size;
    const backingChanged = this.#canvas.width !== resolved.backingWidth
      || this.#canvas.height !== resolved.backingHeight;
    if (this.#canvas.width !== resolved.backingWidth) this.#canvas.width = resolved.backingWidth;
    if (this.#canvas.height !== resolved.backingHeight) this.#canvas.height = resolved.backingHeight;
    const semanticChanged = previous?.cssWidth !== resolved.cssWidth
      || previous?.cssHeight !== resolved.cssHeight
      || previous?.devicePixelRatio !== resolved.devicePixelRatio
      || previous?.backingWidth !== resolved.backingWidth
      || previous?.backingHeight !== resolved.backingHeight;
    if (!semanticChanged) return;
    this.#sizeInput = { ...input };
    this.#size = resolved;
    if (!previous || backingChanged) this.#rebuildFrameIntent();
    if (backingChanged) this.#state.invalidate();
    this.#publishSize();
    this.#publish();
    if (
      (!previous || backingChanged)
      && resolved.backingWidth * resolved.backingHeight > 0
    ) {
      this.#invalidatePresentation();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    return this.#listeners.subscribe(listener);
  };

  /** Subscribes only to context lifecycle changes. */
  subscribeLifecycle = (listener: () => void): (() => void) =>
    this.#context.subscribe(listener);

  /** Subscribes only to semantic canvas-size changes. */
  subscribeSize = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    return this.#sizeListeners.subscribe(listener);
  };

  /** Subscribes only to one exact glTF source/version identity. */
  subscribeGltfAsset = (asset: GltfAssetRef, listener: () => void): (() => void) =>
    this.#gltfAssets.subscribe(asset, listener);

  /** Subscribes only to one exact offline environment source/version identity. */
  subscribePrefilteredEnvironment = (
    environment: PrefilteredEnvironmentLight,
    listener: () => void,
  ): (() => void) => this.#environmentAssets.subscribe(environment, listener);

  /** Subscribes only to one exact decoded texture identity. */
  subscribeTextureAsset = (asset: TextureAssetRef, listener: () => void): (() => void) =>
    this.#textureAssets.subscribe(asset, listener);

  /** Subscribes only to one exact authored VT identity. */
  subscribeVirtualTextureAsset = (
    asset: VirtualTextureAssetRef,
    listener: () => void,
  ): (() => void) => {
    if (this.#disposed) return () => undefined;
    const key = virtualTextureAssetKey(asset);
    return this.#virtualTextureListeners.subscribe(key, listener);
  };

  #assertLive(operation: string): void {
    if (this.#disposed) throw new Error(`Cannot ${operation} on a disposed Royal renderer root`);
  }

  #captureScheduledFailure(error: unknown): void {
    this.#lastFrameFailure = formatFailure(error);
    this.#publish();
    this.#platform.reportScheduledFailure(error);
  }

  #invalidatePresentation(): void {
    if (this.#disposed) return;
    this.#presentationRequired = true;
    this.#clock.invalidate();
  }

  #createFrameIntent(size: ResolvedCanvasSize, color: LinearRgba): ClearFrameIntent {
    return {
      clearColor: color,
      clearDepth: 1,
      framebuffer: null,
      scissor: null,
      size: { height: size.backingHeight, width: size.backingWidth },
      viewport: {
        height: size.backingHeight,
        width: size.backingWidth,
        x: 0,
        y: 0,
      },
    };
  }

  #publish(): void {
    this.#revision += 1;
    this.#listeners.publish(this.#platform.onListenerError);
  }

  #publishSize(): void {
    this.#sizeListeners.publish(this.#platform.onListenerError);
  }

  #rebuildFrameIntent(): void {
    const size = this.#size;
    if (size === null || size.backingWidth === 0 || size.backingHeight === 0) {
      this.#frameIntent = null;
      return;
    }
    const intent = this.#createFrameIntent(size, this.#clearColor);
    validateClearFrameIntent(intent);
    this.#frameIntent = intent;
  }

  #reconcileInstanceSources(scene: Scene): void {
    const claimed = new Set<GltfInstanceTransforms>();
    for (const node of scene.nodes) {
      if (node.kind !== "gltf-instances") continue;
      const source = node.instances;
      claimed.add(source);
      if (this.#instanceSubscriptions.has(source)) continue;
      const unsubscribe = source.subscribe(() => {
        if (this.#disposed) return;
        this.#instanceSceneDirty = true;
        this.#invalidatePresentation();
      });
      this.#instanceSubscriptions.set(source, unsubscribe);
    }
    for (const [source, unsubscribe] of this.#instanceSubscriptions) {
      if (claimed.has(source)) continue;
      unsubscribe();
      this.#instanceSubscriptions.delete(source);
    }
  }

  #flushInstanceScene(): void {
    if (!this.#instanceSceneDirty) return;
    this.#refreshPreparedScene(true);
  }

  #refreshPreparedScene(instanceOnly = false): void {
    if (this.#disposed || this.#surfaceSceneInput === null) return;
    const camera = this.#cameraSource.prepare(this.#surfaceSceneInput.camera);
    const prepared = prepareCanonicalSurfaceScene(
      this.#surfaceSceneInput,
      this.#getGltfAsset,
      camera.camera,
      this.#getDecodedTexture,
      this.#isTexturePending,
    );
    this.#surfaceScene = prepared;
    if (!instanceOnly) {
      this.#progressiveTexturePresentation.reset();
      this.#textureResourcesPending = false;
    }
    this.#surfaceGpu.setScene(prepared);
    this.#reconcilePrefilteredEnvironment(prepared);
    this.#reconcileVirtualTextureRuntime(prepared);
    this.#cameraSource.commit(camera);
    this.#textureAssets.reconcile(prepared.textureAssets, prepared.alphaMaskTextureAssets);
    this.#refreshGltfTextureProgress();
    this.#instanceSceneDirty = false;
    if (!instanceOnly) this.#invalidatePresentation();
  }

  #refreshPreparedTexture(key: string): void {
    if (this.#disposed) return;
    if (this.#surfaceScene !== null) {
      const prepared = refreshCanonicalSurfaceTexture(
        this.#surfaceScene,
        key,
        this.#getDecodedTexture,
        this.#isTexturePending,
      );
      if (prepared !== this.#surfaceScene) {
        this.#surfaceScene = prepared;
        this.#surfaceGpu.publishTextureScene(prepared, key);
        this.#virtualTextureRuntime?.setScene(prepared);
        this.#textureResourcesPending = true;
        this.#progressiveTexturePresentation.changed();
        this.#clock.invalidate();
      }
    }
  }

  #reconcilePrefilteredEnvironment(scene: CanonicalSurfaceScene): void {
    const environment = scene.environment?.source === "royal-prefiltered-v1"
      ? scene.environment
      : undefined;
    this.#environmentAssets.reconcile(environment);
    let textureStateChanged = false;
    try {
      textureStateChanged = this.#surfaceGpu.setPrefilteredEnvironment(
        environment === undefined ? undefined : this.#environmentAssets.prepared(environment),
      );
    } catch (error) {
      textureStateChanged = true;
      throw error;
    } finally {
      if (textureStateChanged) this.#state.invalidateTextureUnit(0);
    }
  }

  #refreshPrefilteredEnvironment(): void {
    if (this.#disposed || this.#surfaceScene === null) return;
    this.#reconcilePrefilteredEnvironment(this.#surfaceScene);
    this.#invalidatePresentation();
  }

  #refreshGltfTextureProgress(): void {
    this.#gltfAssets.refreshTextureProgress(this.#getTextureSnapshot);
    if (this.#textureAssetsSettled()) this.#progressiveTexturePresentation.settled();
  }

  #reconcileVirtualTextureRuntime(scene: CanonicalSurfaceScene): void {
    const required = this.#virtualTextureRequired(scene);
    if (!required) {
      this.#virtualTextureLoadGeneration += 1;
      this.#virtualTextureRequested = false;
      if (this.#virtualTextureActive) {
        this.#surfaceGpu.setVirtualTextureRuntime(null);
        this.#virtualTextureActive = false;
        this.#virtualTextureRuntime = null;
      }
      return;
    }
    if (this.#virtualTextureActive) {
      this.#virtualTextureRuntime?.setScene(scene);
      return;
    }
    if (this.#virtualTextureRequested) return;
    this.#virtualTextureRequested = true;
    const generation = ++this.#virtualTextureLoadGeneration;
    void import("../virtual-texture/runtime").then((module) => {
      if (
        this.#disposed
        || generation !== this.#virtualTextureLoadGeneration
        || this.#surfaceScene === null
        || !this.#virtualTextureRequired(this.#surfaceScene)
      ) return;
      const runtime = module.createBrowserVirtualTextureRuntime(
        this.#gl,
        (asset) => {
          if (this.#disposed) return;
          this.#publishVirtualTexture(asset);
          this.#invalidatePresentation();
        },
        this.#persistentGpuBudget,
        this.#asyncPreparation.run,
        this.#automaticVirtualTexturing ? {
          acquireDecoded: (asset) => this.#textureAssets.acquireDecoded(asset),
          decoded: (asset) => this.#textureAssets.decoded(asset),
          onChanged: () => {
            if (!this.#disposed) this.#invalidatePresentation();
          },
        } : undefined,
      );
      this.#virtualTextureRuntime = runtime;
      this.#surfaceGpu.setVirtualTextureRuntime(runtime);
      this.#virtualTextureActive = true;
      this.#virtualTextureRequested = false;
      this.#invalidatePresentation();
    }).catch((error: unknown) => {
      if (this.#disposed || generation !== this.#virtualTextureLoadGeneration) return;
      this.#virtualTextureRequested = false;
      this.#releaseUploadedTextures();
      this.#captureScheduledFailure(error);
    });
  }

  #virtualTextureRequired(scene: CanonicalSurfaceScene): boolean {
    return scene.virtualTextureAssets.length > 0 || (
      this.#automaticVirtualTexturing
      && scene.surfaces.some((surface) => surface.material.baseColorAsset !== undefined)
    );
  }

  #publishVirtualTexture(asset: VirtualTextureAssetRef): void {
    this.#virtualTextureListeners.publish(
      virtualTextureAssetKey(asset),
      this.#platform.onListenerError,
    );
  }

  #renderFrame(): void {
    const intent = this.#frameIntent;
    if (intent === null || this.#context.getSnapshot().phase !== "active") return;
    this.#flushInstanceScene();
    this.#surfaceGpu.beginFrame();
    if (this.#textureResourcesPending) {
      let texturesUploaded: boolean;
      try {
        if (!this.#surfaceGpu.flushTexturePublications(this.#state)) {
          this.#presentationRequired = true;
        }
      } finally {
        this.#textureResourcesPending = this.#surfaceGpu.texturePublicationsPending();
        texturesUploaded = this.#releaseUploadedTextures();
      }
      if (texturesUploaded && !this.#presentationRequired) {
        this.#progressiveTexturePresentation.changed();
        if (this.#textureAssetsSettled() && !this.#textureResourcesPending) {
          this.#progressiveTexturePresentation.settled();
        }
      }
      if (this.#textureResourcesPending) this.#clock.invalidate();
    }
    if (!this.#presentationRequired) {
      this.#publish();
      return;
    }
    this.#presentationRequired = false;
    this.#state.clear(intent);
    const surfaceScene = this.#surfaceScene;
    const size = this.#size;
    if (surfaceScene !== null && size !== null && surfaceScene.surfaces.length > 0) {
      projectionMat4Into(this.#projection, surfaceScene.camera, size.backingWidth, size.backingHeight);
      viewMat4Into(this.#view, surfaceScene.camera);
      multiplyMat4Into(this.#viewProjection, this.#projection, this.#view);
      this.#canvasViewport.height = size.backingHeight;
      this.#canvasViewport.width = size.backingWidth;
      try {
        if (this.#surfaceGpu.drawViews(
          this.#canvasViews,
          null,
          this.#state,
          this.#clearColor,
        )) {
          this.#invalidatePresentation();
        }
      } finally {
        this.#releaseUploadedTextures();
        this.#textureResourcesPending = this.#surfaceGpu.texturePublicationsPending();
        if (this.#textureResourcesPending) this.#clock.invalidate();
      }
    }
    this.#frame += 1;
    this.#lastFrameFailure = undefined;
    this.#publish();
  }

  #restoreContext(): void {
    if (this.#disposed || !this.#context.transition({ kind: "restoration-started" })) return;
    try {
      this.#sizeLimits = readSizeLimits(this.#gl);
      this.#state.invalidate();
      this.#surfaceGpu.invalidate();
      if (this.#surfaceScene !== null) this.#reconcilePrefilteredEnvironment(this.#surfaceScene);
      this.#textureAssets.invalidateResidency();
      if (this.#sizeInput !== null) {
        const previousSize = this.#size;
        this.#size = resolveCanvasSize(this.#sizeInput, this.#sizeLimits);
        if (this.#canvas.width !== this.#size.backingWidth) {
          this.#canvas.width = this.#size.backingWidth;
        }
        if (this.#canvas.height !== this.#size.backingHeight) {
          this.#canvas.height = this.#size.backingHeight;
        }
        if (
          previousSize?.cssWidth !== this.#size.cssWidth
          || previousSize?.cssHeight !== this.#size.cssHeight
          || previousSize?.devicePixelRatio !== this.#size.devicePixelRatio
          || previousSize?.backingWidth !== this.#size.backingWidth
          || previousSize?.backingHeight !== this.#size.backingHeight
        ) this.#publishSize();
      }
      this.#rebuildFrameIntent();
      this.#context.transition({ kind: "restored" });
      this.#clock.resume();
      this.#invalidatePresentation();
    } catch (error) {
      this.#context.transition({
        failure: formatFailure(error),
        kind: "restoration-failed",
      });
    }
  }

  #releaseUploadedTextures(): boolean {
    // Keep the bounded decode handoff alive until the lazy automatic-VT owner can claim it.
    if (
      this.#automaticVirtualTexturing
      && this.#virtualTextureRequested
      && !this.#virtualTextureActive
    ) return false;
    const uploaded = this.#surfaceGpu.takeUploadedTextureStorageKeys();
    this.#textureAssets.releaseUploaded(uploaded);
    this.#textureAssets.rejectGpuStorage(this.#surfaceGpu.takeDeniedTextureStorageKeys());
    return uploaded.length !== 0;
  }

  #textureAssetsSettled(): boolean {
    const assets = this.#surfaceScene?.textureAssets ?? [];
    return assets.length !== 0 && assets.every((asset) => {
      const state = this.#getTextureSnapshot(asset).state;
      return state === "ready" || state === "error";
    });
  }

  #updateClearColor(color: LinearRgba): boolean {
    validateLinearRgba(color);
    if (sameColor(this.#clearColor, color)) return false;
    this.#clearColor = [color[0], color[1], color[2], color[3]];
    this.#rebuildFrameIntent();
    return true;
  }
}

/** Creates one imperative Royal renderer root for an existing canvas. */
export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options: RendererRootOptions = {},
): RoyalRendererRoot => new CanvasRoot(canvas, options);
