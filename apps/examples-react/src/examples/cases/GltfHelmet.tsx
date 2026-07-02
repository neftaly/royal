/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleRenderer } from '../rendering';

const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';

export const GltfHelmet = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 3.4,
    pitch: 0.05,
    target: [0, -0.08, 0],
  });

  return (
    <Canvas
      aria-label="glTF DamagedHelmet"
      renderer={exampleRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} clearColor={[0.04, 0.05, 0.06, 1]}>
          <directionalLight color={[1, 0.96, 0.9, 1]} direction={[0.4, -0.75, -1]} />
          <model
            src={helmetSrc}
            transform={{
              position: [0, -0.08, 0],
              rotation: [0, 0.34, 0],
              scale: [1.1, 1.1, 1.1],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
