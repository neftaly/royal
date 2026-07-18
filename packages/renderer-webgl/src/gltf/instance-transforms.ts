import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";

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
  const handedness = new Int8Array(streams.count);
  const instanceMatrix = identityMat4();
  const localModel = identityMat4();
  let negativeCount = 0;
  for (let instance = 0; instance < streams.count; instance += 1) {
    composeInstanceMatrixInto(instanceMatrix, streams, instance);
    multiplyMat4Into(localModel, nodeModel, instanceMatrix);
    const nodeSign = localModel[0] * (localModel[5] * localModel[10] - localModel[6] * localModel[9])
      - localModel[4] * (localModel[1] * localModel[10] - localModel[2] * localModel[9])
      + localModel[8] * (localModel[1] * localModel[6] - localModel[2] * localModel[5]) < 0
      ? -1
      : 1;
    handedness[instance] = nodeSign;
    if (nodeSign < 0) negativeCount += 1;
    copyMatrix(all, instance * 16, localModel);
  }
  if (negativeCount === 0) return [{ handedness: 1, localModels: all }];
  if (negativeCount === streams.count) return [{ handedness: -1, localModels: all }];
  const positive = new Float32Array((streams.count - negativeCount) * 16);
  const negative = new Float32Array(negativeCount * 16);
  let positiveOffset = 0;
  let negativeOffset = 0;
  for (let instance = 0; instance < streams.count; instance += 1) {
    if (handedness[instance]! < 0) {
      copyFlatMatrix(negative, negativeOffset, all, instance * 16);
      negativeOffset += 16;
    } else {
      copyFlatMatrix(positive, positiveOffset, all, instance * 16);
      positiveOffset += 16;
    }
  }
  return [
    { handedness: 1, localModels: positive },
    { handedness: -1, localModels: negative },
  ];
};
