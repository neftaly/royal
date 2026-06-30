import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';
import { materialScene } from './TextureMaterials.scene';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const TextureMaterials = (): ReactNode => {
  return (
    <Canvas aria-label="Texture materials" rootOptions={rootOptions}>
      {materialScene()}
    </Canvas>
  );
};
