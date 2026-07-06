import type { PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  type WebGlRoot,
} from "@royal/renderer-webgl";
import {
  isRenderRootDescriptor,
  type RoyalRendererJsxElement,
} from "./renderer-descriptor";

/** WebGL context options for the Royal renderer root. */
export interface RoyalRendererRootContextOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

/** Options passed to renderer backend roots. */
export interface RoyalRendererBackendRootOptions {
  readonly context?: RoyalRendererRootContextOptions;
}

/** Options for the Royal renderer root. */
export interface RoyalRendererRootOptions extends RoyalRendererBackendRootOptions {
  readonly backend?: RoyalRendererBackendRootFactory;
}

export type RoyalRendererRootContextSnapshot = Required<RoyalRendererRootContextOptions>;

export interface RoyalRendererRootSnapshot {
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
}

export type RoyalRendererRootRenderInput = RenderRoot | RoyalRendererJsxElement;

export interface RoyalRendererBackendRoot {
  readonly canvas: HTMLCanvasElement;
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  /** Backend-specific diagnostic payload. Host code must validate before use. */
  diagnostics(): unknown;
  dispose(): void;
  invalidate(): void;
  pick(input: PickInput): PickResult | undefined;
  render(scene: RenderRoot): void;
  snapshot(): RoyalRendererRootSnapshot;
}

export type RoyalRendererBackendRootFactory = (
  canvas: HTMLCanvasElement,
  options?: RoyalRendererBackendRootOptions,
) => RoyalRendererBackendRoot;

/** Imperative renderer root bound to one canvas. */
export interface RoyalRendererRoot {
  readonly canvas: HTMLCanvasElement;
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  /** Renderer-specific diagnostic payload. Host code must validate before use. */
  diagnostics(): unknown;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  /** Returns the front-most render target under a DOM client coordinate. */
  pick(input: PickInput): PickResult | undefined;
  /** Renders a complete scene into the canvas. */
  render(scene: RoyalRendererRootRenderInput): void;
  /** Canonical resource cleanup hook. */
  dispose(): void;
  snapshot(): RoyalRendererRootSnapshot;
}

const WEB_GL_ROOT = Symbol("Royal React WebGL root");

type WebGlBackedRoyalRendererRoot = RoyalRendererRoot & {
  readonly [WEB_GL_ROOT]: WebGlRoot;
};

type WebGlBackedRoyalRendererBackendRoot = RoyalRendererBackendRoot & {
  readonly [WEB_GL_ROOT]: WebGlRoot;
};

const toRenderRoot = (scene: RoyalRendererRootRenderInput): RenderRoot => {
  if (isRenderRootDescriptor(scene)) return scene;

  throw new Error("Royal renderer root render expects a renderer scene");
};

export const webGlRootForRoyalRoot = (root: RoyalRendererRoot): WebGlRoot => {
  const webGlRoot = (root as Partial<WebGlBackedRoyalRendererRoot>)[WEB_GL_ROOT];
  if (webGlRoot === undefined) {
    throw new Error("Royal React root is not backed by the WebGL renderer");
  }

  return webGlRoot;
};

const createWebGlRendererBackendRoot: RoyalRendererBackendRootFactory = (
  canvas,
  options,
) => {
  const root = createWebGlRoot(canvas, options?.context);

  return {
    [WEB_GL_ROOT]: root,
    get canvas() {
      return root.canvas;
    },
    get context() {
      return root.options as RoyalRendererRootContextSnapshot;
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
    diagnostics: () => root.snapshot(),
    dispose: () => {
      root.dispose();
    },
    invalidate: () => {
      root.invalidate();
    },
    pick: (input: PickInput) => root.pick(input),
    render: (scene: RenderRoot) => {
      root.render(scene);
    },
    snapshot: () => {
      return {
        context: root.options as RoyalRendererRootContextSnapshot,
        disposed: root.disposed,
        frame: root.frame,
        latestScene: root.latestScene,
      };
    },
  } satisfies WebGlBackedRoyalRendererBackendRoot;
};

/** Creates an imperative renderer root. */
export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options?: RoyalRendererRootOptions,
): RoyalRendererRoot => {
  const root = (options?.backend ?? createWebGlRendererBackendRoot)(
    canvas,
    options?.context === undefined ? undefined : { context: options.context },
  );
  const webGlRoot = (root as Partial<WebGlBackedRoyalRendererBackendRoot>)[WEB_GL_ROOT];

  const royalRoot: RoyalRendererRoot = {
    get canvas() {
      return root.canvas;
    },
    get context() {
      return root.context;
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
    diagnostics: () => root.diagnostics(),
    dispose: () => {
      root.dispose();
    },
    invalidate: () => {
      root.invalidate();
    },
    pick: (input: PickInput) => root.pick(input),
    render: (scene: RoyalRendererRootRenderInput) => {
      root.render(toRenderRoot(scene));
    },
    snapshot: () => {
      return root.snapshot();
    },
  };
  if (webGlRoot !== undefined) {
    Object.defineProperty(royalRoot, WEB_GL_ROOT, {
      configurable: false,
      enumerable: false,
      value: webGlRoot,
    });
  }

  return royalRoot;
};
