import {
  rendererAcquireExternalClock,
  rendererOwnedWebGl2Context,
  rendererSubmitExternalFrame,
  type ExternalFrameCapableRoot,
  type ExternalSurfaceFrame,
} from "../frame/external-frame";
import type { SurfaceFrameView } from "../frame/surface-frame";
import type { RendererRoot } from "../runtime/canvas-root";
import {
  identityMat4,
  multiplyMat4Into,
  type MutableMat4,
} from "../math/mat4";
import {
  selectXrPreferredFrameRate,
  validateXrPreferredFrameRate,
  type XrPreferredFrameRate,
} from "./frame-rate";

export type XrReferenceSpaceType =
  | "viewer"
  | "local"
  | "local-floor"
  | "bounded-floor"
  | "unbounded";

export interface XrReferenceSpace {
  readonly __royalXrReferenceSpace?: never;
}

export interface XrView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly transform: { readonly inverse: { readonly matrix: ArrayLike<number> } };
}

export interface XrViewerPose {
  readonly views: readonly XrView[];
}

export interface XrFrame {
  getViewerPose(referenceSpace: XrReferenceSpace): XrViewerPose | null;
}

export interface XrSession {
  readonly supportedFrameRates?: ArrayLike<number>;
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
  updateTargetFrameRate?(frameRate: number): Promise<void>;
  updateRenderState(state: {
    readonly baseLayer: XrWebGlLayer;
    readonly depthFar?: number;
    readonly depthNear?: number;
  }): void | Promise<void>;
}

export interface XrWebGlLayer {
  readonly framebuffer: WebGLFramebuffer | null;
  readonly framebufferHeight: number;
  readonly framebufferWidth: number;
  getViewport(view: XrView): XrViewport | null | undefined;
}

export type XrViewport = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

export type XrWebGlLayerOptions = Readonly<{
  /** Requests browser multisampling for the XR layer. @defaultValue `false` */
  antialias?: boolean;
  /** Scale applied to browser-recommended XR framebuffer dimensions; omitted uses the browser default. */
  framebufferScaleFactor?: number;
}>;

/** Explicit WebXR projection depth interval in metres. */
export type XrDepthRange = Readonly<{
  /** Positive far clipping distance. */
  far: number;
  /** Positive near clipping distance. */
  near: number;
}>;

export interface XrWebGlLayerConstructor {
  new (
    session: XrSession,
    gl: WebGL2RenderingContext,
    options?: XrWebGlLayerOptions,
  ): XrWebGlLayer;
}

export type XrSessionRendererFrameSnapshot = Readonly<{
  /** Zero-based count of successfully submitted frames. */
  frameIndex: number;
  /** Allocated copy of the viewports submitted for this frame. */
  viewports: readonly XrViewport[];
}>;

export type XrSessionRendererOptions = Readonly<{
  /**
   * Projection range installed into the browser-owned XR render state.
   * Omitted values preserve WebXR's defaults.
   */
  depthRange?: XrDepthRange;
  /** Allocating diagnostic callback; omit it from production frame paths. */
  onFrameSnapshot?: (snapshot: XrSessionRendererFrameSnapshot) => void;
  /** Best-effort browser frame-rate preference; omitted preserves the browser default. */
  preferredFrameRate?: XrPreferredFrameRate;
  /** Ordered fallback list. Defaults to `local-floor`, then `local`. */
  referenceSpacePreference?: readonly XrReferenceSpaceType[];
  webGlLayer?: XrWebGlLayerOptions;
}>;

export type XrSessionRenderer = Readonly<{
  /** Whether Royal has released this session renderer. */
  readonly disposed: boolean;
  /** Browser layer installed as the session's base layer. */
  readonly layer: XrWebGlLayer;
  /** First supported reference space from `referenceSpacePreference`. */
  readonly referenceSpace: XrReferenceSpace;
  /** Releases Royal's external frame-clock ownership; safe to call repeatedly. */
  dispose(): void;
  /** Submits one browser XR frame; false means no pose was available or ownership ended. */
  renderFrame(frame: XrFrame): boolean;
}>;

type XrRoot = RendererRoot & ExternalFrameCapableRoot;

export type XrSessionRendererPlatform = Readonly<{
  layerConstructor(): XrWebGlLayerConstructor | undefined;
}>;

const REFERENCE_SPACE_TYPES: readonly XrReferenceSpaceType[] = [
  "viewer",
  "local",
  "local-floor",
  "bounded-floor",
  "unbounded",
];
const DEFAULT_REFERENCE_SPACES = ["local-floor", "local"] as const;
const OPTION_FIELDS = new Set([
  "depthRange",
  "onFrameSnapshot",
  "preferredFrameRate",
  "referenceSpacePreference",
  "webGlLayer",
]);
const DEPTH_RANGE_FIELDS = new Set(["far", "near"]);
const LAYER_OPTION_FIELDS = new Set(["antialias", "framebufferScaleFactor"]);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const rejectUnknownFields = (
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  label: string,
): void => {
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== "string" || !fields.has(field)) {
      throw new TypeError(`${label} has unsupported field ${String(field)}`);
    }
  }
};

export const validateXrSessionRendererOptions = (
  options: XrSessionRendererOptions,
): void => {
  const record = requireRecord(options, "Royal XR renderer options");
  rejectUnknownFields(record, OPTION_FIELDS, "Royal XR renderer options");
  if (options.depthRange !== undefined) {
    const depthRange = requireRecord(options.depthRange, "Royal XR depthRange");
    rejectUnknownFields(depthRange, DEPTH_RANGE_FIELDS, "Royal XR depthRange");
    const { far, near } = options.depthRange;
    if (typeof near !== "number" || !Number.isFinite(near) || !(near > 0)) {
      throw new RangeError("Royal XR depthRange near must be a positive finite number");
    }
    if (typeof far !== "number" || !Number.isFinite(far) || !(far > near)) {
      throw new RangeError("Royal XR depthRange far must be finite and greater than near");
    }
  }
  if (options.onFrameSnapshot !== undefined && typeof options.onFrameSnapshot !== "function") {
    throw new TypeError("Royal XR onFrameSnapshot must be a function");
  }
  if (options.preferredFrameRate !== undefined) {
    validateXrPreferredFrameRate(options.preferredFrameRate);
  }
  if (options.referenceSpacePreference !== undefined) {
    if (!Array.isArray(options.referenceSpacePreference)) {
      throw new TypeError("Royal XR referenceSpacePreference must be an array");
    }
    if (options.referenceSpacePreference.length === 0) {
      throw new RangeError("Royal XR referenceSpacePreference must not be empty");
    }
    for (const type of options.referenceSpacePreference) {
      if (!REFERENCE_SPACE_TYPES.includes(type)) {
        throw new TypeError(`Royal XR has unsupported reference space ${String(type)}`);
      }
    }
  }
  if (options.webGlLayer !== undefined) {
    const layer = requireRecord(options.webGlLayer, "Royal XR webGlLayer");
    rejectUnknownFields(layer, LAYER_OPTION_FIELDS, "Royal XR webGlLayer");
    if (options.webGlLayer.antialias !== undefined
      && typeof options.webGlLayer.antialias !== "boolean") {
      throw new TypeError("Royal XR webGlLayer.antialias must be a boolean");
    }
    const scale = options.webGlLayer.framebufferScaleFactor;
    if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0)) {
      throw new RangeError("Royal XR framebufferScaleFactor must be positive and finite");
    }
  }
};

const defaultPlatform: XrSessionRendererPlatform = {
  layerConstructor: () => (
    globalThis as typeof globalThis & { readonly XRWebGLLayer?: XrWebGlLayerConstructor }
  ).XRWebGLLayer,
};

const firstReferenceSpace = async (
  session: XrSession,
  preferences: readonly XrReferenceSpaceType[],
): Promise<XrReferenceSpace> => {
  let lastFailure: unknown;
  for (const type of preferences) {
    try {
      return await session.requestReferenceSpace(type);
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure instanceof Error
    ? lastFailure
    : new Error("Royal XR could not acquire a reference space");
};

type MutableXrFrameSlot = Readonly<{
  frameView: SurfaceFrameView;
  projection: MutableMat4;
  view: MutableMat4;
  viewProjection: MutableMat4;
  viewport: { height: number; width: number; x: number; y: number };
}>;

const createFrameSlot = (): MutableXrFrameSlot => {
  const projection = identityMat4();
  const view = identityMat4();
  const viewProjection = identityMat4();
  const viewport = { height: 1, width: 1, x: 0, y: 0 };
  return {
    frameView: { perspective: true, view, viewProjection, viewport },
    projection,
    view,
    viewProjection,
    viewport,
  };
};

const copyViewMatrix = (
  target: MutableMat4,
  source: ArrayLike<number>,
  viewIndex: number,
  field: "projection" | "view",
): void => {
  if (source.length !== 16) {
    throw new TypeError(`Royal XR views[${viewIndex}].${field} must contain 16 components`);
  }
  for (let componentIndex = 0; componentIndex < 16; componentIndex += 1) {
    const component = source[componentIndex];
    if (component === undefined || !Number.isFinite(component)) {
      throw new TypeError(
        `Royal XR views[${viewIndex}].${field}[${componentIndex}] must be finite`,
      );
    }
    target[componentIndex] = component;
  }
};

const requirePositiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
};

const requirePositiveViewportInteger = (
  value: number,
  viewIndex: number,
  field: "height" | "width",
): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `Royal XR views[${viewIndex}].viewport.${field} must be a positive safe integer`,
    );
  }
};

/** @internal Test seam; consumers use createWebXrSessionRenderer. */
export const createWebXrSessionRendererWithPlatform = async (
  root: XrRoot,
  session: XrSession,
  options: XrSessionRendererOptions,
  platform: XrSessionRendererPlatform,
): Promise<XrSessionRenderer> => {
  validateXrSessionRendererOptions(options);
  if (!(rendererOwnedWebGl2Context in root) || !(rendererSubmitExternalFrame in root)) {
    throw new Error("Royal XR requires a Royal WebGL renderer root");
  }
  if (root.getLifecycleSnapshot().phase !== "active") {
    throw new Error("Royal XR requires an active WebGL renderer root");
  }
  const gl = root[rendererOwnedWebGl2Context] as WebGL2RenderingContext & {
    makeXRCompatible?: () => Promise<void>;
  };
  let ended = false;
  let disposeAfterSetup: (() => void) | undefined;
  const onEnd: EventListener = () => {
    ended = true;
    try {
      disposeAfterSetup?.();
    } catch {
      // The session has ended; every cleanup path is already best-effort.
    }
  };
  const assertSetupActive = (): void => {
    if (ended) throw new Error("Royal XR session ended during setup");
    if (root.getLifecycleSnapshot().phase !== "active") {
      throw new Error("Royal XR renderer root became unavailable during setup");
    }
  };
  session.addEventListener("end", onEnd, { once: true });
  try {
    if (typeof gl.makeXRCompatible !== "function") {
      throw new Error("Royal XR requires WebGL makeXRCompatible support");
    }
    await gl.makeXRCompatible();
    assertSetupActive();
    if (
      options.preferredFrameRate !== undefined
      && typeof session.updateTargetFrameRate === "function"
    ) {
      const frameRate = selectXrPreferredFrameRate(
        options.preferredFrameRate,
        session.supportedFrameRates,
      );
      if (frameRate !== undefined) {
        // Some runtimes settle this preference only after the first XR frame.
        // Setup must reach the layer and frame clock without waiting on it.
        try {
          void session.updateTargetFrameRate(frameRate).catch(() => undefined);
        } catch {
          // A preference cannot make an otherwise usable XR session fail.
        }
      }
    }
    const Layer = platform.layerConstructor();
    if (Layer === undefined) throw new Error("Royal XR requires XRWebGLLayer support");
    const layer = new Layer(session, gl, {
      antialias: options.webGlLayer?.antialias ?? false,
      ...(options.webGlLayer?.framebufferScaleFactor === undefined
        ? {}
        : { framebufferScaleFactor: options.webGlLayer.framebufferScaleFactor }),
    });
    await session.updateRenderState({
      baseLayer: layer,
      ...(options.depthRange === undefined
        ? {}
        : {
          depthFar: options.depthRange.far,
          depthNear: options.depthRange.near,
        }),
    });
    assertSetupActive();
    const referenceSpace = await firstReferenceSpace(
      session,
      options.referenceSpacePreference ?? DEFAULT_REFERENCE_SPACES,
    );
    assertSetupActive();
    const clock = root[rendererAcquireExternalClock]();
    const slots: MutableXrFrameSlot[] = [];
    const frameViews: SurfaceFrameView[] = [];
    const externalSize = { height: layer.framebufferHeight, width: layer.framebufferWidth };
    const externalFrame: ExternalSurfaceFrame = {
      framebuffer: layer.framebuffer,
      size: externalSize,
      views: frameViews,
    };
    let disposed = false;
    let frameIndex = 0;
    let unobserveRoot = (): void => undefined;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      let failure: unknown;
      try {
        session.removeEventListener("end", onEnd);
      } catch (error) {
        failure = error;
      }
      try {
        unobserveRoot();
      } catch (error) {
        failure ??= error;
      }
      try {
        clock.release();
      } catch (error) {
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
    };
    disposeAfterSetup = dispose;
    unobserveRoot = root.subscribeLifecycle(() => {
      if (root.getLifecycleSnapshot().phase !== "active") {
        try {
          dispose();
        } catch {
          // Root lifecycle remains authoritative even if browser cleanup fails.
        }
      }
    });
    if (root.getLifecycleSnapshot().phase !== "active") {
      dispose();
      throw new Error("Royal XR renderer root became unavailable during setup");
    }

    return {
      get disposed() { return disposed; },
      layer,
      referenceSpace,
      dispose,
      renderFrame: (frame) => {
        if (disposed || root.getLifecycleSnapshot().phase !== "active") return false;
        const pose = frame.getViewerPose(referenceSpace);
        if (pose === null || pose.views.length === 0) return false;
        requirePositiveInteger(layer.framebufferWidth, "Royal XR framebuffer width");
        requirePositiveInteger(layer.framebufferHeight, "Royal XR framebuffer height");
        externalSize.width = layer.framebufferWidth;
        externalSize.height = layer.framebufferHeight;
        frameViews.length = 0;
        for (let index = 0; index < pose.views.length; index += 1) {
          const source = pose.views[index]!;
          const sourceViewport = layer.getViewport(source);
          if (sourceViewport === null || sourceViewport === undefined) continue;
          let slot = slots[index];
          if (slot === undefined) {
            slot = createFrameSlot();
            slots[index] = slot;
          }
          copyViewMatrix(slot.projection, source.projectionMatrix, index, "projection");
          copyViewMatrix(slot.view, source.transform.inverse.matrix, index, "view");
          multiplyMat4Into(slot.viewProjection, slot.projection, slot.view);
          requirePositiveViewportInteger(sourceViewport.width, index, "width");
          requirePositiveViewportInteger(sourceViewport.height, index, "height");
          if (!Number.isSafeInteger(sourceViewport.x) || sourceViewport.x < 0
            || !Number.isSafeInteger(sourceViewport.y) || sourceViewport.y < 0
            || sourceViewport.x + sourceViewport.width > layer.framebufferWidth
            || sourceViewport.y + sourceViewport.height > layer.framebufferHeight) {
            throw new RangeError(`Royal XR views[${index}] viewport must fit the framebuffer`);
          }
          slot.viewport.x = sourceViewport.x;
          slot.viewport.y = sourceViewport.y;
          slot.viewport.width = sourceViewport.width;
          slot.viewport.height = sourceViewport.height;
          frameViews.push(slot.frameView);
        }
        if (frameViews.length === 0) return false;
        root[rendererSubmitExternalFrame](externalFrame);
        if (options.onFrameSnapshot !== undefined) {
          options.onFrameSnapshot({
            frameIndex,
            viewports: frameViews.map(({ viewport }) => ({ ...viewport })),
          });
        }
        frameIndex += 1;
        return true;
      },
    };
  } catch (error) {
    try {
      session.removeEventListener("end", onEnd);
    } catch {
      // Preserve the setup failure after every available cleanup attempt.
    }
    try {
      disposeAfterSetup?.();
    } catch {
      // Preserve the setup failure after every available cleanup attempt.
    }
    throw error;
  }
};

/** Creates a retained, allocation-free-by-default renderer for one WebXR session. */
export const createWebXrSessionRenderer = (
  root: RendererRoot,
  session: XrSession,
  options: XrSessionRendererOptions = {},
): Promise<XrSessionRenderer> =>
  createWebXrSessionRendererWithPlatform(root as XrRoot, session, options, defaultPlatform);
