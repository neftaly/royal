import { type CanvasRendererOptions } from '@royal/react';

export const exampleCanvasRenderer = {
  context: {
    preserveDrawingBuffer: true,
  },
} as const satisfies CanvasRendererOptions;
