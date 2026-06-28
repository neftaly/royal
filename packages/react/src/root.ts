import type { RenderRoot } from "@royal/renderer-core";
import { createWebGlRoot, type WebGlRootOptions } from "@royal/renderer-webgl";

/** WebGL context options for the Royal React root. */
export interface RoyalRootContextOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

/** Options for the Royal React root. */
export interface RoyalRootOptions {
  readonly context?: RoyalRootContextOptions;
}

/** Imperative renderer root bound to one canvas. */
export interface RoyalRoot {
  /** Renders a complete scene into the canvas. */
  render(scene: RenderRoot): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
}

const toWebGlRootOptions = (
  options: RoyalRootOptions | undefined,
): WebGlRootOptions | undefined =>
  options === undefined ? undefined : options.context ?? {};

/** Creates an imperative renderer root. */
export const createRoot = (
  canvas: HTMLCanvasElement,
  options?: RoyalRootOptions,
): RoyalRoot => createWebGlRoot(canvas, toWebGlRootOptions(options));
