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

const canonicalZero = (value: number): number => value === 0 ? 0 : value;

const selectedTextureCoordinates = (
  value: unknown,
  fallback: unknown,
  label: string,
  path: string,
): 0 | 1 => {
  const selected = value ?? fallback ?? 0;
  if (selected !== 0 && selected !== 1) {
    return fail(label, path, "must select TEXCOORD_0 or TEXCOORD_1");
  }
  return selected;
};

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
    const set = selectedTextureCoordinates(
      undefined,
      textureInfo.texCoord,
      label,
      `${path}.texCoord`,
    );
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
  const set = selectedTextureCoordinates(
    transform.texCoord,
    textureInfo.texCoord,
    label,
    `${path}.extensions.KHR_texture_transform.texCoord`,
  );
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
