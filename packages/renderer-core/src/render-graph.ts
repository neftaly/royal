import type { Camera } from './camera';
import type { Rgba } from './primitives';
import type { RenderNode } from './render-node';

const TRANSPARENT_BLACK: Rgba = [0, 0, 0, 0];

export type RenderPassClear = 'color-depth' | 'color' | 'depth' | 'none';

export type RenderElement = Scene | RenderPass | RenderNode;
/** Root render description accepted by renderer roots. */
export type RenderRoot = Scene;

/** One camera plus drawable scene nodes. */
export interface RenderPass {
  readonly kind: 'pass';
  readonly camera: Camera;
  readonly children: readonly RenderNode[];
  readonly clear: RenderPassClear;
  readonly clearColor: Rgba;
  readonly depthTest: boolean;
}

export interface RenderPassOptions {
  readonly camera: Camera;
  readonly children: readonly RenderNode[];
  /** Which buffers this pass clears before drawing. */
  readonly clear?: RenderPassClear;
  /** @defaultValue `[0, 0, 0, 0]` */
  readonly clearColor?: Rgba;
  /** Enables depth testing while drawing this pass. */
  readonly depthTest?: boolean;
}

/** Ordered render passes for a frame. */
export interface Scene {
  readonly kind: 'scene';
  readonly children: readonly RenderPass[];
}

export interface SceneOptions {
  readonly children: readonly RenderPass[];
}

/** Creates a render pass. */
export const pass = (options: RenderPassOptions): RenderPass => {
  return {
    kind: 'pass',
    camera: options.camera,
    children: options.children,
    clear: options.clear ?? 'color-depth',
    clearColor: options.clearColor ?? TRANSPARENT_BLACK,
    depthTest: options.depthTest ?? true
  };
};

/** Creates a render scene. */
export const scene = (options: SceneOptions): RenderRoot => ({
  kind: 'scene',
  children: options.children
});
