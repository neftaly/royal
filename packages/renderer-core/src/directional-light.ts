import { frozenDirection3, frozenRgba } from './descriptor-values';
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

const nonNegativeFinite = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`);
  return value;
};

export const directionalLight = (options: DirectionalLightOptions): DirectionalLightNode => Object.freeze({
  kind: 'directional-light',
  direction: frozenDirection3(options.direction, 'directional light direction'),
  color: options.color === undefined ? WHITE : frozenRgba(options.color, 'directional light color'),
  illuminanceLux: nonNegativeFinite(options.illuminanceLux ?? 1, 'directional light illuminanceLux')
});
