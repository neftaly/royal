import type { RenderRoot } from "@royal/renderer-core";
import { WebGlRoot } from "./webgl/root";

/** WebGL context options for the renderer root. */
export interface ReactRoyalRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

/** Imperative renderer root bound to one canvas. */
export interface ReactRoyalRoot {
  /** Renders a complete scene into the canvas. */
  render(scene: RenderRoot): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  /** Compatibility cleanup hook. */
  unmount(): void;
}

export type ReactReglRootOptions = ReactRoyalRootOptions;
export type ReactReglRoot = ReactRoyalRoot;

/** Creates an imperative renderer root. */
export const createRoot = (
  canvas: HTMLCanvasElement,
  options?: ReactRoyalRootOptions,
): ReactRoyalRoot => new WebGlRoot(canvas, options);
