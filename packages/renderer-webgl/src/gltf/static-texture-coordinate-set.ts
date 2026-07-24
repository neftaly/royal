import {
  fail,
  object,
  type JsonObject,
} from "./gltf-values";

/** Resolves the glTF texture-coordinate set selected by one texture info. */
export const selectedTextureCoordinateSet = (
  textureInfo: JsonObject,
  label: string,
  path: string,
): 0 | 1 => {
  const extensions = textureInfo.extensions === undefined
    ? undefined
    : object(textureInfo.extensions, label, `${path}.extensions`);
  const transformValue = extensions?.KHR_texture_transform;
  const transform = transformValue === undefined
    ? undefined
    : object(transformValue, label, `${path}.extensions.KHR_texture_transform`);
  const selected = transform?.texCoord ?? textureInfo.texCoord ?? 0;
  if (selected !== 0 && selected !== 1) {
    return fail(
      label,
      transform === undefined
        ? `${path}.texCoord`
        : `${path}.extensions.KHR_texture_transform.texCoord`,
      "must select TEXCOORD_0 or TEXCOORD_1",
    );
  }
  return selected;
};
