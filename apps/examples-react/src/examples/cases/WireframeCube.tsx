import {
  boxGeometry,
  type EulerRads,
  wireframeMaterial,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useFrame,
  useOrbitCamera,
} from '@royal/react';
import {
  useState,
  type ReactNode,
} from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: [0.38, 0.85, 0.95, 1],
});

const SpinningCube = (): ReactNode => {
  const [rotation, setRotation] = useState<EulerRads>([0.42, 0.7, 0.12]);

  useFrame(({ elapsed }) => {
    const spin = elapsed * 0.72;
    setRotation([0.42 + spin * 0.28, 0.7 + spin, 0.12]);
  });

  return (
    <mesh
      geometry={cubeGeometry}
      material={cubeMaterial}
      transform={{
        position: [0, 0, 0],
        rotation,
      }}
    />
  );
};

export const WireframeCube = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 6,
    pitch: 0.02,
  });

  return (
    <Canvas aria-label="Wireframe cube" renderer={exampleCanvasRenderer}>
      <scene>
        <pass camera={orbit.camera}>
          <SpinningCube />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
