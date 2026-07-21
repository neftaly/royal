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
  rendererAcquireExternalClock,
  rendererOwnedWebGl2Context,
  rendererSubmitExternalFrame,
  type ExternalSurfaceFrame,
} from "../frame/external-frame";
import type { SurfaceFrameView } from "../frame/surface-frame";
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
  refreshCanonicalSurfaceTextures,
  type CanonicalSurfaceScene,
} from "../surface/scene-lowering";
import {
  SurfaceGpuOwner,
  type SurfaceGeometryUploadSnapshot,
} from "../surface/surface-gpu-owner";
import { SurfacePicker } from "../surface/surface-picker";
import {
  createCanonicalInstanceSceneUpdateWorkspace,
  refreshCanonicalInstanceLodBounds,
  updateCanonicalGltfInstanceSource,
} from "../surface/instance-scene-update";
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
  idleVirtualTextureRuntimeSnapshot,
  virtualTextureRuntimeRequired,
  virtualTextureAssetKey,
  type VirtualTextureAssetSnapshot,
  type VirtualTextureRuntime,
  type VirtualTextureRuntimeSnapshot,
} from "../virtual-texture/runtime-contract";
import {
  initialVirtualTextureActivationState,
  reconcileVirtualTextureActivation,
  settleVirtualTextureActivation,
  type VirtualTextureActivationState,
} from "./virtual-texture-activation";
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
  FrameUploadBudgetOwner,
  type FrameUploadBudgetSnapshot,
} from "../resource/frame-upload-budget";
import {
  KeyedRetainedListeners,
  RetainedListeners,
  requireRetainedListener,
} from "../resource/retained-listeners";

export type { RendererRootOptions, ResolvedRendererRootOptions } from "./root-options";

/** WebGL context lifecycle reported by the lower-level renderer root. */
export type RendererContextSnapshot = ContextLifecycleSnapshot;

/** Cold resource and scheduling diagnostics reported by a renderer root. */
export type RendererResourceSnapshot = Readonly<{
  /** Root-wide preparation concurrency and queue pressure. */
  asyncPreparation: AsyncPreparationSnapshot;
  /** Geometry bytes uploaded or deferred during the latest submitted frame. */
  geometryUploads: SurfaceGeometryUploadSnapshot;
  /** Decoded ordinary-texture handoff pressure. */
  ordinaryTexturePreparation: TexturePreparationSnapshot;
  /** Ordinary-texture bytes uploaded or deferred during the latest frame. */
  ordinaryTextureUploads: FrameUploadBudgetSnapshot;
  /** Current ordinary-texture GPU residency and compression totals. */
  ordinaryTextures: OrdinaryTextureGpuSnapshot;
  /** Root-wide persistent GPU admission and retained-byte totals. */
  persistentGpu: PersistentGpuBudgetSnapshot;
  /** Authored and automatic virtual-texture demand, residency, and policy. */
  virtualTextures: VirtualTextureRuntimeSnapshot;
}>;

export type CanvasRootSnapshot = Readonly<{
  /** WebGL context lifecycle, including loss/restoration generations. */
  context: RendererContextSnapshot;
  /** Successfully submitted canvas or external frames since root creation. */
  frame: number;
  /** Bounded message from the latest scheduled frame failure, if any. */
  lastFrameFailure?: string;
  /** Cold operational diagnostics; use focused asset hooks for product UI. */
  resources: RendererResourceSnapshot;
  /** Current CSS/backing size, or `null` before the host supplies a size. */
  size: ResolvedCanvasSize | null;
}>;

/** Complete cold diagnostic snapshot returned by a Royal renderer root. */
export type RendererRootSnapshot = CanvasRootSnapshot;

/** Imperative renderer lifetime owned by one canvas and one WebGL2 context. */
export interface RendererRoot {
  /** Canvas whose context and backing dimensions are owned by this root. */
  readonly canvas: HTMLCanvasElement;
  /** Idempotently releases all subscriptions, asynchronous work, and GPU resources. */
  dispose(): void;
  /** Immediately presents already-invalidated work from an imperative host. */
  flushInvalidated(): void;
  /** Stable getter for a cached, cold operational snapshot. */
  readonly getSnapshot: () => RendererRootSnapshot;
  /** Stable getter for one exact glTF source/version/selected-scene identity. */
  readonly getGltfAssetSnapshot: (asset: GltfAssetRef) => GltfAssetSnapshot;
  /** Stable getter for the current context lifecycle. */
  readonly getLifecycleSnapshot: () => RendererContextSnapshot;
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
  /** Returns the nearest visible hit at one browser-viewport CSS-pixel position. */
  pick(input: PickInput): PickResult | undefined;
  /** Installs complete scene intent and requests one coalesced presentation frame. */
  setScene(scene: Scene): void;
  /** Sets CSS size and requested backing pixels per CSS pixel. */
  setSize(input: CanvasSizeInput): void;
  /** Stable subscription function for broad operational snapshot changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Stable subscription for one exact glTF source/version/selected-scene identity. */
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

const lazyBrowserTextureDecoder = (
  etc2Available: boolean,
  retainSvgSource: boolean,
): NonNullable<CanvasRootPlatform["decodeTexture"]> => {
  let decoder: Promise<NonNullable<CanvasRootPlatform["decodeTexture"]>> | undefined;
  return async (asset, signal, maxStorageBytes, retainAlpha) => {
    decoder ??= import("../texture/browser-decode")
      .then((module) => module.createBrowserTextureDecoder(4, etc2Available, retainSvgSource));
    return (await decoder)(asset, signal, maxStorageBytes, retainAlpha);
  };
};

const lazyBrowserGltfPreparer = (
  etc2Available: boolean,
): NonNullable<GltfAssetOwnerPlatform["prepare"]> => {
  let modulePromise: Promise<typeof import("../gltf/browser-static-preparation")> | undefined;
  return async (bytes, contentKey, label, sourceUri, signal, readResource, sceneIndex) => {
    modulePromise ??= import("../gltf/browser-static-preparation");
    return (await modulePromise).prepareStaticGltfInBrowser(
      bytes,
      contentKey,
      label,
      sourceUri,
      signal,
      readResource,
      undefined,
      etc2Available,
      sceneIndex,
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
  status: "idle",
};
const LOADING_VIRTUAL_TEXTURE: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  status: "loading",
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

type InstanceSubscription = {
  dirty: boolean;
  end: number;
  start: number;
  structural: boolean;
  unsubscribe: () => void;
};

/** Root-local lifecycle, canonical surface, picking, and WebGL state authority. */
export class CanvasRoot implements RendererRoot {
  readonly #asyncPreparation: AsyncPreparationOwner;
  readonly #canvas: HTMLCanvasElement;
  readonly #cameraSource: CameraSourceOwner;
  readonly #clock: FrameClockOwner;
  readonly #context: ContextLifecycleOwner;
  readonly #environmentAssets: PrefilteredEnvironmentAssetOwner;
  readonly #etc2Available: boolean;
  #clearColor: LinearRgba = [0, 0, 0, 0];
  #disposed = false;
  #frame = 0;
  #frameIntent: ClearFrameIntent | null = null;
  readonly #gl: WebGL2RenderingContext;
  readonly #gltfAssets: GltfAssetOwner;
  readonly #frameUploadBudget: FrameUploadBudgetOwner;
  readonly #idleVirtualTextureRuntimeSnapshot: VirtualTextureRuntimeSnapshot;
  readonly #getDecodedAlpha = (asset: TextureSourceRef): DecodedTextureAlpha | undefined =>
    this.#textureAssets.alpha(asset);
  readonly #getDecodedTexture = (asset: TextureSourceRef): DecodedTextureSource | undefined =>
    this.#textureAssets.decoded(asset);
  readonly #getGltfAsset = (node: GltfNode | GltfInstancesNode): PreparedStaticGltf | undefined =>
    this.#gltfAssets.prepared(node.asset);
  readonly #getTextureSnapshot = (asset: TextureSourceRef): TextureAssetSnapshot =>
    this.#textureAssets.getSourceSnapshot(asset);
  readonly #isTexturePending = (asset: TextureSourceRef): boolean => {
    const status = this.#getTextureSnapshot(asset).status;
    return status === "idle" || status === "loading";
  };
  #lastFrameFailure: string | undefined;
  readonly #listeners = new RetainedListeners();
  #instancePickingDirty = false;
  #instanceSceneDirty = false;
  readonly #instanceSubscriptions = new Map<GltfInstanceTransforms, InstanceSubscription>();
  readonly #instanceUpdateWorkspace = createCanonicalInstanceSceneUpdateWorkspace();
  readonly #pendingTexturePublicationKeys = new Set<string>();
  readonly #onContextLost: (event: Event) => void;
  readonly #onContextRestored: () => void;
  readonly #platform: CanvasRootPlatform;
  readonly #persistentGpuBudget: PersistentGpuBudgetOwner;
  #presentationRequired = false;
  readonly #progressivePresentation: ProgressivePresentationOwner;
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
  #surfaceResourcesPending = false;
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
  #virtualTextureActivation: VirtualTextureActivationState = initialVirtualTextureActivationState;
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
    this.#etc2Available = this.#gl.getExtension("WEBGL_compressed_texture_etc") !== null;
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
    this.#idleVirtualTextureRuntimeSnapshot = idleVirtualTextureRuntimeSnapshot(
      resolvedOptions.automaticVirtualTexturing,
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
      this.#etc2Available,
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
      schedule: this.#asyncPreparation.runForeground,
    });
    this.#gltfAssets = new GltfAssetOwner({
      onAssetChanged: () => this.#refreshPreparedScene(),
      onListenerError: (error) => platform.onListenerError(error),
      prepare: lazyBrowserGltfPreparer(this.#etc2Available),
      read: platform.readGltf ?? readGltfWithFetch,
      readResource: platform.readGltfResource ?? readGltfResourceWithFetch,
      schedule: this.#asyncPreparation.runForeground,
    });
    this.#textureAssets = new TextureAssetOwner({
      decode: platform.decodeTexture ?? lazyBrowserTextureDecoder(
        this.#etc2Available,
        this.#automaticVirtualTexturing,
      ),
      onAssetChanged: (key) => this.#queuePreparedTexture(key),
      onListenerError: (error) => platform.onListenerError(error),
      onSnapshotChanged: () => this.#refreshGltfTextureProgress(),
      schedule: this.#asyncPreparation.run,
    }, Math.floor(resolvedOptions.persistentGpuByteBudget * 0.75));
    this.#context = new ContextLifecycleOwner(platform.onListenerError);
    this.#unsubscribeContext = this.#context.subscribe(() => this.#publish());
    this.#clock = new FrameClockOwner({
      render: () => this.#renderFrame(),
      reportScheduledFailure: (error) => this.#captureScheduledFailure(error),
      requestFrame: platform.requestFrame,
    });
    this.#progressivePresentation = new ProgressivePresentationOwner({
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

  /** @internal Dedicated optional renderers temporarily borrow frame authority. */
  [rendererAcquireExternalClock](): ExternalFrameClock {
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
    this.#surfaceResourcesPending = this.#surfaceGpu.surfacePublicationsPending();
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
    this.#progressivePresentation.dispose();
    this.#clock.dispose();
    this.#cameraSource.dispose();
    this.#environmentAssets.dispose();
    this.#gltfAssets.dispose();
    this.#surfaceGpu.dispose();
    this.#textureAssets.dispose();
    this.#asyncPreparation.dispose();
    for (const state of this.#instanceSubscriptions.values()) state.unsubscribe();
    this.#instanceSubscriptions.clear();
    this.#pendingTexturePublicationKeys.clear();
    this.#context.transition({ kind: "dispose" });
    this.#unsubscribeContext();
    this.#listeners.clear();
    this.#sizeListeners.clear();
    this.#virtualTextureListeners.clear();
  }

  flushInvalidated(): void {
    this.#assertLive("flush invalidated work");
    this.#clock.retry();
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
            ?? this.#idleVirtualTextureRuntimeSnapshot,
        },
        size: this.#size,
      };
      this.#snapshotRevision = this.#revision;
    }
    return this.#snapshot;
  };

  /** Focused context lifecycle snapshot for product observation. */
  getLifecycleSnapshot = (): RendererContextSnapshot => this.#context.getSnapshot();

  /** Focused canvas-size snapshot for product observation. */
  getSizeSnapshot = (): ResolvedCanvasSize | null => this.#size;

  /** Focused readiness for one exact glTF source/version/selected-scene identity. */
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
    this.#clock.retry();
    this.#invalidatePresentation();
  }

  pick(input: PickInput): PickResult | undefined {
    this.#assertLive("pick");
    validatePickInput(input);
    if (this.#context.getSnapshot().phase !== "active") return undefined;
    this.#flushInstanceScene(true);
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
      size.backingWidth,
      size.backingHeight,
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
    this.#pendingTexturePublicationKeys.clear();
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
    this.#instancePickingDirty = false;
    this.#progressivePresentation.reset();
    this.#surfaceResourcesPending = false;
    this.#textureResourcesPending = false;
    this.#surfaceGpu.setScene(prepared);
    this.#reconcilePrefilteredEnvironment(prepared);
    this.#reconcileVirtualTextureRuntime(prepared);
    this.#cameraSource.commit(camera);
    this.#gltfAssets.reconcile(prepared.gltfNodes);
    this.#reconcileInstanceSources(scene);
    this.#resetInstanceUpdates();
    this.#reconcileTextureAssets(prepared);
    this.#refreshGltfTextureProgress();
    this.#clock.retry();
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
      || previous?.pixelRatio !== resolved.pixelRatio
      || previous?.backingWidth !== resolved.backingWidth
      || previous?.backingHeight !== resolved.backingHeight;
    if (!semanticChanged) return;
    this.#sizeInput = { ...input };
    this.#size = resolved;
    if (this.#surfaceScene !== null) this.#reconcileTextureAssets(this.#surfaceScene);
    if (!previous || backingChanged) this.#rebuildFrameIntent();
    if (backingChanged) this.#state.invalidate();
    this.#publishSize();
    this.#publish();
    if (
      (!previous || backingChanged)
      && resolved.backingWidth * resolved.backingHeight > 0
    ) {
      this.#clock.retry();
      this.#invalidatePresentation();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    return this.#listeners.subscribe(listener);
  };

  /** Subscribes only to context lifecycle changes. */
  subscribeLifecycle = (listener: () => void): (() => void) => {
    requireRetainedListener(listener);
    return this.#context.subscribe(listener);
  };

  /** Subscribes only to semantic canvas-size changes. */
  subscribeSize = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    return this.#sizeListeners.subscribe(listener);
  };

  /** Subscribes only to one exact glTF source/version/selected-scene identity. */
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
      const state: InstanceSubscription = {
        dirty: false,
        end: 0,
        start: 0,
        structural: false,
        unsubscribe: () => {},
      };
      state.unsubscribe = source.subscribe((channel, start, count) => {
        if (this.#disposed) return;
        if (!state.dirty) {
          state.dirty = true;
          state.start = start;
          state.end = start + count;
        } else {
          state.start = Math.min(state.start, start);
          state.end = Math.max(state.end, start + count);
        }
        if (channel === "scale") state.structural = true;
        this.#instanceSceneDirty = true;
        this.#invalidatePresentation();
      });
      this.#instanceSubscriptions.set(source, state);
    }
    for (const [source, state] of this.#instanceSubscriptions) {
      if (claimed.has(source)) continue;
      state.unsubscribe();
      this.#instanceSubscriptions.delete(source);
    }
  }

  #resetInstanceUpdates(): void {
    for (const state of this.#instanceSubscriptions.values()) {
      state.dirty = false;
      state.structural = false;
    }
    this.#instanceSceneDirty = false;
  }

  #flushInstanceScene(forPicking = false): void {
    if (!this.#instanceSceneDirty) {
      if (forPicking && this.#instancePickingDirty) this.#refreshPreparedScene(true);
      return;
    }
    let requiresStructuralRefresh = forPicking;
    if (!requiresStructuralRefresh) {
      for (const [source, state] of this.#instanceSubscriptions) {
        if (!state.dirty) continue;
        if (state.structural) {
          requiresStructuralRefresh = true;
          break;
        }
        for (const node of this.#surfaceSceneInput?.nodes ?? []) {
          if (
            node.kind === "gltf-instances"
            && node.instances === source
            && (this.#getGltfAsset(node)?.lights.length ?? 0) > 0
          ) {
            requiresStructuralRefresh = true;
            break;
          }
        }
        if (requiresStructuralRefresh) break;
      }
    }
    if (requiresStructuralRefresh) {
      this.#refreshPreparedScene(true);
      return;
    }
    const scene = this.#surfaceScene;
    if (scene === null) return;
    let updated = false;
    for (const [source, state] of this.#instanceSubscriptions) {
      if (!state.dirty) continue;
      updated = updateCanonicalGltfInstanceSource(
        scene,
        source,
        state.start,
        state.end - state.start,
        this.#instanceUpdateWorkspace,
      ) || updated;
    }
    this.#resetInstanceUpdates();
    if (!updated) return;
    refreshCanonicalInstanceLodBounds(scene);
    this.#instancePickingDirty = true;
    this.#surfaceGpu.publishInstanceTransforms();
    this.#virtualTextureRuntime?.invalidateSceneGeometry();
  }

  #refreshPreparedScene(instanceOnly = false): void {
    if (this.#disposed || this.#surfaceSceneInput === null) return;
    this.#pendingTexturePublicationKeys.clear();
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
      this.#progressivePresentation.reset();
      this.#surfaceResourcesPending = false;
      this.#textureResourcesPending = false;
    }
    this.#surfaceGpu.setScene(prepared);
    this.#reconcilePrefilteredEnvironment(prepared);
    this.#reconcileVirtualTextureRuntime(prepared);
    this.#cameraSource.commit(camera);
    this.#reconcileTextureAssets(prepared);
    this.#refreshGltfTextureProgress();
    this.#resetInstanceUpdates();
    this.#instancePickingDirty = false;
    if (!instanceOnly) {
      this.#clock.retry();
      this.#invalidatePresentation();
    }
  }

  #reconcileTextureAssets(scene: CanonicalSurfaceScene): void {
    const size = this.#size;
    const storageBudgetBytes = this.#surfaceGpu.ordinaryTextureStorageBudget(
      this.#persistentGpuBudget.budgetBytes,
      size?.backingWidth ?? 1,
      size?.backingHeight ?? 1,
    );
    this.#textureAssets.reconcile(
      scene.textureAssets,
      scene.alphaMaskTextureAssets,
      storageBudgetBytes,
    );
  }

  #queuePreparedTexture(key: string): void {
    if (this.#disposed) return;
    this.#pendingTexturePublicationKeys.add(key);
    this.#clock.invalidate();
  }

  #flushPreparedTextures(): void {
    const keys = this.#pendingTexturePublicationKeys;
    if (keys.size === 0) return;
    const scene = this.#surfaceScene;
    if (scene === null) {
      keys.clear();
      return;
    }
    const prepared = refreshCanonicalSurfaceTextures(
      scene,
      keys,
      this.#getDecodedTexture,
      this.#isTexturePending,
    );
    if (prepared !== scene) {
      this.#surfaceScene = prepared;
      this.#surfaceGpu.publishTextureBatch(prepared, keys);
      this.#virtualTextureRuntime?.setScene(prepared);
      this.#textureResourcesPending = true;
      this.#progressivePresentation.changed();
    }
    keys.clear();
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
    if (this.#progressiveResourcesSettled()) this.#progressivePresentation.settled();
  }

  #reconcileVirtualTextureRuntime(scene: CanonicalSurfaceScene): void {
    const required = virtualTextureRuntimeRequired(scene, this.#automaticVirtualTexturing);
    const previousActivation = this.#virtualTextureActivation;
    const activation = reconcileVirtualTextureActivation(
      this.#virtualTextureActivation,
      required,
    );
    this.#virtualTextureActivation = activation;
    if (
      previousActivation.phase === "active"
      && activation.phase === "inactive"
    ) {
      this.#surfaceGpu.setVirtualTextureRuntime(null);
      this.#virtualTextureRuntime = null;
      return;
    }
    if (activation.phase === "active") {
      this.#virtualTextureRuntime?.setScene(scene);
      return;
    }
    if (
      previousActivation.phase !== "inactive"
      || activation.phase !== "loading"
    ) return;
    const generation = activation.generation;
    void import("../virtual-texture/runtime").then((module) => {
      if (this.#disposed) return;
      const activation = settleVirtualTextureActivation(
        this.#virtualTextureActivation,
        generation,
        true,
      );
      if (activation === undefined) return;
      const runtime = module.createBrowserVirtualTextureRuntime(
        this.#gl,
        (asset) => {
          if (this.#disposed) return;
          this.#publishVirtualTexture(asset);
          this.#invalidatePresentation();
        },
        this.#persistentGpuBudget,
        this.#asyncPreparation.runForeground,
        this.#automaticVirtualTexturing ? {
          acquireDecoded: (asset) => this.#textureAssets.acquireDecoded(asset),
          decoded: (asset) => this.#textureAssets.decoded(asset),
          onChanged: () => {
            if (!this.#disposed) this.#invalidatePresentation();
          },
        } : undefined,
        this.#frameUploadBudget,
        this.#etc2Available,
      );
      this.#surfaceGpu.setVirtualTextureRuntime(runtime);
      this.#virtualTextureRuntime = runtime;
      this.#virtualTextureActivation = activation;
      this.#invalidatePresentation();
    }).catch((error: unknown) => {
      if (this.#disposed) return;
      const activation = settleVirtualTextureActivation(
        this.#virtualTextureActivation,
        generation,
        false,
      );
      if (activation === undefined) return;
      this.#virtualTextureActivation = activation;
      this.#releaseUploadedTextures();
      this.#captureScheduledFailure(error);
    });
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
    this.#flushPreparedTextures();
    this.#flushInstanceScene();
    this.#surfaceGpu.beginFrame();
    if (this.#surfaceResourcesPending || this.#textureResourcesPending) {
      let resourcesCommitted = false;
      try {
        resourcesCommitted = this.#surfaceGpu.flushResourcePublications(this.#state);
        if (!resourcesCommitted) {
          this.#presentationRequired = true;
        }
      } finally {
        this.#surfaceResourcesPending = this.#surfaceGpu.surfacePublicationsPending();
        this.#textureResourcesPending = this.#surfaceGpu.texturePublicationsPending();
        resourcesCommitted = this.#releaseUploadedTextures() || resourcesCommitted;
      }
      if (resourcesCommitted && !this.#presentationRequired) {
        if (this.#progressiveResourcesSettled()) this.#presentationRequired = true;
        else this.#progressivePresentation.changed();
      }
      if (
        !this.#presentationRequired
        && (this.#surfaceResourcesPending || this.#textureResourcesPending)
      ) {
        this.#clock.invalidate();
      }
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
        const pending = this.#surfaceGpu.drawViews(
          this.#canvasViews,
          null,
          this.#state,
          this.#clearColor,
        );
        this.#surfaceResourcesPending = this.#surfaceGpu.surfacePublicationsPending();
        if (pending) {
          if (this.#surfaceResourcesPending) {
            this.#clock.invalidate();
          } else this.#invalidatePresentation();
        }
      } finally {
        this.#releaseUploadedTextures();
        this.#surfaceResourcesPending = this.#surfaceGpu.surfacePublicationsPending();
        this.#textureResourcesPending = this.#surfaceGpu.texturePublicationsPending();
        if (this.#surfaceResourcesPending || this.#textureResourcesPending) {
          this.#clock.invalidate();
        }
      }
    }
    this.#progressivePresentation.presented();
    this.#frame += 1;
    this.#lastFrameFailure = undefined;
    this.#publish();
  }

  #restoreContext(): void {
    if (this.#disposed || !this.#context.transition({ kind: "restoration-started" })) return;
    try {
      if (
        this.#etc2Available
        && this.#gl.getExtension("WEBGL_compressed_texture_etc") === null
      ) throw new Error("Royal could not restore WEBGL_compressed_texture_etc");
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
          || previousSize?.pixelRatio !== this.#size.pixelRatio
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
      && this.#virtualTextureActivation.phase === "loading"
    ) return false;
    const uploaded = this.#surfaceGpu.takeUploadedTextureStorageKeys();
    const denied = this.#surfaceGpu.takeDeniedTextureStorageKeys();
    this.#textureAssets.releaseUploaded(uploaded);
    this.#textureAssets.rejectGpuStorage(denied);
    return uploaded.length !== 0;
  }

  #progressiveResourcesSettled(): boolean {
    if (this.#surfaceResourcesPending || this.#textureResourcesPending) return false;
    const assets = this.#surfaceScene?.textureAssets ?? [];
    return assets.every((asset) => {
      const status = this.#getTextureSnapshot(asset).status;
      return status === "ready" || status === "error";
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
): RendererRoot => new CanvasRoot(canvas, options);
