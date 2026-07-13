import type { RoyalRendererRoot } from "./root";
import { royalRendererCapabilitiesFor } from "./renderer-capabilities";
import type { XrViewport } from "./xr-store";

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

export interface XrSession {
  addEventListener(
    type: "end",
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: "end",
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void;
  requestReferenceSpace(type: XrReferenceSpaceType): Promise<XrReferenceSpace>;
  updateRenderState(state: { readonly baseLayer: unknown }): void | Promise<void>;
}

export type XrSessionRendererFrameSnapshot = {
  readonly frameIndex: number;
  readonly viewCount: number;
  readonly viewports: readonly XrViewport[];
};

export type XrSessionRendererOptions = {
  readonly layerOptions?: {
    readonly antialias?: boolean;
    readonly framebufferScaleFactor?: number;
  };
  readonly onFrameSnapshot?: (
    snapshot: XrSessionRendererFrameSnapshot,
  ) => void;
  readonly referenceSpacePreference?: readonly XrReferenceSpaceType[];
};

export type XrSessionRenderer = {
  readonly disposed: boolean;
  readonly referenceSpace: XrReferenceSpace;
  dispose(): void;
  renderFrame(frame: XrFrame): boolean;
};

export const createXrSessionRenderer = async (
  root: RoyalRendererRoot,
  session: XrSession,
  options?: XrSessionRendererOptions,
): Promise<XrSessionRenderer> => {
  return royalRendererCapabilitiesFor(root).createXrSessionRenderer(session, options);
};

export {
  createXrSessionStore,
  selectXrSessionControlSnapshot,
  selectXrSessionSnapshot,
  useXrSessionSelector,
  useXrSessionSnapshot,
} from "./xr-store";

export type {
  XrSessionActivationOptions,
  XrSessionAvailabilityOptions,
  XrSessionBeginOptions,
  XrSessionControlSnapshot,
  XrSessionEndOptions,
  XrSessionFailureOptions,
  XrSessionFrameRecord,
  XrSessionMode,
  XrSessionOfferStatus,
  XrSessionState,
  XrSessionStore,
  XrSessionStoreActions,
  XrSessionStoreInitialState,
  XrSessionStoreState,
  XrSessionStatus,
  XrSessionSelectorEquality,
  XrViewport,
} from "./xr-store";
