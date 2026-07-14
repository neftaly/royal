import { positiveFiniteNumber } from './descriptor-values';
import type { Metres, WorldSize3 } from './primitives';

interface GeometryDescriptor<Kind extends string> {
  readonly kind: Kind;
}

/** Box geometry with physical dimensions in metres. */
export interface BoxGeometry extends GeometryDescriptor<'box'> {
  readonly size: WorldSize3;
}

export type BoxGeometrySizeInput = Metres | WorldSize3;

export interface BoxGeometryOptions {
  /** Box dimensions in metres. A scalar creates a metre-sized cube. */
  readonly size: BoxGeometrySizeInput;
}

/** XY plane geometry sized in metres with UVs mapped from bottom-left to top-right. */
export interface PlaneGeometry extends GeometryDescriptor<'plane'> {
  readonly size: readonly [width: Metres, height: Metres];
}

export type PlaneGeometrySizeInput = Metres | readonly [width: Metres, height: Metres];

export interface PlaneGeometryOptions {
  /** Plane dimensions in metres. A scalar creates a metre-sized square. */
  readonly size: PlaneGeometrySizeInput;
}

export type BoxGeometryInput = BoxGeometryOptions | BoxGeometrySizeInput;
export type PlaneGeometryInput = PlaneGeometryOptions | PlaneGeometrySizeInput;

/** Geometry supported by Royal's public mesh node. */
export type Geometry = BoxGeometry | PlaneGeometry;

const boxSize = (input: BoxGeometryInput): WorldSize3 => {
  const size = typeof input === 'number' ? input : 'size' in input ? input.size : input;

  const resolved = typeof size === 'number' ? [size, size, size] as const : size;
  return Object.freeze([
    positiveFiniteNumber(resolved[0], 'box geometry width'),
    positiveFiniteNumber(resolved[1], 'box geometry height'),
    positiveFiniteNumber(resolved[2], 'box geometry depth'),
  ]);
};

const planeSize = (input: PlaneGeometryInput): readonly [width: Metres, height: Metres] => {
  const size = typeof input === 'number' ? input : 'size' in input ? input.size : input;

  const resolved = typeof size === 'number' ? [size, size] as const : size;
  return Object.freeze([
    positiveFiniteNumber(resolved[0], 'plane geometry width'),
    positiveFiniteNumber(resolved[1], 'plane geometry height'),
  ]);
};

export function boxGeometry(size: Metres): BoxGeometry;
export function boxGeometry(size: WorldSize3): BoxGeometry;
export function boxGeometry(options: BoxGeometryOptions): BoxGeometry;
export function boxGeometry(input: BoxGeometryInput): BoxGeometry {
  return Object.freeze({
    kind: 'box',
    size: boxSize(input)
  });
}

export function planeGeometry(size: Metres): PlaneGeometry;
export function planeGeometry(size: readonly [width: Metres, height: Metres]): PlaneGeometry;
export function planeGeometry(options: PlaneGeometryOptions): PlaneGeometry;
export function planeGeometry(input: PlaneGeometryInput): PlaneGeometry {
  return Object.freeze({
    kind: 'plane',
    size: planeSize(input)
  });
}
