import type { Mat4 } from "../math/mat4";

/** A JSON value as authored in a glTF document, exposed without renderer interpretation. */
export type GltfJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly GltfJsonValue[]
  | Readonly<{ [key: string]: GltfJsonValue }>;

export type JsonObject = Record<string, unknown>;
export const fail = (label: string, path: string, detail: string): never => {
  throw new Error(`${label} ${path}: ${detail}`);
};

export const object = (value: unknown, label: string, path: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(label, path, "must be an object");
  }
  return value as JsonObject;
};

export const array = (value: unknown, label: string, path: string): unknown[] => {
  if (!Array.isArray(value)) fail(label, path, "must be an array");
  return value as unknown[];
};

export const optionalArray = (value: unknown, label: string, path: string): unknown[] =>
  value === undefined ? [] : array(value, label, path);

export const integer = (value: unknown, label: string, path: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(label, path, "must be a safe integer");
  }
  return value as number;
};

export const nonNegativeInteger = (value: unknown, label: string, path: string): number => {
  const result = integer(value, label, path);
  if (result < 0) fail(label, path, "must not be negative");
  return result;
};

export const finiteNumber = (
  value: unknown,
  fallback: number,
  label: string,
  path: string,
): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(label, path, "must be finite");
  }
  return value;
};

export const index = (value: unknown, values: readonly unknown[], label: string, path: string): number => {
  const result = nonNegativeInteger(value, label, path);
  if (result >= values.length) fail(label, path, `index ${result} is out of range`);
  return result;
};

export const finiteTuple = (
  value: unknown,
  length: number,
  fallback: readonly number[],
  label: string,
  path: string,
): number[] => {
  if (value === undefined) return [...fallback];
  const values = array(value, label, path);
  if (values.length !== length) fail(label, path, `must contain ${length} numbers`);
  return values.map((component, componentIndex) => {
    if (typeof component !== "number" || !Number.isFinite(component)) {
      fail(label, `${path}[${componentIndex}]`, "must be finite");
    }
    return component as number;
  });
};

export const nodeLocalMatrix = (node: JsonObject, label: string, path: string): Mat4 => {
  if (node.matrix !== undefined) {
    if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
      fail(label, path, "matrix cannot be combined with translation, rotation, or scale");
    }
    return finiteTuple(node.matrix, 16, [], label, `${path}.matrix`) as unknown as Mat4;
  }
  const translation = finiteTuple(
    node.translation, 3, [0, 0, 0], label, `${path}.translation`,
  );
  const rotation = finiteTuple(node.rotation, 4, [0, 0, 0, 1], label, `${path}.rotation`);
  const scale = finiteTuple(node.scale, 3, [1, 1, 1], label, `${path}.scale`);
  const length = Math.hypot(rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!);
  if (!(length > 0)) fail(label, `${path}.rotation`, "must be a non-zero quaternion");
  const x = rotation[0]! / length;
  const y = rotation[1]! / length;
  const z = rotation[2]! / length;
  const w = rotation[3]! / length;
  const xx = x * x; const xy = x * y; const xz = x * z; const xw = x * w;
  const yy = y * y; const yz = y * z; const yw = y * w;
  const zz = z * z; const zw = z * w;
  return [
    (1 - 2 * (yy + zz)) * scale[0]!,
    2 * (xy + zw) * scale[0]!,
    2 * (xz - yw) * scale[0]!,
    0,
    2 * (xy - zw) * scale[1]!,
    (1 - 2 * (xx + zz)) * scale[1]!,
    2 * (yz + xw) * scale[1]!,
    0,
    2 * (xz + yw) * scale[2]!,
    2 * (yz - xw) * scale[2]!,
    (1 - 2 * (xx + yy)) * scale[2]!,
    0,
    translation[0]!, translation[1]!, translation[2]!, 1,
  ];
};
