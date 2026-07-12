import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { gltf, scene } from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasContextOptions } from '../example-context-options';
import { colorAccuratePass, interactiveCanvasStyle } from '../presentation';

const variantSrc = import.meta.env.BASE_URL + 'fixtures/gltf-variants/variant-quad.gltf';

export const GltfVariants = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 3.8, pitch: 0.04, target: [0, 0, 0] },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    ...colorAccuratePass,
    nodes: [
      gltf({ src: variantSrc, transform: { position: [-1.05, 0, 0], rotation: [0, -0.16, 0], scale: [0.76, 0.76, 0.76] } }),
      gltf({ src: variantSrc, variant: 'ruby', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.76, 0.76, 0.76] } }),
      gltf({ src: variantSrc, variant: 1, transform: { position: [1.05, 0, 0], rotation: [0, 0.16, 0], scale: [0.76, 0.76, 0.76] } }),
    ],
  }), [orbit.cameraResource]);

  return (
    <Canvas
      aria-label="glTF KHR_materials_variants"
      context={exampleCanvasContextOptions}
      style={interactiveCanvasStyle}
      scene={renderScene}
    >
      <OrbitControls orbit={orbit} maxDistance={8} minDistance={0.1} />
      <BenchmarkRendererSnapshot />
    </Canvas>
  );
};
