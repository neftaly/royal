import type { EulerRads } from './primitives';

export type EnvironmentLightPreset = 'studio';

export interface EnvironmentLight {
  readonly kind: 'environment-light';
  readonly intensity: number;
  readonly preset: EnvironmentLightPreset;
  readonly rotation: EulerRads;
}

export interface StudioEnvironmentOptions {
  /** Multiplier applied to diffuse irradiance and specular reflections. */
  readonly intensity?: number;
  /** XYZ Euler rotation in radians. */
  readonly rotation?: EulerRads;
}

const DEFAULT_ENVIRONMENT_ROTATION: EulerRads = [0, 0, 0];

const finiteIntensity = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, value);

export const studioEnvironment = (options: StudioEnvironmentOptions = {}): EnvironmentLight => ({
  kind: 'environment-light',
  intensity: finiteIntensity(options.intensity),
  preset: 'studio',
  rotation: options.rotation ?? DEFAULT_ENVIRONMENT_ROTATION
});
