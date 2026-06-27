export type Axis = 'x' | 'y' | 'z';
export type AxisSign = -1 | 1;

export interface AxisDirection {
  readonly axis: Axis;
  readonly sign: AxisSign;
}

export interface CoordinateSystem {
  readonly forward: AxisDirection;
  readonly handedness: 'left' | 'right';
  readonly unit: 'meter' | 'unit';
  readonly up: AxisDirection;
}

export interface SceneSource {
  readonly coordinateSystem: CoordinateSystem;
  readonly id: string;
}

/** World-space XYZ in the coordinate system declared by the scene source. */
export type Vec3 = readonly [x: number, y: number, z: number];
export type Vec4 = readonly [number, number, number, number];
/** Duration in milliseconds. */
export type Ms = number;
export type Rads = number;
/** Normalized RGBA color. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];
/** World-space direction. */
export type Direction3 = Vec3;

/** XYZ Euler rotation in radians. */
export type EulerRads = readonly [x: Rads, y: Rads, z: Rads];

export interface Transform {
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly scale: Vec3;
}

export interface TransformOptions {
  readonly position: Vec3;
  readonly rotation: EulerRads;
  /** @defaultValue `[1, 1, 1]` */
  readonly scale?: Vec3;
}

const identityScale: Vec3 = [1, 1, 1];

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

export function defineCoordinateSystem(system: CoordinateSystem): CoordinateSystem {
  if (system.up.axis === system.forward.axis) {
    throw new Error('Coordinate system up and forward axes must differ');
  }

  return system;
}

export const sceneSource = (source: SceneSource): SceneSource => ({
  coordinateSystem: defineCoordinateSystem(source.coordinateSystem),
  id: source.id
});

export const resolveTransform = (options: TransformOptions): Transform => ({
  position: options.position,
  rotation: options.rotation,
  scale: options.scale ?? identityScale
});
