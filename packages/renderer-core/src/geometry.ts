import { objectWithAllowedFields, positiveFiniteNumber } from './descriptor-values';
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

const GEOMETRY_OPTION_FIELDS = ['size'] as const;
const GEOMETRY_DESCRIPTOR_FIELDS = ['kind', 'size'] as const;
const isBoxSizeTuple = (input: BoxGeometryInput): input is WorldSize3 => Array.isArray(input);
const isPlaneSizeTuple = (
  input: PlaneGeometryInput,
): input is readonly [width: Metres, height: Metres] => Array.isArray(input);

/** @internal Validates structurally supplied geometry at node boundaries. */
export const validateGeometry: (
  value: unknown,
  label: string,
) => asserts value is Geometry = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a boxGeometry or planeGeometry descriptor`);
  }
  for (const field of Object.keys(value)) {
    if (!GEOMETRY_DESCRIPTOR_FIELDS.includes(field as (typeof GEOMETRY_DESCRIPTOR_FIELDS)[number])) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(field)}`);
    }
  }
  const descriptor = value as { readonly kind?: unknown; readonly size?: unknown };
  const dimensions = descriptor.kind === 'box' ? 3 : descriptor.kind === 'plane' ? 2 : 0;
  if (dimensions === 0 || !Array.isArray(descriptor.size) || descriptor.size.length !== dimensions) {
    throw new TypeError(`${label} must be a boxGeometry or planeGeometry descriptor`);
  }
  for (let axis = 0; axis < dimensions; axis += 1) {
    positiveFiniteNumber(descriptor.size[axis] as number, `${label} size[${axis}]`);
  }
};

const boxSize = (input: BoxGeometryInput): WorldSize3 => {
  const size = typeof input === 'number' || isBoxSizeTuple(input)
    ? input
    : objectWithAllowedFields(input, GEOMETRY_OPTION_FIELDS, 'box geometry').size;

  const resolved = typeof size === 'number' ? [size, size, size] as const : size;
  return [
    positiveFiniteNumber(resolved[0], 'box geometry width'),
    positiveFiniteNumber(resolved[1], 'box geometry height'),
    positiveFiniteNumber(resolved[2], 'box geometry depth'),
  ];
};

const planeSize = (input: PlaneGeometryInput): readonly [width: Metres, height: Metres] => {
  const size = typeof input === 'number' || isPlaneSizeTuple(input)
    ? input
    : objectWithAllowedFields(input, GEOMETRY_OPTION_FIELDS, 'plane geometry').size;

  const resolved = typeof size === 'number' ? [size, size] as const : size;
  return [
    positiveFiniteNumber(resolved[0], 'plane geometry width'),
    positiveFiniteNumber(resolved[1], 'plane geometry height'),
  ];
};

export function boxGeometry(size: Metres): BoxGeometry;
export function boxGeometry(size: WorldSize3): BoxGeometry;
export function boxGeometry(options: BoxGeometryOptions): BoxGeometry;
export function boxGeometry(input: BoxGeometryInput): BoxGeometry {
  return {
    kind: 'box',
    size: boxSize(input)
  };
}

export function planeGeometry(size: Metres): PlaneGeometry;
export function planeGeometry(size: readonly [width: Metres, height: Metres]): PlaneGeometry;
export function planeGeometry(options: PlaneGeometryOptions): PlaneGeometry;
export function planeGeometry(input: PlaneGeometryInput): PlaneGeometry {
  return {
    kind: 'plane',
    size: planeSize(input)
  };
}
