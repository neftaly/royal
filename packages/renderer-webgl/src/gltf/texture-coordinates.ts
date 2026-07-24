import {
  fail,
  finiteTuple,
  object,
  type JsonObject,
} from "./gltf-values";
import {
  IDENTITY_TEXTURE_COORDINATES,
  type CanonicalTextureCoordinates,
} from "../surface/texture-coordinates";
import { selectedTextureCoordinateSet } from "./static-texture-coordinate-set";

const canonicalZero = (value: number): number => value === 0 ? 0 : value;

/** Lowers one glTF texture-info transform to two shader-ready affine rows. */
export const prepareTextureCoordinates = (
  textureInfo: JsonObject,
  label: string,
  path: string,
): CanonicalTextureCoordinates => {
  const extensions = textureInfo.extensions === undefined
    ? undefined
    : object(textureInfo.extensions, label, `${path}.extensions`);
  const value = extensions?.KHR_texture_transform;
  if (value === undefined) {
    const set = selectedTextureCoordinateSet(textureInfo, label, path);
    return set === 0
      ? IDENTITY_TEXTURE_COORDINATES
      : { row0: [1, 0, 0, 1], row1: [0, 1, 0, 0] };
  }
  const transform = object(value, label, `${path}.extensions.KHR_texture_transform`);
  const offset = finiteTuple(
    transform.offset,
    2,
    [0, 0],
    label,
    `${path}.extensions.KHR_texture_transform.offset`,
  );
  const scale = finiteTuple(
    transform.scale,
    2,
    [1, 1],
    label,
    `${path}.extensions.KHR_texture_transform.scale`,
  );
  const rotation = transform.rotation === undefined ? 0 : transform.rotation;
  if (typeof rotation !== "number" || !Number.isFinite(rotation)) {
    return fail(
      label,
      `${path}.extensions.KHR_texture_transform.rotation`,
      "must be finite",
    );
  }
  const set = selectedTextureCoordinateSet(textureInfo, label, path);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const row0 = [
    canonicalZero(cosine * scale[0]!),
    canonicalZero(-sine * scale[1]!),
    canonicalZero(offset[0]!),
    set,
  ] as const;
  const row1 = [
    canonicalZero(sine * scale[0]!),
    canonicalZero(cosine * scale[1]!),
    canonicalZero(offset[1]!),
    0,
  ] as const;
  return set === 0
    && row0[0] === 1 && row0[1] === 0 && row0[2] === 0
    && row1[0] === 0 && row1[1] === 1 && row1[2] === 0
    ? IDENTITY_TEXTURE_COORDINATES
    : { row0, row1 };
};
