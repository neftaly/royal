import type { XrSessionVisibilityState, XrViewport } from "./xr-session-model";

export interface XrReferenceSpace {
  readonly __royalXrReferenceSpace?: never;
}

export type XrReferenceSpaceType =
  | "viewer"
  | "local"
  | "local-floor"
  | "bounded-floor"
  | "unbounded";

export interface XrView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly transform: {
    readonly inverse: {
      readonly matrix: ArrayLike<number>;
    };
  };
}

export interface XrViewerPose {
  readonly views: readonly XrView[];
}

export interface XrFrame {
  getViewerPose(referenceSpace: XrReferenceSpace): XrViewerPose | null;
}

export type XrFrameCallback = (time: number, frame: XrFrame) => void;

/** Browser XR session surface consumed by Royal's renderer and runtime. */
export interface XrSession {
  readonly visibilityState?: XrSessionVisibilityState;
  addEventListener(
    type: "end" | "visibilitychange",
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
  removeEventListener(
    type: "end" | "visibilitychange",
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void;
  requestAnimationFrame(callback: XrFrameCallback): number;
  requestReferenceSpace(type: XrReferenceSpaceType): Promise<XrReferenceSpace>;
  updateRenderState(state: { readonly baseLayer: unknown }): void | Promise<void>;
}

export type XrSessionRendererFrameSnapshot = {
  readonly frameIndex: number;
  readonly viewCount: number;
  readonly viewports: readonly XrViewport[];
};

/** Options forwarded to the browser's `XRWebGLLayer` constructor. */
export type XrWebGlLayerOptions = {
  readonly antialias?: boolean;
  /** Positive scale applied to the browser-recommended XR framebuffer size. */
  readonly framebufferScaleFactor?: number;
};

export type XrSessionRendererOptions = {
  readonly webGlLayer?: XrWebGlLayerOptions;
  /** Opt-in frame telemetry. Supplying this callback allocates a viewport snapshot per rendered frame. */
  readonly onFrameSnapshot?: (
    snapshot: XrSessionRendererFrameSnapshot,
  ) => void;
  /** Ordered, non-empty fallback list. Defaults to `local-floor`, then `local`. */
  readonly referenceSpacePreference?: readonly XrReferenceSpaceType[];
};

export type XrSessionRenderer = {
  readonly disposed: boolean;
  readonly referenceSpace: XrReferenceSpace;
  dispose(): void;
  renderFrame(frame: XrFrame): boolean;
};
