import {
  Canvas,
} from '@royal/react';
import {
  directionalLight,
  gltf,
  pass,
  perspectiveCamera,
  scene,
  type RenderRoot,
} from '@royal/renderer-core';
import type { ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const helmetScene = (): RenderRoot =>
  scene({
    children: [
      pass({
        clearColor: [0.05, 0.06, 0.07, 1],
        camera: perspectiveCamera({
          position: [0, 0.2, 3.1],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 100,
        }),
        children: [
          directionalLight({ direction: [0.4, -1, -0.6], color: [1, 1, 1, 1] }),
          gltf({
            src: '/DamagedHelmet/DamagedHelmet.gltf',
            transform: {
              position: [0, -0.45, 0],
              rotation: [0.05, 0.65, 0],
              scale: [1.45, 1.45, 1.45],
            },
          }),
        ],
      }),
    ],
  });

export const GltfHelmet = (): ReactNode => (
  <Canvas aria-label="Damaged Helmet glTF model" rootOptions={rootOptions}>
    {helmetScene()}
  </Canvas>
);
