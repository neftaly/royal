import type { GltfAssetBounds } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";

type StaticBoundsPrimitive = Readonly<{
  geometry: Pick<CanonicalTriangleGeometry, "bounds">;
  instanceBatch?: Readonly<{ localModels: Float32Array }>;
  localModel: Mat4;
}>;

const includeTransformedBounds = (
  resultMin: [number, number, number],
  resultMax: [number, number, number],
  bounds: CanonicalTriangleGeometry["bounds"],
  matrix: ArrayLike<number>,
  offset: number,
): void => {
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  const extentX = (bounds.max[0] - bounds.min[0]) * 0.5;
  const extentY = (bounds.max[1] - bounds.min[1]) * 0.5;
  const extentZ = (bounds.max[2] - bounds.min[2]) * 0.5;
  const m0 = matrix[offset]!;
  const m1 = matrix[offset + 1]!;
  const m2 = matrix[offset + 2]!;
  const m4 = matrix[offset + 4]!;
  const m5 = matrix[offset + 5]!;
  const m6 = matrix[offset + 6]!;
  const m8 = matrix[offset + 8]!;
  const m9 = matrix[offset + 9]!;
  const m10 = matrix[offset + 10]!;
  const transformedCenterX = m0 * centerX + m4 * centerY + m8 * centerZ + matrix[offset + 12]!;
  const transformedCenterY = m1 * centerX + m5 * centerY + m9 * centerZ + matrix[offset + 13]!;
  const transformedCenterZ = m2 * centerX + m6 * centerY + m10 * centerZ + matrix[offset + 14]!;
  const transformedExtentX = Math.abs(m0) * extentX + Math.abs(m4) * extentY + Math.abs(m8) * extentZ;
  const transformedExtentY = Math.abs(m1) * extentX + Math.abs(m5) * extentY + Math.abs(m9) * extentZ;
  const transformedExtentZ = Math.abs(m2) * extentX + Math.abs(m6) * extentY + Math.abs(m10) * extentZ;
  resultMin[0] = Math.min(resultMin[0], transformedCenterX - transformedExtentX);
  resultMin[1] = Math.min(resultMin[1], transformedCenterY - transformedExtentY);
  resultMin[2] = Math.min(resultMin[2], transformedCenterZ - transformedExtentZ);
  resultMax[0] = Math.max(resultMax[0], transformedCenterX + transformedExtentX);
  resultMax[1] = Math.max(resultMax[1], transformedCenterY + transformedExtentY);
  resultMax[2] = Math.max(resultMax[2], transformedCenterZ + transformedExtentZ);
};

/** Computes one selected glTF scene bound without allocating per primitive or instance. */
export const staticGltfBounds = (
  primitives: readonly StaticBoundsPrimitive[],
): GltfAssetBounds => {
  if (primitives.length === 0) {
    throw new RangeError("Royal cannot compute glTF bounds without a renderable primitive");
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives) {
    const localModels = primitive.instanceBatch?.localModels;
    if (localModels === undefined) {
      includeTransformedBounds(min, max, primitive.geometry.bounds, primitive.localModel, 0);
      continue;
    }
    for (let offset = 0; offset < localModels.length; offset += 16) {
      includeTransformedBounds(min, max, primitive.geometry.bounds, localModels, offset);
    }
  }
  return { max, min };
};
