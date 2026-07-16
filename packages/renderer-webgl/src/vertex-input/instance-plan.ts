export type VertexInputInstanceLane = "localModels" | "rootPositions" | "rootRotations" | "rootScales";

export type VertexInputInstanceBufferLayout = Readonly<{
  byteLength: number;
  localModelElements: number;
  rangeElements: number;
  rootPositionElements: number;
  rootRotationElements: number;
  rootScaleElements: number;
}>;

export type VertexInputInstanceArrays = Readonly<{
  localModels: Float32Array;
  ranges: Int32Array;
  rootPositions: Float32Array;
  rootRotations: Float32Array;
  rootScales: Float32Array;
}>;

const MAX_TYPED_ARRAY_ELEMENTS = 0xffff_ffff;

const checkedProduct = (left: number, right: number, label: string): number => {
  const product = left * right;
  if (!Number.isSafeInteger(product)) throw new RangeError(`${label} exceeds the safe integer range`);
  return product;
};

const checkedElementLength = (capacity: number, stride: number, label: string): number => {
  const length = checkedProduct(capacity, stride, label);
  if (length > MAX_TYPED_ARRAY_ELEMENTS) {
    throw new RangeError(`${label} exceeds the maximum typed-array element count`);
  }
  return length;
};

export const vertexInputInstanceBufferLayout = (
  capacity: number,
): VertexInputInstanceBufferLayout => {
  const localModelElements = checkedElementLength(capacity, 16, "instance local-model staging");
  const rootPositionElements = checkedElementLength(capacity, 3, "instance root-position staging");
  const rootRotationElements = checkedElementLength(capacity, 3, "instance root-rotation staging");
  const rootScaleElements = checkedElementLength(capacity, 3, "instance root-scale staging");
  const rangeElements = checkedElementLength(capacity, 2, "instance range staging");
  const floatElements = localModelElements + rootPositionElements + rootRotationElements + rootScaleElements;
  if (!Number.isSafeInteger(floatElements)) {
    throw new RangeError("instance buffer element count exceeds the safe integer range");
  }
  return {
    byteLength: checkedProduct(floatElements, Float32Array.BYTES_PER_ELEMENT, "instance buffer byte size"),
    localModelElements,
    rangeElements,
    rootPositionElements,
    rootRotationElements,
    rootScaleElements,
  };
};

export const growVertexInputInstanceArrays = (
  layout: VertexInputInstanceBufferLayout,
  previous: VertexInputInstanceArrays,
  previousCount: number,
): VertexInputInstanceArrays => {
  const localModels = new Float32Array(layout.localModelElements);
  const ranges = new Int32Array(layout.rangeElements);
  const rootPositions = new Float32Array(layout.rootPositionElements);
  const rootRotations = new Float32Array(layout.rootRotationElements);
  const rootScales = new Float32Array(layout.rootScaleElements);
  localModels.set(previous.localModels.subarray(0, previousCount * 16));
  rootPositions.set(previous.rootPositions.subarray(0, previousCount * 3));
  rootRotations.set(previous.rootRotations.subarray(0, previousCount * 3));
  rootScales.set(previous.rootScales.subarray(0, previousCount * 3));
  return { localModels, ranges, rootPositions, rootRotations, rootScales };
};

export const vertexInputInstanceLaneStride = (lane: VertexInputInstanceLane): number => {
  switch (lane) {
    case "localModels": return 16;
    case "rootPositions": return 3;
    case "rootRotations": return 3;
    case "rootScales": return 3;
  }
};

/** Validates ordered ranges and returns the exact upload cost without touching WebGL state. */
export const vertexInputInstanceLaneUploadBytes = (
  lane: VertexInputInstanceLane,
  instanceCount: number,
  ranges: Int32Array,
  rangeCount: number,
  forceFull: boolean,
): number => {
  if (!Number.isSafeInteger(rangeCount) || rangeCount < 0 || rangeCount * 2 > ranges.length) {
    throw new Error(`Invalid instance upload range count ${rangeCount}`);
  }
  const actualRangeCount = forceFull ? (instanceCount === 0 ? 0 : 1) : rangeCount;
  const stride = vertexInputInstanceLaneStride(lane);
  let bytes = 0;
  let previousEnd = 0;
  for (let index = 0; index < actualRangeCount; index += 1) {
    const start = forceFull ? 0 : ranges[index * 2]!;
    const end = forceFull ? instanceCount : ranges[index * 2 + 1]!;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < previousEnd || start < 0 || end <= start || end > instanceCount) {
      throw new Error(`Invalid ${lane} upload range [${start}, ${end})`);
    }
    previousEnd = end;
    const rangeBytes = checkedProduct(
      checkedProduct(end - start, stride, `${lane} upload element count`),
      Float32Array.BYTES_PER_ELEMENT,
      `${lane} upload byte size`,
    );
    if (!Number.isSafeInteger(bytes + rangeBytes)) {
      throw new RangeError(`${lane} upload byte size exceeds the safe integer range`);
    }
    bytes += rangeBytes;
  }
  return bytes;
};
