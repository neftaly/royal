import { boxGeometry, studioEnvironment } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const cubeGeometry = boxGeometry({ size: [1.5, 1.5, 1.5] });
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.65,
  specularIntensity: 1.35,
});

export const HelloCube = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 5,
    pitch: 0.04,
  });

  return (
    <Canvas aria-label="Lit cube" renderer={exampleCanvasRenderer}>
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment}>
          <directionalLight color={[0.9, 0.86, 0.78, 1]} direction={[0.36, -0.72, -1]} />
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
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
