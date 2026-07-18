import type { EulerRads, LinearRgba, Transform, TransformOptions, Vec3 } from './primitives';

/** Validates one public descriptor-options object before any fields are read. */
export const objectWithAllowedFields = <Options extends object>(
  value: Options,
  allowedFields: readonly string[],
  label: string,
): Options => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} options must be an object`);
  }
  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) {
      throw new TypeError(`${label} options contain unsupported option ${JSON.stringify(field)}`);
    }
  }
  return value;
};

export const finiteNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite; received ${String(value)}`);
  return value;
};

export const positiveFiniteNumber = (value: number, label: string): number => {
  finiteNumber(value, label);
  if (!(value > 0)) throw new Error(`${label} must be positive; received ${String(value)}`);
  return value;
};

export const nonNegativeFiniteNumber = (value: number, label: string): number => {
  finiteNumber(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative; received ${String(value)}`);
  return value;
};

const resolveNumberTuple = (
  value: unknown,
  length: number,
  label: string,
): readonly number[] => {
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${label} must be an array of exactly ${length} numbers`);
  }
  return value.map((component, index) => finiteNumber(component, `${label}[${index}]`));
};

export const resolveVec3 = (value: unknown, label: string): Vec3 =>
  resolveNumberTuple(value, 3, label) as Vec3;

export const resolveDirection3 = (value: Vec3, label: string): Vec3 => {
  const direction = resolveVec3(value, label);
  if (!(Math.hypot(direction[0], direction[1], direction[2]) > 0)) {
    throw new Error(`${label} must be non-zero`);
  }
  return direction;
};

export const resolveRgba = (value: unknown, label: string): LinearRgba =>
  resolveNumberTuple(value, 4, label) as LinearRgba;

const TRANSFORM_FIELDS = ['position', 'rotation', 'scale'] as const;
const BOUNDS_FIELDS = ['max', 'min'] as const;

export const resolveTransformDescriptor = (options: TransformOptions): Transform => {
  objectWithAllowedFields(options, TRANSFORM_FIELDS, 'transform');
  return {
    position: resolveVec3(options.position ?? [0, 0, 0], 'transform position'),
    rotation: resolveVec3(options.rotation ?? [0, 0, 0], 'transform rotation') as EulerRads,
    scale: resolveVec3(options.scale ?? [1, 1, 1], 'transform scale'),
  };
};

export const resolveBounds3 = <Bounds extends { readonly max: Vec3; readonly min: Vec3 }>(
  bounds: Bounds,
  label: string,
): Bounds => {
  objectWithAllowedFields(bounds, BOUNDS_FIELDS, label);
  const min = resolveVec3(bounds.min, `${label} min`);
  const max = resolveVec3(bounds.max, `${label} max`);
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis]! > max[axis]!) throw new Error(`${label} min must not exceed max`);
  }
  return { min, max } as Bounds;
};

export const nonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

export const stringChoice = <Choice extends string>(
  value: unknown,
  choices: readonly Choice[],
  label: string,
): Choice => {
  if (typeof value !== 'string' || !choices.includes(value as Choice)) {
    throw new Error(`${label} must be one of ${choices.join(', ')}`);
  }
  return value as Choice;
};

export const identityScalar = <Value extends number | string>(
  value: Value,
  label: string,
): Value => {
  if (typeof value === 'number') finiteNumber(value, label);
  else nonEmptyString(value, label);
  return value;
};
