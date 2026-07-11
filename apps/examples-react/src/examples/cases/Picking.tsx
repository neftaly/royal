import {
  Canvas,
  OrbitControls,
  type CanvasInteractions,
  useOrbitCamera,
} from '@royal/react';
import {
  directionalLight,
  gltf,
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
import { exampleCanvasContextOptions } from '../example-context-options';
import { srgbColor } from '../color';
import {
  showcaseEnvironment,
  showcaseFillLight,
  showcaseKeyLight,
  showcasePass,
} from '../presentation';

const backplateGeometry = planeGeometry([4.4, 2.65]);
const backplateMaterial = unlitMaterial({ color: srgbColor([0.08, 0.1, 0.12, 1]) });
const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';

const createPickingScene = (
  camera: ReturnType<typeof useOrbitCamera>['cameraResource'],
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
    gltf({
      pickingId: 'helmet',
      src: helmetSrc,
      transform: {
        position: [0, -0.08, 0],
        rotation: [0, 0.34, 0],
        scale: [1.08, 1.08, 1.08],
      },
    }),
  ],
});

export const Picking = (): ReactNode => {
  const [hovered, setHovered] = useState(false);
  const [clicks, setClicks] = useState(0);
  const active = hovered || clicks % 2 === 1;
  const hoveredId = hovered ? 'helmet' : 'none';
  const readoutText = active ? `Helmet ${clicks}` : 'Helmet';
  const orbit = useOrbitCamera({
    initial: { distance: 3.5, pitch: 0.04, target: [0, -0.08, 0] },
  });
  const renderScene = useMemo(
    () => createPickingScene(orbit.cameraResource),
    [orbit.cameraResource],
  );
  const interactions = useMemo(() => ({
    helmet: {
      onClick: () => setClicks((count) => count + 1),
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
  }) satisfies CanvasInteractions, []);

  return (
    <Canvas
      aria-label="Pickable helmet"
      data-royal-picking-hovered-id={hoveredId}
      data-royal-picking-readout={`Target ${readoutText}`}
      interactions={interactions}
      context={exampleCanvasContextOptions}
      style={{ cursor: 'pointer', touchAction: 'none' }}
      scene={renderScene}
    >
      <BenchmarkRendererSnapshot />
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
