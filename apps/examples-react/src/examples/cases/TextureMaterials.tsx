import { boxGeometry, studioEnvironment } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  type ReactNode,
} from 'react';
import { exampleCanvasRootOptions } from '../example-root-options';

const swatchGeometry = boxGeometry({ size: [1.72, 1.72, 1.72] });
const helmetAlbedoSrc = import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.46,
  specularIntensity: 0.82,
});

export const TextureMaterials = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 5.2,
    pitch: 0.03,
    target: [0, 0.02, 0],
  });

  return (
    <Canvas
      aria-label="Texture materials"
      rootOptions={exampleCanvasRootOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment} toneMapping="none">
          <directionalLight color={[0.58, 0.56, 0.52, 1]} direction={[0.36, -0.72, -1]} />
          <mesh
            geometry={swatchGeometry}
            texture={helmetAlbedoSrc}
            transform={{
              position: [0, 0.02, 0],
              rotation: [0.24, 0.26, -0.04],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.orbitControlsProps} />
    </Canvas>
  );
};
