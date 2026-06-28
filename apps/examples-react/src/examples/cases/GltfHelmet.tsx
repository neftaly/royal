import {
  directionalLight,
  gltf,
  pass,
  perspectiveCamera,
  scene,
  type RenderRoot,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';

const helmetUrl = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const helmetScene = (): RenderRoot =>
  scene({
    children: [
      pass({
        clearColor: [0.04, 0.05, 0.06, 1],
        camera: perspectiveCamera({
          position: [0, 0.08, 3.4],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 100,
        }),
        children: [
          directionalLight({ direction: [0.4, -0.75, -1], color: [1, 0.96, 0.9, 1] }),
          gltf({
            src: helmetUrl,
            transform: {
              position: [0, -0.08, 0],
              rotation: [0, 0.34, 0],
              scale: [1.1, 1.1, 1.1],
            },
          }),
        ],
      }),
    ],
  });

export const GltfHelmet = (): ReactNode => (
  <Canvas aria-label="glTF DamagedHelmet" rootOptions={rootOptions}>
    {helmetScene()}
  </Canvas>
);
