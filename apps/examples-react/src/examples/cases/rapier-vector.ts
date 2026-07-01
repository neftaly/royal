import type { Vec3 } from './rapier-runtime';

export const zeroVec3 = [0, 0, 0] satisfies Vec3;

export const vector = ([x, y, z]: Vec3): { readonly x: number; readonly y: number; readonly z: number } => ({
  x,
  y,
  z,
});

export const distanceVec3 = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
};

export const horizontalDistanceVec3 = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dz);
};

export const lengthVec3 = (value: Vec3): number => distanceVec3(value, zeroVec3);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const addVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

export const subtractVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

export const scaleVec3 = (value: Vec3, scale: number): Vec3 => [
  value[0] * scale,
  value[1] * scale,
  value[2] * scale,
];

export const normalizeVec3 = (value: Vec3): Vec3 => {
  const length = lengthVec3(value);
  if (length <= 0.000_001) return [1, 0, 0];

  return scaleVec3(value, 1 / length);
};

export const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const vec3AtDistance = (
  origin: Vec3,
  direction: Vec3,
  distance: number,
): Vec3 => addVec3(origin, scaleVec3(direction, distance));
