import {
  Canvas,
  OrbitControls,
  useFrameIndex,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const MovingLight = (): ReactNode => {
  const frame = useFrameIndex();
  const sweep = frame * 0.018;

  return (
    <directionalLight
      color={[0.92, 0.88, 0.8, 1]}
      direction={[
        Math.cos(sweep) * 0.72,
        -0.82,
        -0.48 + Math.sin(sweep) * 0.64,
      ]}
    />
  );
};

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
        <pass camera={orbit.camera}>
          <MovingLight />
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
