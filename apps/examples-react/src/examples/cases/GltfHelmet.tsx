import {
  Canvas,
  GltfOrbitCameraFit,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { directionalLight, gltf, scene } from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { interactiveCanvasStyle, materialEnvironment, materialFillLight, materialKeyLight, materialPass } from '../presentation';

const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const helmetNode = gltf({
  src: helmetSrc,
  transform: {
    position: [0, -0.08, 0],
    rotation: [0, 0.34, 0],
    scale: [1.1, 1.1, 1.1],
  },
});

export const GltfHelmet = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 3.4, pitch: 0.05, target: [0, -0.08, 0] },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: materialEnvironment,
    ...materialPass,
    nodes: [
      directionalLight(materialKeyLight),
      directionalLight(materialFillLight),
      helmetNode,
    ],
  }), [orbit.cameraResource]);

  return (
    <Canvas
      aria-label="glTF DamagedHelmet PBR material"
      rendererOptions={exampleCanvasRendererOptions}
      style={interactiveCanvasStyle}
      scene={renderScene}
    >
      <BenchmarkRendererSnapshot />
      <GltfOrbitCameraFit node={helmetNode} orbit={orbit} padding={1.15} />
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
