import { perspectiveCamera } from '@royal/renderer-core';
import {
  Canvas,
  useCanvasElement,
  useCanvasRoot,
} from '@royal/react';
import {
  createXrSessionRenderer,
  createXrSessionStore,
  useXrSessionStore,
  type XrFrame,
  type XrSession,
  type XrSessionRenderer,
  type XrSessionStore,
  type XrSessionStatus,
} from '@royal/react/xr';
import { createElement, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const camera = perspectiveCamera({
  far: 80,
  fovY: 0.92,
  near: 0.05,
  position: [0, 1.55, 4.8],
  rotation: [-0.2, 0, 0],
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

type BrowserXrSessionOfferResult = BrowserXrSession | null | undefined;

type BrowserXrSystem = {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>;
  offerSession?(
    mode: 'immersive-vr',
    options?: BrowserXrSessionInit,
  ): BrowserXrSessionOfferResult | Promise<BrowserXrSessionOfferResult>;
  requestSession(mode: 'immersive-vr', options?: BrowserXrSessionInit): Promise<BrowserXrSession>;
};

type XrNavigator = Navigator & {
  readonly xr?: BrowserXrSystem;
};

type BrowserXrSessionOfferGlobal = typeof globalThis & {
  __royalBrowserXrSessionOfferCache?: WeakMap<
    object,
    Promise<BrowserXrSessionOfferResult>
  >;
};

const immersiveVrSessionOptions: BrowserXrSessionInit = {
  optionalFeatures: ['bounded-floor', 'local-floor'],
};

const xrStatusLabel = (status: XrSessionStatus, error: string | null): string => {
  if (status === 'available') return 'ready';
  if (status === 'active') return 'immersive';
  if (status === 'error') return error ?? 'error';
  return status;
};

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUnsupportedXrOfferError = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotSupportedError' || error.name === 'SecurityError');

const getBrowserXrSessionOfferCache = (): WeakMap<
  object,
  Promise<BrowserXrSessionOfferResult>
> => {
  const globalScope = globalThis as BrowserXrSessionOfferGlobal;
  globalScope.__royalBrowserXrSessionOfferCache ??= new WeakMap();

  return globalScope.__royalBrowserXrSessionOfferCache;
};

const getBrowserXrSessionOffer = (
  xr: BrowserXrSystem & Required<Pick<BrowserXrSystem, 'offerSession'>>,
): Promise<BrowserXrSessionOfferResult> => {
  const cache = getBrowserXrSessionOfferCache();
  const cachedOffer = cache.get(xr);
  if (cachedOffer !== undefined) return cachedOffer;

  let offer: Promise<BrowserXrSessionOfferResult>;
  try {
    offer = Promise.resolve(xr.offerSession('immersive-vr', immersiveVrSessionOptions));
  } catch (error) {
    offer = Promise.reject(error);
  }
  cache.set(xr, offer);

  return offer;
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
  const active = useXrSessionStore(store, (state) => state.active);
  const available = useXrSessionStore(store, (state) => state.available);
  const error = useXrSessionStore(store, (state) => state.error);
  const offerStatus = useXrSessionStore(store, (state) => state.offerStatus);
  const setOfferStatus = useXrSessionStore(store, (state) => state.setOfferStatus);
  const status = useXrSessionStore(store, (state) => state.status);
  const activateSession = useXrSessionStore(store, (state) => state.activateSession);
  const beginSession = useXrSessionStore(store, (state) => state.beginSession);
  const endSession = useXrSessionStore(store, (state) => state.endSession);
  const failSession = useXrSessionStore(store, (state) => state.failSession);
  const recordFrame = useXrSessionStore(store, (state) => state.recordFrame);
  const setAvailability = useXrSessionStore(store, (state) => state.setAvailability);
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

  const startXrSession = useCallback(async (session: BrowserXrSession) => {
    if (root === null || root.disposed || rootRef.current !== root) {
      await session.end().catch(() => undefined);
      return;
    }

    if (store.getState().session !== null) {
      await session.end().catch(() => undefined);
      return;
    }

    cleanupFrameLoop();
    beginSession(session, { mode: 'immersive-vr' });

    let renderer: XrSessionRenderer;
    try {
      renderer = await createXrSessionRenderer(root, session, {
        layerOptions: {
          antialias: true,
          framebufferScaleFactor: 0.85,
        },
        onFrameSnapshot: recordFrame,
        referenceSpaceTypes: ['local-floor', 'local'],
      });
    } catch (error) {
      endSession();
      await session.end().catch(() => undefined);
      throw error;
    }
    if (root.disposed || rootRef.current !== root || store.getState().session !== session) {
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

      renderer.renderFrame(frame);
      requestNextFrame();
    };
    const onEnd = (): void => {
      cleanupCurrentFrameLoop();
      endSession();
    };

    frameCleanupRef.current = cleanupCurrentFrameLoop;
    session.addEventListener('end', onEnd);
    activateSession(session, { mode: 'immersive-vr' });
    requestNextFrame();
  }, [
    activateSession,
    beginSession,
    cleanupFrameLoop,
    endSession,
    recordFrame,
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

    void xr.isSessionSupported('immersive-vr')
      .then((supported) => {
        if (cancelled) return;
        setAvailability(supported);
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

  useEffect(() => {
    const xr = (navigator as XrNavigator).xr;
    if (!globalThis.isSecureContext || xr === undefined) {
      setOfferStatus('unsupported');
      return;
    }
    if (canvas === null || root === null) return;

    const { offerStatus: currentOfferStatus } = store.getState();
    if (currentOfferStatus !== 'idle') return;
    if (typeof xr.offerSession !== 'function') {
      setOfferStatus('unsupported');
      return;
    }

    let cancelled = false;
    setAvailability(true, { mode: 'immersive-vr', status: 'available' });
    setOfferStatus('pending');

    void getBrowserXrSessionOffer(
      xr as BrowserXrSystem & Required<Pick<BrowserXrSystem, 'offerSession'>>,
    )
      .then(async (session) => {
        if (cancelled) return;
        if (session === null || session === undefined) {
          setOfferStatus('offered');
          return;
        }

        setOfferStatus('accepted');
        beginSession();
        try {
          await startXrSession(session);
        } catch (error) {
          if (cancelled) return;
          setOfferStatus('error', errorMessageFromUnknown(error));
          failSession(error);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isUnsupportedXrOfferError(error)) {
          setOfferStatus('unsupported');
          return;
        }

        setOfferStatus('error', errorMessageFromUnknown(error));
      });

    return () => {
      cancelled = true;
    };
  }, [beginSession, canvas, failSession, root, setAvailability, setOfferStatus, startXrSession, store]);

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
    const session = await xr.requestSession('immersive-vr', immersiveVrSessionOptions);
    await startXrSession(session);
  }, [
    beginSession,
    canvas,
    cleanupFrameLoop,
    root,
    startXrSession,
    store,
  ]);

  return createElement(
    'div',
    {
      className: 'xr-session-control',
      'data-royal-xr-active': active ? 'true' : 'false',
      'data-royal-xr-offer-status': offerStatus,
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
      renderer={exampleCanvasRenderer}
    >
      <scene>
        <pass camera={camera}>
          <directionalLight color={[1.1, 1.04, 0.94, 1]} direction={[0.42, -0.72, -0.56]} />
          <mesh transform={{ position: [0, -0.04, -1.2], rotation: [-Math.PI / 2, 0, 0] }}>
            <planeGeometry size={[7.2, 7.2]} />
            <standardMaterial color={[0.42, 0.39, 0.31, 1]} />
          </mesh>
          <mesh transform={{ position: [-1.25, 0.52, -1.55], rotation: [0.08, 0.46, 0.02] }}>
            <boxGeometry size={[0.82, 0.82, 0.82]} />
            <standardMaterial color={[0.1, 0.72, 0.64, 1]} />
          </mesh>
          <mesh transform={{ position: [0.15, 0.74, -2.1], rotation: [0.28, -0.2, 0.1] }}>
            <boxGeometry size={[1.12, 1.12, 1.12]} />
            <standardMaterial color={[0.9, 0.34, 0.2, 1]} />
          </mesh>
          <mesh transform={{ position: [1.45, 0.44, -1.25], rotation: [-0.16, -0.66, 0.2] }}>
            <boxGeometry size={[0.72, 0.72, 0.72]} />
            <standardMaterial color={[0.54, 0.46, 0.9, 1]} />
          </mesh>
        </pass>
      </scene>
      <XrSessionControl />
    </Canvas>,
  );
