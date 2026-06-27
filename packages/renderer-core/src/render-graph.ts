import type { Camera } from './camera';
import { RenderGraphKind } from './kind';
import type { Rgba } from './primitives';
import type { RenderNode } from './render-node';

const TRANSPARENT_BLACK: Rgba = [0, 0, 0, 0];

export type RenderElement = Scene | RenderPass | RenderNode;
/** Root render description accepted by renderer roots. */
export type RenderRoot = Scene;

/** One camera plus drawable scene nodes. */
export interface RenderPass {
  readonly kind: RenderGraphKind.Pass;
  readonly camera: Camera;
  readonly children: readonly RenderNode[];
  readonly clearColor: Rgba;
}

export interface RenderPassOptions {
  readonly camera: Camera;
  readonly children: readonly RenderNode[];
  /** @defaultValue `[0, 0, 0, 0]` */
  readonly clearColor?: Rgba;
}

/** Ordered render passes for a frame. */
export interface Scene {
  readonly kind: RenderGraphKind.Scene;
  readonly children: readonly RenderPass[];
}

export interface SceneOptions {
  readonly children: readonly RenderPass[];
}

/** Creates a render pass. */
export const pass = (options: RenderPassOptions): RenderPass => {
  return {
    kind: RenderGraphKind.Pass,
    camera: options.camera,
    children: options.children,
    clearColor: options.clearColor ?? TRANSPARENT_BLACK
  };
};

/** Creates a render scene. */
export const scene = (options: SceneOptions): RenderRoot => ({
  kind: RenderGraphKind.Scene,
  children: options.children
});
