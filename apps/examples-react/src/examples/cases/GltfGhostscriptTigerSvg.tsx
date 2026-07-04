import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRootOptions } from '../example-root-options';

const tigerCardSrc = import.meta.env.BASE_URL + 'fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf';

export const GltfGhostscriptTigerSvg = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 0.72,
    far: 10,
    near: 0.01,
    pitch: 0.08,
    target: [0, -0.01, 0],
    yaw: 0.22,
  });

  return (
    <Canvas
      aria-label="glTF GS_texture_svg Ghostscript tiger card fixture"
      rootOptions={exampleCanvasRootOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} toneMapping="none">
          <gltf
            src={tigerCardSrc}
            transform={{
              position: [0, -0.01, 0],
              rotation: [0, -0.34, 0],
              scale: [1.85, 1.85, 1.85],
            }}
          />
        </pass>
      </scene>
      <BenchmarkRendererSnapshot />
      <OrbitControls {...orbit.orbitControlsProps} maxDistance={2.5} minDistance={0.28} />
    </Canvas>
  );
};
