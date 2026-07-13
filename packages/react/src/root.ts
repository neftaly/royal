import type { PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  type WebGlContextSnapshot,
  type ResourceGovernorPolicy,
  type WebGlRoot,
  type WebGlRootSnapshot,
} from "@royal/renderer-webgl";

/** Renderer creation options exposed through `Canvas.context` and `createRendererRoot`. */
export interface RoyalRendererRootContextOptions {
  /** Request an alpha channel in the canvas backing store. @defaultValue `true` */
  readonly alpha?: boolean;
  /** Request browser-provided WebGL antialiasing. Actual support is device-dependent. @defaultValue `true` */
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
   * Logical virtual texels per authored SVG CSS pixel. Used only when
   * `generatedImageVirtualTextures` is true. Must be finite and in `(0, 16]`.
   * It controls close-zoom texture detail without changing layout or world size;
   * generated dimensions preserve aspect ratio and are capped at 16384 logical
   * texels on their longest side. SVG viewBox coordinates are not raster pixels.
   * @defaultValue `4`
   */
  readonly generatedSvgVirtualTextureRasterDensity?: number;
  /** Immutable cross-class CPU/GPU/job/upload budget policy. Byte-named fields are bytes. */
  readonly resourceGovernorPolicy?: ResourceGovernorPolicy;
  /**
   * Global physical GPU byte budget shared by all virtual-texture atlases and page
   * tables in this root. Must be a non-negative safe integer.
   * @defaultValue `67108864` (64 MiB)
   */
  readonly virtualTexturePhysicalByteBudget?: number;
}

/** Options for the Royal renderer root. */
export interface RoyalRendererRootOptions {
  /** Renderer creation options. These are fixed for the lifetime of the root. */
  readonly context?: RoyalRendererRootContextOptions;
}

export type RoyalRendererRootContextSnapshot =
  Required<Omit<RoyalRendererRootContextOptions, "resourceGovernorPolicy">>
  & Pick<RoyalRendererRootContextOptions, "resourceGovernorPolicy">;

export type RoyalRendererRootLifecycle = "available" | "disposed" | "failed" | "unavailable";

export interface RoyalRendererRootLifecycleSnapshot {
  readonly error?: string;
  readonly generation: number;
  readonly lifecycle: RoyalRendererRootLifecycle;
}

export interface RoyalRendererRootSnapshot {
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly lifecycle: RoyalRendererRootLifecycleSnapshot;
}

/** Typed diagnostics returned by the current Royal WebGL renderer backend. */
export type RoyalRendererDiagnosticsSnapshot = WebGlRootSnapshot;

export type RoyalRendererRootRenderInput = RenderRoot;

/** Imperative renderer root bound to one canvas. */
export interface RoyalRendererRoot {
  readonly canvas: HTMLCanvasElement;
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  /** Typed WebGL diagnostics, including virtual-texture residency and request counters. */
  diagnostics(): RoyalRendererDiagnosticsSnapshot;
  /** Immediately renders queued demand on the caller's current frame, if any. */
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
  render(scene: RoyalRendererRootRenderInput): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  snapshot(): RoyalRendererRootSnapshot;
}

const WEB_GL_ROOT = Symbol("Royal React WebGL root");

const royalLifecycleSnapshot = (
  snapshot: WebGlContextSnapshot,
): RoyalRendererRootLifecycleSnapshot => Object.freeze({
  ...(snapshot.lastError === undefined ? {} : { error: snapshot.lastError }),
  generation: snapshot.generation,
  lifecycle: snapshot.lifecycle === "active"
    ? "available"
    : snapshot.lifecycle === "disposed"
      ? "disposed"
      : snapshot.lastError === undefined ? "unavailable" : "failed",
});

type WebGlBackedRoyalRendererRoot = RoyalRendererRoot & {
  readonly [WEB_GL_ROOT]: WebGlRoot;
};

export const webGlRootForRoyalRoot = (root: RoyalRendererRoot): WebGlRoot => {
  const webGlRoot = (root as Partial<WebGlBackedRoyalRendererRoot>)[WEB_GL_ROOT];
  if (webGlRoot === undefined) {
    throw new Error("Royal React root is not backed by the WebGL renderer");
  }

  return webGlRoot;
};

/** @internal Transfers demand scheduling to a React-owned frame loop. */
export type RoyalRendererFrameClock = {
  flushInvalidated(): void;
  release(): void;
};

export const acquireExternalRenderClockForRoyalRoot = (
  root: RoyalRendererRoot,
): RoyalRendererFrameClock => {
  const webGlRoot = webGlRootForRoyalRoot(root);
  return {
    flushInvalidated: () => webGlRoot.flushInvalidatedFromExternalClock(),
    release: webGlRoot.acquireExternalRenderClock(),
  };
};

/**
 * Creates an imperative renderer root. `options.context` is fixed for the
 * lifetime of the returned root.
 */
export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options?: RoyalRendererRootOptions,
): RoyalRendererRoot => {
  const root = createWebGlRoot(canvas, options?.context);
  const context: RoyalRendererRootContextSnapshot = Object.freeze({
    alpha: root.options.alpha,
    antialias: root.options.antialias,
    generatedImageVirtualTextures: root.options.generatedImageVirtualTextures,
    generatedSvgVirtualTextureRasterDensity: root.options.generatedSvgVirtualTextureRasterDensity,
    ...(root.options.resourceGovernorPolicy === undefined
      ? {}
      : { resourceGovernorPolicy: root.options.resourceGovernorPolicy }),
    virtualTexturePhysicalByteBudget: root.options.virtualTexturePhysicalByteBudget,
  });

  const royalRoot: RoyalRendererRoot = {
    get canvas() {
      return root.canvas;
    },
    get context() {
      return context;
    },
    get disposed() {
      return root.disposed;
    },
    get frame() {
      return root.frame;
    },
    diagnostics: () => root.snapshot(),
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
    render: (scene: RoyalRendererRootRenderInput) => {
      root.render(scene);
    },
    snapshot: () => {
      return Object.freeze({
        context,
        disposed: root.disposed,
        frame: root.frame,
        lifecycle: royalLifecycleSnapshot(root.contextSnapshot()),
      });
    },
  };
  Object.defineProperty(royalRoot, WEB_GL_ROOT, {
    configurable: false,
    enumerable: false,
    value: root,
  });

  return royalRoot;
};
