import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { studioEnvironment } from '@royal/react/scene';
import { type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';

const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.46,
  specularIntensity: 0.82,
});

export const GltfHelmet = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 3.4,
    pitch: 0.05,
    target: [0, -0.08, 0],
  });

  return (
    <Canvas
      aria-label="glTF DamagedHelmet PBR material"
      renderer={exampleCanvasRendererOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment} toneMapping="none">
          <directionalLight color={[0.58, 0.56, 0.52, 1]} direction={[0.36, -0.72, -1]} />
          <gltf
            src={helmetSrc}
            transform={{
              position: [0, -0.08, 0],
              rotation: [0, 0.34, 0],
              scale: [1.1, 1.1, 1.1],
            }}
          />
        </pass>
      </scene>
      <BenchmarkRendererSnapshot />
      <OrbitControls {...orbit.orbitControlsProps} />
    </Canvas>
  );
};
