import {
  finiteNumber,
  nonNegativeFiniteNumber,
  objectWithAllowedFields,
  positiveFiniteNumber,
  resolveDirection3,
  resolveRgba,
  resolveVec3,
} from './descriptor-values';
import type { Direction3, LinearRgba, Metres, Rads, WorldPosition3 } from './primitives';

export interface SpotLightNode {
  readonly kind: 'spot-light';
  readonly color: LinearRgba;
  readonly direction: Direction3;
  readonly innerConeAngle: Rads;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  readonly outerConeAngle: Rads;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

export interface SpotLightOptions {
  /** Scene-linear light color. Use `linearRgbaFromSrgb` for artist-authored sRGB values. @defaultValue `[1, 1, 1, 1]` */
  readonly color?: LinearRgba;
  /** Normalized world-space direction from the light toward the cone. */
  readonly direction: Direction3;
  /** Inner cone angle in radians. @defaultValue `0` */
  readonly innerConeAngle?: Rads;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  /** Outer cone angle in radians. @defaultValue `Math.PI / 4` */
  readonly outerConeAngle?: Rads;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

const WHITE: LinearRgba = resolveRgba([1, 1, 1, 1], 'spot light color');
const SPOT_LIGHT_FIELDS = [
  'color', 'direction', 'innerConeAngle', 'intensityCandela', 'outerConeAngle', 'position', 'range',
] as const;
export const spotLight = (options: SpotLightOptions): SpotLightNode => {
  objectWithAllowedFields(options, SPOT_LIGHT_FIELDS, 'spot light');
  const outerConeAngle = options.outerConeAngle ?? Math.PI / 4;
  const innerConeAngle = options.innerConeAngle ?? 0;
  finiteNumber(outerConeAngle, 'spot light outerConeAngle');
  finiteNumber(innerConeAngle, 'spot light innerConeAngle');
  if (outerConeAngle <= 0 || outerConeAngle > Math.PI / 2) {
    throw new RangeError('spot light outerConeAngle must be in (0, PI/2]');
  }
  if (innerConeAngle < 0 || innerConeAngle >= outerConeAngle) {
    throw new RangeError('spot light innerConeAngle must be in [0, outerConeAngle)');
  }
  return {
    kind: 'spot-light',
    color: options.color === undefined ? WHITE : resolveRgba(options.color, 'spot light color'),
    direction: resolveDirection3(options.direction, 'spot light direction'),
    innerConeAngle,
    intensityCandela: nonNegativeFiniteNumber(
      options.intensityCandela,
      'spot light intensityCandela',
    ),
    outerConeAngle,
    position: resolveVec3(options.position, 'spot light position'),
    ...(options.range === undefined
      ? {}
      : { range: positiveFiniteNumber(options.range, 'spot light range') })
  };
};
