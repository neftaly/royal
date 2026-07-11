import type { CameraSource } from './camera-resource';
import { frozenRgba } from './descriptor-values';
import type { EnvironmentLight } from './environment-light';
import type { Rgba } from './primitives';
import type { RenderNode } from './render-node';

const TRANSPARENT_BLACK = frozenRgba([0, 0, 0, 0], 'scene clearColor');

export type RenderToneMapping = 'linear-clamp' | 'aces-fitted' | 'pbr-neutral';

/** Public normalized scene description accepted by renderer roots. */
export interface RenderRoot {
  readonly kind: 'scene';
  readonly camera: CameraSource;
  readonly nodes: readonly RenderNode[];
  readonly clearColor: Rgba;
  readonly environment?: EnvironmentLight;
  readonly exposureEv100?: number;
  readonly toneMapping?: RenderToneMapping;
}

export interface SceneOptions {
  readonly camera: CameraSource;
  readonly nodes: readonly RenderNode[];
  /** @defaultValue `[0, 0, 0, 0]` */
  readonly clearColor?: Rgba;
  readonly environment?: EnvironmentLight;
  /** Camera exposure value at ISO 100. Higher values produce a darker image. */
  readonly exposureEv100?: number;
  /** Display transform applied to scene-linear output. */
  readonly toneMapping?: RenderToneMapping;
}

const finiteExposureEv100 = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error('scene exposureEv100 must be finite');
  return value;
};

/** Creates one public scene. Multipass planning remains renderer-private. */
export const scene = (options: SceneOptions): RenderRoot => {
  const exposureEv100 = finiteExposureEv100(options.exposureEv100);

  return Object.freeze({
    kind: 'scene',
    camera: options.camera,
    nodes: Object.freeze([...options.nodes]),
    clearColor: options.clearColor === undefined
      ? TRANSPARENT_BLACK
      : frozenRgba(options.clearColor, 'scene clearColor'),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(exposureEv100 === undefined ? {} : { exposureEv100 }),
    ...(options.toneMapping === undefined ? {} : { toneMapping: options.toneMapping })
  });
};
