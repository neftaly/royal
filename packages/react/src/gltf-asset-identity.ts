import type { GltfAssetRef } from "@royal/renderer-core";

export const validateGltfAssetRef = (input: unknown, label: string): void => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be a GltfAssetRef object`);
  }
  const { uri, version } = input as Partial<GltfAssetRef>;
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
