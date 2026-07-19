import {
  validatePickInput,
  type GltfInstanceTransforms,
  type GltfAssetRef,
  type GltfInstancesNode,
  type GltfNode,
  type PickInput,
  type PickResult,
  type RenderRoot,
  type TextureAssetRef,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import type { ContextLifecycleSnapshot } from "../context/context-lifecycle";
import { ContextLifecycleOwner } from "../context/context-lifecycle-owner";
import type { ClearFrameIntent, LinearRgba } from "../frame/clear-frame";
import { validateClearFrameIntent, validateLinearRgba } from "../frame/clear-frame";
import {
  resolveCanvasSize,
  type CanvasSizeInput,
  type CanvasSizeLimits,
  type ResolvedCanvasSize,
} from "../frame/canvas-size";
import { FrameClockOwner, type ExternalFrameClock } from "../frame/frame-clock-owner";
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
import { SurfaceGpuOwner, type SurfaceFrameView } from "../surface/surface-gpu-owner";
import { SurfacePicker } from "../surface/surface-picker";
import {
  TextureAssetOwner,
  type DecodedTextureSource,
  type TextureAssetSnapshot,
  type TextureSourceRef,
} from "../texture/asset-owner";
import { WebGlStateOwner } from "../webgl/state-owner";
import {
  rendererRootOptionsSemanticKey,
  type CanvasRootOptions,
} from "./root-options";
import {
  virtualTextureAssetKey,
  type VirtualTextureAssetSnapshot,
  type VirtualTextureRuntime,
} from "../virtual-texture/runtime-contract";

export type { CanvasRootOptions } from "./root-options";

export type CanvasRootSnapshot = Readonly<{
  context: ContextLifecycleSnapshot;
  frame: number;
  lastFrameFailure?: string;
  size: ResolvedCanvasSize | null;
}>;

export type CanvasRootPlatform = Readonly<{
  onListenerError(error: unknown): void;
  reportScheduledFailure(error: unknown): void;
  requestFrame(callback: () => void): void;
  decodeTexture?(
    asset: TextureSourceRef,
    signal: AbortSignal,
  ): Promise<DecodedTextureSource>;
  readGltf?(asset: GltfAssetRef, signal: AbortSignal): Promise<Uint8Array>;
  readGltfResource?(uri: string, signal: AbortSignal): Promise<Uint8Array>;
}>;

const defaultPlatform = (): CanvasRootPlatform => ({
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
  return async (asset, signal) => {
    decoder ??= import("../texture/browser-decode")
      .then((module) => module.createBrowserTextureDecoder());
    return (await decoder)(asset, signal);
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
  options: CanvasRootOptions,
): WebGL2RenderingContext => {
  const gl = canvas.getContext("webgl2", {
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    depth: true,
    stencil: true,
  });
  if (gl === null) throw new Error("Royal renderer could not create a WebGL2 context");
  return gl;
};

/** Root-local lifecycle, canonical surface, picking, and WebGL state authority. */
export class CanvasRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #cameraSource: CameraSourceOwner;
  readonly #clock: FrameClockOwner;
  readonly #context: ContextLifecycleOwner;
  #clearColor: LinearRgba = [0, 0, 0, 0];
  #disposed = false;
  #frame = 0;
  #frameIntent: ClearFrameIntent | null = null;
  readonly #gl: WebGL2RenderingContext;
  readonly #gltfAssets: GltfAssetOwner;
  readonly #getDecodedTexture = (asset: TextureSourceRef): DecodedTextureSource | undefined =>
    this.#textureAssets.decoded(asset);
  readonly #getGltfAsset = (node: GltfNode | GltfInstancesNode): PreparedStaticGltf | undefined =>
    this.#gltfAssets.prepared(node.asset);
  readonly #getTextureSnapshot = (asset: TextureSourceRef): TextureAssetSnapshot =>
    this.#textureAssets.getSourceSnapshot(asset);
  #lastFrameFailure: string | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #instanceSubscriptions = new Map<GltfInstanceTransforms, () => void>();
  readonly #onContextLost: (event: Event) => void;
  readonly #onContextRestored: () => void;
  readonly #platform: CanvasRootPlatform;
  #revision = 0;
  #size: ResolvedCanvasSize | null = null;
  #sizeInput: CanvasSizeInput | null = null;
  #sizeLimits: CanvasSizeLimits;
  readonly #sizeListeners = new Set<() => void>();
  #snapshot: CanvasRootSnapshot | undefined;
  #snapshotRevision = -1;
  readonly #state: WebGlStateOwner;
  readonly #surfaceGpu: SurfaceGpuOwner;
  readonly #surfacePicker = new SurfacePicker();
  readonly #textureAssets: TextureAssetOwner;
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
  readonly #externalClearIntent: {
    clearColor: LinearRgba;
    clearDepth: number;
    clearStencil: number;
    framebuffer: WebGLFramebuffer | null;
    scissor: null;
    size: { height: number; width: number };
    viewport: { height: number; width: number; x: number; y: number };
  } = {
    clearColor: this.#clearColor,
    clearDepth: 1,
    clearStencil: 0,
    framebuffer: null,
    scissor: null,
    size: { height: 1, width: 1 },
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #surfaceScene: ReturnType<typeof prepareCanonicalSurfaceScene> | null = null;
  #surfaceSceneInput: RenderRoot | null = null;
  #virtualTextureActive = false;
  #virtualTextureLoadGeneration = 0;
  #virtualTextureRequested = false;
  #virtualTextureRuntime: VirtualTextureRuntime | null = null;
  readonly #virtualTextureListeners = new Map<string, Set<() => void>>();

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
    options: CanvasRootOptions = {},
    platform: CanvasRootPlatform = defaultPlatform(),
  ) {
    rendererRootOptionsSemanticKey(options);
    this.#canvas = canvas;
    this.#platform = platform;
    this.#gl = createContext(canvas, options);
    this.#sizeLimits = readSizeLimits(this.#gl);
    this.#state = new WebGlStateOwner(this.#gl);
    this.#surfaceGpu = new SurfaceGpuOwner(this.#gl);
    const usesDefaultGltfIo = platform.readGltf === undefined
      && platform.readGltfResource === undefined;
    this.#gltfAssets = new GltfAssetOwner({
      onAssetChanged: () => this.#refreshPreparedScene(),
      onListenerError: (error) => platform.onListenerError(error),
      ...(usesDefaultGltfIo ? { prepare: lazyBrowserGltfPreparer() } : {}),
      read: platform.readGltf ?? readGltfWithFetch,
      readResource: platform.readGltfResource ?? readGltfResourceWithFetch,
    });
    this.#textureAssets = new TextureAssetOwner({
      decode: platform.decodeTexture ?? lazyBrowserTextureDecoder(),
      onAssetChanged: (key) => this.#refreshPreparedTexture(key),
      onListenerError: (error) => platform.onListenerError(error),
      onSnapshotChanged: () => this.#refreshGltfTextureProgress(),
    });
    this.#context = new ContextLifecycleOwner(platform.onListenerError);
    this.#unsubscribeContext = this.#context.subscribe(() => this.#publish());
    this.#clock = new FrameClockOwner({
      render: () => this.#renderFrame(),
      reportScheduledFailure: (error) => this.#captureScheduledFailure(error),
      requestFrame: platform.requestFrame,
    });
    this.#cameraSource = new CameraSourceOwner({
      onCameraChanged: () => this.#clock.invalidate(),
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
    const intent = this.#externalClearIntent;
    intent.clearColor = this.#clearColor;
    intent.framebuffer = frame.framebuffer;
    intent.size.height = frame.size.height;
    intent.size.width = frame.size.width;
    intent.viewport.height = frame.size.height;
    intent.viewport.width = frame.size.width;
    this.#state.invalidate();
    this.#state.clear(intent);
    const pending = this.#surfaceGpu.drawViews(
      frame.views,
      frame.framebuffer,
      this.#state,
    );
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
    this.#clock.dispose();
    this.#cameraSource.dispose();
    this.#gltfAssets.dispose();
    this.#textureAssets.dispose();
    this.#surfaceGpu.dispose();
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
    this.#clock.invalidate();
  }

  pick(input: PickInput): PickResult | undefined {
    this.#assertLive("pick");
    validatePickInput(input);
    if (this.#context.getSnapshot().phase !== "active") return undefined;
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

  render(scene: RenderRoot): void {
    this.#assertLive("render");
    if (
      typeof scene !== "object"
      || scene === null
      || scene.kind !== "scene"
      || !Array.isArray(scene.nodes)
    ) {
      throw new TypeError("Royal renderer render requires a validated scene descriptor");
    }
    if (scene === this.#surfaceSceneInput) return;
    const camera = this.#cameraSource.prepare(scene.camera);
    const prepared = prepareCanonicalSurfaceScene(
      scene,
      this.#getGltfAsset,
      camera.camera,
      this.#getDecodedTexture,
    );
    this.#updateClearColor(scene.clearColor);
    this.#surfaceScene = prepared;
    this.#surfaceSceneInput = scene;
    this.#surfaceGpu.setScene(prepared);
    this.#reconcileVirtualTextureRuntime(prepared);
    this.#cameraSource.commit(camera);
    this.#gltfAssets.reconcile(prepared.gltfNodes);
    this.#reconcileInstanceSources(scene);
    this.#textureAssets.reconcile(prepared.textureAssets);
    this.#refreshGltfTextureProgress();
    this.#clock.invalidate();
  }

  setClearColor(color: LinearRgba): void {
    this.#assertLive("set clear color");
    if (this.#updateClearColor(color)) this.#clock.invalidate();
  }

  setSize(input: CanvasSizeInput): void {
    this.#assertLive("set size");
    const resolved = resolveCanvasSize(input, this.#sizeLimits);
    this.#sizeInput = { ...input };
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
    this.#size = resolved;
    this.#state.invalidate();
    this.#rebuildFrameIntent();
    this.#publishSize();
    this.#publish();
    if (backingChanged && resolved.backingWidth > 0 && resolved.backingHeight > 0) {
      this.#clock.invalidate();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  };

  /** Subscribes only to context lifecycle changes. */
  subscribeLifecycle = (listener: () => void): (() => void) =>
    this.#context.subscribe(listener);

  /** Subscribes only to semantic canvas-size changes. */
  subscribeSize = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    this.#sizeListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#sizeListeners.delete(listener);
    };
  };

  /** Subscribes only to one exact glTF source/version identity. */
  subscribeGltfAsset = (asset: GltfAssetRef, listener: () => void): (() => void) =>
    this.#gltfAssets.subscribe(asset, listener);

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
    let listeners = this.#virtualTextureListeners.get(key);
    if (listeners === undefined) {
      listeners = new Set();
      this.#virtualTextureListeners.set(key, listeners);
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners!.delete(listener);
      if (listeners!.size === 0) this.#virtualTextureListeners.delete(key);
    };
  };

  #assertLive(operation: string): void {
    if (this.#disposed) throw new Error(`Cannot ${operation} on a disposed Royal renderer root`);
  }

  #captureScheduledFailure(error: unknown): void {
    this.#lastFrameFailure = formatFailure(error);
    this.#publish();
    this.#platform.reportScheduledFailure(error);
  }

  #createFrameIntent(size: ResolvedCanvasSize, color: LinearRgba): ClearFrameIntent {
    return {
      clearColor: color,
      clearDepth: 1,
      clearStencil: 0,
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
    if (this.#listeners.size === 0) return;
    const listeners = [...this.#listeners];
    for (const listener of listeners) {
      if (!this.#listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        try {
          this.#platform.onListenerError(error);
        } catch {
          // A failing diagnostic sink must not interrupt later listeners.
        }
      }
    }
  }

  #publishSize(): void {
    if (this.#sizeListeners.size === 0) return;
    const listeners = [...this.#sizeListeners];
    for (const listener of listeners) {
      if (!this.#sizeListeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        try {
          this.#platform.onListenerError(error);
        } catch {
          // A failing diagnostic sink must not interrupt later listeners.
        }
      }
    }
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

  #reconcileInstanceSources(scene: RenderRoot): void {
    const claimed = new Set<GltfInstanceTransforms>();
    for (const node of scene.nodes) {
      if (node.kind !== "gltf-instances") continue;
      const source = node.instances;
      claimed.add(source);
      if (this.#instanceSubscriptions.has(source)) continue;
      const unsubscribe = source.subscribe(() => {
        if (this.#disposed) return;
        try {
          this.#refreshPreparedScene();
        } catch (error) {
          this.#captureScheduledFailure(error);
        }
      });
      this.#instanceSubscriptions.set(source, unsubscribe);
    }
    for (const [source, unsubscribe] of this.#instanceSubscriptions) {
      if (claimed.has(source)) continue;
      unsubscribe();
      this.#instanceSubscriptions.delete(source);
    }
  }

  #refreshPreparedScene(): void {
    if (this.#disposed || this.#surfaceSceneInput === null) return;
    const camera = this.#cameraSource.prepare(this.#surfaceSceneInput.camera);
    const prepared = prepareCanonicalSurfaceScene(
      this.#surfaceSceneInput,
      this.#getGltfAsset,
      camera.camera,
      this.#getDecodedTexture,
    );
    this.#surfaceScene = prepared;
    this.#surfaceGpu.setScene(prepared);
    this.#reconcileVirtualTextureRuntime(prepared);
    this.#cameraSource.commit(camera);
    this.#textureAssets.reconcile(prepared.textureAssets);
    this.#refreshGltfTextureProgress();
    this.#clock.invalidate();
  }

  #refreshPreparedTexture(key: string): void {
    if (this.#disposed) return;
    if (this.#surfaceScene !== null) {
      const prepared = refreshCanonicalSurfaceTexture(
        this.#surfaceScene,
        key,
        this.#getDecodedTexture,
      );
      if (prepared !== this.#surfaceScene) {
        this.#surfaceScene = prepared;
        this.#surfaceGpu.publishTextureScene(prepared, key);
        this.#clock.invalidate();
      }
    }
  }

  #refreshGltfTextureProgress(): void {
    this.#gltfAssets.refreshTextureProgress(this.#getTextureSnapshot);
  }

  #reconcileVirtualTextureRuntime(scene: CanonicalSurfaceScene): void {
    const required = scene.virtualTextureAssets.length > 0;
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
    if (this.#virtualTextureActive || this.#virtualTextureRequested) return;
    this.#virtualTextureRequested = true;
    const generation = ++this.#virtualTextureLoadGeneration;
    void import("../virtual-texture/runtime").then((module) => {
      if (
        this.#disposed
        || generation !== this.#virtualTextureLoadGeneration
        || (this.#surfaceScene?.virtualTextureAssets.length ?? 0) === 0
      ) return;
      const runtime = module.createBrowserVirtualTextureRuntime(
        this.#gl,
        (asset) => {
          if (this.#disposed) return;
          this.#publishVirtualTexture(asset);
          this.#clock.invalidate();
        },
      );
      this.#virtualTextureRuntime = runtime;
      this.#surfaceGpu.setVirtualTextureRuntime(runtime);
      this.#virtualTextureActive = true;
      this.#virtualTextureRequested = false;
      this.#clock.invalidate();
    }).catch((error: unknown) => {
      if (this.#disposed || generation !== this.#virtualTextureLoadGeneration) return;
      this.#virtualTextureRequested = false;
      this.#captureScheduledFailure(error);
    });
  }

  #publishVirtualTexture(asset: VirtualTextureAssetRef): void {
    const listeners = this.#virtualTextureListeners.get(virtualTextureAssetKey(asset));
    if (listeners === undefined) return;
    for (const listener of listeners) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        try {
          this.#platform.onListenerError(error);
        } catch {
          // A failing diagnostic sink must not interrupt later listeners.
        }
      }
    }
  }

  #renderFrame(): void {
    const intent = this.#frameIntent;
    if (intent === null || this.#context.getSnapshot().phase !== "active") return;
    this.#state.clear(intent);
    const surfaceScene = this.#surfaceScene;
    const size = this.#size;
    if (surfaceScene !== null && size !== null && surfaceScene.surfaces.length > 0) {
      projectionMat4Into(this.#projection, surfaceScene.camera, size.backingWidth, size.backingHeight);
      viewMat4Into(this.#view, surfaceScene.camera);
      multiplyMat4Into(this.#viewProjection, this.#projection, this.#view);
      this.#canvasViewport.height = size.backingHeight;
      this.#canvasViewport.width = size.backingWidth;
      if (this.#surfaceGpu.drawViews(this.#canvasViews, null, this.#state)) {
        this.#clock.invalidate();
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
      this.#clock.invalidate();
    } catch (error) {
      this.#context.transition({
        failure: formatFailure(error),
        kind: "restoration-failed",
      });
    }
  }

  #updateClearColor(color: LinearRgba): boolean {
    validateLinearRgba(color);
    if (sameColor(this.#clearColor, color)) return false;
    this.#clearColor = [color[0], color[1], color[2], color[3]];
    this.#rebuildFrameIntent();
    return true;
  }
}

export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options: CanvasRootOptions = {},
): CanvasRoot => new CanvasRoot(canvas, options);
