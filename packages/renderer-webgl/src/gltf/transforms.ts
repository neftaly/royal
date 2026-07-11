import {
  identityMat4,
  multiplyMat4,
  quaternionMat4,
  scaleMat4,
  translationMat4,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type {
  GltfDocument,
  GltfSceneNode,
} from "./schema";

const validateFiniteTuple = (
  label: string,
  values: readonly number[] | undefined,
  length: number,
): void => {
  if (values === undefined) return;
  if (values.length !== length) {
    throw new Error(`glTF node ${label} must contain exactly ${length} finite numbers`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`glTF node ${label} must contain exactly ${length} finite numbers`);
  }
};

const validateGltfNodeTransform = (node: GltfSceneNode | undefined): void => {
  if (node === undefined) return;
  if (node.matrix !== undefined) {
    if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
      throw new Error("glTF node matrix cannot be combined with translation, rotation, or scale");
    }
    validateFiniteTuple("matrix", node.matrix, 16);
    return;
  }

  validateFiniteTuple("translation", node.translation, 3);
  validateFiniteTuple("rotation", node.rotation, 4);
  validateFiniteTuple("scale", node.scale, 3);
  if (node.rotation !== undefined) {
    const [x, y, z, w] = node.rotation;
    const lengthSquared = x! * x! + y! * y! + z! * z! + w! * w!;
    if (!(lengthSquared > 1e-12)) {
      throw new Error("glTF node rotation must be a non-zero quaternion");
    }
  }
};

export const gltfNodeMat4Into = (
  out: MutableMat4,
  node: GltfSceneNode | undefined,
): MutableMat4 => {
  validateGltfNodeTransform(node);
  if (node?.matrix !== undefined) {
    for (let index = 0; index < 16; index += 1) out[index] = node.matrix[index]!;
    return out;
  }

  const translation = node?.translation;
  const rotation = node?.rotation;
  const scale = node?.scale;
  const x = rotation?.[0] ?? 0;
  const y = rotation?.[1] ?? 0;
  const z = rotation?.[2] ?? 0;
  const w = rotation?.[3] ?? 1;
  const inverseLength = 1 / (Math.hypot(x, y, z, w) || 1);
  const nx = x * inverseLength;
  const ny = y * inverseLength;
  const nz = z * inverseLength;
  const nw = w * inverseLength;
  const sx = scale?.[0] ?? 1;
  const sy = scale?.[1] ?? 1;
  const sz = scale?.[2] ?? 1;
  const xx = nx * nx;
  const xy = nx * ny;
  const xz = nx * nz;
  const xw = nx * nw;
  const yy = ny * ny;
  const yz = ny * nz;
  const yw = ny * nw;
  const zz = nz * nz;
  const zw = nz * nw;

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
  out[12] = translation?.[0] ?? 0;
  out[13] = translation?.[1] ?? 0;
  out[14] = translation?.[2] ?? 0;
  out[15] = 1;
  return out;
};

export const gltfNodeMat4 = (node: GltfSceneNode | undefined): Mat4 =>
  gltfNodeMat4Into(identityMat4(), node);

export const gltfInstanceTransformMat4 = (
  translations: Float32Array | undefined,
  rotations: Float32Array | undefined,
  scales: Float32Array | undefined,
  index: number,
): Mat4 => {
  const translationOffset = index * 3;
  const rotationOffset = index * 4;
  const scaleOffset = index * 3;

  return multiplyMat4(
    translationMat4([
      translations?.[translationOffset] ?? 0,
      translations?.[translationOffset + 1] ?? 0,
      translations?.[translationOffset + 2] ?? 0,
    ]),
    multiplyMat4(
      quaternionMat4(rotations === undefined
        ? undefined
        : [
            rotations[rotationOffset] ?? 0,
            rotations[rotationOffset + 1] ?? 0,
            rotations[rotationOffset + 2] ?? 0,
            rotations[rotationOffset + 3] ?? 1,
          ]),
      scaleMat4([
        scales?.[scaleOffset] ?? 1,
        scales?.[scaleOffset + 1] ?? 1,
        scales?.[scaleOffset + 2] ?? 1,
      ]),
    ),
  );
};

export const gltfInstancingAttributeCount = (
  document: GltfDocument,
  accessorIndex: number | undefined,
): number | undefined =>
  accessorIndex === undefined ? undefined : document.accessors?.[accessorIndex]?.count;
