import { frozenVec3, nonNegativeFiniteNumber } from './descriptor-values';
import type { EulerRads } from './primitives';

export type EnvironmentLightPreset = 'studio';

export interface EnvironmentLight {
  readonly kind: 'environment-light';
  readonly preset: EnvironmentLightPreset;
  /** Linear scene-referred environment radiance scale in cd/m² per preset unit. */
  readonly radianceScaleNits: number;
  readonly rotation: EulerRads;
}

export interface StudioEnvironmentOptions {
  /** Linear scene-referred environment radiance scale in cd/m² per preset unit. */
  readonly radianceScaleNits?: number;
  /** XYZ Euler rotation in radians. */
  readonly rotation?: EulerRads;
}

const DEFAULT_ENVIRONMENT_ROTATION = frozenVec3([0, 0, 0], 'environment rotation') as EulerRads;

export const studioEnvironment = (options: StudioEnvironmentOptions = {}): EnvironmentLight => Object.freeze({
  kind: 'environment-light',
  preset: 'studio',
  radianceScaleNits: nonNegativeFiniteNumber(
    options.radianceScaleNits ?? 1,
    'environment radianceScaleNits',
  ),
  rotation: options.rotation === undefined
    ? DEFAULT_ENVIRONMENT_ROTATION
    : frozenVec3(options.rotation, 'environment rotation') as EulerRads,
});
