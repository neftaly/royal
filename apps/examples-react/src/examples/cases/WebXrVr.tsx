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
  addEventListener(type: 'end', listener: () => void): void;
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
  removeEventListener(type: 'end', listener: () => void): void;
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

const browserXrSessionOfferModes: readonly BrowserXrSessionMode[] = [
  'immersive-ar',
  'immersive-vr',
];

const immersiveSessionOptions: BrowserXrSessionInit = {
  optionalFeatures: ['bounded-floor', 'local-floor'],
};

const xrStatusLabel = (status: XrSessionStatus, error: string | null): string => {
  if (status === 'available') return 'ready';
  if (status === 'active') return 'immersive';
  if (status === 'error') return error ?? 'error';
  return status;
};

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
  for (const mode of browserXrSessionOfferModes) {
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
  const status = useXrSessionSelector(store, (state) => state.status);
  const activateSession = useXrSessionSelector(store, (state) => state.activateSession);
  const beginSession = useXrSessionSelector(store, (state) => state.beginSession);
  const endSession = useXrSessionSelector(store, (state) => state.endSession);
  const failSession = useXrSessionSelector(store, (state) => state.failSession);
  const setAvailability = useXrSessionSelector(store, (state) => state.setAvailability);
  const visibleStatus = xrStatusLabel(status, error);

  const cleanupFrameLoop = useCallback(() => {
    frameCleanupRef.current?.();
    frameCleanupRef.current = undefined;
  }, []);

  const stopActiveSession = useCallback(() => {
    cleanupFrameLoop();
    const currentSession = store.getState().session;
    if (currentSession === null) return;

    endSession();
    void currentSession.end().catch(() => undefined);
  }, [cleanupFrameLoop, endSession, store]);

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

    frameCleanupRef.current = cleanupCurrentFrameLoop;
    session.addEventListener('end', onEnd);
    activateSession(session, { mode });
    requestNextFrame();
  }, [
    activateSession,
    beginSession,
    cleanupFrameLoop,
    endSession,
    failSession,
    root,
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
        disabled: !available || root === null || canvas === null,
        onClick: () => {
          void enterXr().catch((error: unknown) => {
            failSession(error);
          });
        },
        type: 'button',
      },
      active ? 'Exit XR' : 'Enter XR',
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
