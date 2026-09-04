import { Canvas, OrbitControls, useOrbitCamera } from '@royal/react';
import {
  boundedVolume,
  boxGeometry,
  directionalLight,
  linearRgbaFromSrgb,
  mesh,
  planeGeometry,
  scene,
  standardMaterial,
  triangleGeometry,
} from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import {
  interactiveCanvasStyle,
  showcaseEnvironment,
  showcaseFillLight,
  showcaseKeyLight,
  showcasePass,
} from '../presentation';

const boardGeometry = planeGeometry([5.4, 3.5]);
const cardGeometry = boxGeometry([1.35, 0.08, 0.9]);
const markerGeometry = triangleGeometry({
  indices: [
    0, 1, 2, 0, 2, 3,
    5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7,
    1, 5, 6, 1, 6, 2,
    3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0,
  ],
  positions: [
    -0.71, -0.575, 0.485,
    0.71, -0.575, 0.485,
    0.22, 0.575, 0.22,
    -0.22, 0.575, 0.22,
    -0.71, -0.575, -0.485,
    0.71, -0.575, -0.485,
    0.22, 0.575, -0.22,
    -0.22, 0.575, -0.22,
  ],
});

const volumeOracle = new URLSearchParams(window.location.search).get('volume');

export const BoundedVolume = (): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 3.7, pitch: -0.34, target: [0, 0.2, 0] },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      mesh({
        geometry: boardGeometry,
        material: standardMaterial({ color: linearRgbaFromSrgb([0.12, 0.15, 0.17, 1]) }),
        transform: { position: [0, -0.22, 0], rotation: [-Math.PI / 2, 0, 0] },
      }),
      mesh({
        geometry: cardGeometry,
        material: standardMaterial({ color: linearRgbaFromSrgb([0.9, 0.31, 0.18, 1]) }),
        transform: { position: [0, -0.14, 0] },
      }),
      mesh({
        geometry: cardGeometry,
        material: standardMaterial({ color: linearRgbaFromSrgb([0.96, 0.72, 0.22, 1]) }),
        transform: { position: [0.04, -0.04, -0.02], rotation: [0, 0.08, 0.03] },
      }),
      mesh({
        geometry: boxGeometry([0.42, 0.42, 0.42]),
        material: standardMaterial({ color: linearRgbaFromSrgb([0.22, 0.32, 0.44, 1]) }),
        transform: { position: [0.1, 0.2, 0.02], rotation: [0.15, 0.35, 0.1] },
      }),
      ...(volumeOracle === 'off' ? [] : [boundedVolume({
        geometry: markerGeometry,
        color: [0.08, 2.2, 0.48, volumeOracle === 'zero' ? 0 : 0.88],
        extinctionPerMetre: 3.4,
        densityProfile: [
          [0, 0.45],
          [0.18, 1],
          [0.68, 0.58],
          [1, 0],
        ],
        noiseScale: [4.2, 8.5, 5.1],
        noiseStrength: 0.42,
        transform: { position: [0.02, 0.43, -0.01], rotation: [0, 0.04, 0] },
      })]),
    ],
  }), [orbit.camera]);

  return (
    <Canvas
      aria-label="Mesh-bounded emissive volume"
      rendererOptions={exampleCanvasRendererOptions}
      scene={renderScene}
      style={interactiveCanvasStyle}
    >
      <BenchmarkRendererSnapshot />
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
