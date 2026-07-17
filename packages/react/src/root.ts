import type {
  GltfAssetBounds,
  GltfAssetRef,
  PickInput,
  PickResult,
  RenderRoot,
  TextureAssetRef,
  VirtualTextureAssetRef,
} from "@royal/renderer-core";
import {
  createWebGlRoot,
  resolveWebGlRootOptions,
  type WebGlContextSnapshot,
  type WebGlDiagnosticLogSnapshot,
  type WebGlDiagnosticMessage,
  type WebGlFramePlanningSnapshot,
  type WebGlGltfInstancingSnapshot,
  type WebGlGltfLoadDiagnosticsAssetSnapshot,
  type WebGlGltfLoadDiagnosticsSnapshot,
  type WebGlPickingSnapshot,
  type WebGlResourceLifetimeSnapshot,
  type WebGlResourceBudgetOptions,
  type WebGlResourceBudgets,
  type WebGlResourcePressureSnapshot,
  type WebGlRoot,
  type WebGlTextureResidencySnapshot,
  type WebGlVirtualTexturingSnapshot,
} from "@royal/renderer-webgl";
import {
  registerRoyalRendererCapabilities,
  royalRendererCapabilitiesFor,
  type RoyalRendererFrameClock,
} from "./renderer-capabilities";
import { validateGltfAssetRef } from "./gltf-asset-identity";
import { validateTextureAssetRef } from "./texture-asset-identity";

/** Immutable renderer creation options shared by `<Canvas>` and `createRendererRoot`. */
export interface RendererOptions {
  /** Request a canvas alpha channel when creating its WebGL context. @defaultValue `true` */
  readonly alpha?: boolean;
  /** Request browser context antialiasing. @defaultValue `true` */
  readonly antialias?: boolean;
  /**
   * Stream sufficiently large ordinary images and SVGs through Royal's
   * virtual-texture page source. The ordinary texture remains active until
   * generated coverage is ready; authored virtual textures are unaffected.
   * @defaultValue `false`
   */
  readonly automaticVirtualTextures?: boolean;
  /**
   * Root-wide overrides for CPU, GPU, upload, and job admission budgets.
   * Byte-named values are bytes; omitted fields retain Royal's defaults.
   */
  readonly resourceBudgets?: RendererResourceBudgetOptions;
}

/** Concise overrides for renderer resource admission budgets. */
export type RendererResourceBudgetOptions = WebGlResourceBudgetOptions;

/** Complete immutable resource budgets retained by a renderer root. */
export type RendererResourceBudgets = WebGlResourceBudgets;

/** @internal Validates the product-level root creation boundary. */
export const validateRendererOptions = (options: RendererOptions | undefined): void => {
  resolveWebGlRootOptions(options);
};

/** @internal Canonical identity for the product-level options that own a React Canvas lifetime. */
export const rendererRootOptionsSemanticKey = (options?: RendererOptions): string => {
  const resolved = resolveWebGlRootOptions(options);
  return `${resolved.alpha}:${resolved.antialias}:${resolved.automaticVirtualTextures}:${
    JSON.stringify(resolved.resourceBudgets)
  }`;
};

/** Normalized creation options retained for the lifetime of a renderer root. */
export type ResolvedRendererOptions = Omit<Required<RendererOptions>, "resourceBudgets"> & {
  readonly resourceBudgets: RendererResourceBudgets;
};

/** Availability states for the renderer owned by a Canvas. */
export type RoyalRendererRootLifecycle = "available" | "disposed" | "failed" | "unavailable";

type RoyalRendererRootLifecycleCounters = Readonly<{
  readonly generation: number;
  /** Number of backend interruptions observed during this root's lifetime. */
  readonly interruptions: number;
  /** Number of successful recoveries from an interruption. */
  readonly recoveries: number;
}>;

/** Immutable renderer availability and recovery counters at one point in time. */
export type RoyalRendererRootLifecycleSnapshot = RoyalRendererRootLifecycleCounters & (
  | Readonly<{
    readonly error?: never;
    readonly state: Exclude<RoyalRendererRootLifecycle, "failed">;
  }>
  | Readonly<{
    readonly error: string;
    readonly state: "failed";
  }>
);

/** Small, stable snapshot for rendering lifecycle UI without diagnostic payloads. */
export interface RoyalRendererRootSnapshot {
  readonly frame: number;
  readonly lifecycle: RoyalRendererRootLifecycleSnapshot;
  readonly options: ResolvedRendererOptions;
}

/** One bounded, deduplicated operational message. */
export type RoyalRendererDiagnosticMessage = WebGlDiagnosticMessage;

/** Fixed-capacity operational message log with per-entry occurrence counts. */
export type RoyalRendererDiagnosticLog = WebGlDiagnosticLogSnapshot;

/** Retained glTF asset readiness and bounded load timing. */
export type RoyalRendererGltfLoadDiagnosticsSnapshot = WebGlGltfLoadDiagnosticsSnapshot;
/** Instanced glTF planning, drawing, and upload counters. */
export type RoyalRendererGltfInstancingDiagnosticsSnapshot = WebGlGltfInstancingSnapshot;
/** Scene-plan compilation counters. */
export type RoyalRendererPlanningDiagnosticsSnapshot = WebGlFramePlanningSnapshot;
/** Renderer resource acquisition and queue high-water counters. */
export type RoyalRendererResourceLifetimeDiagnosticsSnapshot = WebGlResourceLifetimeSnapshot;
/** Current resource budgets, usage, admissions, and denials. */
export type RoyalRendererResourcePressureDiagnosticsSnapshot = WebGlResourcePressureSnapshot;
/** Counters from the most recent picking query. */
export type RoyalRendererPickingDiagnosticsSnapshot = WebGlPickingSnapshot;
/** Current ordinary-texture lease and prepared-source counts. */
export type RoyalRendererTextureResidencyDiagnosticsSnapshot = WebGlTextureResidencySnapshot;
/** Current VT residency plus cumulative request, upload, and failure counters. */
export type RoyalRendererVirtualTexturingDiagnosticsSnapshot = WebGlVirtualTexturingSnapshot;

/** Bounded operational diagnostics projected from the active renderer backend. */
export interface RoyalRendererDiagnosticsSnapshot {
  /** Bounded recent diagnostic messages with stable identity and occurrence counts. */
  readonly messageLog: RoyalRendererDiagnosticLog;
  /** Retained glTF asset readiness and bounded load timing. */
  readonly gltfLoads: RoyalRendererGltfLoadDiagnosticsSnapshot;
  /** Instanced glTF planning, drawing, and upload counters. */
  readonly gltfInstancing: RoyalRendererGltfInstancingDiagnosticsSnapshot;
  /** Scene-plan compilation counters. */
  readonly planning: RoyalRendererPlanningDiagnosticsSnapshot;
  /** Renderer resource acquisition and queue high-water counters. */
  readonly resourceLifetime: RoyalRendererResourceLifetimeDiagnosticsSnapshot;
  /** Current resource budgets, usage, admissions, and denials. */
  readonly resourcePressure: RoyalRendererResourcePressureDiagnosticsSnapshot;
  /** Counters from the most recent picking query. */
  readonly picking: RoyalRendererPickingDiagnosticsSnapshot;
  /** Current ordinary-texture lease and prepared-source counts. */
  readonly textureResidency: RoyalRendererTextureResidencyDiagnosticsSnapshot;
  /** Current VT residency plus cumulative request, upload, and failure counters. */
  readonly virtualTexturing: RoyalRendererVirtualTexturingDiagnosticsSnapshot;
}

/** One failed image preparation belonging to a retained glTF asset. */
export interface RoyalRendererGltfImageFailure {
  /** Stable image-demand identity, usually derived from the authored image URI. */
  readonly key: string;
  /** Transport, decode, or admission failure reported for this image. */
  readonly message: string;
}

/** Image preparation progress for one retained glTF asset. */
export interface RoyalRendererGltfImageProgress {
  /** Known asset images not demanded by the current prepared materials yet. */
  readonly dormant: number;
  /** Images whose decode or admission failed. */
  readonly failed: number;
  /** Focused reasons for each failed image, in settlement order. */
  readonly failures: readonly RoyalRendererGltfImageFailure[];
  /** Images decoded and accepted for publication. */
  readonly loaded: number;
  /** Requested images not yet loaded or failed. */
  readonly pending: number;
  /** Images whose loading has been requested. */
  readonly requested: number;
  /** Distinct relevant images in the asset. */
  readonly total: number;
}

/** Prepared scene resources for one retained glTF asset. */
export interface RoyalRendererGltfSceneStatistics {
  readonly lights: number;
  readonly nodes: number;
  readonly primitives: number;
}

export type RoyalRendererGltfPhaseTimings = WebGlGltfLoadDiagnosticsAssetSnapshot["phaseMs"];

type RoyalRendererGltfAssetDetails = Readonly<{
  /** Aggregate loaded asset-space bounds, including authored node and instance transforms. */
  readonly bounds?: GltfAssetBounds;
  readonly images: RoyalRendererGltfImageProgress;
  readonly phaseMs: RoyalRendererGltfPhaseTimings;
  readonly scene: RoyalRendererGltfSceneStatistics;
  /** Authored `KHR_materials_variants` names in declaration order; empty until scene preparation. */
  readonly variantNames: readonly string[];
}>;

/** Focused, observable state for one exact glTF asset identity retained by the renderer. */
export type RoyalRendererGltfAssetSnapshot =
  | Readonly<{
    readonly error?: never;
    readonly state: "idle";
    readonly variantNames: readonly string[];
  }>
  | (RoyalRendererGltfAssetDetails & Readonly<{
    readonly error?: never;
    /** The scene graph is not renderable yet. */
    readonly state: "loading";
  }>)
  | (RoyalRendererGltfAssetDetails & Readonly<{
    readonly error?: never;
    /** Scene geometry is renderable while relevant images continue preparing. */
    readonly state: "streaming";
  }>)
  | (RoyalRendererGltfAssetDetails & Readonly<{
    readonly error?: never;
    /** Scene geometry is renderable and current image demand has settled; dormant images may load later. */
    readonly state: "ready";
  }>)
  | (RoyalRendererGltfAssetDetails & Readonly<{
    readonly error?: never;
    /** Scene geometry is renderable, but at least one image failed. */
    readonly state: "degraded";
  }>)
  | (RoyalRendererGltfAssetDetails & Readonly<{
    readonly error: string;
    readonly state: "error";
  }>);

/** Focused readiness for one exact ordinary image or authored virtual texture. */
export type RoyalRendererTextureAssetSnapshot =
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
    readonly pendingPages: number;
    readonly state: "idle" | "loading" | "ready";
  }>
  | Readonly<{
    readonly error: string;
    readonly kind: "virtual";
    readonly pendingPages: number;
    readonly state: "error" | "unsupported";
  }>;

/** Imperative renderer root bound to one canvas. */
export interface RoyalRendererRoot {
  readonly canvas: HTMLCanvasElement;
  readonly disposed: boolean;
  readonly frame: number;
  /** Normalized creation options fixed for the lifetime of this root. */
  readonly options: ResolvedRendererOptions;
  /** Bounded operational diagnostics, excluding scene data and root snapshot fields. */
  diagnostics(): RoyalRendererDiagnosticsSnapshot;
  /** Immediately renders queued demand on the caller's current frame, regardless of clock ownership. */
  flushInvalidated(): void;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  /** Reads one retained glTF asset without allocating the full diagnostics payload. */
  gltfAssetSnapshot(asset: GltfAssetRef): RoyalRendererGltfAssetSnapshot;
  /** Reads readiness for one exact texture descriptor retained by the scene. */
  textureAssetSnapshot(
    texture: TextureAssetRef | VirtualTextureAssetRef,
  ): RoyalRendererTextureAssetSnapshot;
  /** Observes renderer availability without polling. Calls back immediately. */
  observeLifecycle(callback: (snapshot: RoyalRendererRootLifecycleSnapshot) => void): () => void;
  /** Observes completed renderer frames. Calls back immediately with the current frame index. */
  observeFrame(callback: (frame: number) => void): () => void;
  /** Observes one exact glTF asset identity. Calls back immediately. */
  observeGltfAsset(
    asset: GltfAssetRef,
    callback: (snapshot: RoyalRendererGltfAssetSnapshot) => void,
  ): () => void;
  /** Observes one exact texture descriptor. Calls back immediately. */
  observeTextureAsset(
    texture: TextureAssetRef | VirtualTextureAssetRef,
    callback: (snapshot: RoyalRendererTextureAssetSnapshot) => void,
  ): () => void;
  /** Observes failures from renderer-owned scheduled frames. */
  observeRenderFailures(callback: (failure: unknown) => void): () => void;
  /** Returns the front-most target under a DOM/React pointer event or its client coordinates. */
  pick(input: PickInput): PickResult | undefined;
  /** Renders a complete scene into the canvas. */
  render(scene: RenderRoot): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  /** Reads the current frame, lifecycle, and normalized creation options. */
  snapshot(): RoyalRendererRootSnapshot;
}

const royalLifecycleSnapshot = (
  snapshot: WebGlContextSnapshot,
): RoyalRendererRootLifecycleSnapshot => {
  const counters = {
    generation: snapshot.generation,
    interruptions: snapshot.losses,
    recoveries: snapshot.restores,
  };
  if (snapshot.lastError !== undefined) {
    return Object.freeze({ ...counters, error: snapshot.lastError, state: "failed" });
  }

  return Object.freeze({
    ...counters,
    state: snapshot.lifecycle === "active"
      ? "available"
      : snapshot.lifecycle === "disposed" ? "disposed" : "unavailable",
  });
};

const NO_GLTF_VARIANTS: readonly string[] = Object.freeze([]);

const validateObserver = (callback: unknown, label: string): void => {
  if (typeof callback !== "function") throw new TypeError(`${label} must be a function`);
};

/** @internal Pure product-status projection from one backend asset snapshot. */
export const royalGltfAssetSnapshotFrom = (
  snapshot: WebGlGltfLoadDiagnosticsAssetSnapshot | undefined,
): RoyalRendererGltfAssetSnapshot => {
  if (snapshot === undefined) return Object.freeze({ state: "idle", variantNames: NO_GLTF_VARIANTS });
  const settledImages = snapshot.imagesLoaded + snapshot.imageFailures;
  const pendingImages = Math.max(0, snapshot.imageRequests - settledImages);
  const details: RoyalRendererGltfAssetDetails = {
    ...(snapshot.bounds === undefined ? {} : {
      bounds: Object.freeze({
        max: Object.freeze([...snapshot.bounds.max] as [number, number, number]),
        min: Object.freeze([...snapshot.bounds.min] as [number, number, number]),
      }),
    }),
    images: Object.freeze({
      dormant: Math.max(0, snapshot.imageCandidates - snapshot.imageRequests),
      failed: snapshot.imageFailures,
      failures: Object.freeze(snapshot.imageFailureDetails.map((failure) => Object.freeze({ ...failure }))),
      loaded: snapshot.imagesLoaded,
      pending: pendingImages,
      requested: snapshot.imageRequests,
      total: snapshot.imageCandidates,
    }),
    phaseMs: Object.freeze({ ...snapshot.phaseMs }),
    scene: Object.freeze({
      lights: snapshot.lightCount,
      nodes: snapshot.nodeCount,
      primitives: snapshot.primitiveCount,
    }),
    variantNames: snapshot.variantNames,
  };
  if (snapshot.status === "loading") {
    return Object.freeze({ ...details, state: "loading" });
  }
  if (snapshot.status === "error") {
    return Object.freeze({
      ...details,
      error: snapshot.error ?? "glTF asset failed to load",
      state: "error",
    });
  }
  if (snapshot.imageFailures > 0) return Object.freeze({ ...details, state: "degraded" });
  if (pendingImages > 0) return Object.freeze({ ...details, state: "streaming" });
  return Object.freeze({ ...details, state: "ready" });
};

const royalTextureAssetSnapshot = (
  snapshot: ReturnType<WebGlRoot["textureAssetSnapshot"]>,
): RoyalRendererTextureAssetSnapshot => Object.freeze({ ...snapshot });

export type { RoyalRendererFrameClock } from "./renderer-capabilities";

export const acquireExternalRenderClockForRoyalRoot = (
  root: RoyalRendererRoot,
): RoyalRendererFrameClock => royalRendererCapabilitiesFor(root).acquireExternalRenderClock();

/**
 * Creates an imperative renderer root. `options` is fixed for the lifetime of
 * the returned root.
 */
export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options?: RendererOptions,
): RoyalRendererRoot => {
  const normalizedOptions = resolveWebGlRootOptions(options);
  const root = createWebGlRoot(canvas, normalizedOptions);

  const royalRoot: RoyalRendererRoot = {
    get canvas() {
      return root.canvas;
    },
    get disposed() {
      return root.disposed;
    },
    get frame() {
      return root.frame;
    },
    get options() {
      return normalizedOptions;
    },
    diagnostics: () => {
      const snapshot = root.snapshot();
      return Object.freeze({
        gltfInstancing: snapshot.gltfInstancing,
        gltfLoads: snapshot.gltfLoadDiagnostics,
        messageLog: snapshot.diagnosticLog,
        picking: snapshot.picking,
        planning: snapshot.planning,
        resourcePressure: snapshot.resourcePressure,
        resourceLifetime: snapshot.resourceLifetime,
        textureResidency: snapshot.textureResidency,
        virtualTexturing: snapshot.virtualTexturing,
      });
    },
    dispose: () => {
      root.dispose();
    },
    flushInvalidated: () => {
      root.flushInvalidated();
    },
    gltfAssetSnapshot: (asset) => {
      validateGltfAssetRef(asset, "RoyalRendererRoot gltfAssetSnapshot asset");
      return royalGltfAssetSnapshotFrom(root.gltfAssetSnapshot(asset));
    },
    textureAssetSnapshot: (texture) => {
      validateTextureAssetRef(texture, "RoyalRendererRoot textureAssetSnapshot texture");
      return royalTextureAssetSnapshot(root.textureAssetSnapshot(texture));
    },
    invalidate: () => {
      root.invalidate();
    },
    observeLifecycle: (callback) => {
      validateObserver(callback, "RoyalRendererRoot observeLifecycle callback");
      return root.observeContextLifecycle((snapshot) => {
        callback(royalLifecycleSnapshot(snapshot));
      });
    },
    observeFrame: (callback) => {
      validateObserver(callback, "RoyalRendererRoot observeFrame callback");
      return root.observeFrame(callback);
    },
    observeGltfAsset: (asset, callback) => {
      validateGltfAssetRef(asset, "RoyalRendererRoot observeGltfAsset asset");
      validateObserver(callback, "RoyalRendererRoot observeGltfAsset callback");
      return root.observeGltfAsset(asset, (snapshot) => {
        callback(royalGltfAssetSnapshotFrom(snapshot));
      });
    },
    observeTextureAsset: (texture, callback) => {
      validateTextureAssetRef(texture, "RoyalRendererRoot observeTextureAsset texture");
      validateObserver(callback, "RoyalRendererRoot observeTextureAsset callback");
      return root.observeTextureAsset(texture, (snapshot) => callback(royalTextureAssetSnapshot(snapshot)));
    },
    observeRenderFailures: (callback) => {
      validateObserver(callback, "RoyalRendererRoot observeRenderFailures callback");
      return root.observeRenderFailures(callback);
    },
    pick: (input: PickInput) => {
      return root.pick(input);
    },
    render: (scene: RenderRoot) => {
      root.render(scene);
    },
    snapshot: () => {
      return Object.freeze({
        frame: root.frame,
        lifecycle: royalLifecycleSnapshot(root.contextSnapshot()),
        options: normalizedOptions,
      });
    },
  };
  registerRoyalRendererCapabilities(royalRoot, {
    acquireExternalRenderClock: () => root.acquireExternalRenderClock(),
    webGlRoot: root,
  });

  return royalRoot;
};
