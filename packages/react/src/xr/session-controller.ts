import type { RoyalRendererRoot } from "@royal/renderer-webgl";
import type {
  XrFrame,
  XrSession as RendererXrSession,
  XrSessionRenderer,
  XrSessionRendererOptions,
} from "@royal/renderer-webgl/xr";
import {
  initialXrSessionSnapshot,
  reduceXrSessionSnapshot,
  type XrSessionMode,
  type XrSessionSnapshot,
  type XrVisibilityState,
} from "./session-state";
import { recordWithAllowedFields } from "../validation";

export type XrSessionInit = Readonly<{
  optionalFeatures?: readonly string[];
  requiredFeatures?: readonly string[];
}>;

export interface BrowserXrSession extends RendererXrSession {
  readonly visibilityState?: XrVisibilityState;
  addEventListener(type: "end" | "visibilitychange", listener: EventListener): void;
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
  removeEventListener(type: "end" | "visibilitychange", listener: EventListener): void;
  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void): number;
}

export interface BrowserXrSystem {
  isSessionSupported(mode: XrSessionMode): Promise<boolean>;
  requestSession(mode: XrSessionMode, options?: XrSessionInit): Promise<BrowserXrSession>;
}

export type XrSessionControllerOptions = Readonly<{
  /** Browser session mode. Defaults to immersive-vr. */
  mode?: XrSessionMode;
  /** Renderer-owned layer, reference-space, and opt-in telemetry policy. */
  renderer?: XrSessionRendererOptions;
  /** Features forwarded verbatim to navigator.xr.requestSession. */
  session?: XrSessionInit;
}>;

export type XrSessionController = Readonly<{
  /** Releases Royal immediately and asks the browser to end any live session. */
  dispose(): void;
  /** Requests a session. Resolves true only after rendering becomes active. */
  enter(): Promise<boolean>;
  /** Requests browser termination; a rejected request restores the live session. */
  exit(): Promise<void>;
  getSnapshot(): XrSessionSnapshot;
  /** Re-runs browser capability detection while no session is owned. */
  refreshAvailability(): Promise<void>;
  subscribe(listener: () => void): () => void;
}>;

export type XrSessionControllerPlatform = Readonly<{
  createRenderer(
    root: RoyalRendererRoot,
    session: BrowserXrSession,
    options?: XrSessionRendererOptions,
  ): Promise<XrSessionRenderer>;
  xrSystem(): BrowserXrSystem | undefined;
}>;

const formatFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 400 ? message : `${message.slice(0, 399)}…`;
};

const defaultPlatform: XrSessionControllerPlatform = {
  createRenderer: async (root, session, options) => {
    const { createWebXrSessionRenderer } = await import("@royal/renderer-webgl/xr");
    return createWebXrSessionRenderer(root, session, options);
  },
  xrSystem: () => globalThis.isSecureContext === false
    ? undefined
    : (
      globalThis as typeof globalThis & {
        readonly navigator?: Navigator & { readonly xr?: BrowserXrSystem };
      }
    ).navigator?.xr,
};

const visibilityOf = (session: BrowserXrSession): XrVisibilityState => {
  const visibility = session.visibilityState ?? "visible";
  return visibility === "hidden" || visibility === "visible" || visibility === "visible-blurred"
    ? visibility
    : "visible";
};

const deniedSession = (error: unknown): boolean =>
  typeof DOMException === "function" && error instanceof DOMException && (
    error.name === "NotAllowedError"
    || error.name === "SecurityError"
    || error.name === "InvalidStateError"
  );

const MODES: readonly XrSessionMode[] = ["immersive-ar", "immersive-vr", "inline"];
const REFERENCE_SPACES = new Set(["viewer", "local", "local-floor", "bounded-floor", "unbounded"]);

const stringArray = (value: unknown, label: string): readonly string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new TypeError(`${label}[${index}] must be a non-empty string`);
    }
    return entry;
  });
};

const normalizeOptions = (
  options: XrSessionControllerOptions,
): Required<Pick<XrSessionControllerOptions, "mode">> & Omit<XrSessionControllerOptions, "mode"> => {
  recordWithAllowedFields(options, ["mode", "renderer", "session"], "XR session options", "option");
  const mode = options.mode ?? "immersive-vr";
  if (!MODES.includes(mode)) {
    throw new TypeError("XR session mode must be immersive-ar, immersive-vr, or inline");
  }
  let session: XrSessionInit | undefined;
  if (options.session !== undefined) {
    recordWithAllowedFields(
      options.session,
      ["optionalFeatures", "requiredFeatures"],
      "XR browser session options",
      "option",
    );
    const optionalFeatures = stringArray(
      options.session.optionalFeatures,
      "XR browser session optionalFeatures",
    );
    const requiredFeatures = stringArray(
      options.session.requiredFeatures,
      "XR browser session requiredFeatures",
    );
    session = {
      ...(optionalFeatures === undefined ? {} : { optionalFeatures }),
      ...(requiredFeatures === undefined ? {} : { requiredFeatures }),
    };
  }
  let renderer: XrSessionRendererOptions | undefined;
  if (options.renderer !== undefined) {
    recordWithAllowedFields(
      options.renderer,
      ["onFrameSnapshot", "referenceSpacePreference", "webGlLayer"],
      "XR renderer options",
      "option",
    );
    if (options.renderer.onFrameSnapshot !== undefined
      && typeof options.renderer.onFrameSnapshot !== "function") {
      throw new TypeError("XR renderer onFrameSnapshot must be a function");
    }
    const referenceSpacePreference = stringArray(
      options.renderer.referenceSpacePreference,
      "XR renderer referenceSpacePreference",
    );
    if (referenceSpacePreference?.length === 0) {
      throw new RangeError("XR renderer referenceSpacePreference must not be empty");
    }
    for (const referenceSpace of referenceSpacePreference ?? []) {
      if (!REFERENCE_SPACES.has(referenceSpace)) {
        throw new TypeError(`XR renderer has unsupported reference space ${referenceSpace}`);
      }
    }
    const webGlLayer = options.renderer.webGlLayer;
    if (webGlLayer !== undefined) {
      recordWithAllowedFields(
        webGlLayer,
        ["antialias", "framebufferScaleFactor"],
        "XR WebGL layer options",
        "option",
      );
      if (webGlLayer.antialias !== undefined && typeof webGlLayer.antialias !== "boolean") {
        throw new TypeError("XR WebGL layer antialias must be a boolean");
      }
      if (webGlLayer.framebufferScaleFactor !== undefined
        && (!Number.isFinite(webGlLayer.framebufferScaleFactor)
          || webGlLayer.framebufferScaleFactor <= 0)) {
        throw new RangeError("XR WebGL layer framebufferScaleFactor must be positive and finite");
      }
    }
    renderer = {
      ...(options.renderer.onFrameSnapshot === undefined
        ? {}
        : { onFrameSnapshot: options.renderer.onFrameSnapshot }),
      ...(referenceSpacePreference === undefined
        ? {}
        : {
          referenceSpacePreference: referenceSpacePreference as NonNullable<
            XrSessionRendererOptions["referenceSpacePreference"]
          >,
        }),
      ...(webGlLayer === undefined ? {} : { webGlLayer: { ...webGlLayer } }),
    };
  }
  return {
    mode,
    ...(renderer === undefined ? {} : { renderer }),
    ...(session === undefined ? {} : { session }),
  };
};

/** @internal Injectable imperative shell around the pure XR state transition. */
export const createXrSessionControllerWithPlatform = (
  root: RoyalRendererRoot,
  options: XrSessionControllerOptions,
  platform: XrSessionControllerPlatform,
): XrSessionController => {
  const normalized = normalizeOptions(options);
  const mode = normalized.mode;
  let snapshot = initialXrSessionSnapshot(mode);
  let ownedSession: BrowserXrSession | null = null;
  let renderer: XrSessionRenderer | null = null;
  let frameHandle: number | undefined;
  let endPromise: Promise<void> | undefined;
  let enterPromise: Promise<boolean> | undefined;
  let unobserveRoot = (): void => undefined;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (event: Parameters<typeof reduceXrSessionSnapshot>[1]): void => {
    const next = reduceXrSessionSnapshot(snapshot, event);
    if (next === snapshot) return;
    snapshot = next;
    const publishedListeners = Array.from(listeners);
    for (const listener of publishedListeners) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        // External-store observers cannot become XR lifecycle authority.
      }
    }
  };
  const requestSessionEnd = (session: BrowserXrSession): void => {
    try {
      void session.end().catch(() => undefined);
    } catch {
      // Terminal cleanup is already authoritative in Royal.
    }
  };
  const releaseRoyal = (): void => {
    if (frameHandle !== undefined && ownedSession !== null) {
      try {
        ownedSession.cancelAnimationFrame(frameHandle);
      } catch {
        // Continue releasing the renderer and lifecycle subscription.
      }
      frameHandle = undefined;
    }
    try {
      renderer?.dispose();
    } catch {
      // Continue releasing the remaining Royal owners.
    }
    renderer = null;
    try {
      unobserveRoot();
    } catch {
      // A broken observer release cannot retain the remaining owners.
    }
    unobserveRoot = () => undefined;
  };
  const releaseSessionListeners = (session: BrowserXrSession): void => {
    try {
      session.removeEventListener("end", onEnd);
    } catch {
      // Continue releasing the visibility listener.
    }
    try {
      session.removeEventListener("visibilitychange", onVisibility);
    } catch {
      // Both browser listeners are best-effort after Royal relinquishes ownership.
    }
  };
  const finishSession = (): void => {
    const session = ownedSession;
    if (session === null) return;
    releaseRoyal();
    releaseSessionListeners(session);
    ownedSession = null;
    endPromise = undefined;
    publish({ kind: "ended" });
  };
  const scheduleFrame = (): void => {
    const session = ownedSession;
    if (disposed || session === null || renderer === null) return;
    frameHandle = session.requestAnimationFrame(onFrame);
  };
  const onFrame = (_time: number, frame: XrFrame): void => {
    frameHandle = undefined;
    if (disposed || renderer === null || ownedSession === null) return;
    try {
      renderer.renderFrame(frame);
      scheduleFrame();
    } catch (error) {
      const session = ownedSession;
      releaseRoyal();
      releaseSessionListeners(session);
      ownedSession = null;
      publish({ blocked: false, error: formatFailure(error), kind: "fail" });
      requestSessionEnd(session);
    }
  };
  const onEnd: EventListener = () => finishSession();
  const onVisibility: EventListener = () => {
    if (ownedSession !== null) {
      publish({ kind: "visibility", visibilityState: visibilityOf(ownedSession) });
    }
  };

  const refreshAvailability = async (): Promise<void> => {
    if (disposed || ownedSession !== null) return;
    let system: BrowserXrSystem | undefined;
    try {
      system = platform.xrSystem();
    } catch {
      publish({ kind: "availability", supported: false });
      return;
    }
    if (system === undefined) {
      publish({ kind: "availability", supported: false });
      return;
    }
    try {
      publish({ kind: "availability", supported: await system.isSessionSupported(mode) });
    } catch {
      publish({ kind: "availability", supported: false });
    }
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const session = ownedSession;
      if (session !== null) {
        releaseRoyal();
        releaseSessionListeners(session);
        ownedSession = null;
        requestSessionEnd(session);
      }
      listeners.clear();
      publish({ kind: "dispose" });
    },
    enter: () => {
      if (enterPromise !== undefined) return enterPromise;
      const operation = (async (): Promise<boolean> => {
        if (disposed || ownedSession !== null) return false;
        if (snapshot.status === "checking" || snapshot.status === "unavailable") {
          await refreshAvailability();
        }
        const currentStatus: string = snapshot.status;
        if (currentStatus !== "available" && currentStatus !== "blocked"
          && currentStatus !== "error") return false;
        let system: BrowserXrSystem | undefined;
        try {
          system = platform.xrSystem();
        } catch (error) {
          publish({ blocked: false, error: formatFailure(error), kind: "fail" });
          return false;
        }
        if (system === undefined) {
          publish({ kind: "availability", supported: false });
          return false;
        }
        publish({ kind: "begin" });
        try {
          const session = await system.requestSession(mode, normalized.session);
          if (disposed) {
            requestSessionEnd(session);
            return false;
          }
          ownedSession = session;
          session.addEventListener("end", onEnd);
          session.addEventListener("visibilitychange", onVisibility);
          renderer = await platform.createRenderer(root, session, normalized.renderer);
          if (disposed || ownedSession !== session) {
            renderer.dispose();
            renderer = null;
            requestSessionEnd(session);
            return false;
          }
          publish({ kind: "activate", visibilityState: visibilityOf(session) });
          unobserveRoot = root.subscribeLifecycle(() => {
            if (root.getLifecycleSnapshot().phase === "active" || ownedSession !== session) return;
            releaseRoyal();
            releaseSessionListeners(session);
            ownedSession = null;
            publish({
              blocked: false,
              error: "Royal XR renderer root became unavailable",
              kind: "fail",
            });
            requestSessionEnd(session);
          });
          scheduleFrame();
          return true;
        } catch (error) {
          const session = ownedSession;
          if (session !== null) {
            releaseRoyal();
            releaseSessionListeners(session);
            ownedSession = null;
            requestSessionEnd(session);
          }
          publish({ blocked: deniedSession(error), error: formatFailure(error), kind: "fail" });
          return false;
        }
      })();
      enterPromise = operation;
      void operation.then(() => {
        if (enterPromise === operation) enterPromise = undefined;
      }, () => {
        if (enterPromise === operation) enterPromise = undefined;
      });
      return operation;
    },
    exit: () => {
      if (disposed || ownedSession === null) return Promise.resolve();
      if (endPromise !== undefined) return endPromise;
      const session = ownedSession;
      publish({ kind: "begin-end" });
      let requestedEnd: Promise<void>;
      try {
        requestedEnd = session.end();
      } catch (error) {
        publish({ error: formatFailure(error), kind: "end-failed" });
        return Promise.reject(error);
      }
      endPromise = requestedEnd.then(
        () => finishSession(),
        (error: unknown) => {
          endPromise = undefined;
          if (!disposed && ownedSession === session) {
            publish({ error: formatFailure(error), kind: "end-failed" });
          }
          throw error;
        },
      );
      return endPromise;
    },
    getSnapshot: () => snapshot,
    refreshAvailability,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const createXrSessionController = (
  root: RoyalRendererRoot,
  options: XrSessionControllerOptions = {},
): XrSessionController =>
  createXrSessionControllerWithPlatform(root, options, defaultPlatform);
