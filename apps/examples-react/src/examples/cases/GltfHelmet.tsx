import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { studioEnvironment } from '@royal/renderer-core';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.65,
  specularIntensity: 1.35,
});

export const GltfHelmet = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 3.4,
    pitch: 0.05,
    target: [0, -0.08, 0],
  });

  return (
    <Canvas
      aria-label="glTF DamagedHelmet PBR material"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment}>
          <directionalLight color={[0.9, 0.86, 0.78, 1]} direction={[0.36, -0.72, -1]} />
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
