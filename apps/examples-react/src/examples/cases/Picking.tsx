import {
  Canvas,
  OrbitControls,
  type ScenePointerEvents,
  useGltfAssetStatus,
  useOrbitCamera,
} from '@royal/react';
import {
  directionalLight,
  gltf,
  linearRgbaFromSrgb,
  mesh,
  planeGeometry,
  scene,
  unlitMaterial,
} from '@royal/react/scene';
import {
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import {
  showcaseEnvironment,
  showcaseFillLight,
  showcaseKeyLight,
  showcasePass,
} from '../presentation';

const backplateGeometry = planeGeometry([4.4, 2.65]);
const backplateMaterial = unlitMaterial({ color: linearRgbaFromSrgb([0.08, 0.1, 0.12, 1]) });
const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const helmetNode = gltf({
  pickingId: 'helmet',
  src: helmetSrc,
  transform: {
    position: [0, -0.08, 0],
    rotation: [0, 0.34, 0],
    scale: [1.08, 1.08, 1.08],
  },
});

const PickingBenchmarkSnapshot = (): ReactNode => {
  const status = useGltfAssetStatus(helmetNode.asset);
  return <BenchmarkRendererSnapshot asset={helmetNode.asset} status={status} />;
};

const createPickingScene = (
  camera: ReturnType<typeof useOrbitCamera>['camera'],
) => scene({
  camera,
  environment: showcaseEnvironment,
  ...showcasePass,
  nodes: [
    directionalLight(showcaseKeyLight),
    directionalLight(showcaseFillLight),
    mesh({
      geometry: backplateGeometry,
      material: backplateMaterial,
      transform: {
        position: [0, 0, -0.9],
        rotation: [0, 0, 0],
      },
    }),
    helmetNode,
  ],
});

export const Picking = (): ReactNode => {
  const [hovered, setHovered] = useState(false);
  const [clicks, setClicks] = useState(0);
  const active = hovered || clicks % 2 === 1;
  const hoveredId = hovered ? 'helmet' : 'none';
  const readoutText = hovered
    ? `Hovering helmet · ${clicks} ${clicks === 1 ? 'click' : 'clicks'}`
    : active
      ? `Helmet selected · ${clicks} ${clicks === 1 ? 'click' : 'clicks'}`
      : clicks === 0
        ? 'Move over the helmet, then click it'
        : `Helmet released · ${clicks} clicks`;
  const orbit = useOrbitCamera({
    initial: { distance: 3.5, pitch: 0.04, target: [0, -0.08, 0] },
  });
  const renderScene = useMemo(
    () => createPickingScene(orbit.camera),
    [orbit.camera],
  );
  const interactions = useMemo(() => ({
    helmet: {
      onClick: () => setClicks((count) => count + 1),
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
  }) satisfies ScenePointerEvents, []);

  return (
    <div className="picking-example">
      <Canvas
        aria-label="Pickable helmet"
        scenePointerEvents={interactions}
        rendererOptions={exampleCanvasRendererOptions}
        style={{ cursor: hovered ? 'pointer' : 'grab', touchAction: 'none' }}
        scene={renderScene}
      >
        <PickingBenchmarkSnapshot />
        <OrbitControls orbit={orbit} />
      </Canvas>
      <output
        aria-live="polite"
        className={`picking-readout${active ? ' picking-readout-active' : ''}`}
        data-royal-picking-hovered-id={hoveredId}
      >
        {readoutText}
      </output>
    </div>
  );
};
