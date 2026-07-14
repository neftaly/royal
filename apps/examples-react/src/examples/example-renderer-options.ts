import { type RendererOptions } from '@royal/react';

const defaultExampleCanvasRendererOptions = {
  alpha: true,
  generatedImageVirtualTextures: true,
} as const satisfies RendererOptions;

export const exampleCanvasRendererOptions = defaultExampleCanvasRendererOptions;
