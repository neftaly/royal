import {
  boxGeometry,
  directionalLight,
  linearRgbaFromSrgb,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
} from '@royal/react/scene';
import {
  Canvas,
  useCanvasElement,
  useCanvasRoot,
} from '@royal/react';
import {
  createXrSessionRenderer,
  createXrSessionStore,
  useXrSessionSelector,
  type XrFrame,
  type XrSession,
  type XrSessionRenderer,
  type XrSessionStore,
  type XrSessionStatus,
  type XrSessionVisibilityState,
} from '@royal/react/xr';
import { createElement, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { showcaseEnvironment, showcaseFillLight, showcaseKeyLight, showcasePass } from '../presentation';

const camera = perspectiveCamera({
  far: 80,
  fovY: 0.92,
  near: 0.05,
  position: [0, 1.55, 4.8],
  rotation: [-0.2, 0, 0],
});
const renderScene = scene({
  camera,
  environment: showcaseEnvironment,
  ...showcasePass,
  nodes: [
    directionalLight(showcaseKeyLight),
    directionalLight(showcaseFillLight),
    mesh({
      geometry: planeGeometry([7.2, 7.2]),
      material: standardMaterial({ color: linearRgbaFromSrgb([0.42, 0.39, 0.31, 1]) }),
      transform: { position: [0, -0.04, -1.2], rotation: [-Math.PI / 2, 0, 0] },
    }),
    mesh({
      geometry: boxGeometry([0.82, 0.82, 0.82]),
      material: standardMaterial({ color: linearRgbaFromSrgb([0.1, 0.72, 0.64, 1]) }),
      transform: { position: [-1.25, 0.52, -1.55], rotation: [0.08, 0.46, 0.02] },
    }),
    mesh({
      geometry: boxGeometry([1.12, 1.12, 1.12]),
      material: standardMaterial({ color: linearRgbaFromSrgb([0.9, 0.34, 0.2, 1]) }),
      transform: { position: [0.15, 0.74, -2.1], rotation: [0.28, -0.2, 0.1] },
    }),
    mesh({
      geometry: boxGeometry([0.72, 0.72, 0.72]),
      material: standardMaterial({ color: linearRgbaFromSrgb([0.54, 0.46, 0.9, 1]) }),
      transform: { position: [1.45, 0.44, -1.25], rotation: [-0.16, -0.66, 0.2] },
    }),
  ],
});

type BrowserXrSession = XrSession & {
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void): number;
};

type BrowserXrSessionInit = {
  readonly optionalFeatures?: readonly string[];
};

type BrowserXrSessionMode = 'immersive-ar' | 'immersive-vr';

type BrowserXrSystem = {
  isSessionSupported(mode: BrowserXrSessionMode): Promise<boolean>;
  requestSession(mode: BrowserXrSessionMode, options?: BrowserXrSessionInit): Promise<BrowserXrSession>;
};

type XrNavigator = Navigator & {
  readonly xr?: BrowserXrSystem;
};

const browserXrSessionModes: readonly BrowserXrSessionMode[] = ['immersive-vr'];

const immersiveSessionOptions: BrowserXrSessionInit = {
  optionalFeatures: ['bounded-floor', 'local-floor'],
};

const xrStatusLabel = (status: XrSessionStatus, error: string | null): string => {
  if (status === 'available') return 'ready';
  if (status === 'active') return 'immersive';
  if (status === 'blocked' || status === 'error') return error ?? status;
  return status;
};

const sessionVisibilityState = (session: BrowserXrSession): XrSessionVisibilityState =>
  session.visibilityState ?? 'visible';

const immersiveSessionAlreadyActive = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'InvalidStateError')
  || /already an active, immersive XRSession/iu.test(
    error instanceof Error ? error.message : String(error),
  );

const sessionRequestDenied = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'NotAllowedError';

const isBrowserXrSessionModeSupported = async (
  xr: BrowserXrSystem,
  mode: BrowserXrSessionMode,
): Promise<boolean> => {
  try {
    return await xr.isSessionSupported(mode);
  } catch {
    return false;
  }
};

const getPreferredBrowserXrSessionMode = async (
  xr: BrowserXrSystem,
): Promise<BrowserXrSessionMode | null> => {
  for (const mode of browserXrSessionModes) {
    if (await isBrowserXrSessionModeSupported(xr, mode)) return mode;
  }

  return null;
};

const XrSessionControl = (): ReactNode => {
  const canvas = useCanvasElement();
  const root = useCanvasRoot();
  const storeRef = useRef<XrSessionStore<BrowserXrSession> | undefined>(undefined);
  const rootRef = useRef(root);
  const frameCleanupRef = useRef<(() => void) | undefined>(undefined);
  if (storeRef.current === undefined) {
    storeRef.current = createXrSessionStore<BrowserXrSession>();
  }

  const store = storeRef.current;
  const active = useXrSessionSelector(store, (state) => state.active);
  const available = useXrSessionSelector(store, (state) => state.available);
  const error = useXrSessionSelector(store, (state) => state.error);
  const session = useXrSessionSelector(store, (state) => state.session);
  const status = useXrSessionSelector(store, (state) => state.status);
  const activateSession = useXrSessionSelector(store, (state) => state.activateSession);
  const beginSession = useXrSessionSelector(store, (state) => state.beginSession);
  const beginSessionEnd = useXrSessionSelector(store, (state) => state.beginSessionEnd);
  const blockSession = useXrSessionSelector(store, (state) => state.blockSession);
  const endSession = useXrSessionSelector(store, (state) => state.endSession);
  const failSession = useXrSessionSelector(store, (state) => state.failSession);
  const setAvailability = useXrSessionSelector(store, (state) => state.setAvailability);
  const setSessionVisibility = useXrSessionSelector(store, (state) => state.setSessionVisibility);
  const visibleStatus = xrStatusLabel(status, error);

  const cleanupFrameLoop = useCallback(() => {
    frameCleanupRef.current?.();
    frameCleanupRef.current = undefined;
  }, []);

  const stopActiveSession = useCallback(() => {
    cleanupFrameLoop();
    const currentSession = store.getState().session;
    if (currentSession === null) return;

    beginSessionEnd();
    void currentSession.end().catch(() => undefined);
  }, [beginSessionEnd, cleanupFrameLoop, store]);

  const startXrSession = useCallback(async (
    session: BrowserXrSession,
    mode: BrowserXrSessionMode,
  ) => {
    if (root === null || root.disposed || rootRef.current !== root) {
      await session.end().catch(() => undefined);
      return;
    }

    if (store.getState().session !== null) {
      await session.end().catch(() => undefined);
      return;
    }

    cleanupFrameLoop();
    beginSession(session, { mode });

    let renderer: XrSessionRenderer;
    try {
      renderer = await createXrSessionRenderer(root, session, {
        layerOptions: {
          antialias: true,
          framebufferScaleFactor: 0.85,
        },
        referenceSpacePreference: ['local-floor', 'local'],
      });
    } catch (error) {
      endSession();
      await session.end().catch(() => undefined);
      throw error;
    }
    if (root.disposed || rootRef.current !== root || store.getState().session !== session) {
      renderer.dispose();
      endSession();
      await session.end().catch(() => undefined);
      return;
    }

    let stopped = false;
    let frameHandle: number | undefined;
    const isCurrentFrameLoop = (): boolean =>
      !stopped &&
      !root.disposed &&
      rootRef.current === root &&
      store.getState().session === session;
    const cleanupCurrentFrameLoop = (): void => {
      if (stopped) return;
      stopped = true;
      if (frameHandle !== undefined) {
        session.cancelAnimationFrame(frameHandle);
        frameHandle = undefined;
      }
      session.removeEventListener('end', onEnd);
      session.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.dispose();
      if (frameCleanupRef.current === cleanupCurrentFrameLoop) {
        frameCleanupRef.current = undefined;
      }
    };
    const requestNextFrame = (): void => {
      if (!isCurrentFrameLoop()) return;
      frameHandle = session.requestAnimationFrame(onFrame);
    };
    const onFrame = (_time: number, frame: XrFrame): void => {
      frameHandle = undefined;
      if (!isCurrentFrameLoop()) {
        cleanupCurrentFrameLoop();
        if (store.getState().session === session) {
          endSession();
        }
        void session.end().catch(() => undefined);
        return;
      }

      try {
        renderer.renderFrame(frame);
        requestNextFrame();
      } catch (error) {
        cleanupCurrentFrameLoop();
        failSession(error);
        void session.end().catch(() => undefined);
      }
    };
    const onEnd = (): void => {
      cleanupCurrentFrameLoop();
      endSession();
    };
    const onVisibilityChange = (): void => {
      setSessionVisibility(sessionVisibilityState(session));
    };

    frameCleanupRef.current = cleanupCurrentFrameLoop;
    session.addEventListener('end', onEnd);
    session.addEventListener('visibilitychange', onVisibilityChange);
    activateSession(session, { mode, visibilityState: sessionVisibilityState(session) });
    requestNextFrame();
  }, [
    activateSession,
    beginSession,
    cleanupFrameLoop,
    endSession,
    failSession,
    root,
    setSessionVisibility,
    store,
  ]);

  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as XrNavigator).xr;
    if (!globalThis.isSecureContext || xr === undefined) {
      setAvailability(false);
      return;
    }

    void getPreferredBrowserXrSessionMode(xr)
      .then((mode) => {
        if (cancelled) return;
        setAvailability(mode !== null, { mode });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        failSession(error instanceof Error ? error : new Error('unavailable'), {
          available: false,
          mode: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [failSession, setAvailability]);

  useEffect(() => {
    rootRef.current = root;

    return () => {
      if (rootRef.current === root) {
        rootRef.current = null;
      }
      if (root !== null) {
        stopActiveSession();
      }
    };
  }, [root, stopActiveSession]);

  const enterXr = useCallback(async () => {
    const xr = (navigator as XrNavigator).xr;
    if (xr === undefined || canvas === null || root === null) return;

    const currentSession = store.getState().session;
    if (currentSession !== null) {
      beginSessionEnd();
      await currentSession.end();
      return;
    }

    cleanupFrameLoop();
    beginSession();
    const mode = await getPreferredBrowserXrSessionMode(xr);
    if (mode === null) {
      setAvailability(false);
      return;
    }

    setAvailability(true, { mode });
    const session = await xr.requestSession(mode, immersiveSessionOptions);
    await startXrSession(session, mode);
  }, [
    beginSession,
    beginSessionEnd,
    canvas,
    cleanupFrameLoop,
    root,
    setAvailability,
    startXrSession,
    store,
  ]);

  return createElement(
    'div',
    {
      className: 'xr-session-control',
      'data-royal-xr-active': active ? 'true' : 'false',
      'data-royal-xr-status': visibleStatus,
    },
    createElement(
      'button',
      {
        className: 'xr-session-button',
        disabled: (session === null && !available) || root === null || canvas === null,
        onClick: () => {
          void enterXr().catch((error: unknown) => {
            if (store.getState().session !== null) {
              cleanupFrameLoop();
              failSession(error);
            } else if (immersiveSessionAlreadyActive(error)) {
              blockSession('immersive-session-already-active', error, {
                available: true,
                mode: 'immersive-vr',
              });
            } else if (sessionRequestDenied(error)) {
              blockSession('session-request-denied', error, {
                available: true,
                mode: 'immersive-vr',
              });
            } else {
              failSession(error);
            }
          });
        },
        type: 'button',
      },
      session === null ? 'Enter XR' : 'Exit XR',
    ),
    createElement('span', { className: 'xr-session-status' }, visibleStatus),
  );
};

export const WebXrVr = (): ReactNode =>
  createElement(
    'div',
    { className: 'webxr-vr-example' },
    <Canvas
      aria-label="WebXR VR"
      className="webxr-vr-canvas"
      rendererOptions={exampleCanvasRendererOptions}
      scene={renderScene}
    >
      <BenchmarkRendererSnapshot />
      <XrSessionControl />
    </Canvas>,
  );
