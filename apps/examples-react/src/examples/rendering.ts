import type { CanvasRendererOptions } from '@royal/react';

export const exampleRenderer = {
  context: {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  },
} as const satisfies CanvasRendererOptions;
