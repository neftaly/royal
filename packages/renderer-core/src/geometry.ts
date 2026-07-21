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

/** XY plane geometry sized in metres with upper-left-origin UVs covering the full surface. */
export interface PlaneGeometry extends GeometryDescriptor<'plane'> {
  readonly size: readonly [width: Metres, height: Metres];
}

export type PlaneGeometrySizeInput = Metres | readonly [width: Metres, height: Metres];

export interface PlaneGeometryOptions {
  /** Plane dimensions in metres. A scalar creates a metre-sized square. */
  readonly size: PlaneGeometrySizeInput;
}

export type TriangleGeometryIndices = Uint8Array | Uint16Array | Uint32Array;

/** Caller-authored indexed triangles in Royal local space. */
export interface TriangleGeometry extends GeometryDescriptor<'triangles'> {
  readonly indices: TriangleGeometryIndices;
  /** Optional packed non-zero XYZ normals (`vertexCount * 3`). */
  readonly normals?: Float32Array;
  /** Packed XYZ positions in metres (`vertexCount * 3`). */
  readonly positions: Float32Array;
  /** Optional packed UV coordinates (`vertexCount * 2`); V=0 is the texture's upper edge. */
  readonly textureCoordinates?: Float32Array;
}

export interface TriangleGeometryOptions {
  /** Optional triangle-list indices. Omit for sequential triangle-soup vertices. */
  readonly indices?: ArrayLike<number>;
  /** Optional packed non-zero XYZ normals (`vertexCount * 3`). */
  readonly normals?: ArrayLike<number>;
  /** Packed XYZ positions in metres (`vertexCount * 3`). */
  readonly positions: ArrayLike<number>;
  /** Optional packed UV coordinates (`vertexCount * 2`); V=0 is the texture's upper edge. */
  readonly textureCoordinates?: ArrayLike<number>;
}

export type BoxGeometryInput = BoxGeometryOptions | BoxGeometrySizeInput;
export type PlaneGeometryInput = PlaneGeometryOptions | PlaneGeometrySizeInput;

/** Geometry supported by Royal's public mesh and exact picking paths. */
export type Geometry = BoxGeometry | PlaneGeometry | TriangleGeometry;

const GEOMETRY_OPTION_FIELDS = ['size'] as const;
const GEOMETRY_DESCRIPTOR_FIELDS = ['kind', 'size'] as const;
const TRIANGLE_GEOMETRY_FIELDS = [
  'indices', 'kind', 'normals', 'positions', 'textureCoordinates',
] as const;
const TRIANGLE_GEOMETRY_OPTION_FIELDS = [
  'indices', 'normals', 'positions', 'textureCoordinates',
] as const;
const isBoxSizeTuple = (input: BoxGeometryInput): input is WorldSize3 => Array.isArray(input);
const isPlaneSizeTuple = (
  input: PlaneGeometryInput,
): input is readonly [width: Metres, height: Metres] => Array.isArray(input);
const typedArrayTag = (value: unknown): string => Object.prototype.toString.call(value);
const isFloat32Array = (value: unknown): value is Float32Array =>
  typedArrayTag(value) === '[object Float32Array]';
const isTriangleIndexArray = (value: unknown): value is TriangleGeometryIndices => {
  const tag = typedArrayTag(value);
  return tag === '[object Uint8Array]'
    || tag === '[object Uint16Array]'
    || tag === '[object Uint32Array]';
};

const validateFiniteChannel = (values: Float32Array, label: string): void => {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new TypeError(`${label}[${index}] must be finite`);
    }
  }
};

const validateTriangleChannels = (geometry: TriangleGeometry, label: string): void => {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.positions.length < 9 || !Number.isInteger(vertexCount)) {
    throw new TypeError(`${label}.positions must contain at least three packed XYZ positions`);
  }
  if (geometry.indices.length < 3 || geometry.indices.length % 3 !== 0) {
    throw new TypeError(`${label}.indices must contain complete triangles`);
  }
  if (geometry.normals !== undefined && geometry.normals.length !== vertexCount * 3) {
    throw new TypeError(`${label}.normals must contain one packed XYZ normal per vertex`);
  }
  if (
    geometry.textureCoordinates !== undefined
    && geometry.textureCoordinates.length !== vertexCount * 2
  ) throw new TypeError(`${label}.textureCoordinates must contain one packed UV per vertex`);
  validateFiniteChannel(geometry.positions, `${label}.positions`);
  if (geometry.normals !== undefined) {
    validateFiniteChannel(geometry.normals, `${label}.normals`);
    for (let offset = 0; offset < geometry.normals.length; offset += 3) {
      if (Math.hypot(
        geometry.normals[offset]!,
        geometry.normals[offset + 1]!,
        geometry.normals[offset + 2]!,
      ) === 0) throw new RangeError(`${label}.normals[${offset / 3}] must be non-zero`);
    }
  }
  if (geometry.textureCoordinates !== undefined) {
    validateFiniteChannel(geometry.textureCoordinates, `${label}.textureCoordinates`);
  }
  for (let index = 0; index < geometry.indices.length; index += 1) {
    if (geometry.indices[index]! >= vertexCount) {
      throw new RangeError(`${label}.indices[${index}] must reference a vertex`);
    }
  }
};

/** @internal Validates structurally supplied geometry at node boundaries. */
export const validateGeometry: (
  value: unknown,
  label: string,
) => asserts value is Geometry = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a Royal geometry descriptor`);
  }
  const descriptor = value as { readonly kind?: unknown; readonly size?: unknown };
  if (descriptor.kind === 'triangles') {
    objectWithAllowedFields(value, TRIANGLE_GEOMETRY_FIELDS, label);
    const triangle = value as Partial<TriangleGeometry>;
    if (!isFloat32Array(triangle.positions)) {
      throw new TypeError(`${label}.positions must be the Float32Array created by triangleGeometry`);
    }
    if (!isTriangleIndexArray(triangle.indices)) {
      throw new TypeError(`${label}.indices must be the unsigned typed array created by triangleGeometry`);
    }
    if (triangle.normals !== undefined && !isFloat32Array(triangle.normals)) {
      throw new TypeError(`${label}.normals must be a Float32Array when provided`);
    }
    if (
      triangle.textureCoordinates !== undefined
      && !isFloat32Array(triangle.textureCoordinates)
    ) throw new TypeError(`${label}.textureCoordinates must be a Float32Array when provided`);
    validateTriangleChannels(triangle as TriangleGeometry, label);
    return;
  }
  for (const field of Reflect.ownKeys(value)) {
    if (
      typeof field !== 'string'
      || !GEOMETRY_DESCRIPTOR_FIELDS.includes(field as (typeof GEOMETRY_DESCRIPTOR_FIELDS)[number])
    ) {
      const name = typeof field === 'string' ? JSON.stringify(field) : String(field);
      throw new TypeError(`${label} contains unsupported field ${name}`);
    }
  }
  const dimensions = descriptor.kind === 'box' ? 3 : descriptor.kind === 'plane' ? 2 : 0;
  if (dimensions === 0 || !Array.isArray(descriptor.size) || descriptor.size.length !== dimensions) {
    throw new TypeError(
      `${label} must be a boxGeometry, planeGeometry, or triangleGeometry descriptor`,
    );
  }
  for (let axis = 0; axis < dimensions; axis += 1) {
    positiveFiniteNumber(descriptor.size[axis] as number, `${label} size[${axis}]`);
  }
};

const finiteFloat32Channel = (
  source: unknown,
  multiple: number,
  label: string,
): Float32Array => {
  if (typeof source !== 'object' || source === null) {
    throw new TypeError(`${label} must be an array-like object`);
  }
  const valuesSource = source as ArrayLike<unknown>;
  if (
    !Number.isSafeInteger(valuesSource.length)
    || valuesSource.length < multiple
    || valuesSource.length % multiple !== 0
  ) {
    throw new TypeError(`${label} must contain a positive multiple of ${multiple} numbers`);
  }
  const values = new Float32Array(valuesSource.length);
  for (let index = 0; index < valuesSource.length; index += 1) {
    const value = valuesSource[index];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${label}[${index}] must be finite`);
    }
    values[index] = value;
    if (!Number.isFinite(values[index])) {
      throw new RangeError(`${label}[${index}] cannot be represented as a finite float`);
    }
  }
  return values;
};

const canonicalTriangleIndices = (
  source: unknown,
  vertexCount: number,
): TriangleGeometryIndices => {
  if (source !== undefined && (typeof source !== 'object' || source === null)) {
    throw new TypeError('triangle geometry indices must be an array-like object');
  }
  const indicesSource = source as ArrayLike<unknown> | undefined;
  const length = indicesSource?.length ?? vertexCount;
  if (!Number.isSafeInteger(length) || length < 3 || length % 3 !== 0) {
    throw new TypeError('triangle geometry indices must contain a positive multiple of 3 values');
  }
  if (source === undefined && vertexCount % 3 !== 0) {
    throw new TypeError('triangle geometry without indices requires a triangle-soup vertex count');
  }
  const indices: TriangleGeometryIndices = vertexCount <= 0x100
    ? new Uint8Array(length)
    : vertexCount <= 0x1_00_00 ? new Uint16Array(length) : new Uint32Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = indicesSource?.[index] ?? index;
    if (
      typeof value !== 'number'
      || !Number.isSafeInteger(value)
      || value < 0
      || value >= vertexCount
    ) {
      throw new RangeError(`triangle geometry indices[${index}] must reference a vertex`);
    }
    indices[index] = value;
  }
  return indices;
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

/** Copies and validates one caller-authored local-space triangle surface. */
export const triangleGeometry = (options: TriangleGeometryOptions): TriangleGeometry => {
  objectWithAllowedFields(options, TRIANGLE_GEOMETRY_OPTION_FIELDS, 'triangle geometry');
  const positions = finiteFloat32Channel(options.positions, 3, 'triangle geometry positions');
  if (positions.length < 9) {
    throw new TypeError('triangle geometry positions must contain at least three vertices');
  }
  const vertexCount = positions.length / 3;
  const normals = options.normals === undefined
    ? undefined
    : finiteFloat32Channel(options.normals, 3, 'triangle geometry normals');
  const textureCoordinates = options.textureCoordinates === undefined
    ? undefined
    : finiteFloat32Channel(
      options.textureCoordinates,
      2,
      'triangle geometry textureCoordinates',
    );
  const geometry: TriangleGeometry = {
    indices: canonicalTriangleIndices(options.indices, vertexCount),
    kind: 'triangles',
    ...(normals === undefined ? {} : { normals }),
    positions,
    ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
  };
  validateTriangleChannels(geometry, 'triangle geometry');
  return geometry;
};
