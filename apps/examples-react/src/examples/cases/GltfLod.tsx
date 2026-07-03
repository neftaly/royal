import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const lodSrc = import.meta.env.BASE_URL + 'fixtures/gltf-lod/royal-four-step-color-lod-cube.gltf';

export const GltfLod = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 4.6,
    pitch: 0.02,
  });

  return (
    <Canvas
      aria-label="glTF MSFT_lod"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera}>
          <directionalLight color={[1.22, 1.16, 1.05, 1]} direction={[-0.42, -0.5, -1]} />
          <model
            src={lodSrc}
            transform={{
              position: [0, 0, 0],
              rotation: [0.18, -0.28, 0],
              scale: [1.3, 1.3, 1.3],
            }}
          />
        </pass>
      </scene>
      <OrbitControls
        {...orbit.controls}
        maxDistance={28}
        minDistance={2.4}
        zoomSpeed={0.00075}
      />
    </Canvas>
  );
};
