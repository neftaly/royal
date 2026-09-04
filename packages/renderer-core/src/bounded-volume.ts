import { validateGeometry, type Geometry } from './geometry';
import {
  nonNegativeFiniteNumber,
  objectWithAllowedFields,
  positiveFiniteNumber,
  resolveRgba,
  resolveVec3,
} from './descriptor-values';
import {
  resolveTransform,
  type LinearRgba,
  type Transform,
  type TransformOptions,
  type Vec3,
} from './primitives';

export type VolumeDensityPoint = readonly [height: number, multiplier: number];

/**
 * A closed convex boundary containing a spatially stable emissive medium.
 * It is non-pickable and renders after opaque surfaces but before transmission
 * and alpha-blended surfaces.
 */
export interface BoundedVolumeNode {
  readonly kind: 'bounded-volume';
  /** Scene-linear emission RGB; alpha multiplies the medium density. */
  readonly color: LinearRgba;
  readonly densityProfile: readonly VolumeDensityPoint[];
  /** Beer-Lambert extinction coefficient in inverse Royal world metres. */
  readonly extinctionPerMetre: number;
  /** A box or a closed, outward-wound convex triangle hull with at most 32 face planes. */
  readonly geometry: Exclude<Geometry, { readonly kind: 'plane' }>;
  /** Local-space noise frequency on X, Y, and Z. */
  readonly noiseScale: Vec3;
  /** Density modulation in 0..1. */
  readonly noiseStrength: number;
  readonly transform?: Transform;
}

export interface BoundedVolumeOptions {
  /** Scene-linear emission RGB; alpha multiplies the medium density. */
  readonly color: LinearRgba;
  /** Ordered normalized local-height/density pairs. Limited to eight points. */
  readonly densityProfile?: readonly VolumeDensityPoint[];
  /** Beer-Lambert extinction coefficient in inverse Royal world metres. */
  readonly extinctionPerMetre: number;
  /** A box or a closed, outward-wound convex triangle hull with at most 32 face planes. */
  readonly geometry: Exclude<Geometry, { readonly kind: 'plane' }>;
  /** Local-space noise frequency. @defaultValue `[3, 8, 3]` */
  readonly noiseScale?: Vec3;
  /** Density modulation in 0..1. @defaultValue `0.35` */
  readonly noiseStrength?: number;
  readonly transform?: TransformOptions;
}

const DEFAULT_DENSITY_PROFILE: readonly VolumeDensityPoint[] = [
  [0, 0.5],
  [0.25, 1],
  [1, 0],
];
const FIELDS = [
  'color',
  'densityProfile',
  'extinctionPerMetre',
  'geometry',
  'noiseScale',
  'noiseStrength',
  'transform',
] as const;

const resolveDensityProfile = (
  value: readonly VolumeDensityPoint[] | undefined,
): readonly VolumeDensityPoint[] => {
  const profile = value ?? DEFAULT_DENSITY_PROFILE;
  if (!Array.isArray(profile) || profile.length < 2 || profile.length > 8) {
    throw new RangeError('bounded volume densityProfile must contain 2..8 points');
  }
  const result: VolumeDensityPoint[] = [];
  let previousHeight = -Infinity;
  for (let index = 0; index < profile.length; index += 1) {
    const point = profile[index];
    if (!Array.isArray(point) || point.length !== 2) {
      throw new TypeError(`bounded volume densityProfile[${index}] must be [height, multiplier]`);
    }
    const height = nonNegativeFiniteNumber(
      point[0],
      `bounded volume densityProfile[${index}][0]`,
    );
    if (height > 1) {
      throw new RangeError(`bounded volume densityProfile[${index}][0] must be within 0..1`);
    }
    if (height <= previousHeight) {
      throw new RangeError('bounded volume densityProfile heights must be strictly increasing');
    }
    const multiplier = nonNegativeFiniteNumber(
      point[1],
      `bounded volume densityProfile[${index}][1]`,
    );
    result.push([height, multiplier]);
    previousHeight = height;
  }
  if (result[0]![0] !== 0 || result.at(-1)![0] !== 1) {
    throw new RangeError('bounded volume densityProfile must begin at 0 and end at 1');
  }
  return result;
};

/** Creates a deterministic, non-pickable bounded participating medium. */
export const boundedVolume = (options: BoundedVolumeOptions): BoundedVolumeNode => {
  objectWithAllowedFields(options, FIELDS, 'bounded volume');
  const geometry = options.geometry as Geometry;
  validateGeometry(geometry, 'bounded volume geometry');
  if (geometry.kind === 'plane') {
    throw new TypeError('bounded volume geometry must be a closed box or convex triangle mesh');
  }
  const noiseScale = resolveVec3(options.noiseScale ?? [3, 8, 3], 'bounded volume noiseScale');
  for (let axis = 0; axis < 3; axis += 1) {
    positiveFiniteNumber(noiseScale[axis]!, `bounded volume noiseScale[${axis}]`);
  }
  const noiseStrength = nonNegativeFiniteNumber(
    options.noiseStrength ?? 0.35,
    'bounded volume noiseStrength',
  );
  if (noiseStrength > 1) {
    throw new RangeError('bounded volume noiseStrength must be within 0..1');
  }
  const transform = options.transform === undefined
    ? undefined
    : resolveTransform(options.transform);
  if (transform?.scale.some((value) => value === 0)) {
    throw new RangeError('bounded volume transform scale must be non-zero on every axis');
  }
  const node = {
    kind: 'bounded-volume',
    color: resolveRgba(options.color, 'bounded volume color'),
    densityProfile: resolveDensityProfile(options.densityProfile),
    extinctionPerMetre: positiveFiniteNumber(
      options.extinctionPerMetre,
      'bounded volume extinctionPerMetre',
    ),
    geometry,
    noiseScale,
    noiseStrength,
  } satisfies Omit<BoundedVolumeNode, 'transform'>;
  return transform === undefined
    ? node
    : { ...node, transform };
};
