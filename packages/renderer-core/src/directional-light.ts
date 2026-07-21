import {
  resolveDirection3,
  resolveRgba,
  nonNegativeFiniteNumber,
  objectWithAllowedFields,
} from './descriptor-values';
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
  /** Normalized world-space direction in which light rays travel. */
  readonly direction: Direction3;
  /** Scene-linear light color. Use `linearRgbaFromSrgb` for artist-authored sRGB values. @defaultValue `[1, 1, 1, 1]` */
  readonly color?: LinearRgba;
  /** Incident illuminance in lux. @defaultValue `1` */
  readonly illuminanceLux?: number;
}

const DEFAULT_LIGHT_COLOR: LinearRgba = [1, 1, 1, 1];
const DIRECTIONAL_LIGHT_FIELDS = ['color', 'direction', 'illuminanceLux'] as const;

/** Creates an infinite world-space directional light. */
export const directionalLight = (options: DirectionalLightOptions): DirectionalLightNode => {
  objectWithAllowedFields(options, DIRECTIONAL_LIGHT_FIELDS, 'directional light');
  return {
    kind: 'directional-light',
    direction: resolveDirection3(options.direction, 'directional light direction'),
    color: resolveRgba(options.color ?? DEFAULT_LIGHT_COLOR, 'directional light color'),
    illuminanceLux: nonNegativeFiniteNumber(options.illuminanceLux ?? 1, 'directional light illuminanceLux')
  };
};
