import type { GltfTextureInfo } from "./schema";

export type GltfTextureCoordinates = {
  readonly row0: readonly [number, number, number, number];
  readonly row1: readonly [number, number, number, number];
  readonly set: 0 | 1;
};

export const IDENTITY_GLTF_TEXTURE_COORDINATES: GltfTextureCoordinates = Object.freeze({
  row0: Object.freeze([1, 0, 0, 0] as const),
  row1: Object.freeze([0, 1, 0, 0] as const),
  set: 0,
});

const finiteOrDefault = (value: number | undefined, fallback: number, field: string): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    throw new Error(`glTF KHR_texture_transform ${field} must be finite`);
  }
  return value;
};

/** Pure glTF KHR_texture_transform preparation for the fragment shader. */
export const gltfTextureCoordinates = (textureInfo: GltfTextureInfo): GltfTextureCoordinates => {
  const transform = textureInfo.extensions?.KHR_texture_transform;
  const selectedSet = transform?.texCoord ?? textureInfo.texCoord ?? 0;
  if (selectedSet !== 0 && selectedSet !== 1) {
    throw new Error(
      `Royal supports glTF material texture coordinate sets 0 and 1; received TEXCOORD_${String(selectedSet)}`,
    );
  }

  const offsetX = finiteOrDefault(transform?.offset?.[0], 0, "offset.x");
  const offsetY = finiteOrDefault(transform?.offset?.[1], 0, "offset.y");
  const scaleX = finiteOrDefault(transform?.scale?.[0], 1, "scale.x");
  const scaleY = finiteOrDefault(transform?.scale?.[1], 1, "scale.y");
  const rotation = finiteOrDefault(transform?.rotation, 0, "rotation");
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const row0 = [cosine * scaleX, -sine * scaleY, offsetX, 0] as const;
  const row1 = [sine * scaleX, cosine * scaleY, offsetY, 0] as const;

  if (
    selectedSet === 0
    && row0[0] === 1 && row0[1] === 0 && row0[2] === 0
    && row1[0] === 0 && row1[1] === 1 && row1[2] === 0
  ) return IDENTITY_GLTF_TEXTURE_COORDINATES;

  return Object.freeze({
    row0: Object.freeze(row0),
    row1: Object.freeze(row1),
    set: selectedSet,
  });
};

export const transformGltfTextureCoordinates = (
  coordinates: GltfTextureCoordinates,
  u: number,
  v: number,
): readonly [number, number] => [
  coordinates.row0[0] * u + coordinates.row0[1] * v + coordinates.row0[2],
  coordinates.row1[0] * u + coordinates.row1[1] * v + coordinates.row1[2],
];
