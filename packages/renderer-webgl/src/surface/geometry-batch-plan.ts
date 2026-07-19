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
  let maximumIndex = 0;
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
    for (let index = 0; index < geometry.indices.length; index += 1) {
      const sourceIndex = geometry.indices[index]!;
      if (sourceIndex >= geometry.vertexCount) {
        throw new Error("Royal geometry batch index exceeds its vertex range");
      }
      maximumIndex = Math.max(maximumIndex, vertexCount + sourceIndex);
    }
    ranges[geometryIndex] = {
      indexByteOffset: indexCount,
      indexCount: geometry.indices.length,
      vertexOffset: vertexCount,
    };
    indexCount = nextIndexCount;
    vertexCount = nextVertexCount;
  }
  const indexBytes = maximumIndex <= 0xff ? 1 : maximumIndex <= 0xffff ? 2 : 4;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    ranges[index] = { ...range, indexByteOffset: range.indexByteOffset * indexBytes };
  }
  return { indexBytes, indexCount, ranges, vertexCount };
};

/** Writes one planned range into caller-owned staging storage. */
export const writeRebasedGeometryIndices = (
  output: GeometryIndexArray,
  outputOffset: number,
  source: GeometryIndexArray,
  vertexOffset: number,
): void => {
  if (
    !Number.isSafeInteger(outputOffset)
    || outputOffset < 0
    || outputOffset + source.length > output.length
  ) throw new Error("Royal geometry batch output range is invalid");
  const maximum = output instanceof Uint8Array ? 0xff
    : output instanceof Uint16Array ? 0xffff : 0xffff_ffff;
  for (let index = 0; index < source.length; index += 1) {
    const rebased = vertexOffset + source[index]!;
    if (rebased > maximum) throw new Error("Royal geometry batch index storage is too narrow");
    output[outputOffset + index] = rebased;
  }
};
