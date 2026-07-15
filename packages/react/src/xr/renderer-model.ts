import type { XrSessionVisibilityState, XrViewport } from "./session-model";
import { recordWithAllowedFields } from "../validation";

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
  readonly frameRate?: number | null;
  readonly supportedFrameRates?: Float32Array | null;
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
  updateTargetFrameRate?(rate: number): Promise<void>;
  updateRenderState(state: { readonly baseLayer: unknown }): void | Promise<void>;
}

export type XrSessionRendererFrameSnapshot = {
  readonly frameIndex: number;
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

const XR_RENDERER_OPTION_FIELDS = [
  "onFrameSnapshot",
  "referenceSpacePreference",
  "webGlLayer",
] as const;
const XR_WEBGL_LAYER_OPTION_FIELDS = ["antialias", "framebufferScaleFactor"] as const;
const XR_REFERENCE_SPACE_TYPES: readonly XrReferenceSpaceType[] = [
  "viewer",
  "local",
  "local-floor",
  "bounded-floor",
  "unbounded",
];

/** @internal Validates the React XR boundary before backend loading or session ownership. */
export const validateXrSessionRendererOptions = (
  options: XrSessionRendererOptions | undefined,
): void => {
  if (options === undefined) return;
  recordWithAllowedFields(
    options,
    XR_RENDERER_OPTION_FIELDS,
    "XR session renderer options",
    "option",
  );
  if (options.onFrameSnapshot !== undefined && typeof options.onFrameSnapshot !== "function") {
    throw new TypeError("XR session renderer onFrameSnapshot must be a function");
  }
  if (options.webGlLayer !== undefined) {
    recordWithAllowedFields(
      options.webGlLayer,
      XR_WEBGL_LAYER_OPTION_FIELDS,
      "XR session renderer webGlLayer options",
      "option",
    );
    if (
      options.webGlLayer.antialias !== undefined
      && typeof options.webGlLayer.antialias !== "boolean"
    ) {
      throw new TypeError("XR session renderer webGlLayer.antialias must be a boolean");
    }
    if (
      options.webGlLayer.framebufferScaleFactor !== undefined
      && (
        !Number.isFinite(options.webGlLayer.framebufferScaleFactor)
        || options.webGlLayer.framebufferScaleFactor <= 0
      )
    ) {
      throw new RangeError(
        "XR session renderer webGlLayer.framebufferScaleFactor must be positive and finite",
      );
    }
  }
  const preference = options.referenceSpacePreference;
  if (preference !== undefined && !Array.isArray(preference)) {
    throw new TypeError("XR session renderer referenceSpacePreference must be an array");
  }
  if (preference !== undefined && preference.length === 0) {
    throw new RangeError(
      "XR session renderer referenceSpacePreference must contain at least one reference space type",
    );
  }
  if (preference?.some((type) => !XR_REFERENCE_SPACE_TYPES.includes(type)) === true) {
    throw new TypeError(
      `XR session renderer referenceSpacePreference entries must be one of ${XR_REFERENCE_SPACE_TYPES.join(", ")}`,
    );
  }
};

export type XrSessionRenderer = {
  readonly disposed: boolean;
  readonly referenceSpace: XrReferenceSpace;
  dispose(): void;
  renderFrame(frame: XrFrame): boolean;
};
