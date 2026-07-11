import { boxGeometry, directionalLight, mesh, scene, standardMaterial } from '@royal/react/scene';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { useMemo, type ReactNode } from 'react';
import { srgbColor } from '../color';
import { exampleCanvasContextOptions } from '../example-context-options';
import { showcaseEnvironment, showcaseFillLight, showcaseKeyLight, showcasePass } from '../presentation';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';

const cubeGeometry = boxGeometry({ size: [1.5, 1.5, 1.5] });

export const HelloCube = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 5, pitch: 0.04 },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      mesh({
        geometry: cubeGeometry,
        material: standardMaterial({ color: srgbColor([0.9, 0.2, 0.16, 1]) }),
        transform: { position: [0, 0, 0], rotation: [0.45, 0.7, 0.05] },
      }),
    ],
  }), [orbit.cameraResource]);

  return (
    <Canvas aria-label="Lit cube" context={exampleCanvasContextOptions} scene={renderScene}>
      <BenchmarkRendererSnapshot />
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
