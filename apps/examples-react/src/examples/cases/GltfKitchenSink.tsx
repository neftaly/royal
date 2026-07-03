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
const svgMaterialGridSrc = import.meta.env.BASE_URL
  + 'fixtures/gltf-kitchen-sink/svg-material-grid.gltf';

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

export const GltfKitchenSink = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 6.8,
    far: 40,
    pitch: 0.12,
    target: [0.1, -0.05, 0],
    yaw: 0.18,
  });

  return (
    <Canvas
      aria-label="glTF Kitchen Sink material and SVG texture fixture"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera}>
          <KeyLight />
          <directionalLight color={[0.24, 0.36, 0.72, 1]} direction={[-0.55, -0.35, 0.74]} />
          <model
            src={svgMaterialGridSrc}
            transform={{
              position: [0, -0.22, 0],
              rotation: [-0.06, 0, 0],
              scale: [1, 1, 1],
            }}
          />
          <model
            src={iridescenceSrc}
            transform={{
              position: [0, 1.55, -0.18],
              rotation: [0, 0.32, 0],
              scale: [1.22, 1.22, 1.22],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} maxDistance={14} minDistance={2.5} />
    </Canvas>
  );
};
