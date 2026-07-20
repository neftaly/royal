import {
  composeEulerMat4Into,
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { GltfInstanceTransforms } from "@royal/renderer-core";

export type StaticInstanceStreams = Readonly<{
  count: number;
  rotations?: Float32Array;
  scales?: Float32Array;
  translations?: Float32Array;
}>;

export type StaticInstanceBatch = Readonly<{
  handedness: 1 | -1;
  localModels: Float32Array;
}>;

export type IndexedStaticInstanceBatch = StaticInstanceBatch & Readonly<{
  innerIndices?: Uint32Array;
  sourceOrdered: boolean;
  sourceIndices: Uint32Array;
}>;

export type GltfInstanceRangeBatch = Readonly<{
  innerCount: number;
  innerIndices?: Uint32Array;
  innerModels: ArrayLike<number>;
  localModels: Float32Array;
  sourceIndices: Uint32Array;
  sourceOrdered: boolean;
}>;

export type GltfInstanceUpdateWorkspace = Readonly<{
  composed: MutableMat4;
  innerModel: MutableMat4;
  instanceModel: MutableMat4;
}>;

export const createGltfInstanceUpdateWorkspace = (): GltfInstanceUpdateWorkspace => ({
  composed: identityMat4(),
  innerModel: identityMat4(),
  instanceModel: identityMat4(),
});

const composeInstanceMatrixInto = (
  out: MutableMat4,
  streams: StaticInstanceStreams,
  instance: number,
): void => {
  const translationOffset = instance * 3;
  const rotationOffset = instance * 4;
  const scaleOffset = instance * 3;
  const translation = streams.translations;
  const rotation = streams.rotations;
  const scale = streams.scales;
  const tx = translation?.[translationOffset] ?? 0;
  const ty = translation?.[translationOffset + 1] ?? 0;
  const tz = translation?.[translationOffset + 2] ?? 0;
  let x = rotation?.[rotationOffset] ?? 0;
  let y = rotation?.[rotationOffset + 1] ?? 0;
  let z = rotation?.[rotationOffset + 2] ?? 0;
  let w = rotation?.[rotationOffset + 3] ?? 1;
  const sx = scale?.[scaleOffset] ?? 1;
  const sy = scale?.[scaleOffset + 1] ?? 1;
  const sz = scale?.[scaleOffset + 2] ?? 1;
  if (
    !Number.isFinite(tx)
    || !Number.isFinite(ty)
    || !Number.isFinite(tz)
    || !Number.isFinite(sx)
    || !Number.isFinite(sy)
    || !Number.isFinite(sz)
  ) throw new Error(`instance ${instance} translation and scale must be finite`);
  const quaternionLength = Math.hypot(x, y, z, w);
  if (!(quaternionLength > 0) || !Number.isFinite(quaternionLength)) {
    throw new Error(`instance ${instance} rotation must be a finite non-zero quaternion`);
  }
  x /= quaternionLength;
  y /= quaternionLength;
  z /= quaternionLength;
  w /= quaternionLength;
  const xx = x * x; const xy = x * y; const xz = x * z; const xw = x * w;
  const yy = y * y; const yz = y * z; const yw = y * w;
  const zz = z * z; const zw = z * w;
  out[0] = (1 - 2 * (yy + zz)) * sx;
  out[1] = 2 * (xy + zw) * sx;
  out[2] = 2 * (xz - yw) * sx;
  out[3] = 0;
  out[4] = 2 * (xy - zw) * sy;
  out[5] = (1 - 2 * (xx + zz)) * sy;
  out[6] = 2 * (yz + xw) * sy;
  out[7] = 0;
  out[8] = 2 * (xz + yw) * sz;
  out[9] = 2 * (yz - xw) * sz;
  out[10] = (1 - 2 * (xx + yy)) * sz;
  out[11] = 0;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
};

const copyMatrix = (
  target: Float32Array,
  targetOffset: number,
  source: Mat4,
): void => {
  for (let component = 0; component < 16; component += 1) {
    target[targetOffset + component] = source[component]!;
  }
};

const copyFlatMatrix = (
  target: Float32Array,
  targetOffset: number,
  source: Float32Array,
  sourceOffset: number,
): void => {
  for (let component = 0; component < 16; component += 1) {
    target[targetOffset + component] = source[sourceOffset + component]!;
  }
};

const matrixHandedness = (matrix: ArrayLike<number>, offset: number): 1 | -1 =>
  matrix[offset]! * (
    matrix[offset + 5]! * matrix[offset + 10]!
    - matrix[offset + 6]! * matrix[offset + 9]!
  ) - matrix[offset + 4]! * (
    matrix[offset + 1]! * matrix[offset + 10]!
    - matrix[offset + 2]! * matrix[offset + 9]!
  ) + matrix[offset + 8]! * (
    matrix[offset + 1]! * matrix[offset + 6]!
    - matrix[offset + 2]! * matrix[offset + 5]!
  ) < 0 ? -1 : 1;

const composeGltfInstanceMatrixInto = (
  output: MutableMat4,
  source: GltfInstanceTransforms,
  instance: number,
): void => {
  const offset = instance * 3;
  const rotationX = source.rotations[offset]!;
  const rotationY = source.rotations[offset + 1]!;
  const rotationZ = source.rotations[offset + 2]!;
  composeEulerMat4Into(
    output,
    source.positions,
    source.scales,
    offset,
    Math.cos(rotationX),
    Math.sin(rotationX),
    Math.cos(rotationY),
    Math.sin(rotationY),
    Math.cos(rotationZ),
    Math.sin(rotationZ),
  );
};

const composeGltfInnerModelInto = (
  batch: GltfInstanceRangeBatch,
  source: GltfInstanceTransforms,
  sourceIndex: number,
  innerIndex: number,
  outputIndex: number,
  workspace: GltfInstanceUpdateWorkspace,
): void => {
  composeGltfInstanceMatrixInto(workspace.instanceModel, source, sourceIndex);
  const innerOffset = innerIndex * 16;
  for (let component = 0; component < 16; component += 1) {
    workspace.innerModel[component] = batch.innerModels[innerOffset + component]!;
  }
  multiplyMat4Into(workspace.composed, workspace.instanceModel, workspace.innerModel);
  copyMatrix(batch.localModels, outputIndex * 16, workspace.composed);
};

/** Rewrites one validated source range without reallocating its retained matrix batch. */
export const updateGltfInstanceBatchRangeInto = (
  batch: GltfInstanceRangeBatch,
  source: GltfInstanceTransforms,
  startIndex: number,
  count: number,
  workspace: GltfInstanceUpdateWorkspace,
): void => {
  const endIndex = startIndex + count;
  if (batch.sourceOrdered) {
    for (let sourceIndex = startIndex; sourceIndex < endIndex; sourceIndex += 1) {
      for (let innerIndex = 0; innerIndex < batch.innerCount; innerIndex += 1) {
        const outputIndex = sourceIndex * batch.innerCount + innerIndex;
        composeGltfInnerModelInto(
          batch,
          source,
          sourceIndex,
          innerIndex,
          outputIndex,
          workspace,
        );
      }
    }
    return;
  }
  for (let outputIndex = 0; outputIndex < batch.sourceIndices.length; outputIndex += 1) {
    const sourceIndex = batch.sourceIndices[outputIndex]!;
    if (sourceIndex < startIndex || sourceIndex >= endIndex) continue;
    composeGltfInnerModelInto(
      batch,
      source,
      sourceIndex,
      batch.innerIndices?.[outputIndex] ?? 0,
      outputIndex,
      workspace,
    );
  }
};

const splitStaticInstanceMatrices = (
  all: Float32Array,
  negativeCount: number,
): readonly StaticInstanceBatch[] => {
  const count = all.length / 16;
  if (negativeCount === 0) return [{ handedness: 1, localModels: all }];
  if (negativeCount === count) return [{ handedness: -1, localModels: all }];
  const positive = new Float32Array((count - negativeCount) * 16);
  const negative = new Float32Array(negativeCount * 16);
  let positiveOffset = 0;
  let negativeOffset = 0;
  for (let instance = 0; instance < count; instance += 1) {
    const sourceOffset = instance * 16;
    if (matrixHandedness(all, sourceOffset) < 0) {
      copyFlatMatrix(negative, negativeOffset, all, sourceOffset);
      negativeOffset += 16;
    } else {
      copyFlatMatrix(positive, positiveOffset, all, sourceOffset);
      positiveOffset += 16;
    }
  }
  return [
    { handedness: 1, localModels: positive },
    { handedness: -1, localModels: negative },
  ];
};

/** Purely batches already-composed transforms without changing their authored values. */
export const prepareStaticMatrixBatches = (
  models: readonly Mat4[],
): readonly StaticInstanceBatch[] => {
  if (models.length === 0) throw new Error("instance matrices must not be empty");
  const all = new Float32Array(models.length * 16);
  let negativeCount = 0;
  for (let instance = 0; instance < models.length; instance += 1) {
    const model = models[instance]!;
    copyMatrix(all, instance * 16, model);
    if (matrixHandedness(model, 0) < 0) negativeCount += 1;
  }
  return splitStaticInstanceMatrices(all, negativeCount);
};

/** Purely lowers instance TRS streams into compact, front-face-compatible matrix batches. */
export const prepareStaticInstanceBatches = (
  nodeModel: Mat4,
  streams: StaticInstanceStreams,
): readonly StaticInstanceBatch[] => {
  if (!Number.isSafeInteger(streams.count) || streams.count < 1) {
    throw new Error("instance count must be a positive safe integer");
  }
  const expectedLengths = [
    [streams.translations, streams.count * 3, "translation"],
    [streams.rotations, streams.count * 4, "rotation"],
    [streams.scales, streams.count * 3, "scale"],
  ] as const;
  for (const [values, expected, name] of expectedLengths) {
    if (values !== undefined && values.length !== expected) {
      throw new Error(`instance ${name} stream length must be ${expected}`);
    }
  }
  const all = new Float32Array(streams.count * 16);
  const instanceMatrix = identityMat4();
  const localModel = identityMat4();
  let negativeCount = 0;
  for (let instance = 0; instance < streams.count; instance += 1) {
    composeInstanceMatrixInto(instanceMatrix, streams, instance);
    multiplyMat4Into(localModel, nodeModel, instanceMatrix);
    if (matrixHandedness(localModel, 0) < 0) negativeCount += 1;
    copyMatrix(all, instance * 16, localModel);
  }
  return splitStaticInstanceMatrices(all, negativeCount);
};

/** Lowers public mutable Euler-TRS streams and asset-local models to one instance ABI. */
export const prepareGltfInstanceBatches = (
  source: GltfInstanceTransforms,
  innerModels: ArrayLike<number>,
  innerCount: number,
): readonly IndexedStaticInstanceBatch[] => {
  if (!Number.isSafeInteger(innerCount) || innerCount < 1 || innerModels.length !== innerCount * 16) {
    throw new Error("explicit glTF instance inner matrix storage is invalid");
  }
  const total = source.count * innerCount;
  if (!Number.isSafeInteger(total) || total < 1 || total > 0xffff_ffff) {
    throw new Error("explicit glTF instance expansion exceeds the safe count range");
  }
  const all = new Float32Array(total * 16);
  const sourceIndices = new Uint32Array(total);
  const instanceModel = identityMat4();
  const innerModel = identityMat4();
  const composed = identityMat4();
  let negativeCount = 0;
  let outputIndex = 0;
  for (let instance = 0; instance < source.count; instance += 1) {
    composeGltfInstanceMatrixInto(instanceModel, source, instance);
    for (let inner = 0; inner < innerCount; inner += 1) {
      const innerOffset = inner * 16;
      for (let component = 0; component < 16; component += 1) {
        innerModel[component] = innerModels[innerOffset + component]!;
      }
      multiplyMat4Into(composed, instanceModel, innerModel);
      copyMatrix(all, outputIndex * 16, composed);
      sourceIndices[outputIndex] = instance;
      if (matrixHandedness(composed, 0) < 0) negativeCount += 1;
      outputIndex += 1;
    }
  }
  if (negativeCount === 0) {
    return [{ handedness: 1, localModels: all, sourceIndices, sourceOrdered: true }];
  }
  if (negativeCount === total) {
    return [{ handedness: -1, localModels: all, sourceIndices, sourceOrdered: true }];
  }
  const positiveCount = total - negativeCount;
  const positiveModels = new Float32Array(positiveCount * 16);
  const positiveIndices = new Uint32Array(positiveCount);
  const negativeModels = new Float32Array(negativeCount * 16);
  const negativeIndices = new Uint32Array(negativeCount);
  const positiveInnerIndices = innerCount === 1 ? undefined : new Uint32Array(positiveCount);
  const negativeInnerIndices = innerCount === 1 ? undefined : new Uint32Array(negativeCount);
  let positive = 0;
  let negative = 0;
  for (let item = 0; item < total; item += 1) {
    if (matrixHandedness(all, item * 16) < 0) {
      copyFlatMatrix(negativeModels, negative * 16, all, item * 16);
      negativeIndices[negative] = sourceIndices[item]!;
      if (negativeInnerIndices !== undefined) negativeInnerIndices[negative] = item % innerCount;
      negative += 1;
    } else {
      copyFlatMatrix(positiveModels, positive * 16, all, item * 16);
      positiveIndices[positive] = sourceIndices[item]!;
      if (positiveInnerIndices !== undefined) positiveInnerIndices[positive] = item % innerCount;
      positive += 1;
    }
  }
  return [
    {
      handedness: 1,
      ...(positiveInnerIndices === undefined ? {} : { innerIndices: positiveInnerIndices }),
      localModels: positiveModels,
      sourceIndices: positiveIndices,
      sourceOrdered: false,
    },
    {
      handedness: -1,
      ...(negativeInnerIndices === undefined ? {} : { innerIndices: negativeInnerIndices }),
      localModels: negativeModels,
      sourceIndices: negativeIndices,
      sourceOrdered: false,
    },
  ];
};
