/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleRenderer } from '../rendering';

const lodSrc = import.meta.env.BASE_URL + 'lod-fixture/msft-lod.gltf';

export const GltfLod = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 4.6,
    pitch: 0.02,
  });

  return (
    <Canvas
      aria-label="glTF MSFT_lod"
      renderer={exampleRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} clearColor={[0.035, 0.042, 0.052, 1]}>
          <directionalLight color={[1.22, 1.16, 1.05, 1]} direction={[-0.42, -0.5, -1]} />
          <model
            src={lodSrc}
            transform={{
              rotation: [0.18, -0.28, 0],
              scale: [1.3, 1.3, 1.3],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
