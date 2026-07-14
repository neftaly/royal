import { type RendererOptions } from '@royal/react';

const defaultExampleCanvasRendererOptions = {
  alpha: true,
  automaticVirtualTextures: true,
} as const satisfies RendererOptions;

export const exampleCanvasRendererOptions = defaultExampleCanvasRendererOptions;
