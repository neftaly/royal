import {
  resolveVec3,
  identityScalar,
  nonEmptyString,
  nonNegativeFiniteNumber,
  objectWithAllowedFields,
} from './descriptor-values';
import type { EulerRads } from './primitives';

interface EnvironmentLightBase {
  readonly kind: 'environment-light';
  /** Linear scene-referred environment radiance scale in cd/m² per preset unit. */
  readonly radianceScaleNits: number;
  readonly rotation: EulerRads;
}

export interface StudioEnvironmentLight extends EnvironmentLightBase {
  readonly source: 'studio';
}

/** Offline-prefiltered Royal environment artifact. Raw HDR images are not accepted at runtime. */
export interface PrefilteredEnvironmentLight extends EnvironmentLightBase {
  readonly source: 'royal-prefiltered-v1';
  /** URL of a Royal prefiltered KTX 1 environment artifact. */
  readonly src: string;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
  readonly version?: number | string;
}

export type EnvironmentLight = StudioEnvironmentLight | PrefilteredEnvironmentLight;

export interface StudioEnvironmentOptions {
  /** Linear scene-referred environment radiance scale in cd/m² per preset unit. @defaultValue `1` */
  readonly radianceScaleNits?: number;
  /** XYZ Euler rotation in radians. @defaultValue `[0, 0, 0]` */
  readonly rotation?: EulerRads;
}

const DEFAULT_ENVIRONMENT_ROTATION: EulerRads = [0, 0, 0];
const STUDIO_ENVIRONMENT_FIELDS = ['radianceScaleNits', 'rotation'] as const;

/** Creates Royal's built-in studio image-based-lighting environment. */
export const studioEnvironment = (options: StudioEnvironmentOptions = {}): StudioEnvironmentLight => {
  objectWithAllowedFields(options, STUDIO_ENVIRONMENT_FIELDS, 'studio environment');
  return {
    kind: 'environment-light',
    source: 'studio',
    radianceScaleNits: nonNegativeFiniteNumber(
      options.radianceScaleNits ?? 1,
      'environment radianceScaleNits',
    ),
    rotation: resolveVec3(
      options.rotation ?? DEFAULT_ENVIRONMENT_ROTATION,
      'environment rotation',
    ) as EulerRads,
  };
};

export interface PrefilteredEnvironmentOptions extends StudioEnvironmentOptions {
  /** URL of a Royal prefiltered KTX 1 environment artifact. */
  readonly src: string;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
  readonly version?: number | string;
}

const PREFILTERED_ENVIRONMENT_FIELDS = [
  'radianceScaleNits', 'rotation', 'src', 'version',
] as const;

/** Uses an offline-filtered cubemap and spherical harmonics without runtime convolution. */
export const prefilteredEnvironment = (
  options: PrefilteredEnvironmentOptions,
): PrefilteredEnvironmentLight => {
  objectWithAllowedFields(options, PREFILTERED_ENVIRONMENT_FIELDS, 'prefiltered environment');
  const version = options.version === undefined
    ? undefined
    : identityScalar(options.version, 'prefiltered environment version');
  return {
    kind: 'environment-light',
    source: 'royal-prefiltered-v1',
    src: nonEmptyString(options.src, 'prefiltered environment source'),
    ...(version === undefined ? {} : { version }),
    radianceScaleNits: nonNegativeFiniteNumber(
      options.radianceScaleNits ?? 1,
      'environment radianceScaleNits',
    ),
    rotation: resolveVec3(
      options.rotation ?? DEFAULT_ENVIRONMENT_ROTATION,
      'environment rotation',
    ) as EulerRads,
  };
};
