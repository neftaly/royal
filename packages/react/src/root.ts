import type { RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  type WebGlRootOptions,
} from "@royal/renderer-webgl";
import type { RoyalRendererJsxElement } from "./jsx-runtime";

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

export type RoyalRootContextSnapshot = Required<RoyalRootContextOptions>;

export interface RoyalRootSnapshot {
  readonly context: RoyalRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
}

export type RoyalRootRenderInput = RoyalRendererJsxElement;

/** Imperative renderer root bound to one canvas. */
export interface RoyalRoot {
  readonly canvas: HTMLCanvasElement;
  readonly context: RoyalRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  /** Renders a complete scene into the canvas. */
  render(scene: RoyalRootRenderInput): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  snapshot(): RoyalRootSnapshot;
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

  return {
    get canvas() {
      return root.canvas;
    },
    get context() {
      return root.options as RoyalRootContextSnapshot;
    },
    get disposed() {
      return root.disposed;
    },
    get frame() {
      return root.frame;
    },
    get latestScene() {
      return root.latestScene;
    },
    dispose: () => {
      root.dispose();
    },
    render: (scene: RoyalRootRenderInput) => {
      root.render(toRenderRoot(scene));
    },
    snapshot: () => {
      const snapshot = root.snapshot();
      return {
        context: snapshot.options as RoyalRootContextSnapshot,
        disposed: snapshot.disposed,
        frame: snapshot.frame,
        latestScene: snapshot.latestScene,
      };
    },
  };
};
