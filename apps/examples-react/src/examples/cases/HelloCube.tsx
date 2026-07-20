import { boxGeometry, directionalLight, linearRgbaFromSrgb, mesh, scene, standardMaterial } from '@royal/react/scene';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { useMemo, type ReactNode } from 'react';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { showcaseEnvironment, showcaseFillLight, showcaseKeyLight, showcasePass } from '../presentation';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';

const cubeGeometry = boxGeometry({ size: [1.5, 1.5, 1.5] });

export const HelloCube = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 5, pitch: 0.04 },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      mesh({
        geometry: cubeGeometry,
        material: standardMaterial({ color: linearRgbaFromSrgb([0.9, 0.2, 0.16, 1]) }),
        transform: { position: [0, 0, 0], rotation: [0.45, 0.7, 0.05] },
      }),
    ],
  }), [orbit.camera]);

  return (
    <Canvas aria-label="Lit cube" rendererOptions={exampleCanvasRendererOptions} scene={renderScene}>
      <BenchmarkRendererSnapshot />
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
