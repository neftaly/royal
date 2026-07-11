import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { gltf, scene } from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasContextOptions } from '../example-context-options';

const tigerCardSrc = import.meta.env.BASE_URL + 'fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf';

export const GltfGhostscriptTigerSvg = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 0.72, pitch: 0.08, target: [0, -0.01, 0], yaw: 0.22 },
    far: 10,
    near: 0.01,
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    toneMapping: 'linear-clamp',
    nodes: [gltf({
      src: tigerCardSrc,
      transform: {
        position: [0, -0.01, 0],
        rotation: [0, -0.34, 0],
        scale: [1.85, 1.85, 1.85],
      },
    })],
  }), [orbit.cameraResource]);

  return (
    <Canvas
      aria-label="glTF GS_texture_svg Ghostscript tiger card fixture"
      context={exampleCanvasContextOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
      scene={renderScene}
    >
      <BenchmarkRendererSnapshot />
      <OrbitControls orbit={orbit} maxDistance={2.5} minDistance={0.28} />
    </Canvas>
  );
};
