import { type CanvasRendererOptions } from '@royal/react';

export const exampleCanvasRendererOptions = {
  context: {
    preserveDrawingBuffer: true,
  },
} as const satisfies CanvasRendererOptions;
