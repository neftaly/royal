import type { RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  type WebGlRootOptions,
  type WebGlRootSnapshot,
} from "@royal/renderer-webgl";
import type { ReactNode } from "react";

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

export type RoyalRootRenderInput = ReactNode | RenderRoot;

/** Imperative renderer root bound to one canvas. */
export interface RoyalRoot {
  readonly canvas: HTMLCanvasElement;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: WebGlRootOptions;
  /** Renders a complete scene into the canvas. */
  render(scene: RoyalRootRenderInput): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  snapshot(): WebGlRootSnapshot;
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

const isRenderRoot = (value: unknown): value is RenderRoot =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "scene";

const toRenderRoot = (scene: RoyalRootRenderInput): RenderRoot => {
  if (isRenderRoot(scene)) return scene;

  throw new Error("Royal root render expects a renderer scene");
};

/** Creates an imperative renderer root. */
export const createRoot = (
  canvas: HTMLCanvasElement,
  options?: RoyalRootOptions,
): RoyalRoot => {
  const root = createWebGlRoot(canvas, toWebGlRootOptions(options));
  const render = root.render.bind(root);

  root.render = (scene: RoyalRootRenderInput): void => {
    render(toRenderRoot(scene));
  };

  return root;
};
