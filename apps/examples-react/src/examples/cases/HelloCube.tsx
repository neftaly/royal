import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';
import { helloCubeScene } from './HelloCube.scene';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const HelloCube = (): ReactNode => (
  <Canvas aria-label="Lit cube" rootOptions={rootOptions}>
    {helloCubeScene()}
  </Canvas>
);
