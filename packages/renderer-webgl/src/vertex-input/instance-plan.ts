export type VertexInputInstanceLane = "models";

export type VertexInputInstanceBufferLayout = Readonly<{
  byteLength: number;
  modelElements: number;
  rangeElements: number;
}>;

export type VertexInputInstanceArrays = Readonly<{
  models: Float32Array;
  ranges: Int32Array;
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
  const modelElements = checkedElementLength(capacity, 16, "instance model staging");
  const rangeElements = checkedElementLength(capacity, 2, "instance range staging");
  return {
    byteLength: checkedProduct(modelElements, Float32Array.BYTES_PER_ELEMENT, "instance buffer byte size"),
    modelElements,
    rangeElements,
  };
};

export const growVertexInputInstanceArrays = (
  layout: VertexInputInstanceBufferLayout,
  previous: VertexInputInstanceArrays,
  previousCount: number,
): VertexInputInstanceArrays => {
  const models = new Float32Array(layout.modelElements);
  const ranges = new Int32Array(layout.rangeElements);
  models.set(previous.models.subarray(0, previousCount * 16));
  return { models, ranges };
};

export const vertexInputInstanceLaneStride = (lane: VertexInputInstanceLane): number => {
  switch (lane) {
    case "models": return 16;
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
