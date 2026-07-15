import type { RoyalRendererRoot, RoyalRendererRootLifecycleSnapshot } from "./root";
import {
  createXrSessionRenderer,
  type XrFrame,
  type XrSession,
  type XrSessionRenderer,
  type XrSessionRendererOptions,
} from "./xr-renderer";
import { validateXrSessionRendererOptions } from "./xr-renderer-model";
import type { XrSessionStore } from "./xr-store";
import {
  isXrSessionMode,
  isXrSessionVisibilityState,
  type XrSessionMode,
} from "./xr-session-model";
import { recordWithAllowedFields } from "./validation";

const XR_RUNTIME_OPTION_FIELDS = ["mode", "rendererOptions"] as const;

export type XrSessionRuntimeOptions = {
  readonly mode: XrSessionMode;
  readonly rendererOptions?: XrSessionRendererOptions;
};

/** Owns one session's renderer, events, frame loop, and terminal cleanup. */
export interface XrSessionRuntime<Session extends XrSession = XrSession> {
  readonly disposed: boolean;
  readonly session: Session;
  /** Requests a browser session end while retaining rendering if the request rejects. */
  end(): Promise<void>;
  /** Immediately releases Royal resources and requests a browser session end. */
  dispose(): void;
}

type XrSessionRendererFactory<Session extends XrSession> = (
  root: RoyalRendererRoot,
  session: Session,
  options?: XrSessionRendererOptions,
) => Promise<XrSessionRenderer>;

type CapturedFailure = { readonly value: unknown };

const captureFailure = (
  failure: CapturedFailure | undefined,
  operation: () => void,
): CapturedFailure | undefined => {
  try {
    operation();
  } catch (error) {
    return failure ?? { value: error };
  }
  return failure;
};

const validateRuntimeOptions = (options: XrSessionRuntimeOptions): void => {
  recordWithAllowedFields(
    options,
    XR_RUNTIME_OPTION_FIELDS,
    "XR session runtime options",
    "option",
  );
  if (!isXrSessionMode(options.mode)) {
    throw new TypeError("XR session runtime mode must be immersive-ar, immersive-vr, or inline");
  }
  validateXrSessionRendererOptions(options.rendererOptions);
};

const sessionVisibilityState = (session: XrSession) => {
  const visibilityState = session.visibilityState ?? "visible";
  if (!isXrSessionVisibilityState(visibilityState)) {
    throw new TypeError("XR session visibilityState must be hidden, visible, or visible-blurred");
  }
  return visibilityState;
};

const rootLifecycleError = (
  snapshot: RoyalRendererRootLifecycleSnapshot,
): Error => new Error(
  snapshot.state === "failed"
    ? `XR renderer root failed: ${snapshot.error}`
    : `XR renderer root became ${snapshot.state}`,
);

/** @internal Testable runtime boundary with an injected renderer factory. */
export const createXrSessionRuntimeWithRenderer = async <Session extends XrSession>(
  root: RoyalRendererRoot,
  store: XrSessionStore<Session>,
  session: Session,
  options: XrSessionRuntimeOptions,
  createRenderer: XrSessionRendererFactory<Session>,
): Promise<XrSessionRuntime<Session>> => {
  validateRuntimeOptions(options);
  if (typeof createRenderer !== "function") {
    throw new TypeError("XR session runtime createRenderer must be a function");
  }
  const initialVisibilityState = sessionVisibilityState(session);
  if (root.disposed) {
    throw new Error("Cannot start an XR session on a disposed Royal renderer root");
  }
  if (store.getState().session !== null) {
    throw new Error("Cannot start an XR session while another session is owned");
  }

  const requestSessionEnd = (): void => {
    try {
      void session.end().catch(() => undefined);
    } catch {
      // Startup already has an authoritative failure; a broken end request cannot replace it.
    }
  };
  const failOwnedStartup = (error: unknown): void => {
    if (store.getState().session !== session) return;
    try {
      store.getState().failSession(error);
    } catch {
      // The transition commits before notifying subscribers; preserve the startup failure.
    }
  };

  try {
    store.getState().beginSession(session, { mode: options.mode });
  } catch (error) {
    failOwnedStartup(error);
    requestSessionEnd();
    throw error;
  }

  let renderer: XrSessionRenderer;
  try {
    renderer = await createRenderer(root, session, options.rendererOptions);
  } catch (error) {
    failOwnedStartup(error);
    requestSessionEnd();
    throw error;
  }

  if (
    root.disposed
    || store.getState().session !== session
    || store.getState().status !== "starting"
  ) {
    const error = new Error("XR session startup was interrupted before activation");
    try {
      renderer.dispose();
    } catch {
      // Preserve the interrupted-startup failure after attempting every owner cleanup.
    }
    if (store.getState().session === session) {
      try {
        store.getState().endSession();
      } catch {
        // The state transition is already committed before subscriber notification.
      }
    }
    try {
      await session.end();
    } catch {
      // The session is already unusable to this runtime.
    }
    throw error;
  }

  let disposed = false;
  let frameHandle: number | undefined;
  let endPromise: Promise<void> | undefined;
  let unobserveRoot: () => void = () => undefined;

  const ownsSession = (): boolean => store.getState().session === session;
  const cleanupRoyalResources = (): void => {
    if (disposed) return;
    disposed = true;
    let failure: CapturedFailure | undefined;
    if (frameHandle !== undefined) {
      const handle = frameHandle;
      frameHandle = undefined;
      failure = captureFailure(failure, () => session.cancelAnimationFrame(handle));
    }
    failure = captureFailure(failure, () => session.removeEventListener("end", onEnd));
    failure = captureFailure(
      failure,
      () => session.removeEventListener("visibilitychange", onVisibilityChange),
    );
    failure = captureFailure(failure, unobserveRoot);
    failure = captureFailure(failure, () => renderer.dispose());
    if (failure !== undefined) throw failure.value;
  };
  const finish = (error?: unknown): void => {
    cleanupRoyalResources();
    if (!ownsSession()) return;
    if (error === undefined) store.getState().endSession();
    else store.getState().failSession(error);
  };
  const requestNextFrame = (): void => {
    if (disposed || !ownsSession()) return;
    frameHandle = session.requestAnimationFrame(onFrame);
  };
  const onFrame = (_time: number, frame: XrFrame): void => {
    frameHandle = undefined;
    if (disposed) return;
    if (!ownsSession() || root.disposed) {
      finish();
      void session.end().catch(() => undefined);
      return;
    }

    try {
      renderer.renderFrame(frame);
      requestNextFrame();
    } catch (error) {
      finish(error);
      void session.end().catch(() => undefined);
    }
  };
  const onEnd = (): void => {
    finish();
  };
  const onVisibilityChange = (): void => {
    if (disposed || !ownsSession()) return;
    store.getState().setSessionVisibility(sessionVisibilityState(session));
  };
  const onRootLifecycle = (snapshot: RoyalRendererRootLifecycleSnapshot): void => {
    if (snapshot.state === "available" || disposed) return;
    finish(rootLifecycleError(snapshot));
    void session.end().catch(() => undefined);
  };

  const runtime: XrSessionRuntime<Session> = {
    get disposed() {
      return disposed;
    },
    session,
    dispose: () => {
      if (disposed) return;
      if (ownsSession()) store.getState().beginSessionEnd();
      cleanupRoyalResources();
      void session.end().then(
        () => {
          if (ownsSession()) store.getState().endSession();
        },
        (error: unknown) => {
          if (ownsSession()) store.getState().failSession(error);
        },
      );
    },
    end: () => {
      if (disposed) return Promise.resolve();
      if (endPromise !== undefined) return endPromise;
      if (ownsSession()) store.getState().beginSessionEnd();
      endPromise = session.end().then(
        () => {
          finish();
        },
        (error: unknown) => {
          endPromise = undefined;
          if (!disposed && ownsSession()) store.getState().failSessionEnd(error);
          throw error;
        },
      );
      return endPromise;
    },
  };

  try {
    session.addEventListener("end", onEnd);
    session.addEventListener("visibilitychange", onVisibilityChange);
    store.getState().activateSession(session, {
      mode: options.mode,
      visibilityState: initialVisibilityState,
    });
    unobserveRoot = root.observeLifecycle(onRootLifecycle);
    if (disposed) unobserveRoot();
    requestNextFrame();
    return runtime;
  } catch (error) {
    try {
      cleanupRoyalResources();
    } catch {
      // Preserve the setup failure after attempting every acquired Royal resource.
    }
    failOwnedStartup(error);
    requestSessionEnd();
    throw error;
  }
};

export const createXrSessionRuntime = async <Session extends XrSession>(
  root: RoyalRendererRoot,
  store: XrSessionStore<Session>,
  session: Session,
  options: XrSessionRuntimeOptions,
): Promise<XrSessionRuntime<Session>> =>
  createXrSessionRuntimeWithRenderer(
    root,
    store,
    session,
    options,
    createXrSessionRenderer,
  );
