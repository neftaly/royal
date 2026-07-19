import { type RendererRootOptions } from '@royal/react';

const defaultExampleCanvasRendererOptions = {
  alpha: true,
} as const satisfies RendererRootOptions;

export const exampleCanvasRendererOptions = defaultExampleCanvasRendererOptions;
