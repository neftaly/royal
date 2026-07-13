import type { PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  webGlRootOptionsSemanticKey,
  type WebGlContextSnapshot,
  type WebGlRoot,
  type WebGlRootOptions,
  type WebGlRootSnapshot,
} from "@royal/renderer-webgl";
import {
  registerRoyalRendererCapabilities,
  royalRendererCapabilitiesFor,
} from "./renderer-capabilities";

/** Immutable renderer creation options accepted by `createRendererRoot`. */
export type RendererOptions = WebGlRootOptions;

/** @internal Backend-owned semantic identity used by the React Canvas lifetime. */
export const rendererRootOptionsSemanticKey = webGlRootOptionsSemanticKey;

/** Normalized creation options retained for the lifetime of a renderer root. */
export type ResolvedRendererOptions = WebGlRoot["options"];

export type RoyalRendererRootLifecycle = "available" | "disposed" | "failed" | "unavailable";

export interface RoyalRendererRootLifecycleSnapshot {
  readonly error?: string;
  readonly generation: number;
  /** Number of backend interruptions observed during this root's lifetime. */
  readonly interruptions: number;
  /** Number of successful recoveries from an interruption. */
  readonly recoveries: number;
  readonly state: RoyalRendererRootLifecycle;
}

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
  readonly gltfLoads: WebGlRootSnapshot["gltfLoadDiagnostics"];
  readonly gltfInstancing: WebGlRootSnapshot["gltfInstancing"];
  readonly planning: WebGlRootSnapshot["planning"];
  readonly resourceLifetime: WebGlRootSnapshot["resourceLifetime"];
  readonly resourceGovernor: WebGlRootSnapshot["resourceGovernor"];
  readonly picking: WebGlRootSnapshot["picking"];
  readonly textureResidency: WebGlRootSnapshot["textureResidency"];
  readonly virtualTexturing: WebGlRootSnapshot["virtualTexturing"];
}

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
  /** Observes renderer availability without polling. Calls back immediately. */
  observeLifecycle(callback: (snapshot: RoyalRendererRootLifecycleSnapshot) => void): () => void;
  /** Observes failures from renderer-owned scheduled frames. */
  observeRenderFailures(callback: (failure: unknown) => void): () => void;
  /** Returns the front-most render target under a DOM client coordinate. */
  pick(input: PickInput): PickResult | undefined;
  /** Renders a complete scene into the canvas. */
  render(scene: RenderRoot): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  snapshot(): RoyalRendererRootSnapshot;
}

const royalLifecycleSnapshot = (
  snapshot: WebGlContextSnapshot,
): RoyalRendererRootLifecycleSnapshot => Object.freeze({
  ...(snapshot.lastError === undefined ? {} : { error: snapshot.lastError }),
  generation: snapshot.generation,
  interruptions: snapshot.losses,
  recoveries: snapshot.restores,
  state: snapshot.lifecycle === "active"
    ? "available"
    : snapshot.lifecycle === "disposed"
      ? "disposed"
      : snapshot.lastError === undefined ? "unavailable" : "failed",
});

/** @internal Transfers demand scheduling to a React-owned frame loop. */
export type RoyalRendererFrameClock = {
  /** Flushes demand while this is the root's sole external clock owner. */
  flushInvalidated(): void;
  /** Returns scheduling to the root after the last external owner releases. */
  release(): void;
};

export const acquireExternalRenderClockForRoyalRoot = (
  root: RoyalRendererRoot,
): RoyalRendererFrameClock => {
  const capabilities = royalRendererCapabilitiesFor(root);
  return {
    flushInvalidated: () => capabilities.flushInvalidatedFromExternalClock(),
    release: capabilities.acquireExternalRenderClock(),
  };
};

/**
 * Creates an imperative renderer root. `options` is fixed for the lifetime of
 * the returned root.
 */
export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options?: RendererOptions,
): RoyalRendererRoot => {
  const root = createWebGlRoot(canvas, options);
  const normalizedOptions = root.options;

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
        resourceGovernor: snapshot.resourceGovernor,
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
    invalidate: () => {
      root.invalidate();
    },
    observeLifecycle: (callback) => root.observeContextLifecycle((snapshot) => {
      callback(royalLifecycleSnapshot(snapshot));
    }),
    observeRenderFailures: (callback) => root.observeRenderFailures(callback),
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
    flushInvalidatedFromExternalClock: () => root.flushInvalidatedFromExternalClock(),
  });

  return royalRoot;
};
