import { frozenDirection3, frozenRgba, nonNegativeFiniteNumber } from './descriptor-values';
import type { Direction3, LinearRgba } from './primitives';

/** Directional light in world space. */
export interface DirectionalLightNode {
  readonly kind: 'directional-light';
  readonly direction: Direction3;
  readonly color: LinearRgba;
  /** Incident illuminance in lux. */
  readonly illuminanceLux: number;
}

export interface DirectionalLightOptions {
  /** World-space light direction. */
  readonly direction: Direction3;
  /** Scene-linear light color. Use `linearRgbaFromSrgb` for artist-authored sRGB values. */
  readonly color?: LinearRgba;
  /** Incident illuminance in lux. */
  readonly illuminanceLux?: number;
}

const WHITE: LinearRgba = frozenRgba([1, 1, 1, 1], 'directional light color');

export const directionalLight = (options: DirectionalLightOptions): DirectionalLightNode => Object.freeze({
  kind: 'directional-light',
  direction: frozenDirection3(options.direction, 'directional light direction'),
  color: options.color === undefined ? WHITE : frozenRgba(options.color, 'directional light color'),
  illuminanceLux: nonNegativeFiniteNumber(options.illuminanceLux ?? 1, 'directional light illuminanceLux')
});
