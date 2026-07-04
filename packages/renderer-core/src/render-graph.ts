import type { Camera } from './camera';
import type { EnvironmentLight } from './environment-light';
import type { Rgba } from './primitives';
import type { RenderNode } from './render-node';

const TRANSPARENT_BLACK: Rgba = [0, 0, 0, 0];

export type RenderPassClear = 'color-depth' | 'color' | 'depth' | 'none';
export type RenderToneMapping = 'none' | 'aces';

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
  readonly environment?: EnvironmentLight;
  readonly exposure?: number;
  readonly toneMapping?: RenderToneMapping;
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
  /** Scene-authored image-based environment lighting for this pass. */
  readonly environment?: EnvironmentLight;
  /** Linear exposure multiplier applied to lit surface output. */
  readonly exposure?: number;
  /** Tone mapping applied to lit surface output. Defaults to Three-style none. */
  readonly toneMapping?: RenderToneMapping;
}

const finiteExposure = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, value);

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
  const exposure = finiteExposure(options.exposure);

  return {
    kind: 'pass',
    camera: options.camera,
    children: options.children,
    clear: options.clear ?? 'color-depth',
    clearColor: options.clearColor ?? TRANSPARENT_BLACK,
    depthTest: options.depthTest ?? true,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(exposure === undefined ? {} : { exposure }),
    ...(options.toneMapping === undefined ? {} : { toneMapping: options.toneMapping })
  };
};

/** Creates a render scene. */
export const scene = (options: SceneOptions): RenderRoot => ({
  kind: 'scene',
  children: options.children
});
