import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { gltf, scene, studioEnvironment } from '@royal/react/scene';
import { useMemo, useState, type ReactNode } from 'react';
import { BenchmarkGltfRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { colorAccuratePass, interactiveCanvasStyle } from '../presentation';

const variantSrc = import.meta.env.BASE_URL + 'fixtures/gltf-variants/variant-quad.gltf';
const variantAsset = gltf({ src: variantSrc }).asset;
const variantNames = ['ruby', 'mint', 'slate'] as const;
type VariantName = typeof variantNames[number];

export const GltfVariants = (): ReactNode => {
  const [variant, setVariant] = useState<VariantName>('ruby');
  const orbit = useOrbitCamera({
    initial: { distance: 3.8, pitch: 0.04, target: [0, 0, 0] },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    ...colorAccuratePass,
    environment: studioEnvironment({ radianceScaleNits: 80 }),
    nodes: [
      gltf({ src: variantSrc, transform: { position: [-1.05, 0, 0], rotation: [0, -0.16, 0], scale: [0.76, 0.76, 0.76] } }),
      gltf({ src: variantSrc, materialVariant: variant, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.76, 0.76, 0.76] } }),
      gltf({ src: variantSrc, materialVariant: 'mint', transform: { position: [1.05, 0, 0], rotation: [0, 0.16, 0], scale: [0.76, 0.76, 0.76] } }),
    ],
  }), [orbit.cameraResource, variant]);

  return (
    <div className="gltf-variants" data-selected-variant={variant}>
      <div className="gltf-variants-toolbar">
        <div>
          <strong>KHR_materials_variants</strong>
          <span>Base material · interactive named variant · mint</span>
        </div>
        <div aria-label="Center material variant" className="gltf-variants-actions" role="group">
          {variantNames.map((name) => (
            <button
              aria-pressed={variant === name}
              key={name}
              type="button"
              onClick={() => setVariant(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="gltf-variants-canvas">
        <Canvas
          aria-label="glTF KHR_materials_variants"
          rendererOptions={exampleCanvasRendererOptions}
          style={interactiveCanvasStyle}
          scene={renderScene}
        >
          <OrbitControls orbit={orbit} maxDistance={8} minDistance={0.1} />
          <BenchmarkGltfRendererSnapshot asset={variantAsset} />
        </Canvas>
      </div>
    </div>
  );
};
