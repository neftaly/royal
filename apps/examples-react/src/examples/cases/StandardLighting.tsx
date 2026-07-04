import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { studioEnvironment } from '@royal/renderer-core';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.65,
  specularIntensity: 1.35,
});

export const StandardLighting = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 6.2,
    pitch: -0.08,
    target: [0, 0.05, 0],
  });

  return (
    <Canvas
      aria-label="Standard material lighting"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment}>
          <directionalLight color={[0.9, 0.86, 0.78, 1]} direction={[0.36, -0.72, -1]} />
          <mesh transform={{ position: [0, -0.78, -0.35], rotation: [-Math.PI / 2, 0, 0] }}>
            <planeGeometry size={[5.2, 3.2]} />
            <standardMaterial color={[0.16, 0.2, 0.22, 1]} />
          </mesh>
          <mesh transform={{ position: [-1.55, 0.05, 0], rotation: [0.38, 0.62, 0.08] }}>
            <boxGeometry size={[0.92, 0.92, 0.92]} />
            <standardMaterial color={[0.08, 0.74, 0.67, 1]} />
          </mesh>
          <mesh transform={{ position: [0, 0.05, 0], rotation: [0.28, -0.42, 0.22] }}>
            <boxGeometry size={[0.92, 0.92, 0.92]} />
            <standardMaterial color={[0.94, 0.34, 0.22, 1]} />
          </mesh>
          <mesh transform={{ position: [1.55, 0.05, 0], rotation: [0.12, -0.82, -0.08] }}>
            <boxGeometry size={[0.92, 0.92, 0.92]} />
            <standardMaterial color={[0.5, 0.44, 0.9, 1]} />
          </mesh>
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
