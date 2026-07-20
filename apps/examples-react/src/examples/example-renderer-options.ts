import { type RendererRootOptions } from '@royal/react';

const defaultExampleCanvasRendererOptions = {
  alpha: false,
  antialias: false,
} as const satisfies RendererRootOptions;

export const exampleCanvasRendererOptions = defaultExampleCanvasRendererOptions;
