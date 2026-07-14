import type { RoyalRendererRoot, RoyalRendererRootLifecycleSnapshot } from "./root";
import {
  createXrSessionRenderer,
  type XrFrame,
  type XrSession,
  type XrSessionRenderer,
  type XrSessionRendererOptions,
} from "./xr-renderer";
import type { XrSessionMode, XrSessionStore } from "./xr-store";

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

const sessionVisibilityState = (session: XrSession) =>
  session.visibilityState ?? "visible";

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
  if (root.disposed) {
    throw new Error("Cannot start an XR session on a disposed Royal renderer root");
  }
  if (store.getState().session !== null) {
    throw new Error("Cannot start an XR session while another session is owned");
  }

  store.getState().beginSession(session, { mode: options.mode });

  let renderer: XrSessionRenderer;
  try {
    renderer = await createRenderer(root, session, options.rendererOptions);
  } catch (error) {
    if (store.getState().session === session) {
      store.getState().failSession(error);
    }
    void session.end().catch(() => undefined);
    throw error;
  }

  if (
    root.disposed
    || store.getState().session !== session
    || store.getState().status !== "starting"
  ) {
    renderer.dispose();
    if (store.getState().session === session) store.getState().endSession();
    await session.end().catch(() => undefined);
    throw new Error("XR session startup was interrupted before activation");
  }

  let disposed = false;
  let frameHandle: number | undefined;
  let endPromise: Promise<void> | undefined;
  let unobserveRoot: () => void = () => undefined;

  const ownsSession = (): boolean => store.getState().session === session;
  const cleanupRoyalResources = (): void => {
    if (disposed) return;
    disposed = true;
    if (frameHandle !== undefined) {
      session.cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    }
    session.removeEventListener("end", onEnd);
    session.removeEventListener("visibilitychange", onVisibilityChange);
    unobserveRoot();
    renderer.dispose();
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

  session.addEventListener("end", onEnd);
  session.addEventListener("visibilitychange", onVisibilityChange);
  store.getState().activateSession(session, {
    mode: options.mode,
    visibilityState: sessionVisibilityState(session),
  });
  unobserveRoot = root.observeLifecycle(onRootLifecycle);
  if (disposed) unobserveRoot();
  requestNextFrame();
  return runtime;
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
