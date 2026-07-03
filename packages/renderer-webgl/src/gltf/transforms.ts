import {
  multiplyMat4,
  quaternionMat4,
  scaleMat4,
  translationMat4,
  type Mat4,
} from "../math/mat4";
import type {
  GltfDocument,
  GltfSceneNode,
} from "./schema";

export const gltfNodeMat4 = (node: GltfSceneNode | undefined): Mat4 => {
  if (node?.matrix !== undefined && node.matrix.length === 16) {
    return [
      node.matrix[0]!, node.matrix[1]!, node.matrix[2]!, node.matrix[3]!,
      node.matrix[4]!, node.matrix[5]!, node.matrix[6]!, node.matrix[7]!,
      node.matrix[8]!, node.matrix[9]!, node.matrix[10]!, node.matrix[11]!,
      node.matrix[12]!, node.matrix[13]!, node.matrix[14]!, node.matrix[15]!,
    ];
  }

  const translation = node?.translation;
  const scale = node?.scale;
  return multiplyMat4(
    translationMat4([
      translation?.[0] ?? 0,
      translation?.[1] ?? 0,
      translation?.[2] ?? 0,
    ]),
    multiplyMat4(
      quaternionMat4(node?.rotation),
      scaleMat4([
        scale?.[0] ?? 1,
        scale?.[1] ?? 1,
        scale?.[2] ?? 1,
      ]),
    ),
  );
};

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
