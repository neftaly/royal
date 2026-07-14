import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  boxGeometry,
  directionalLight,
  linearRgbaFromSrgb,
  mesh,
  planeGeometry,
  pointLight,
  scene,
  standardMaterial,
} from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { interactiveCanvasStyle, showcaseEnvironment, showcaseFillLight, showcaseKeyLight, showcasePass } from '../presentation';


export const StandardLighting = (): ReactNode => {
  const requestedLightCount = Number(new URLSearchParams(globalThis.location?.search ?? '').get('lights') ?? 24);
  const lightCount = Number.isFinite(requestedLightCount)
    ? Math.max(0, Math.min(1000, Math.floor(requestedLightCount)))
    : 24;
  const pointLights = useMemo(() => Array.from({ length: lightCount }, (_, index) => {
    const angle = index * 2.399963229728653;
    const radius = 1.2 + (index % 7) * 0.32;
    return {
      color: linearRgbaFromSrgb([
        0.72 + 0.28 * Math.max(0, Math.cos(angle)),
        0.72 + 0.28 * Math.max(0, Math.cos(angle - 2.094)),
        0.72 + 0.28 * Math.max(0, Math.cos(angle + 2.094)),
        1,
      ]),
      position: [Math.cos(angle) * radius, -0.1 + (index % 5) * 0.42, Math.sin(angle) * radius - 0.3] as const,
    };
  }), [lightCount]);
  const orbit = useOrbitCamera({
    initial: { distance: 6.2, pitch: -0.08, target: [0, 0.05, 0] },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      ...pointLights.map((light) => pointLight({
        color: light.color,
        intensityCandela: 18,
        position: light.position,
        range: 3.4,
      })),
      mesh({
        geometry: planeGeometry([5.2, 3.2]),
        material: standardMaterial({ color: linearRgbaFromSrgb([0.16, 0.2, 0.22, 1]) }),
        transform: { position: [0, -0.78, -0.35], rotation: [-Math.PI / 2, 0, 0] },
      }),
      mesh({
        geometry: boxGeometry([0.92, 0.92, 0.92]),
        material: standardMaterial({ color: linearRgbaFromSrgb([0.08, 0.74, 0.67, 1]) }),
        transform: { position: [-1.55, 0.05, 0], rotation: [0.38, 0.62, 0.08] },
      }),
      mesh({
        geometry: boxGeometry([0.92, 0.92, 0.92]),
        material: standardMaterial({ color: linearRgbaFromSrgb([0.94, 0.34, 0.22, 1]) }),
        transform: { position: [0, 0.05, 0], rotation: [0.28, -0.42, 0.22] },
      }),
      mesh({
        geometry: boxGeometry([0.92, 0.92, 0.92]),
        material: standardMaterial({ color: linearRgbaFromSrgb([0.5, 0.44, 0.9, 1]) }),
        transform: { position: [1.55, 0.05, 0], rotation: [0.12, -0.82, -0.08] },
      }),
    ],
  }), [orbit.cameraResource, pointLights]);

  return (
    <Canvas
      aria-label="Standard material lighting"
      rendererOptions={exampleCanvasRendererOptions}
      style={interactiveCanvasStyle}
      scene={renderScene}
    >
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
