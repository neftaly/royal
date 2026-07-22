import { type RendererRootOptions } from '@royal/react';

const defaultExampleCanvasRendererOptions = {
  alpha: true,
  antialias: false,
} as const satisfies RendererRootOptions;

export const exampleCanvasRendererOptions = defaultExampleCanvasRendererOptions;
