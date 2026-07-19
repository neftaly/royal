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

export type GeometryBatchLayoutPlan = Readonly<{
  indexBytes: 1 | 2 | 4;
  indexCount: number;
  ranges: readonly GeometryBatchRange[];
  vertexCount: number;
}>;

const indexArray = (
  length: number,
  indexBytes: 1 | 2 | 4,
): GeometryIndexArray => indexBytes === 1
  ? new Uint8Array(length)
  : indexBytes === 2 ? new Uint16Array(length) : new Uint32Array(length);

const maximumIndexFor = (indices: GeometryIndexArray): number => indices.BYTES_PER_ELEMENT === 1
  ? 0xff
  : indices.BYTES_PER_ELEMENT === 2 ? 0xffff : 0xffff_ffff;

/** Validates that a local index stream addresses only its declared vertices. */
export const validateGeometryIndices = (
  indices: GeometryIndexArray,
  vertexCount: number,
): void => {
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 1) {
    throw new Error("Royal geometry batch received an invalid vertex count");
  }
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index]! >= vertexCount) {
      throw new Error("Royal geometry batch index exceeds its vertex range");
    }
  }
};

/** Writes one rebased stream into caller-owned storage without allocating. */
export const writeRebasedGeometryIndices = (
  output: GeometryIndexArray,
  indices: GeometryIndexArray,
  vertexOffset: number,
  vertexCount: number,
  outputOffset = 0,
): void => {
  if (
    !Number.isSafeInteger(outputOffset)
    || outputOffset < 0
    || output.length - outputOffset < indices.length
  ) {
    throw new Error("Royal geometry batch index workspace is too small");
  }
  if (!Number.isSafeInteger(vertexOffset) || vertexOffset < 0) {
    throw new Error("Royal geometry batch received an invalid vertex offset");
  }
  validateGeometryIndices(indices, vertexCount);
  const maximumIndex = maximumIndexFor(output);
  for (let index = 0; index < indices.length; index += 1) {
    const rebasedIndex = vertexOffset + indices[index]!;
    if (rebasedIndex > maximumIndex) {
      throw new Error("Royal geometry batch exceeds its index storage");
    }
    output[outputOffset + index] = rebasedIndex;
  }
};

/** Plans shared allocation and draw ranges without allocating merged index storage. */
export const planGeometryBatchLayout = (
  geometries: readonly GeometryBatchInput[],
): GeometryBatchLayoutPlan => {
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
  for (let geometryIndex = 0; geometryIndex < ranges.length; geometryIndex += 1) {
    const range = ranges[geometryIndex]!;
    ranges[geometryIndex] = {
      ...range,
      indexByteOffset: range.indexByteOffset * indexBytes,
    };
  }
  return { indexBytes, indexCount, ranges, vertexCount };
};

/** Rebases one local index stream for upload into a planned shared arena range. */
export const rebaseGeometryIndices = (
  indices: GeometryIndexArray,
  vertexOffset: number,
  indexBytes: 1 | 2 | 4,
  vertexCount: number,
): GeometryIndexArray => {
  const output = indexArray(indices.length, indexBytes);
  writeRebasedGeometryIndices(output, indices, vertexOffset, vertexCount);
  return output;
};

/** Plans one shared vertex/index allocation without inspecting browser or GL state. */
export const planGeometryBatch = (
  geometries: readonly GeometryBatchInput[],
): GeometryBatchPlan => {
  const layout = planGeometryBatchLayout(geometries);
  const indices = indexArray(layout.indexCount, layout.indexBytes);
  let outputOffset = 0;
  for (let geometryIndex = 0; geometryIndex < geometries.length; geometryIndex += 1) {
    const geometry = geometries[geometryIndex]!;
    const range = layout.ranges[geometryIndex]!;
    writeRebasedGeometryIndices(
      indices,
      geometry.indices,
      range.vertexOffset,
      geometry.vertexCount,
      outputOffset,
    );
    outputOffset += geometry.indices.length;
  }
  return { ...layout, indices };
};
