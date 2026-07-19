export type GeometryIndexArray = Uint8Array | Uint16Array | Uint32Array;

export type GeometryBatchInput = Readonly<{
  indices: GeometryIndexArray;
  vertexCount: number;
}>;

export type GeometryBatchRange = Readonly<{
  indexByteOffset: number;
  indexCount: number;
  vertexOffset: number;
}>;

export type GeometryBatchPlan = Readonly<{
  indexBytes: 1 | 2 | 4;
  indexCount: number;
  indices: GeometryIndexArray;
  ranges: readonly GeometryBatchRange[];
  vertexCount: number;
}>;

/** Plans one shared vertex/index allocation without inspecting browser or GL state. */
export const planGeometryBatch = (
  geometries: readonly GeometryBatchInput[],
): GeometryBatchPlan => {
  if (geometries.length === 0) {
    throw new Error("Royal geometry batch requires at least one geometry");
  }
  let indexCount = 0;
  let vertexCount = 0;
  const ranges = Array<GeometryBatchRange>(geometries.length);
  for (let geometryIndex = 0; geometryIndex < geometries.length; geometryIndex += 1) {
    const geometry = geometries[geometryIndex]!;
    if (!Number.isSafeInteger(geometry.vertexCount) || geometry.vertexCount < 1) {
      throw new Error("Royal geometry batch received an invalid vertex count");
    }
    if (geometry.indices.length < 1) {
      throw new Error("Royal geometry batch received empty indices");
    }
    const nextVertexCount = vertexCount + geometry.vertexCount;
    const nextIndexCount = indexCount + geometry.indices.length;
    if (!Number.isSafeInteger(nextVertexCount) || !Number.isSafeInteger(nextIndexCount)) {
      throw new Error("Royal geometry batch size exceeds safe integer storage");
    }
    ranges[geometryIndex] = {
      indexByteOffset: indexCount,
      indexCount: geometry.indices.length,
      vertexOffset: vertexCount,
    };
    indexCount = nextIndexCount;
    vertexCount = nextVertexCount;
  }
  if (vertexCount > 0x1_0000_0000) {
    throw new Error("Royal geometry batch exceeds 32-bit index storage");
  }
  const maximumIndex = vertexCount - 1;
  const indexBytes = maximumIndex <= 0xff ? 1 : maximumIndex <= 0xffff ? 2 : 4;
  const indices: GeometryIndexArray = indexBytes === 1
    ? new Uint8Array(indexCount)
    : indexBytes === 2 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  let outputOffset = 0;
  for (let geometryIndex = 0; geometryIndex < geometries.length; geometryIndex += 1) {
    const geometry = geometries[geometryIndex]!;
    const range = ranges[geometryIndex]!;
    ranges[geometryIndex] = {
      ...range,
      indexByteOffset: range.indexByteOffset * indexBytes,
    };
    for (let index = 0; index < geometry.indices.length; index += 1) {
      const sourceIndex = geometry.indices[index]!;
      if (sourceIndex >= geometry.vertexCount) {
        throw new Error("Royal geometry batch index exceeds its vertex range");
      }
      indices[outputOffset] = range.vertexOffset + sourceIndex;
      outputOffset += 1;
    }
  }
  return { indexBytes, indexCount, indices, ranges, vertexCount };
};
