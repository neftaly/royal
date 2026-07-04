import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { studioEnvironment } from '@royal/renderer-core';
import { type ReactNode } from 'react';
import { exampleCanvasRootOptions } from '../example-root-options';

const lodSrc = import.meta.env.BASE_URL + 'fixtures/gltf-lod/royal-four-step-color-lod-cube.gltf';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.46,
  specularIntensity: 0.82,
});

export const GltfLod = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 4.6,
    pitch: 0.02,
  });

  return (
    <Canvas
      aria-label="glTF MSFT_lod"
      rootOptions={exampleCanvasRootOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment} toneMapping="none">
          <directionalLight color={[0.58, 0.56, 0.52, 1]} direction={[0.36, -0.72, -1]} />
          <gltf
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
        {...orbit.orbitControlsProps}
        maxDistance={28}
        minDistance={2.4}
        zoomSpeed={0.00075}
      />
    </Canvas>
  );
};
