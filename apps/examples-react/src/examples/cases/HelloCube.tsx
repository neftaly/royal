import { boxGeometry } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const cubeGeometry = boxGeometry({ size: [1.5, 1.5, 1.5] });

export const HelloCube = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 5,
    pitch: 0.04,
  });

  return (
    <Canvas aria-label="Lit cube" renderer={exampleCanvasRenderer}>
      <scene>
        <pass camera={orbit.camera}>
          <directionalLight color={[1, 1, 1, 1]} direction={[0.8, -1.8, -1]} />
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
