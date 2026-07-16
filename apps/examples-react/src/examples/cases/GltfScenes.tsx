import {
  Canvas,
  OrbitControls,
  useGltfAssetStatus,
  useOrbitCamera,
  useRendererLifecycle,
  type OrbitCameraViewOptions,
} from '@royal/react';
import { directionalLight, gltf, scene, type Transform } from '@royal/react/scene';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import {
  interactiveCanvasStyle,
  materialEnvironment,
  materialFillLight,
  materialKeyLight,
  materialPass,
} from '../presentation';

type SceneShowcaseEntry = {
  readonly bytes: number;
  readonly camera: OrbitCameraViewOptions;
  readonly credit: string;
  readonly description: string;
  readonly far: number;
  readonly id: string;
  readonly maxDistance: number;
  readonly minDistance: number;
  readonly near: number;
  readonly sourceUrl: string;
  readonly src: string;
  readonly title: string;
  readonly transform?: Transform;
};

const fixtureRoot = import.meta.env.BASE_URL + 'fixtures/scenes/';
const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const upstreamRoot = 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf/Models/';
const sceneShowcaseRendererOptions = {
  ...exampleCanvasRendererOptions,
  automaticVirtualTextures: false,
} as const;

const sceneEntries = [
  {
    bytes: 52_686_624,
    camera: { distance: 9.5, pitch: 0.28, target: [-0.48, 3.2, -0.31], yaw: -1.57 },
    credit: 'Crytek · Frank Meinl',
    description: 'Architectural core-glTF scene with 103 primitives, 25 materials, and 69 textures.',
    far: 160,
    id: 'sponza',
    maxDistance: 80,
    minDistance: 0.25,
    near: 0.025,
    sourceUrl: upstreamRoot + 'Sponza',
    src: fixtureRoot + 'Sponza/glTF/Sponza.gltf',
    title: 'Sponza',
  },
  {
    bytes: 42_977_928,
    camera: { distance: 1.12, pitch: 0.52, target: [0, 0.055, 0], yaw: 0.68 },
    credit: 'MaterialX Project · Ed Mackey',
    description: 'Authored chess composition using transmission, volume, and a dense PBR texture set.',
    far: 20,
    id: 'a-beautiful-game',
    maxDistance: 4,
    minDistance: 0.08,
    near: 0.005,
    sourceUrl: upstreamRoot + 'ABeautifulGame',
    src: fixtureRoot + 'ABeautifulGame/glTF-Binary/ABeautifulGame.glb',
    title: 'A Beautiful Game',
  },
  {
    bytes: 3_085_416,
    camera: { distance: 205, pitch: 0.34, target: [0, 24, 1.43], yaw: 0.66 },
    credit: '3DRT',
    description: 'Compact city scene with 234 nodes and 167 materials; its authored animation is shown paused.',
    far: 1_200,
    id: 'virtual-city',
    maxDistance: 600,
    minDistance: 8,
    near: 0.2,
    sourceUrl: upstreamRoot + 'VirtualCity',
    src: fixtureRoot + 'VirtualCity/glTF-Binary/VirtualCity.glb',
    title: 'Virtual City',
  },
  {
    bytes: 3_776_595,
    camera: { distance: 3.4, pitch: 0.05, target: [0, -0.08, 0], yaw: 0 },
    credit: 'theblueturtle_ · ctxwing',
    description: 'The compact PBR baseline used by Royal for ordinary glTF loading and material fidelity.',
    far: 100,
    id: 'damaged-helmet',
    maxDistance: 12,
    minDistance: 0.1,
    near: 0.01,
    sourceUrl: upstreamRoot + 'DamagedHelmet',
    src: helmetSrc,
    title: 'Damaged Helmet',
    transform: {
      position: [0, -0.08, 0],
      rotation: [0, 0.34, 0],
      scale: [1.1, 1.1, 1.1],
    },
  },
] as const satisfies readonly SceneShowcaseEntry[];

type SceneId = typeof sceneEntries[number]['id'];
const defaultSceneId: SceneId = sceneEntries[0].id;
const defaultScene: SceneShowcaseEntry = sceneEntries[0];
const sceneById: ReadonlyMap<string, SceneShowcaseEntry> = new Map(
  sceneEntries.map((entry) => [entry.id, entry]),
);

const sceneIdFromLocation = (): SceneId => {
  const candidate = new URLSearchParams(globalThis.location?.search ?? '').get('scene');
  return sceneById.has(candidate ?? '') ? candidate as SceneId : defaultSceneId;
};

const writeSceneId = (id: SceneId): void => {
  const url = new URL(globalThis.location.href);
  url.searchParams.set('scene', id);
  globalThis.history.pushState(null, '', url);
};

const SceneLoadStatus = ({ src }: { readonly src: string }): ReactNode => {
  const asset = useGltfAssetStatus(src);
  const lifecycle = useRendererLifecycle();
  const assetLabel = asset.state === 'error' ? `error: ${asset.error}` : asset.state;
  const rendererLabel = lifecycle.state === 'failed' ? `failed: ${lifecycle.error}` : lifecycle.state;
  return (
    <output aria-live="polite" className="gltf-scenes-load-status">
      Renderer: {rendererLabel}; asset: {assetLabel} · drag to orbit · wheel/pinch to zoom
    </output>
  );
};

export const GltfScenes = (): ReactNode => {
  const [sceneId, setSceneId] = useState(sceneIdFromLocation);
  const entry = sceneById.get(sceneId) ?? defaultScene;
  const orbit = useOrbitCamera({
    far: entry.far,
    initial: entry.camera,
    near: entry.near,
  });

  useEffect(() => {
    const syncFromHistory = (): void => setSceneId(sceneIdFromLocation());
    globalThis.addEventListener('popstate', syncFromHistory);
    return () => globalThis.removeEventListener('popstate', syncFromHistory);
  }, []);
  useLayoutEffect(() => orbit.setView(entry.camera), [entry, orbit]);

  const selectScene = useCallback((nextId: SceneId): void => {
    writeSceneId(nextId);
    setSceneId(nextId);
  }, []);
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: materialEnvironment,
    ...materialPass,
    nodes: [
      directionalLight(materialKeyLight),
      directionalLight(materialFillLight),
      gltf({
        src: entry.src,
        ...(entry.transform === undefined ? {} : { transform: entry.transform }),
      }),
    ],
  }), [entry.src, entry.transform, orbit.cameraResource]);

  return (
    <div className="gltf-scenes" data-scene-id={entry.id}>
      <div className="gltf-scenes-toolbar">
        <div className="gltf-scenes-controls">
          <label>
            Scene
            <select
              value={entry.id}
              onChange={(event) => selectScene(event.currentTarget.value as SceneId)}
            >
              {sceneEntries.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => orbit.setView(entry.camera)}>Reset view</button>
        </div>
        <div className="gltf-scenes-summary">
          <strong>{entry.title}</strong>
          <span>{entry.description}</span>
        </div>
        <div className="gltf-scenes-metadata">
          <span>{(entry.bytes / 1024 / 1024).toFixed(1)} MiB</span>
          <span>{entry.credit}</span>
          <a href={entry.sourceUrl} rel="noreferrer" target="_blank">Khronos source</a>
        </div>
      </div>
      <div className="gltf-scenes-canvas">
        <Canvas
          aria-label={`glTF scene showcase: ${entry.title}`}
          rendererOptions={sceneShowcaseRendererOptions}
          scene={renderScene}
          style={interactiveCanvasStyle}
        >
          <BenchmarkRendererSnapshot />
          <SceneLoadStatus src={entry.src} />
          <OrbitControls
            enablePan
            maxDistance={entry.maxDistance}
            minDistance={entry.minDistance}
            orbit={orbit}
          />
        </Canvas>
      </div>
    </div>
  );
};
