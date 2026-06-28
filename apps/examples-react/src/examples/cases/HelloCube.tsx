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
import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';

const cube = boxGeometry({ size: [1.5, 1.5, 1.5] });
const cubeMaterial = standardMaterial({ color: [0.9, 0.2, 0.16, 1] });
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const cubeScene = (): RenderRoot =>
  scene({
    children: [
      pass({
        clearColor: [0.06, 0.08, 0.1, 1],
        camera: perspectiveCamera({
          position: [0, 0.2, 5],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 1000,
        }),
        children: [
          directionalLight({ direction: [0.8, -1.8, -1], color: [1, 1, 1, 1] }),
          mesh({
            geometry: cube,
            material: cubeMaterial,
            transform: {
              position: [0, 0, 0],
              rotation: [0.45, 0.7, 0.05],
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
