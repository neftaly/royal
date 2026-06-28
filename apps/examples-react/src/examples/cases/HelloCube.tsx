import {
  Canvas,
} from '@royal/react';
import {
  boxGeometry,
  directionalLight,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  type RenderRoot,
} from '@royal/renderer-core';
import type { ReactNode } from 'react';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [0.85, 0.16, 0.18, 1] });
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const cubeScene = (): RenderRoot =>
  scene({
    children: [
      pass({
        camera: perspectiveCamera({
          position: [0, 0, 5],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 1000,
        }),
        children: [
          directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] }),
          mesh({
            geometry: cube,
            material: red,
            transform: {
              position: [0, 0, 0],
              rotation: [0.4, 0.65, 0],
            },
          }),
        ],
      }),
    ],
  });

export const HelloCube = (): ReactNode => (
  <Canvas aria-label="Lit cube" rootOptions={rootOptions}>
    {cubeScene()}
  </Canvas>
);
