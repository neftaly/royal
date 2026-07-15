import {
  boxGeometry,
  directionalLight,
  imageTexture,
  linearRgbaFromSrgb,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
  virtualTexture,
} from '@royal/react/scene';
import {
  Canvas,
  useCanvasElement,
  useCanvasRoot,
} from '@royal/react';
import {
  createXrSessionRuntime,
  createXrSessionStore,
  useXrSessionSelector,
  type XrSession,
  type XrSessionRuntime,
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
const virtualTextureFixtureRoot = import.meta.env.BASE_URL + 'fixtures/virtual-texture-stress/';
const generatedSvgFixtureRoot = import.meta.env.BASE_URL + 'fixtures/gltf-svg-texture/';
const virtualGroundMaterial = unlitMaterial({
  texture: virtualTexture({
    sampler: {
      magFilter: 'linear',
      minFilter: 'linear-mipmap-linear',
      wrapS: 'clamp-to-edge',
      wrapT: 'clamp-to-edge',
    },
    manifestUri: `${virtualTextureFixtureRoot}map.vt.json`,
  }),
});
const generatedSvgMaterial = unlitMaterial({
  texture: imageTexture(`${generatedSvgFixtureRoot}ghostscript-tiger.svg`),
});
const renderScene = scene({
  camera,
  environment: showcaseEnvironment,
  ...showcasePass,
  nodes: [
    directionalLight(showcaseKeyLight),
    directionalLight(showcaseFillLight),
    mesh({
      geometry: planeGeometry([20, 20]),
      material: virtualGroundMaterial,
      transform: { position: [0, -0.04, -4], rotation: [-Math.PI / 2, 0, 0] },
    }),
    mesh({
      geometry: planeGeometry([2.8, 2.8]),
      material: generatedSvgMaterial,
      transform: { position: [0, 1.6, -3.8] },
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

type BrowserXrSessionInit = {
  readonly optionalFeatures?: readonly string[];
};

type BrowserXrSessionMode = 'immersive-ar' | 'immersive-vr';

type BrowserXrSystem = {
  isSessionSupported(mode: BrowserXrSessionMode): Promise<boolean>;
  requestSession(mode: BrowserXrSessionMode, options?: BrowserXrSessionInit): Promise<XrSession>;
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
  const storeRef = useRef<XrSessionStore<XrSession> | undefined>(undefined);
  const rootRef = useRef(root);
  const runtimeRef = useRef<XrSessionRuntime | undefined>(undefined);
  const runtimeGenerationRef = useRef(0);
  if (storeRef.current === undefined) {
    storeRef.current = createXrSessionStore<XrSession>();
  }

  const store = storeRef.current;
  const available = useXrSessionSelector(store, (state) => state.available);
  const error = useXrSessionSelector(store, (state) => state.error);
  const session = useXrSessionSelector(store, (state) => state.session);
  const status = useXrSessionSelector(store, (state) => state.status);
  const active = status === 'active';
  const beginSession = useXrSessionSelector(store, (state) => state.beginSession);
  const beginSessionEnd = useXrSessionSelector(store, (state) => state.beginSessionEnd);
  const blockSession = useXrSessionSelector(store, (state) => state.blockSession);
  const endSession = useXrSessionSelector(store, (state) => state.endSession);
  const failSession = useXrSessionSelector(store, (state) => state.failSession);
  const failSessionEnd = useXrSessionSelector(store, (state) => state.failSessionEnd);
  const setAvailability = useXrSessionSelector(store, (state) => state.setAvailability);
  const visibleStatus = xrStatusLabel(status, error);

  const stopActiveSession = useCallback(() => {
    runtimeGenerationRef.current += 1;
    const runtime = runtimeRef.current;
    runtimeRef.current = undefined;
    if (runtime !== undefined) {
      runtime.dispose();
      return;
    }

    const currentSession = store.getState().session;
    if (currentSession === null) return;

    beginSessionEnd();
    void currentSession.end().then(
      () => endSession(),
      (endError: unknown) => failSessionEnd(endError),
    );
  }, [beginSessionEnd, endSession, failSessionEnd, store]);

  const startXrSession = useCallback(async (
    session: XrSession,
    mode: BrowserXrSessionMode,
  ) => {
    const generation = ++runtimeGenerationRef.current;
    if (root === null || root.disposed || rootRef.current !== root) {
      await session.end().catch(() => undefined);
      return;
    }

    if (store.getState().session !== null) {
      await session.end().catch(() => undefined);
      return;
    }

    const runtime = await createXrSessionRuntime(root, store, session, {
      mode,
      rendererOptions: {
        webGlLayer: {
          antialias: true,
          framebufferScaleFactor: 0.8,
        },
        referenceSpacePreference: ['local-floor', 'local'],
      },
    });
    if (generation !== runtimeGenerationRef.current || rootRef.current !== root) {
      runtime.dispose();
      return;
    }
    runtimeRef.current = runtime;
  }, [
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
      const runtime = runtimeRef.current;
      if (runtime !== undefined) {
        await runtime.end().catch(() => undefined);
        if (runtime.disposed && runtimeRef.current === runtime) {
          runtimeRef.current = undefined;
        }
      } else {
        beginSessionEnd();
        await currentSession.end().then(
          () => endSession(),
          (endError: unknown) => failSessionEnd(endError),
        );
      }
      return;
    }

    beginSession();
    const mode = await getPreferredBrowserXrSessionMode(xr);
    if (mode === null) {
      setAvailability(false);
      return;
    }

    beginSession(undefined, { mode });
    const session = await xr.requestSession(mode, immersiveSessionOptions);
    await startXrSession(session, mode);
  }, [
    beginSession,
    beginSessionEnd,
    canvas,
    endSession,
    failSessionEnd,
    root,
    setAvailability,
    startXrSession,
    store,
  ]);

  const acquiring = session === null && status === 'starting';
  const ending = status === 'ending';
  const buttonLabel = acquiring
    ? 'Entering XR…'
    : ending ? 'Exiting XR…' : session === null ? 'Enter XR' : 'Exit XR';

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
        disabled:
          acquiring
          || ending
          || (session === null && !available)
          || root === null
          || canvas === null,
        onClick: () => {
          void enterXr().catch((error: unknown) => {
            if (immersiveSessionAlreadyActive(error)) {
              blockSession('immersive-session-already-active', error, {
                mode: 'immersive-vr',
              });
            } else if (sessionRequestDenied(error)) {
              blockSession('session-request-denied', error, {
                mode: 'immersive-vr',
              });
            } else {
              failSession(error);
            }
          });
        },
        type: 'button',
      },
      buttonLabel,
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
