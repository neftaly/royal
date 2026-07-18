import type { CameraSource } from './camera-resource';
import { resolveRgba, objectWithAllowedFields, stringChoice } from './descriptor-values';
import type { EnvironmentLight } from './environment-light';
import type { LinearRgba } from './primitives';
import type { RenderNode } from './render-node';

const TRANSPARENT_BLACK = resolveRgba([0, 0, 0, 0], 'scene clearColor');
const RENDER_TONE_MAPPINGS = ['linear-clamp', 'pbr-neutral'] as const;
const MIN_EXPOSURE_EV100 = -128;
const MAX_EXPOSURE_EV100 = 149;
const SCENE_OPTION_FIELDS = [
  'camera', 'clearColor', 'environment', 'exposureEv100', 'nodes', 'toneMapping',
] as const;

export type RenderToneMapping = 'linear-clamp' | 'pbr-neutral';

/** Public normalized scene description accepted by renderer roots. */
export interface RenderRoot {
  readonly kind: 'scene';
  readonly camera: CameraSource;
  readonly nodes: readonly RenderNode[];
  readonly clearColor: LinearRgba;
  readonly environment?: EnvironmentLight;
  readonly exposureEv100?: number;
  readonly toneMapping?: RenderToneMapping;
}

export interface SceneOptions {
  readonly camera: CameraSource;
  readonly nodes: readonly RenderNode[];
  /** @defaultValue `[0, 0, 0, 0]` */
  readonly clearColor?: LinearRgba;
  readonly environment?: EnvironmentLight;
  /** Camera exposure value at ISO 100 in `[-128, 149]`. Higher values produce a darker image. */
  readonly exposureEv100?: number;
  /** Display transform applied to scene-linear output. @defaultValue `"pbr-neutral"` */
  readonly toneMapping?: RenderToneMapping;
}

const finiteExposureEv100 = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error('scene exposureEv100 must be finite');
  if (value < MIN_EXPOSURE_EV100 || value > MAX_EXPOSURE_EV100) {
    throw new RangeError(
      `scene exposureEv100 must be within ${MIN_EXPOSURE_EV100}..${MAX_EXPOSURE_EV100}`
    );
  }
  return value;
};

/** Creates one public scene. Multipass planning remains renderer-private. */
export const scene = (options: SceneOptions): RenderRoot => {
  objectWithAllowedFields(options, SCENE_OPTION_FIELDS, 'scene');
  const exposureEv100 = finiteExposureEv100(options.exposureEv100);
  const toneMapping = options.toneMapping === undefined
    ? undefined
    : stringChoice(options.toneMapping, RENDER_TONE_MAPPINGS, 'scene toneMapping');

  return {
    kind: 'scene',
    camera: options.camera,
    nodes: [...options.nodes],
    clearColor: options.clearColor === undefined
      ? TRANSPARENT_BLACK
      : resolveRgba(options.clearColor, 'scene clearColor'),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(exposureEv100 === undefined ? {} : { exposureEv100 }),
    ...(toneMapping === undefined ? {} : { toneMapping })
  };
};
