import {
  frozenRgba,
  frozenVec3,
  nonNegativeFiniteNumber,
  objectWithAllowedFields,
  positiveFiniteNumber,
} from './descriptor-values';
import type { LinearRgba, Metres, WorldPosition3 } from './primitives';

export interface PointLightNode {
  readonly kind: 'point-light';
  readonly color: LinearRgba;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

export interface PointLightOptions {
  /** Scene-linear light color. Use `linearRgbaFromSrgb` for artist-authored sRGB values. @defaultValue `[1, 1, 1, 1]` */
  readonly color?: LinearRgba;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

const WHITE: LinearRgba = frozenRgba([1, 1, 1, 1], 'point light color');
const POINT_LIGHT_FIELDS = ['color', 'intensityCandela', 'position', 'range'] as const;
export const pointLight = (options: PointLightOptions): PointLightNode => {
  objectWithAllowedFields(options, POINT_LIGHT_FIELDS, 'point light');
  const range = options.range === undefined
    ? undefined
    : positiveFiniteNumber(options.range, 'point light range');
  return Object.freeze({
    kind: 'point-light',
    color: options.color === undefined ? WHITE : frozenRgba(options.color, 'point light color'),
    intensityCandela: nonNegativeFiniteNumber(
      options.intensityCandela,
      'point light intensityCandela',
    ),
    position: frozenVec3(options.position, 'point light position'),
    ...(range === undefined ? {} : { range })
  });
};
