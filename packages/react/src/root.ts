import type { GltfAssetRef, PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  type WebGlContextSnapshot,
  type WebGlGltfLoadDiagnosticsAssetSnapshot,
  type WebGlRootSnapshot,
} from "@royal/renderer-webgl";
import {
  registerRoyalRendererCapabilities,
  royalRendererCapabilitiesFor,
} from "./renderer-capabilities";
import { validateGltfAssetRef } from "./gltf-asset-identity";

/** Immutable renderer creation options shared by `<Canvas>` and `createRendererRoot`. */
export interface RendererOptions {
  /** Request an alpha channel from the rendering context. @defaultValue `true` */
  readonly alpha?: boolean;
  /** Request browser context antialiasing. @defaultValue `true` */
  readonly antialias?: boolean;
  /**
   * Generate demand-driven VTs for eligible ordinary base-color images. The
   * ordinary texture remains active until generated coverage is ready.
   * @defaultValue `false`
   */
  readonly automaticVirtualTextures?: boolean;
}

/** @internal Canonical identity for the product-level options that own a React Canvas lifetime. */
export const rendererRootOptionsSemanticKey = (options?: RendererOptions): string =>
  `${options?.alpha ?? true}:${options?.antialias ?? true}:${options?.automaticVirtualTextures ?? false}`;

/** Normalized creation options retained for the lifetime of a renderer root. */
export interface ResolvedRendererOptions {
  readonly alpha: boolean;
  readonly antialias: boolean;
  readonly automaticVirtualTextures: boolean;
}

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

/** Bounded operational diagnostics projected from the active renderer backend. */
export interface RoyalRendererDiagnosticsSnapshot {
  /** Bounded recent diagnostic messages. */
  readonly messages: WebGlRootSnapshot["diagnostics"];
  /** Capacity and occurrence counts for the bounded diagnostic message log. */
  readonly messageStats: WebGlRootSnapshot["diagnosticStats"];
  /** Retained glTF asset readiness and bounded load timing. */
  readonly gltfLoads: WebGlRootSnapshot["gltfLoadDiagnostics"];
  /** Instanced glTF planning, drawing, and upload counters. */
  readonly gltfInstancing: WebGlRootSnapshot["gltfInstancing"];
  /** Scene-plan compilation counters. */
  readonly planning: WebGlRootSnapshot["planning"];
  /** Renderer resource acquisition and queue high-water counters. */
  readonly resourceLifetime: WebGlRootSnapshot["resourceLifetime"];
  /** Current resource budgets, usage, admissions, and denials. */
  readonly resourcePressure: WebGlRootSnapshot["resourcePressure"];
  /** Counters from the most recent picking query. */
  readonly picking: WebGlRootSnapshot["picking"];
  /** Current ordinary-texture lease and prepared-source counts. */
  readonly textureResidency: WebGlRootSnapshot["textureResidency"];
  /** Current VT residency plus cumulative request, upload, and failure counters. */
  readonly virtualTexturing: WebGlRootSnapshot["virtualTexturing"];
}

/** Focused state for one exact glTF asset identity retained by the renderer. */
export type RoyalGltfAssetSnapshot =
  | Readonly<{
    readonly error?: never;
    readonly state: "idle" | "loading" | "ready";
    readonly variantNames: readonly string[];
  }>
  | Readonly<{
    readonly error: string;
    readonly state: "error";
    readonly variantNames: readonly string[];
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
  gltfAssetSnapshot(asset: GltfAssetRef): RoyalGltfAssetSnapshot;
  /** Observes renderer availability without polling. Calls back immediately. */
  observeLifecycle(callback: (snapshot: RoyalRendererRootLifecycleSnapshot) => void): () => void;
  /** Observes completed renderer frames. Calls back immediately with the current frame index. */
  observeFrame(callback: (frame: number) => void): () => void;
  /** Observes one exact glTF asset identity. Calls back immediately. */
  observeGltfAsset(asset: GltfAssetRef, callback: (snapshot: RoyalGltfAssetSnapshot) => void): () => void;
  /** Observes failures from renderer-owned scheduled frames. */
  observeRenderFailures(callback: (failure: unknown) => void): () => void;
  /** Returns the front-most render target under a DOM client coordinate. */
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

const royalGltfAssetSnapshot = (
  snapshot: WebGlGltfLoadDiagnosticsAssetSnapshot | undefined,
): RoyalGltfAssetSnapshot => {
  if (snapshot === undefined) return Object.freeze({ state: "idle", variantNames: NO_GLTF_VARIANTS });
  if (snapshot.status === "loading") {
    return Object.freeze({ state: "loading", variantNames: NO_GLTF_VARIANTS });
  }
  if (snapshot.status === "error") {
    return Object.freeze({
      error: snapshot.error ?? "glTF asset failed to load",
      state: "error",
      variantNames: NO_GLTF_VARIANTS,
    });
  }
  return Object.freeze({ state: "ready", variantNames: snapshot.variantNames });
};

/** @internal Transfers demand scheduling to a React-owned frame loop. */
export type RoyalRendererFrameClock = {
  /** Flushes demand while this is the root's sole external clock owner. */
  flushInvalidated(): void;
  /** Returns scheduling to the root after the last external owner releases. */
  release(): void;
};

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
  const root = createWebGlRoot(canvas, options === undefined ? undefined : {
    ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
    ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
    ...(options.automaticVirtualTextures === undefined
      ? {}
      : { automaticVirtualTextures: options.automaticVirtualTextures }),
  });
  const normalizedOptions: ResolvedRendererOptions = Object.freeze({
    alpha: root.options.alpha,
    antialias: root.options.antialias,
    automaticVirtualTextures: root.options.automaticVirtualTextures,
  });

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
        messageStats: snapshot.diagnosticStats,
        messages: snapshot.diagnostics,
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
      return royalGltfAssetSnapshot(root.gltfAssetSnapshot(asset));
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
        callback(royalGltfAssetSnapshot(snapshot));
      });
    },
    observeRenderFailures: (callback) => {
      validateObserver(callback, "RoyalRendererRoot observeRenderFailures callback");
      return root.observeRenderFailures(callback);
    },
    pick: (input: PickInput) => root.pick(input),
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
    createXrSessionRenderer: async (session, xrOptions) => {
      const { createWebXrSessionRenderer } = await import("@royal/renderer-webgl/webxr");
      return createWebXrSessionRenderer(root, session, xrOptions);
    },
  });

  return royalRoot;
};
