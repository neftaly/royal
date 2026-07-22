import { type RendererRootOptions } from '@royal/react';

const defaultExampleCanvasRendererOptions = {
  alpha: true,
  antialias: false,
} as const satisfies RendererRootOptions;

export const exampleCanvasRendererOptions = defaultExampleCanvasRendererOptions;

/** Example policy for resolution-independent image sources rendered through automatic VT. */
export const automaticVirtualTextureExampleRendererOptions = {
  ...defaultExampleCanvasRendererOptions,
  automaticVirtualTexturing: true,
} as const satisfies RendererRootOptions;
