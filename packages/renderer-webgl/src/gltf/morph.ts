import { readGltfFloatAccessor } from "./accessors";
import type {
  GltfDocument,
  GltfMesh,
  GltfMeshPrimitive,
  GltfSceneNode,
} from "./schema";

export type GltfMorphableAttributes = {
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly tangents?: Float32Array;
};

const finiteWeight = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 0 : value;

export const gltfMorphWeights = (
  mesh: GltfMesh | undefined,
  node: GltfSceneNode | undefined,
): readonly number[] =>
  (node?.weights ?? mesh?.weights ?? []).map(finiteWeight);

const targetDelta = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: number | undefined,
  expectedLength: number,
): Float32Array | undefined => {
  if (accessor === undefined) return undefined;

  const delta = readGltfFloatAccessor(document, buffers, accessor);
  return delta.length === expectedLength ? delta : undefined;
};

const addWeightedDelta = (
  base: Float32Array,
  delta: Float32Array | undefined,
  weight: number,
  current: Float32Array,
): Float32Array => {
  if (delta === undefined || weight === 0) return current;

  const output = current === base ? new Float32Array(base) : current;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (output[index] ?? 0) + delta[index]! * weight;
  }

  return output;
};

const addWeightedTangentDelta = (
  base: Float32Array,
  delta: Float32Array | undefined,
  weight: number,
  current: Float32Array,
): Float32Array => {
  if (delta === undefined || weight === 0) return current;

  const output = current === base ? new Float32Array(base) : current;
  const vertexCount = Math.floor(base.length / 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const baseOffset = vertex * 4;
    const deltaOffset = vertex * 3;
    output[baseOffset] = (output[baseOffset] ?? 0) + delta[deltaOffset]! * weight;
    output[baseOffset + 1] = (output[baseOffset + 1] ?? 0) + delta[deltaOffset + 1]! * weight;
    output[baseOffset + 2] = (output[baseOffset + 2] ?? 0) + delta[deltaOffset + 2]! * weight;
  }

  return output;
};

export const applyGltfMorphTargets = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  weights: readonly number[],
  attributes: GltfMorphableAttributes,
): GltfMorphableAttributes => {
  const targets = primitive.targets ?? [];
  if (targets.length === 0 || weights.every((weight) => weight === 0)) return attributes;

  let positions = attributes.positions;
  let normals = attributes.normals;
  let tangents = attributes.tangents;
  for (const [targetIndex, target] of targets.entries()) {
    const weight = finiteWeight(weights[targetIndex]);
    if (weight === 0) continue;

    positions = addWeightedDelta(
      attributes.positions,
      targetDelta(document, buffers, target.POSITION, attributes.positions.length),
      weight,
      positions,
    );
    if (normals !== undefined) {
      normals = addWeightedDelta(
        attributes.normals!,
        targetDelta(document, buffers, target.NORMAL, attributes.normals!.length),
        weight,
        normals,
      );
    }
    if (tangents !== undefined) {
      tangents = addWeightedTangentDelta(
        attributes.tangents!,
        targetDelta(document, buffers, target.TANGENT, Math.floor(attributes.tangents!.length / 4) * 3),
        weight,
        tangents,
      );
    }
  }

  return {
    ...(normals === undefined ? {} : { normals }),
    positions,
    ...(tangents === undefined ? {} : { tangents }),
  };
};
