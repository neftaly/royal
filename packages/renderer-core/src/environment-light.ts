import type { EulerRads } from './primitives';

export type EnvironmentLightPreset = 'studio';

export interface EnvironmentLight {
  readonly irradianceIntensity: number;
  readonly kind: 'environment-light';
  /**
   * Shared multiplier retained for simple callers. Renderers should use the
   * separate irradiance/specular intensities when available.
   */
  readonly intensity: number;
  readonly preset: EnvironmentLightPreset;
  readonly rotation: EulerRads;
  readonly specularIntensity: number;
}

export interface StudioEnvironmentOptions {
  /** Shared multiplier applied when a more specific intensity is not provided. */
  readonly intensity?: number;
  /** Multiplier for diffuse image-based irradiance. */
  readonly irradianceIntensity?: number;
  /** XYZ Euler rotation in radians. */
  readonly rotation?: EulerRads;
  /** Multiplier for specular image-based reflections. */
  readonly specularIntensity?: number;
}

const DEFAULT_ENVIRONMENT_ROTATION: EulerRads = [0, 0, 0];

const finiteIntensity = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, value);

export const studioEnvironment = (options: StudioEnvironmentOptions = {}): EnvironmentLight => ({
  irradianceIntensity: finiteIntensity(options.irradianceIntensity ?? options.intensity),
  kind: 'environment-light',
  intensity: finiteIntensity(options.intensity),
  preset: 'studio',
  rotation: options.rotation ?? DEFAULT_ENVIRONMENT_ROTATION,
  specularIntensity: finiteIntensity(options.specularIntensity ?? options.intensity)
});
