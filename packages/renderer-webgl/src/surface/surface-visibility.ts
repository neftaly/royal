import type { Mat4 } from "../math/mat4";
import type { CanonicalTriangleGeometry } from "./canonical-geometry";

export type WorldBounds = Readonly<{
  max: readonly [number, number, number];
  min: readonly [number, number, number];
}>;

export type MutableWorldBounds = {
  max: [number, number, number];
  min: [number, number, number];
};

export const emptyWorldBounds = (): MutableWorldBounds => ({
  max: [-Infinity, -Infinity, -Infinity],
  min: [Infinity, Infinity, Infinity],
});

/** Expands one lowering-owned AABB by another already-world-space AABB. */
export const includeWorldBounds = (
  output: MutableWorldBounds,
  bounds: WorldBounds,
): void => {
  output.min[0] = Math.min(output.min[0], bounds.min[0]);
  output.min[1] = Math.min(output.min[1], bounds.min[1]);
  output.min[2] = Math.min(output.min[2], bounds.min[2]);
  output.max[0] = Math.max(output.max[0], bounds.max[0]);
  output.max[1] = Math.max(output.max[1], bounds.max[1]);
  output.max[2] = Math.max(output.max[2], bounds.max[2]);
};

/** Expands a world AABB by one affine-transformed local AABB without corner allocations. */
export const includeTransformedBounds = (
  output: MutableWorldBounds,
  bounds: CanonicalTriangleGeometry["bounds"],
  matrix: ArrayLike<number>,
  offset = 0,
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
  output.min[0] = Math.min(output.min[0], transformedCenterX - transformedExtentX);
  output.min[1] = Math.min(output.min[1], transformedCenterY - transformedExtentY);
  output.min[2] = Math.min(output.min[2], transformedCenterZ - transformedExtentZ);
  output.max[0] = Math.max(output.max[0], transformedCenterX + transformedExtentX);
  output.max[1] = Math.max(output.max[1], transformedCenterY + transformedExtentY);
  output.max[2] = Math.max(output.max[2], transformedCenterZ + transformedExtentZ);
};

export const transformedWorldBounds = (
  bounds: CanonicalTriangleGeometry["bounds"],
  model: Mat4,
): MutableWorldBounds => {
  const result = emptyWorldBounds();
  includeTransformedBounds(result, bounds, model);
  return result;
};

const setNormalizedPlane = (
  output: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  constant: number,
): void => {
  const inverseLength = 1 / Math.hypot(x, y, z);
  output[offset] = x * inverseLength;
  output[offset + 1] = y * inverseLength;
  output[offset + 2] = z * inverseLength;
  output[offset + 3] = constant * inverseLength;
};

/** Extracts normalized WebGL clip planes into caller-owned storage. */
export const frustumPlanesInto = (output: Float32Array, matrix: Mat4): void => {
  setNormalizedPlane(output, 0, matrix[3] + matrix[0], matrix[7] + matrix[4], matrix[11] + matrix[8], matrix[15] + matrix[12]);
  setNormalizedPlane(output, 4, matrix[3] - matrix[0], matrix[7] - matrix[4], matrix[11] - matrix[8], matrix[15] - matrix[12]);
  setNormalizedPlane(output, 8, matrix[3] + matrix[1], matrix[7] + matrix[5], matrix[11] + matrix[9], matrix[15] + matrix[13]);
  setNormalizedPlane(output, 12, matrix[3] - matrix[1], matrix[7] - matrix[5], matrix[11] - matrix[9], matrix[15] - matrix[13]);
  setNormalizedPlane(output, 16, matrix[3] + matrix[2], matrix[7] + matrix[6], matrix[11] + matrix[10], matrix[15] + matrix[14]);
  setNormalizedPlane(output, 20, matrix[3] - matrix[2], matrix[7] - matrix[6], matrix[11] - matrix[10], matrix[15] - matrix[14]);
};

/** Conservative AABB/frustum selection; boundary and near-camera intersections stay visible. */
export const worldBoundsVisible = (
  bounds: WorldBounds,
  planes: Float32Array,
): boolean => {
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  const extentX = (bounds.max[0] - bounds.min[0]) * 0.5;
  const extentY = (bounds.max[1] - bounds.min[1]) * 0.5;
  const extentZ = (bounds.max[2] - bounds.min[2]) * 0.5;
  for (let offset = 0; offset < 24; offset += 4) {
    const x = planes[offset]!;
    const y = planes[offset + 1]!;
    const z = planes[offset + 2]!;
    const distance = x * centerX + y * centerY + z * centerZ + planes[offset + 3]!;
    const radius = Math.abs(x) * extentX + Math.abs(y) * extentY + Math.abs(z) * extentZ;
    if (distance + radius < -0.000_01) return false;
  }
  return true;
};
