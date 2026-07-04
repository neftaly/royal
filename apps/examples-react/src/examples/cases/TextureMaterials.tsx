import { boxGeometry } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  type ReactNode,
} from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const swatchGeometry = boxGeometry({ size: [1.72, 1.72, 1.72] });
const helmetAlbedoSrc = import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg';

export const TextureMaterials = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 5.2,
    pitch: 0.03,
    target: [0, 0.02, 0],
  });

  return (
    <Canvas
      aria-label="Texture materials"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera}>
          <directionalLight color={[0.96, 0.92, 0.84, 1]} direction={[-0.24, -0.42, -1]} />
          <mesh
            geometry={swatchGeometry}
            texture={helmetAlbedoSrc}
            transform={{
              position: [0, 0.02, 0],
              rotation: [0.24, 0.26, -0.04],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
