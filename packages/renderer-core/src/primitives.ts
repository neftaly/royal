import { resolveTransformDescriptor } from './descriptor-values';

/** The single coordinate convention used by every Royal public scene value. */
export interface RoyalCoordinateConvention {
  readonly angleUnit: 'radian';
  readonly handedness: 'right';
  /** Direction viewed by a camera whose rotation is `[0, 0, 0]`. */
  readonly viewForward: '-z';
  readonly linearUnit: 'metre';
  readonly up: '+y';
}

/** Royal is right-handed, +Y-up, -Z view-forward, metric, and radian-based. */
export const royalCoordinateConvention: RoyalCoordinateConvention = {
  angleUnit: 'radian',
  handedness: 'right',
  linearUnit: 'metre',
  up: '+y',
  viewForward: '-z'
};

/** A scalar distance or length in Royal world space. One unit is one metre. */
export type Metres = number;
/** Generic numeric XYZ tuple. Prefer a semantic alias at public API boundaries. */
export type Vec3 = readonly [x: number, y: number, z: number];
export type Vec4 = readonly [number, number, number, number];
/** A position in Royal world space, in metres. */
export type WorldPosition3 = readonly [x: Metres, y: Metres, z: Metres];
/** XYZ dimensions in metres before a dimensionless transform scale is applied. */
export type WorldSize3 = readonly [width: Metres, height: Metres, depth: Metres];
/** Dimensionless XYZ transform multipliers. */
export type Scale3 = readonly [x: number, y: number, z: number];
/** Royal's fixed metric scale. Exported so adapters can assert their boundary. */
export const metresPerWorldUnit = 1 as const;
/** Duration in milliseconds. */
export type Ms = number;
/** Angle in radians. */
export type Rads = number;
/** Scene-linear RGBA color. RGB values are linear, not CSS/sRGB values. */
export type LinearRgba = readonly [r: number, g: number, b: number, a: number];
/** Artist-authored normalized sRGB color accepted by `linearRgbaFromSrgb`. */
export type SrgbRgba = readonly [r: number, g: number, b: number, a: number];
/** Dimensionless world-space direction; constructors normalize where required. */
export type Direction3 = readonly [x: number, y: number, z: number];

/** Three.js-compatible `Euler(x, y, z, "XYZ")` rotation in radians. */
export type EulerRads = readonly [x: Rads, y: Rads, z: Rads];

const linearChannelFromSrgb = (value: number): number => {
  if (typeof value !== 'number') {
    throw new TypeError(`sRGB color channel must be a number; received ${String(value)}`);
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`sRGB color channel must be finite; received ${String(value)}`);
  }
  if (value < 0 || value > 1) {
    throw new RangeError(`sRGB color channel must be within 0..1; received ${String(value)}`);
  }
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
};

const normalizedAlpha = (value: number): number => {
  if (typeof value !== 'number') {
    throw new TypeError(`sRGB color alpha must be a number; received ${String(value)}`);
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`sRGB color alpha must be finite; received ${String(value)}`);
  }
  if (value < 0 || value > 1) {
    throw new RangeError(`sRGB color alpha must be within 0..1; received ${String(value)}`);
  }
  return value;
};

/** Converts an artist-authored normalized sRGB tuple to Royal's scene-linear color domain. */
export const linearRgbaFromSrgb = (color: SrgbRgba): LinearRgba => {
  if (!Array.isArray(color) || color.length !== 4) {
    throw new TypeError('sRGB color must be an array of exactly 4 numbers');
  }
  return [
    linearChannelFromSrgb(color[0]),
    linearChannelFromSrgb(color[1]),
    linearChannelFromSrgb(color[2]),
    normalizedAlpha(color[3]),
  ];
};

export interface Transform {
  /** Translation in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Dimensionless multiplier; it never changes the metre definition. */
  readonly scale: Scale3;
}

export interface TransformOptions {
  /** Translation in metres. @defaultValue `[0, 0, 0]` */
  readonly position?: WorldPosition3;
  /** XYZ Euler rotation in radians. @defaultValue `[0, 0, 0]` */
  readonly rotation?: EulerRads;
  /** Dimensionless multiplier. @defaultValue `[1, 1, 1]` */
  readonly scale?: Scale3;
}

/** Resolves an optional transform input into copied explicit position, rotation, and scale. */
export const resolveTransform = (options: TransformOptions): Transform =>
  resolveTransformDescriptor(options);
