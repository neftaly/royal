export type CanonicalTextureCoordinates = Readonly<{
  /** Affine row: scale/rotation x, scale/rotation y, offset x, UV set. */
  row0: readonly [number, number, number, 0 | 1];
  /** Affine row: scale/rotation x, scale/rotation y, offset y, unused. */
  row1: readonly [number, number, number, 0];
}>;

export const IDENTITY_TEXTURE_COORDINATES: CanonicalTextureCoordinates = {
  row0: [1, 0, 0, 0],
  row1: [0, 1, 0, 0],
};

/** Pure CPU application of the same canonical affine rows used by shaders. */
export const transformTextureCoordinates = (
  coordinates: CanonicalTextureCoordinates,
  uv0: readonly [number, number],
  uv1: readonly [number, number],
): readonly [number, number] => {
  const uv = coordinates.row0[3] === 0 ? uv0 : uv1;
  return [
    coordinates.row0[0] * uv[0] + coordinates.row0[1] * uv[1] + coordinates.row0[2],
    coordinates.row1[0] * uv[0] + coordinates.row1[1] * uv[1] + coordinates.row1[2],
  ];
};
