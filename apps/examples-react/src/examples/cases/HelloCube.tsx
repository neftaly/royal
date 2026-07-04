import { boxGeometry, studioEnvironment } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRootOptions } from '../example-root-options';

const cubeGeometry = boxGeometry({ size: [1.5, 1.5, 1.5] });
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.46,
  specularIntensity: 0.82,
});

export const HelloCube = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 5,
    pitch: 0.04,
  });

  return (
    <Canvas aria-label="Lit cube" rootOptions={exampleCanvasRootOptions}>
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment} toneMapping="none">
          <directionalLight color={[0.58, 0.56, 0.52, 1]} direction={[0.36, -0.72, -1]} />
          <mesh
            color={[0.9, 0.2, 0.16, 1]}
            geometry={cubeGeometry}
            transform={{
              position: [0, 0, 0],
              rotation: [0.45, 0.7, 0.05],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.orbitControlsProps} />
    </Canvas>
  );
};
