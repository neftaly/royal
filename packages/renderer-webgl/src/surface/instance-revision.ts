/** Automatic instance matrices are immutable snapshots owned by scene lowering. */
export type InstanceRevision = number | string | Float32Array;

/** Compare the exact GPU values without allocating decimal strings or hashes. */
export const sameInstanceRevision = (
  left: InstanceRevision | undefined,
  right: InstanceRevision | undefined,
): boolean => {
  if (left === right) return true;
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};
