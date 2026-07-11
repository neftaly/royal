import { finiteNumber, frozenVec3 } from './descriptor-values';
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

const finiteRadiance = (value: number | undefined): number => {
  if (value === undefined) return 1;
  finiteNumber(value, 'environment radianceScaleNits');
  if (value < 0) throw new Error('environment radianceScaleNits must be non-negative');
  return value;
};

export const studioEnvironment = (options: StudioEnvironmentOptions = {}): EnvironmentLight => Object.freeze({
  kind: 'environment-light',
  preset: 'studio',
  radianceScaleNits: finiteRadiance(options.radianceScaleNits),
  rotation: options.rotation === undefined
    ? DEFAULT_ENVIRONMENT_ROTATION
    : frozenVec3(options.rotation, 'environment rotation') as EulerRads,
});
