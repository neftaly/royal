import type { RenderRoot } from "@royal/renderer-core";
import type {
  WebGlRenderView,
  WebGlRenderViewsOptions,
  WebGlRenderViewport,
} from "./root";

export interface WebGlXrReferenceSpace {
  readonly __royalWebGlXrReferenceSpace?: never;
}

export type WebXrReferenceSpaceType =
  | "viewer"
  | "local"
  | "local-floor"
  | "bounded-floor"
  | "unbounded";

export interface WebGlXrView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly transform?: {
    readonly inverse?: {
      readonly matrix: ArrayLike<number>;
    };
  };
  readonly viewMatrix?: ArrayLike<number>;
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

export interface WebGlXrRenderRoot {
  readonly canvas: HTMLCanvasElement;
  readonly latestScene: RenderRoot | undefined;
  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void;
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
  readonly layer: WebGlXrLayer;
  readonly referenceSpace: WebGlXrReferenceSpace;
  renderFrame(frame: WebGlXrFrame, scene?: RenderRoot): boolean;
}

type WebGl2XrCompatibleContext = WebGL2RenderingContext & {
  makeXRCompatible?: () => Promise<void>;
};

const DEFAULT_REFERENCE_SPACE_TYPES = ["local-floor", "local"] as const;

const xrLayerConstructor = (): WebGlXrLayerConstructor | undefined =>
  (globalThis as { readonly XRWebGLLayer?: WebGlXrLayerConstructor }).XRWebGLLayer;

const webGl2Context = (canvas: HTMLCanvasElement): WebGl2XrCompatibleContext => {
  const gl = canvas.getContext("webgl2") as WebGl2XrCompatibleContext | null;
  if (gl === null) throw new Error("Royal WebXR rendering requires a WebGL2 context");
  return gl;
};

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

const viewMatrix = (view: WebGlXrView): ArrayLike<number> => {
  const matrix = view.viewMatrix ?? view.transform?.inverse?.matrix;
  if (matrix === undefined) {
    throw new Error("Royal WebXR views require an inverse transform matrix");
  }

  return matrix;
};

const renderViews = (
  layer: WebGlXrLayer,
  pose: WebGlXrViewerPose,
): readonly WebGlRenderView[] =>
  pose.views.flatMap((view) => {
    const viewport = layer.getViewport(view);
    if (viewport === null || viewport === undefined) return [];
    return [{
      projectionMatrix: view.projectionMatrix,
      viewMatrix: viewMatrix(view),
      viewport,
    }];
  });

const frameSnapshot = (
  frameIndex: number,
  views: readonly WebGlRenderView[],
): WebGlXrFrameSnapshot => ({
  frameIndex,
  viewCount: views.length,
  viewports: views.map(({ viewport }) => ({
    height: viewport.height,
    width: viewport.width,
    x: viewport.x,
    y: viewport.y,
  })),
});

export const createWebXrSessionRenderer = async (
  root: WebGlXrRenderRoot,
  session: WebGlXrSession,
  options: WebGlXrSessionRendererOptions = {},
): Promise<WebGlXrSessionRenderer> => {
  const gl = webGl2Context(root.canvas);
  await gl.makeXRCompatible?.();

  const Layer = options.advanced?.xrWebGLLayerConstructor ?? xrLayerConstructor();
  if (Layer === undefined) {
    throw new Error("Royal WebXR rendering requires XRWebGLLayer");
  }

  const layer = new Layer(session, gl, options.layerOptions);
  await session.updateRenderState({ baseLayer: layer });
  const referenceSpace = await firstReferenceSpace(
    session,
    options.referenceSpacePreference ?? DEFAULT_REFERENCE_SPACE_TYPES,
  );
  let frameIndex = 0;

  return {
    layer,
    referenceSpace,
    renderFrame: (frame, scene = root.latestScene) => {
      if (scene === undefined) return false;
      const pose = frame.getViewerPose(referenceSpace);
      if (pose === null) return false;
      const views = renderViews(layer, pose);
      if (views.length === 0) return false;
      options.onFrameSnapshot?.(frameSnapshot(frameIndex, views));
      frameIndex += 1;
      root.renderViews(scene, {
        framebuffer: layer.framebuffer,
        views,
      });
      return true;
    },
  };
};
