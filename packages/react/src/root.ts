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

export type RoyalRendererBackend = "auto" | "webgl2";

/** Options for the Royal React root. */
export interface RoyalRootOptions {
  readonly backend?: RoyalRendererBackend;
  readonly context?: RoyalRootContextOptions;
}

/** Imperative renderer root bound to one canvas. */
export interface RoyalRoot {
  /** Renders a complete scene into the canvas. */
  render(scene: RenderRoot): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
}

const assertSupportedBackend = (backend: string | undefined): void => {
  if (backend === undefined || backend === "auto" || backend === "webgl2") return;

  throw new Error("Royal React roots currently support the webgl2 backend only");
};

const toWebGlRootOptions = (
  options: RoyalRootOptions | undefined,
): WebGlRootOptions | undefined => {
  assertSupportedBackend(options?.backend);

  return options === undefined ? undefined : options.context ?? {};
};

/** Creates an imperative renderer root. */
export const createRoot = (
  canvas: HTMLCanvasElement,
  options?: RoyalRootOptions,
): RoyalRoot => createWebGlRoot(canvas, toWebGlRootOptions(options));
