import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';
import { helmetScene } from './GltfHelmet.scene';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const GltfHelmet = (): ReactNode => (
  <Canvas aria-label="glTF DamagedHelmet" rootOptions={rootOptions}>
    {helmetScene()}
  </Canvas>
);
