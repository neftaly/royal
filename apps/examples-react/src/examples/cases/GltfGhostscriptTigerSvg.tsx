import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

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
      aria-label="glTF ROYAL_texture_svg Ghostscript tiger card fixture"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera}>
          <model
            src={tigerCardSrc}
            transform={{
              position: [0, -0.01, 0],
              rotation: [0, -0.34, 0],
              scale: [1.85, 1.85, 1.85],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} maxDistance={2.5} minDistance={0.28} />
    </Canvas>
  );
};
