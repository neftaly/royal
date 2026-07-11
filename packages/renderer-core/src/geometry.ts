import type { GeometryKind } from './kind';
import { positiveFiniteNumber } from './descriptor-values';
import type { Vec3 } from './primitives';

/** Discriminant type for built-in and custom geometry kinds. */
export type GeometryKindValue = string;

export interface Geometry<Kind extends GeometryKindValue = GeometryKind> {
  readonly kind: Kind;
}

/** Box geometry sized in world units. */
export interface BoxGeometry extends Geometry<'box'> {
  readonly size: Vec3;
}

export type BoxGeometrySizeInput = number | Vec3;

export interface BoxGeometryOptions {
  /** Box dimensions in world units. */
  readonly size: BoxGeometrySizeInput;
}

/** XY plane geometry sized in world units with UVs mapped from bottom-left to top-right. */
export interface PlaneGeometry extends Geometry<'plane'> {
  readonly size: readonly [width: number, height: number];
}

export type PlaneGeometrySizeInput = number | readonly [width: number, height: number];

export interface PlaneGeometryOptions {
  /** Plane dimensions in world units. */
  readonly size: PlaneGeometrySizeInput;
}

export type BoxGeometryInput = BoxGeometryOptions | BoxGeometrySizeInput;
export type PlaneGeometryInput = PlaneGeometryOptions | PlaneGeometrySizeInput;

const boxSize = (input: BoxGeometryInput): Vec3 => {
  const size = typeof input === 'number' ? input : 'size' in input ? input.size : input;

  const resolved = typeof size === 'number' ? [size, size, size] as const : size;
  return Object.freeze([
    positiveFiniteNumber(resolved[0], 'box geometry width'),
    positiveFiniteNumber(resolved[1], 'box geometry height'),
    positiveFiniteNumber(resolved[2], 'box geometry depth'),
  ]);
};

const planeSize = (input: PlaneGeometryInput): readonly [width: number, height: number] => {
  const size = typeof input === 'number' ? input : 'size' in input ? input.size : input;

  const resolved = typeof size === 'number' ? [size, size] as const : size;
  return Object.freeze([
    positiveFiniteNumber(resolved[0], 'plane geometry width'),
    positiveFiniteNumber(resolved[1], 'plane geometry height'),
  ]);
};

export function boxGeometry(size: number): BoxGeometry;
export function boxGeometry(size: Vec3): BoxGeometry;
export function boxGeometry(options: BoxGeometryOptions): BoxGeometry;
export function boxGeometry(input: BoxGeometryInput): BoxGeometry {
  return Object.freeze({
    kind: 'box',
    size: boxSize(input)
  });
}

export function planeGeometry(size: number): PlaneGeometry;
export function planeGeometry(size: readonly [width: number, height: number]): PlaneGeometry;
export function planeGeometry(options: PlaneGeometryOptions): PlaneGeometry;
export function planeGeometry(input: PlaneGeometryInput): PlaneGeometry {
  return Object.freeze({
    kind: 'plane',
    size: planeSize(input)
  });
}
