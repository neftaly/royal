import type { RenderRoot } from "@royal/renderer-core";
import { createWebGlRoot, type WebGlRootOptions } from "@royal/renderer-webgl";

export type ReactRoyalRootOptions = WebGlRootOptions;

/** Imperative renderer root bound to one canvas. */
export interface ReactRoyalRoot {
  /** Renders a complete scene into the canvas. */
  render(scene: RenderRoot): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
}

/** Creates an imperative renderer root. */
export const createRoot = (
  canvas: HTMLCanvasElement,
  options?: ReactRoyalRootOptions,
): ReactRoyalRoot => createWebGlRoot(canvas, options);
