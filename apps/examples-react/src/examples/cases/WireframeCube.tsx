import {
  boxGeometry,
  wireframeMaterial,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useFrame,
  useOrbitCamera,
  type RenderObjectHandle,
} from '@royal/react';
import {
  useRef,
  type ReactNode,
} from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: [0.38, 0.85, 0.95, 1],
});

const SpinningCube = (): ReactNode => {
  const target = useRef<RenderObjectHandle | null>(null);

  useFrame(({ elapsed }) => {
    const spin = elapsed * 0.72;
    target.current?.rotation.set(0.42 + spin * 0.28, 0.7 + spin, 0.12);
  });

  return (
    <mesh
      ref={target}
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
