import type { WebGlXrFrame, WebGlXrSession } from "@royal/renderer-webgl/webxr";
import { createWebGlXrSessionRenderer } from "@royal/renderer-webgl/webxr";
import type { RoyalRendererRoot } from "./root";
import { webGlRootForRoyalRoot } from "./root";
import type { XrViewport } from "./xr-store";

export interface XrReferenceSpace {
  readonly __royalXrReferenceSpace?: never;
}

export interface XrView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly transform?: {
    readonly inverse?: {
      readonly matrix: ArrayLike<number>;
    };
  };
  readonly viewMatrix?: ArrayLike<number>;
}

export interface XrViewerPose {
  readonly views: readonly XrView[];
}

export interface XrFrame {
  getViewerPose(referenceSpace: XrReferenceSpace): XrViewerPose | null;
}

export interface XrSession {
  requestReferenceSpace(type: string): Promise<XrReferenceSpace>;
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
  readonly referenceSpaceTypes?: readonly string[];
};

export type XrSessionRenderer = {
  readonly referenceSpace: XrReferenceSpace;
  renderFrame(frame: XrFrame): boolean;
};

export const createXrSessionRenderer = async (
  root: RoyalRendererRoot,
  session: XrSession,
  options?: XrSessionRendererOptions,
): Promise<XrSessionRenderer> => {
  const renderer = await createWebGlXrSessionRenderer(
    webGlRootForRoyalRoot(root),
    session as WebGlXrSession,
    options,
  );

  return {
    referenceSpace: renderer.referenceSpace as XrReferenceSpace,
    renderFrame: (frame) => renderer.renderFrame(frame as WebGlXrFrame),
  };
};

export {
  createXrSessionStore,
  selectXrSessionControlSnapshot,
  selectXrSessionSnapshot,
  useXrSessionStore,
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
  XrSessionSnapshot,
  XrSessionSerializableState,
  XrSessionState,
  XrSessionStore,
  XrSessionStoreActions,
  XrSessionStoreInitialState,
  XrSessionStoreState,
  XrSessionStatus,
  XrSessionSerializableSnapshot,
  XrViewport,
} from "./xr-store";
