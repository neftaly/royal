import type { EulerRads, LinearRgba, Transform, TransformOptions, Vec3 } from './primitives';

export const finiteNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite; received ${String(value)}`);
  return value;
};

export const positiveFiniteNumber = (value: number, label: string): number => {
  finiteNumber(value, label);
  if (!(value > 0)) throw new Error(`${label} must be positive; received ${String(value)}`);
  return value;
};

export const frozenVec3 = (value: Vec3, label: string): Vec3 => Object.freeze([
  finiteNumber(value[0], `${label}[0]`),
  finiteNumber(value[1], `${label}[1]`),
  finiteNumber(value[2], `${label}[2]`),
]) as Vec3;

export const frozenDirection3 = (value: Vec3, label: string): Vec3 => {
  const direction = frozenVec3(value, label);
  if (!(Math.hypot(direction[0], direction[1], direction[2]) > 0)) {
    throw new Error(`${label} must be non-zero`);
  }
  return direction;
};

export const frozenRgba = (value: LinearRgba, label: string): LinearRgba => Object.freeze([
  finiteNumber(value[0], `${label}[0]`),
  finiteNumber(value[1], `${label}[1]`),
  finiteNumber(value[2], `${label}[2]`),
  finiteNumber(value[3], `${label}[3]`),
]) as LinearRgba;

export const frozenTransform = (options: TransformOptions): Transform => Object.freeze({
  position: frozenVec3(options.position ?? [0, 0, 0], 'transform position'),
  rotation: frozenVec3(options.rotation ?? [0, 0, 0], 'transform rotation') as EulerRads,
  scale: frozenVec3(options.scale ?? [1, 1, 1], 'transform scale'),
});

export const frozenBounds3 = <Bounds extends { readonly max: Vec3; readonly min: Vec3 }>(
  bounds: Bounds,
  label: string,
): Bounds => {
  const min = frozenVec3(bounds.min, `${label} min`);
  const max = frozenVec3(bounds.max, `${label} max`);
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis]! > max[axis]!) throw new Error(`${label} min must not exceed max`);
  }
  return Object.freeze({ min, max }) as Bounds;
};

export const nonEmptyString = (value: string, label: string): string => {
  if (value.length === 0) throw new Error(`${label} must not be empty`);
  return value;
};
