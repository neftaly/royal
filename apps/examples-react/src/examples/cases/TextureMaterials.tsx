import { boxGeometry, directionalLight, imageTexture, mesh, scene, standardMaterial } from '@royal/react/scene';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  useMemo,
  type ReactNode,
} from 'react';
import { exampleCanvasContextOptions } from '../example-context-options';
import { interactiveCanvasStyle, showcaseEnvironment, showcaseFillLight, showcaseKeyLight, showcasePass } from '../presentation';

const swatchGeometry = boxGeometry({ size: [1.72, 1.72, 1.72] });
const helmetAlbedoSrc = import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg';

export const TextureMaterials = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 5.2, pitch: 0.03, target: [0, 0.02, 0] },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      mesh({
        geometry: swatchGeometry,
        material: standardMaterial({ texture: imageTexture(helmetAlbedoSrc) }),
        transform: { position: [0, 0.02, 0], rotation: [0.24, 0.26, -0.04] },
      }),
    ],
  }), [orbit.cameraResource]);

  return (
    <Canvas
      aria-label="Texture materials"
      context={exampleCanvasContextOptions}
      style={interactiveCanvasStyle}
      scene={renderScene}
    >
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
