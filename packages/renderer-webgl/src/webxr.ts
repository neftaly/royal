import type { RenderRoot } from "@royal/renderer-core";
import type {
  WebGlContextLifecycle,
  WebGlRoot,
  WebGlRenderViewport,
} from "./root";
import {
  appendFrameView,
  createFrameViews,
  resetFrameViews,
  type FrameViews,
} from "./frame-views";
import {
  rendererOwnedWebGl2Context,
  type RendererOwnedWebGl2Context,
} from "./webgl/context-lane";
import {
  rendererFrameViews,
  type RendererFrameViewLane,
} from "./webgl/frame-view-lane";

export interface WebGlXrReferenceSpace {
  readonly __royalXrReferenceSpace?: never;
}

export type WebXrReferenceSpaceType =
  | "viewer"
  | "local"
  | "local-floor"
  | "bounded-floor"
  | "unbounded";

export interface WebGlXrView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly transform: {
    readonly inverse: {
      readonly matrix: ArrayLike<number>;
    };
  };
}

export interface WebGlXrViewerPose {
  readonly views: readonly WebGlXrView[];
}

export interface WebGlXrFrame {
  getViewerPose(referenceSpace: WebGlXrReferenceSpace): WebGlXrViewerPose | null;
}

export interface WebGlXrLayer {
  readonly framebuffer: WebGLFramebuffer | null;
  getViewport(view: WebGlXrView): WebGlRenderViewport | null | undefined;
}

export interface WebGlXrSession {
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
  requestReferenceSpace(type: WebXrReferenceSpaceType): Promise<WebGlXrReferenceSpace>;
  updateRenderState(state: { readonly baseLayer: WebGlXrLayer }): void | Promise<void>;
}

export interface WebGlXrLayerConstructor {
  new (
    session: WebGlXrSession,
    gl: WebGL2RenderingContext,
    options?: WebGlXrLayerOptions,
  ): WebGlXrLayer;
}

export interface WebGlXrLayerOptions {
  readonly antialias?: boolean;
  readonly framebufferScaleFactor?: number;
}

export interface WebGlXrRenderRoot extends RendererOwnedWebGl2Context, RendererFrameViewLane {
  readonly contextLifecycle: WebGlContextLifecycle;
  readonly latestScene: RenderRoot | undefined;
  acquireExternalRenderClock(): () => void;
}

export interface WebGlXrFrameSnapshotViewport {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface WebGlXrFrameSnapshot {
  readonly frameIndex: number;
  readonly viewCount: number;
  readonly viewports: readonly WebGlXrFrameSnapshotViewport[];
}

export type WebGlXrFrameSnapshotCallback = (snapshot: WebGlXrFrameSnapshot) => void;

export interface WebGlXrSessionRendererAdvancedOptions {
  readonly xrWebGLLayerConstructor?: WebGlXrLayerConstructor;
}

export interface WebGlXrSessionRendererOptions {
  readonly advanced?: WebGlXrSessionRendererAdvancedOptions;
  readonly layerOptions?: WebGlXrLayerOptions;
  readonly onFrameSnapshot?: WebGlXrFrameSnapshotCallback;
  readonly referenceSpacePreference?: readonly WebXrReferenceSpaceType[];
}

export interface WebGlXrSessionRenderer {
  readonly disposed: boolean;
  readonly layer: WebGlXrLayer;
  readonly referenceSpace: WebGlXrReferenceSpace;
  dispose(): void;
  renderFrame(frame: WebGlXrFrame, scene?: RenderRoot): boolean;
}

type WebGl2XrCompatibleContext = WebGL2RenderingContext & {
  makeXRCompatible?: () => Promise<void>;
};

const DEFAULT_REFERENCE_SPACE_TYPES = ["local-floor", "local"] as const;

const xrLayerConstructor = (): WebGlXrLayerConstructor | undefined =>
  (globalThis as { readonly XRWebGLLayer?: WebGlXrLayerConstructor }).XRWebGLLayer;

const firstReferenceSpace = async (
  session: WebGlXrSession,
  types: readonly WebXrReferenceSpaceType[],
): Promise<WebGlXrReferenceSpace> => {
  let lastError: unknown;
  for (const type of types) {
    try {
      return await session.requestReferenceSpace(type);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Royal WebXR could not acquire a reference space");
};

const fillFrameViews = (
  frameViews: FrameViews,
  layer: WebGlXrLayer,
  pose: WebGlXrViewerPose,
): void => {
  resetFrameViews(frameViews, layer.framebuffer, true);
  for (const view of pose.views) {
    const viewport = layer.getViewport(view);
    if (viewport === null || viewport === undefined) continue;
    appendFrameView(
      frameViews,
      view.projectionMatrix,
      view.transform.inverse.matrix,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    );
  }
};

const frameSnapshot = (
  frameIndex: number,
  frameViews: FrameViews,
): WebGlXrFrameSnapshot => ({
  frameIndex,
  viewCount: frameViews.count,
  viewports: Array.from({ length: frameViews.count }, (_value, index) => {
    const offset = index * 4;
    return {
      height: frameViews.viewports[offset + 3]!,
      width: frameViews.viewports[offset + 2]!,
      x: frameViews.viewports[offset]!,
      y: frameViews.viewports[offset + 1]!,
    };
  }),
});

export const createWebXrSessionRenderer = async (
  publicRoot: WebGlRoot | WebGlXrRenderRoot,
  session: WebGlXrSession,
  options: WebGlXrSessionRendererOptions = {},
): Promise<WebGlXrSessionRenderer> => {
  if (
    !(rendererOwnedWebGl2Context in publicRoot)
    || !(rendererFrameViews in publicRoot)
  ) {
    throw new Error(
      "Royal WebXR rendering requires a Royal WebGL root with renderer-owned context and frame-view capabilities",
    );
  }
  const root = publicRoot as WebGlXrRenderRoot;
  if (root.contextLifecycle !== "active") {
    throw new Error("Royal WebXR rendering requires an active renderer-owned WebGL2 context");
  }
  const gl = root[rendererOwnedWebGl2Context] as WebGl2XrCompatibleContext;
  let sessionEnded = false;
  let disposeEndedSession: (() => void) | undefined;
  const onSessionEnd: EventListener = () => {
    sessionEnded = true;
    disposeEndedSession?.();
  };
  const assertSessionActive = (): void => {
    if (sessionEnded) throw new Error("Royal WebXR session ended during renderer setup");
  };
  session.addEventListener("end", onSessionEnd, { once: true });

  try {
    if (typeof gl.makeXRCompatible !== "function") {
      throw new Error("Royal WebXR rendering requires WebGL makeXRCompatible support");
    }
    await gl.makeXRCompatible();
    assertSessionActive();
    if (root.contextLifecycle !== "active") {
      throw new Error("Royal WebXR renderer context became unavailable during session setup");
    }

    const Layer = options.advanced?.xrWebGLLayerConstructor ?? xrLayerConstructor();
    if (Layer === undefined) {
      throw new Error("Royal WebXR rendering requires XRWebGLLayer");
    }

    const layer = new Layer(session, gl, options.layerOptions);
    await session.updateRenderState({ baseLayer: layer });
    assertSessionActive();
    const referenceSpace = await firstReferenceSpace(
      session,
      options.referenceSpacePreference ?? DEFAULT_REFERENCE_SPACE_TYPES,
    );
    assertSessionActive();
    let frameIndex = 0;
    let disposed = false;
    const frameViews = createFrameViews(2);
    const releaseRenderClock = root.acquireExternalRenderClock();
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      let firstFailure: unknown;
      let failed = false;
      try {
        session.removeEventListener("end", onSessionEnd);
      } catch (error) {
        failed = true;
        firstFailure = error;
      }
      try {
        releaseRenderClock();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
        }
      }
      if (failed) throw firstFailure;
    };
    disposeEndedSession = dispose;

    return {
      get disposed() {
        return disposed;
      },
      layer,
      referenceSpace,
      dispose,
      renderFrame: (frame, scene = root.latestScene) => {
        if (disposed) return false;
        if (root.contextLifecycle !== "active") return false;
        if (scene === undefined) return false;
        const pose = frame.getViewerPose(referenceSpace);
        if (pose === null) return false;
        fillFrameViews(frameViews, layer, pose);
        if (frameViews.count === 0) return false;
        root[rendererFrameViews](scene, frameViews);
        if (options.onFrameSnapshot !== undefined) {
          options.onFrameSnapshot(frameSnapshot(frameIndex, frameViews));
        }
        frameIndex += 1;
        return true;
      },
    };
  } catch (error) {
    try {
      if (disposeEndedSession === undefined) session.removeEventListener("end", onSessionEnd);
      else disposeEndedSession();
    } catch {
      // Preserve the setup failure after making every available cleanup attempt.
    }
    throw error;
  }
};
