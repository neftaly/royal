import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleCanvasRenderer } from '../example-renderer';

const variantSrc = import.meta.env.BASE_URL + 'fixtures/gltf-variants/variant-quad.gltf';

export const GltfVariants = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 3.8,
    pitch: 0.04,
    target: [0, 0, 0],
  });

  return (
    <Canvas
      aria-label="glTF KHR_materials_variants"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera}>
          <model
            src={variantSrc}
            transform={{
              position: [-1.05, 0, 0],
              rotation: [0, -0.16, 0],
              scale: [0.76, 0.76, 0.76],
            }}
          />
          <model
            src={variantSrc}
            transform={{
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [0.76, 0.76, 0.76],
            }}
            variant="ruby"
          />
          <model
            src={variantSrc}
            transform={{
              position: [1.05, 0, 0],
              rotation: [0, 0.16, 0],
              scale: [0.76, 0.76, 0.76],
            }}
            variant={1}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} maxDistance={8} minDistance={2} />
    </Canvas>
  );
};
