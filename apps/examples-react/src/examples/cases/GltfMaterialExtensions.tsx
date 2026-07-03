import {
  Canvas,
  OrbitControls,
  useFrameIndex,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const iridescenceSrc = import.meta.env.BASE_URL
  + 'fixtures/khronos/CompareIridescence/glTF/CompareIridescence.gltf';

const KeyLight = (): ReactNode => {
  const frame = useFrameIndex();
  const sweep = frame * 0.014;

  return (
    <directionalLight
      color={[1.2, 1.12, 0.98, 1]}
      direction={[
        Math.cos(sweep) * 0.64,
        -0.62,
        -0.58 + Math.sin(sweep) * 0.34,
      ]}
    />
  );
};

export const GltfMaterialExtensions = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 3.2,
    pitch: 0.04,
    target: [0, 0, 0],
  });

  return (
    <Canvas
      aria-label="glTF Khronos material extension fixture"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera}>
          <KeyLight />
          <directionalLight color={[0.24, 0.36, 0.72, 1]} direction={[-0.55, -0.35, 0.74]} />
          <model
            src={iridescenceSrc}
            transform={{
              position: [0, 0, 0],
              rotation: [0, 0.18, 0],
              scale: [1.75, 1.75, 1.75],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
