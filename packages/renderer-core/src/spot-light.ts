import {
  frozenDirection3,
  frozenRgba,
  frozenVec3,
  nonNegativeFiniteNumber,
  positiveFiniteNumber,
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
  /** Scene-linear light color. Use `linearRgbaFromSrgb` for artist-authored sRGB values. */
  readonly color?: LinearRgba;
  readonly direction: Direction3;
  /** Inner cone angle in radians. */
  readonly innerConeAngle?: Rads;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  /** Outer cone angle in radians. */
  readonly outerConeAngle?: Rads;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

const WHITE: LinearRgba = frozenRgba([1, 1, 1, 1], 'spot light color');
export const spotLight = (options: SpotLightOptions): SpotLightNode => {
  const outerConeAngle = options.outerConeAngle ?? Math.PI / 4;
  const innerConeAngle = options.innerConeAngle ?? 0;
  if (!Number.isFinite(outerConeAngle) || outerConeAngle <= 0 || outerConeAngle > Math.PI / 2) {
    throw new Error('spot light outerConeAngle must be in (0, PI/2]');
  }
  if (!Number.isFinite(innerConeAngle) || innerConeAngle < 0 || innerConeAngle >= outerConeAngle) {
    throw new Error('spot light innerConeAngle must be in [0, outerConeAngle)');
  }
  return Object.freeze({
    kind: 'spot-light',
    color: options.color === undefined ? WHITE : frozenRgba(options.color, 'spot light color'),
    direction: frozenDirection3(options.direction, 'spot light direction'),
    innerConeAngle,
    intensityCandela: nonNegativeFiniteNumber(
      options.intensityCandela,
      'spot light intensityCandela',
    ),
    outerConeAngle,
    position: frozenVec3(options.position, 'spot light position'),
    ...(options.range === undefined
      ? {}
      : { range: positiveFiniteNumber(options.range, 'spot light range') })
  });
};
