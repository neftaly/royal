import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';
import { formControlsScene } from './FormControls.scene';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const FormControls = (): ReactNode => (
  <Canvas aria-label="Canvas-native form controls" rootOptions={rootOptions}>
    {formControlsScene()}
  </Canvas>
);
