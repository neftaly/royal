export const GEOMETRY_BUCKET_COMPARISON_LIMIT = 8;

export interface GeometryByteLayout {
  readonly colors?: ArrayBufferView;
  readonly indices?: ArrayBufferView;
  readonly mode: string;
  readonly normals?: ArrayBufferView;
  readonly positions: ArrayBufferView;
  readonly tangents?: ArrayBufferView;
  readonly texCoords0?: ArrayBufferView;
  readonly texCoords1?: ArrayBufferView;
}

export const sameArrayViewBytes = (
  left: ArrayBufferView | undefined,
  right: ArrayBufferView | undefined,
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
};

export const sameGeometryBytes = (left: GeometryByteLayout, right: GeometryByteLayout): boolean =>
  left.mode === right.mode
  && sameArrayViewBytes(left.positions, right.positions)
  && sameArrayViewBytes(left.normals, right.normals)
  && sameArrayViewBytes(left.tangents, right.tangents)
  && sameArrayViewBytes(left.colors, right.colors)
  && sameArrayViewBytes(left.texCoords0, right.texCoords0)
  && sameArrayViewBytes(left.texCoords1, right.texCoords1)
  && sameArrayViewBytes(left.indices, right.indices);

export const findVerifiedGeometry = <Entry extends { readonly source: GeometryByteLayout }>(
  bucket: readonly Entry[],
  candidate: GeometryByteLayout,
  comparisonLimit = GEOMETRY_BUCKET_COMPARISON_LIMIT,
): Entry | undefined => {
  const limit = Math.min(bucket.length, comparisonLimit);
  for (let index = 0; index < limit; index += 1) {
    const entry = bucket[index];
    if (entry !== undefined && sameGeometryBytes(entry.source, candidate)) return entry;
  }
  return undefined;
};
