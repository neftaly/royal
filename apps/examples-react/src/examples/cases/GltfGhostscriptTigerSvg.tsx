import {
  Canvas,
  OrbitControls,
  useGltfAssetStatus,
  useOrbitCamera,
  useOrbitCameraView,
} from '@royal/react';
import { gltf, scene } from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { automaticVirtualTextureExampleRendererOptions } from '../example-renderer-options';
import { colorAccuratePass } from '../presentation';

const tigerCardSrc = import.meta.env.BASE_URL + 'fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf';
const tigerCard = gltf({
  src: tigerCardSrc,
  transform: {
    position: [0, -0.01, 0],
    rotation: [0, -0.34, 0],
    scale: [1.85, 1.85, 1.85],
  },
});

const TigerBenchmark = (): ReactNode => {
  const status = useGltfAssetStatus(tigerCard.asset);
  return <BenchmarkRendererSnapshot asset={tigerCard.asset} status={status} />;
};

export const GltfGhostscriptTigerSvg = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 0.72, pitch: 0.08, target: [0, -0.01, 0], yaw: 0.22 },
    far: 10,
    near: 0.001,
  });
  const orbitView = useOrbitCameraView(orbit);
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    ...colorAccuratePass,
    nodes: [tigerCard],
  }), [orbit.camera]);
  return (
    <div
      className="svg-texture-example"
      data-svg-texture-mode="automatic-vt"
    >
      <Canvas
        aria-label="glTF core SVG Ghostscript tiger card fixture"
        data-vt-distance={orbitView.distance.toFixed(3)}
        rendererOptions={automaticVirtualTextureExampleRendererOptions}
        style={{ cursor: 'grab', touchAction: 'none' }}
        scene={renderScene}
      >
        <TigerBenchmark />
        <OrbitControls orbit={orbit} maxDistance={2.5} minDistance={0.02} />
      </Canvas>
    </div>
  );
};
