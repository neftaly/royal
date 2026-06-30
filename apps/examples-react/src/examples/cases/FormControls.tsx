import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';
import { formControlsScene } from './FormControls.scene';
import { useAtkinsonFont } from './text-font';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const FormControls = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const font = fontState.status === 'ready' ? fontState.font : undefined;

  return (
    <Canvas aria-label="Canvas-native form controls" rootOptions={rootOptions}>
      {formControlsScene(font)}
    </Canvas>
  );
};
