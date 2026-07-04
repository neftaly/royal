import type { PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createWebGlRoot,
  type WebGlGltfInstancingSnapshot,
  type WebGlRoot,
  type WebGlRootOptions,
  type WebGlVirtualTexturingSnapshot,
} from "@royal/renderer-webgl";
import {
  isRenderRootDescriptor,
  type RoyalRendererJsxElement,
} from "./jsx-runtime-internal";

/** WebGL context options for the Royal renderer root. */
export interface RoyalRendererRootContextOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

/** Options for the Royal renderer root. */
export interface RoyalRendererRootOptions {
  readonly context?: RoyalRendererRootContextOptions;
}

export type RoyalRendererRootContextSnapshot = Required<RoyalRendererRootContextOptions>;

export interface RoyalRendererRootSnapshot {
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  /** Renderer-owned counters for diagnostics; not scene or application state. */
  readonly gltfInstancing: WebGlGltfInstancingSnapshot;
  readonly latestScene: RenderRoot | undefined;
  readonly virtualTexturing: WebGlVirtualTexturingSnapshot;
}

export type RoyalRendererRootRenderInput = RenderRoot | RoyalRendererJsxElement;

/** Imperative renderer root bound to one canvas. */
export interface RoyalRendererRoot {
  readonly canvas: HTMLCanvasElement;
  readonly context: RoyalRendererRootContextSnapshot;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
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

const toWebGlRootOptions = (
  options: RoyalRendererRootOptions | undefined,
): WebGlRootOptions | undefined => {
  return options?.context;
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

/** Creates an imperative renderer root. */
export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options?: RoyalRendererRootOptions,
): RoyalRendererRoot => {
  const root = createWebGlRoot(canvas, toWebGlRootOptions(options));

  const royalRoot: WebGlBackedRoyalRendererRoot = {
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
      const snapshot = root.snapshot();
      return {
        context: snapshot.options as RoyalRendererRootContextSnapshot,
        disposed: snapshot.disposed,
        frame: snapshot.frame,
        gltfInstancing: snapshot.gltfInstancing,
        latestScene: snapshot.latestScene,
        virtualTexturing: snapshot.virtualTexturing,
      };
    },
  };

  return royalRoot;
};
