type TriangleIndexArray = Uint8Array | Uint16Array | Uint32Array;

const allocateLike = (source: TriangleIndexArray, length: number): TriangleIndexArray => (
  source instanceof Uint8Array
    ? new Uint8Array(length)
    : source instanceof Uint16Array
      ? new Uint16Array(length)
      : new Uint32Array(length)
);

/** Lowers glTF's triangle-family modes once so the renderer owns one topology. */
export const canonicalTriangleIndices = (
  source: TriangleIndexArray,
  mode: 4 | 5 | 6,
): TriangleIndexArray => {
  if (mode === 4) return source;
  const triangleCount = Math.max(0, source.length - 2);
  const indices = allocateLike(source, triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const target = triangle * 3;
    if (mode === 6) {
      indices[target] = source[0]!;
      indices[target + 1] = source[triangle + 1]!;
    } else if ((triangle & 1) === 0) {
      indices[target] = source[triangle]!;
      indices[target + 1] = source[triangle + 1]!;
    } else {
      indices[target] = source[triangle + 1]!;
      indices[target + 1] = source[triangle]!;
    }
    indices[target + 2] = source[triangle + 2]!;
  }
  return indices;
};
