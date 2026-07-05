import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { studioEnvironment } from '@royal/renderer-core';
import { type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRootOptions } from '../example-root-options';

const variantSrc = import.meta.env.BASE_URL + 'fixtures/gltf-variants/variant-quad.gltf';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.46,
  specularIntensity: 0.82,
});

export const GltfVariants = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 3.8,
    pitch: 0.04,
    target: [0, 0, 0],
  });

  return (
    <Canvas
      aria-label="glTF KHR_materials_variants"
      rootOptions={exampleCanvasRootOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment} toneMapping="none">
          <directionalLight color={[0.58, 0.56, 0.52, 1]} direction={[0.36, -0.72, -1]} />
          <gltf
            src={variantSrc}
            transform={{
              position: [-1.05, 0, 0],
              rotation: [0, -0.16, 0],
              scale: [0.76, 0.76, 0.76],
            }}
          />
          <gltf
            src={variantSrc}
            transform={{
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [0.76, 0.76, 0.76],
            }}
            variant="ruby"
          />
          <gltf
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
      <OrbitControls {...orbit.orbitControlsProps} maxDistance={8} minDistance={2} />
      <BenchmarkRendererSnapshot />
    </Canvas>
  );
};
