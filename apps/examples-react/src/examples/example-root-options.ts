import { type CanvasRootOptions } from '@royal/react';

export const exampleCanvasRootOptions = {
  context: {
    preserveDrawingBuffer: true,
  },
} as const satisfies CanvasRootOptions;
