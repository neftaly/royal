import {
  Canvas,
  createOrbitCameraController,
  createOrbitControls,
  createRendererRoot,
  GltfOrbitCameraFit,
  OrbitControls,
  resolveRendererRootOptions,
  useCanvasSize,
  useCanvasPick,
  useGltfAssetStatus,
  useInvalidate,
  usePrefilteredEnvironmentStatus,
  useRendererLifecycle,
  useRendererSnapshot,
  useTextureAssetStatus,
  useVirtualTextureAssetStatus,
  type RendererContextSnapshot,
  type GltfDocumentScene,
  type RendererHookOptions,
  type RendererResourceSnapshot,
  type RendererRoot,
  type ScenePointerEvent,
  type ScenePointerEvents,
} from '@royal/react';
import {
  clampOrbitCameraView,
  createGltfInstanceTransforms,
  gltf,
  gltfInstances,
  imageTexture,
  mesh,
  orbitPerspectiveCamera,
  prefilteredEnvironment,
  scene,
  standardMaterial,
  triangleGeometry,
  unlitMaterial,
  virtualTexture,
  type Scene,
  type WorldPosition3,
} from '@royal/react/scene';
import { useXrSession } from '@royal/react/xr';
import { inspectEtc2Ktx2 } from '@royal/renderer-webgl/ktx2';
import { useState, type ReactNode } from 'react';

const ktx2Inspection = inspectEtc2Ktx2 as (bytes: Uint8Array) => {
  readonly colorSpace: 'linear' | 'srgb';
  readonly height: number;
  readonly levelCount: number;
  readonly storageBytes: number;
  readonly width: number;
};
void ktx2Inspection;
type RootContext = RendererContextSnapshot;
type RootResources = RendererResourceSnapshot;
void (undefined as RootContext | undefined);
void (undefined as RootResources | undefined);

const orbit = createOrbitCameraController({
  far: 100,
  fovY: Math.PI / 4,
  initial: { distance: 3 },
  near: 0.1,
});
const rendererOptions = resolveRendererRootOptions({
  antialias: true,
  automaticVirtualTexturing: true,
});
const pureOrbitCamera = orbitPerspectiveCamera({
  view: clampOrbitCameraView({ distance: 0.01 }, { minDistance: 0.1 }),
});
void pureOrbitCamera;
// @ts-expect-error Orbit camera mutation belongs to the controller.
orbit.camera.commit();

const pickingGeometry = triangleGeometry({
  positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
});
const model = gltf({
  materialVariant: 'Ruby',
  pickingGeometry,
  pickingId: 'hero',
  sceneIndex: 2,
  src: '/model.gltf',
  version: 'model-sha256',
});
const albedo = imageTexture({ src: '/albedo.webp', version: 2 });
const authoredVirtualTexture = virtualTexture({
  manifestUri: '/terrain.vt.json',
  version: 'terrain-sha256',
});
const environment = prefilteredEnvironment({
  radianceScaleNits: 1,
  src: '/studio.royal.ktx',
  version: 'environment-sha256',
});
const transforms = createGltfInstanceTransforms({
  count: 2,
  logicalIds: ['tree-left', 'tree-right'],
  positions: [-1, 0, 0, 1, 0, 0],
});
transforms.positions[1] = 0.25;
transforms.commitPosition(0, 1);

const renderScene: Scene = scene({
  camera: orbit.camera,
  clearColor: [0.1, 0.15, 0.2, 1],
  environment,
  nodes: [
    model,
    gltfInstances({
      instances: transforms,
      pickingGeometry,
      pickingId: 'trees',
      sceneIndex: 1,
      src: '/tree.glb',
    }),
    mesh({
      geometry: pickingGeometry,
      material: standardMaterial({
        metallic: 0.2,
        roughness: 0.7,
        texture: albedo,
        tint: [0.9, 0.8, 0.7, 1],
      }),
    }),
    mesh({
      geometry: pickingGeometry,
      material: unlitMaterial({ texture: authoredVirtualTexture }),
    }),
  ],
});

const reportPick = (event: ScenePointerEvent): void => {
  const point: WorldPosition3 = event.hit.point;
  console.log(event.target.pickingId, point);
};
const scenePointerEvents: ScenePointerEvents = {
  hero: { onClick: reportPick },
};

const Status = ({ root }: { readonly root?: RendererRoot | null }): ReactNode => {
  const options = root === undefined ? undefined : { root };
  const size = useCanvasSize(options);
  const lifecycle = useRendererLifecycle(options);
  const rendererSnapshot = useRendererSnapshot(options);
  const modelStatus = useGltfAssetStatus(model.asset, options);
  const textureStatus = useTextureAssetStatus(albedo, options);
  const environmentStatus = usePrefilteredEnvironmentStatus(environment, options);
  const virtualTextureStatus = useVirtualTextureAssetStatus(authoredVirtualTexture, options);
  const renderer = lifecycle.status === 'failed' ? lifecycle.error : lifecycle.status;
  const variants = modelStatus.status === 'ready'
    || modelStatus.status === 'streaming'
    || modelStatus.status === 'degraded'
    ? modelStatus.variantNames.join(', ')
    : '';
  const documentScenes: readonly GltfDocumentScene[] = modelStatus.status === 'ready'
    || modelStatus.status === 'streaming'
    || modelStatus.status === 'degraded'
    ? modelStatus.scenes
    : [];
  return (
    <output>
      {renderer}: frame {rendererSnapshot?.frame ?? 0}; {size?.cssWidth ?? 0} by{' '}
      {size?.cssHeight ?? 0}; model {modelStatus.status} ({documentScenes.length} scenes,{' '}
      {variants}); texture{' '}
      {textureStatus.status}; environment {environmentStatus.status}; VT{' '}
      {virtualTextureStatus.status}
    </output>
  );
};

const ExternalControls = ({ root }: RendererHookOptions): ReactNode => {
  const invalidate = useInvalidate({ root });
  const pick = useCanvasPick({ root });
  return (
    <button
      onClick={() => {
        invalidate();
        console.log(pick({ clientX: 0, clientY: 0 }));
      }}
    >
      Pick and redraw
    </button>
  );
};

const XrControl = (): ReactNode => {
  const xr = useXrSession({
    mode: 'immersive-vr',
    session: { optionalFeatures: ['local-floor'] },
  });
  const live = xr.status === 'active' || xr.status === 'suspended';
  return (
    <button onClick={() => void (live ? xr.exit() : xr.enter())}>
      {live ? 'Exit XR' : `Enter XR (${xr.status})`}
    </button>
  );
};

export const App = (): ReactNode => {
  const [root, setRoot] = useState<RendererRoot | null>(null);
  return (
    <>
      <Canvas
        aria-label="Royal preview"
        data-testid="royal-canvas"
        rendererOptions={rendererOptions}
        rendererRef={setRoot}
        scene={renderScene}
        scenePointerEvents={scenePointerEvents}
      >
        <GltfOrbitCameraFit node={model} orbit={orbit} padding={1.1} />
        <OrbitControls minDistance={0.05} orbit={orbit} />
        <Status />
        <XrControl />
      </Canvas>
      <Status root={root} />
      <ExternalControls root={root} />
    </>
  );
};

/** Minimal non-React host proving the same scene and controls vocabulary. */
export const mountImperativeRoyal = (canvas: HTMLCanvasElement): (() => void) => {
  const root = createRendererRoot(canvas, rendererOptions);
  root.setSize({ cssHeight: 450, cssWidth: 800, pixelRatio: 1 });
  root.setScene(renderScene);
  const controls = createOrbitControls(canvas, {
    initialView: orbit.getView(),
    onChange: orbit.setView,
  });
  return () => {
    controls.dispose();
    root.dispose();
  };
};
