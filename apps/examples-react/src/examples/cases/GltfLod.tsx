import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { directionalLight, gltf, scene } from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasContextOptions } from '../example-context-options';
import { interactiveCanvasStyle, showcaseEnvironment, showcaseFillLight, showcaseKeyLight, showcasePass } from '../presentation';

const lodSrc = import.meta.env.BASE_URL + 'fixtures/gltf-lod/royal-four-step-color-lod-cube.gltf';

export const GltfLod = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 4.6, pitch: 0.02 },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      gltf({
        src: lodSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0.18, -0.28, 0],
          scale: [1.3, 1.3, 1.3],
        },
      }),
    ],
  }), [orbit.cameraResource]);

  return (
    <Canvas
      aria-label="glTF MSFT_lod"
      context={exampleCanvasContextOptions}
      style={interactiveCanvasStyle}
      scene={renderScene}
    >
      <OrbitControls
        orbit={orbit}
        maxDistance={28}
        minDistance={0.1}
        zoomSpeed={0.00075}
      />
      <BenchmarkRendererSnapshot />
    </Canvas>
  );
};
