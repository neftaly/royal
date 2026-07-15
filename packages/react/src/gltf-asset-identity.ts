import type { GltfAssetRef } from "@royal/renderer-core";
import { recordWithAllowedFields } from "./validation";

const GLTF_ASSET_REF_FIELDS = ["bounds", "uri", "version"] as const;
const GLTF_BOUNDS_FIELDS = ["max", "min"] as const;

const validateBound = (value: unknown, label: string): readonly number[] => {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must be an array of exactly 3 numbers`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (!Number.isFinite(value[axis])) throw new TypeError(`${label}[${axis}] must be finite`);
  }
  return value as readonly number[];
};

const validateBounds = (value: unknown, label: string): void => {
  const bounds = recordWithAllowedFields(value, GLTF_BOUNDS_FIELDS, label, "field");
  const min = validateBound(bounds.min, `${label} min`);
  const max = validateBound(bounds.max, `${label} max`);
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis]! > max[axis]!) throw new RangeError(`${label} min must not exceed max`);
  }
};

export const validateGltfAssetRef = (input: unknown, label: string): void => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be a GltfAssetRef object`);
  }
  const { bounds, uri, version } = recordWithAllowedFields(
    input,
    GLTF_ASSET_REF_FIELDS,
    label,
    "field",
  ) as Partial<GltfAssetRef>;
  if (typeof uri !== "string" || uri.length === 0) {
    throw new TypeError(`${label} uri must be a non-empty string`);
  }
  if (version !== undefined && (
    (typeof version !== "string" && typeof version !== "number")
    || (typeof version === "string" && version.length === 0)
    || (typeof version === "number" && !Number.isFinite(version))
  )) {
    throw new TypeError(`${label} version must be a non-empty string or finite number`);
  }
  if (bounds !== undefined) validateBounds(bounds, `${label} bounds`);
};

/** @internal Validates hook inputs before Canvas availability can affect behavior. */
export const validateGltfAssetStatusInput = (input: unknown): void => {
  if (typeof input === "string") {
    if (input.length === 0) throw new TypeError("glTF asset status source must be a non-empty string");
    return;
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("glTF asset status input must be a source string or GltfAssetRef object");
  }
  validateGltfAssetRef(input, "glTF asset status input");
};
