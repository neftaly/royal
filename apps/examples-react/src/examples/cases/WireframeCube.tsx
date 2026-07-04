import {
  boxGeometry,
  type EulerRads,
  type RenderObjectHandle,
  wireframeMaterial,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useFrame,
  useOrbitCamera,
} from '@royal/react';
import {
  useRef,
  type ReactNode,
} from 'react';
import { exampleCanvasRootOptions } from '../example-root-options';

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: [0.38, 0.85, 0.95, 1],
});

const SpinningCube = (): ReactNode => {
  const meshRef = useRef<RenderObjectHandle | null>(null);

  useFrame(({ elapsedSeconds }) => {
    const handle = meshRef.current;
    if (handle === null) return;

    const spin = elapsedSeconds * 0.72;
    const rotation: EulerRads = [0.42 + spin * 0.28, 0.7 + spin, 0.12];
    handle.setTransform({ rotation });
  });

  return (
    <mesh
      ref={meshRef}
      geometry={cubeGeometry}
      material={cubeMaterial}
      transform={{
        position: [0, 0, 0],
        rotation: [0.42, 0.7, 0.12],
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
    <Canvas aria-label="Wireframe cube" rootOptions={exampleCanvasRootOptions}>
      <scene>
        <pass camera={orbit.camera}>
          <SpinningCube />
        </pass>
      </scene>
      <OrbitControls {...orbit.orbitControlsProps} />
    </Canvas>
  );
};
