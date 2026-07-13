import { frozenTransform, nonEmptyString } from './descriptor-values';

export type Axis = 'x' | 'y' | 'z';
export type AxisSign = -1 | 1;

export interface AxisDirection {
  readonly axis: Axis;
  readonly sign: AxisSign;
}

export interface CoordinateSystem {
  readonly forward: AxisDirection;
  readonly handedness: 'left' | 'right';
  /**
   * Linear unit used by source coordinates. Royal world space is metric.
   *
   * `unit` is a legacy spelling for a source whose units already represent
   * metres; it does not introduce an arbitrary or scale-free world unit.
   * @deprecated Prefer `meter`.
   */
  readonly unit: 'meter' | 'unit';
  readonly up: AxisDirection;
}

export interface SceneSource {
  readonly coordinateSystem: CoordinateSystem;
  readonly id: string;
}

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
/** Normalized RGBA color. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];
/** Dimensionless world-space direction; constructors normalize where required. */
export type Direction3 = readonly [x: number, y: number, z: number];

/** XYZ Euler rotation in radians. */
export type EulerRads = readonly [x: Rads, y: Rads, z: Rads];

export interface Transform {
  /** Translation in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Dimensionless multiplier; it never changes the metre definition. */
  readonly scale: Scale3;
}

export interface TransformOptions {
  /** Translation in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Dimensionless multiplier. @defaultValue `[1, 1, 1]` */
  readonly scale?: Scale3;
}

export const defineCoordinateSystem = (system: CoordinateSystem): CoordinateSystem => {
  if (system.up.axis === system.forward.axis) {
    throw new Error('Coordinate system up and forward axes must differ');
  }
  if (system.unit !== 'meter' && system.unit !== 'unit') {
    throw new Error('Coordinate system unit must be meter');
  }

  return Object.freeze({
    forward: Object.freeze({ ...system.forward }),
    handedness: system.handedness,
    unit: system.unit,
    up: Object.freeze({ ...system.up }),
  });
};

export const zUpLeftHanded: CoordinateSystem = defineCoordinateSystem({
  forward: { axis: 'y', sign: 1 },
  handedness: 'left',
  unit: 'meter',
  up: { axis: 'z', sign: 1 }
});

export const yUpRightHanded: CoordinateSystem = defineCoordinateSystem({
  forward: { axis: 'z', sign: -1 },
  handedness: 'right',
  unit: 'meter',
  up: { axis: 'y', sign: 1 }
});

export const sceneSource = (source: SceneSource): SceneSource => Object.freeze({
  coordinateSystem: defineCoordinateSystem(source.coordinateSystem),
  id: nonEmptyString(source.id, 'scene source id')
});

export const resolveTransform = (options: TransformOptions): Transform => frozenTransform(options);
