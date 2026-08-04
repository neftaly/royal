import {
  array,
  fail,
  index,
  object,
  type JsonObject,
} from "./gltf-values";

export type StaticMaterialInputs = Readonly<{
  extensions: JsonObject;
  iorExtension: JsonObject | undefined;
  pbr: JsonObject;
  specularExtension: JsonObject | undefined;
  transmissionExtension: JsonObject | undefined;
  volumeExtension: JsonObject | undefined;
}>;

const optionalExtension = (
  extensions: JsonObject,
  name: string,
  label: string,
  materialPath: string,
): JsonObject | undefined => extensions[name] === undefined
  ? undefined
  : object(extensions[name], label, `${materialPath}.extensions.${name}`);

/** Pure structural view shared by material preparation and selected-image demand. */
export const readStaticMaterialInputs = (
  material: JsonObject,
  label: string,
  materialPath: string,
): StaticMaterialInputs => {
  const extensions = material.extensions === undefined
    ? {}
    : object(material.extensions, label, `${materialPath}.extensions`);
  return {
    extensions,
    iorExtension: optionalExtension(extensions, "KHR_materials_ior", label, materialPath),
    pbr: material.pbrMetallicRoughness === undefined
      ? {}
      : object(
        material.pbrMetallicRoughness,
        label,
        `${materialPath}.pbrMetallicRoughness`,
      ),
    specularExtension: optionalExtension(
      extensions,
      "KHR_materials_specular",
      label,
      materialPath,
    ),
    transmissionExtension: optionalExtension(
      extensions,
      "KHR_materials_transmission",
      label,
      materialPath,
    ),
    volumeExtension: optionalExtension(
      extensions,
      "KHR_materials_volume",
      label,
      materialPath,
    ),
  };
};

/** Reads one validated material LOD edge list for planning and preparation. */
export const staticMaterialLodIds = (
  materials: readonly unknown[],
  extensions: JsonObject,
  label: string,
  materialPath: string,
): readonly number[] => {
  if (extensions.MSFT_lod === undefined) return [];
  const extensionPath = `${materialPath}.extensions.MSFT_lod`;
  const ids = array(
    object(extensions.MSFT_lod, label, extensionPath).ids,
    label,
    `${extensionPath}.ids`,
  );
  if (ids.length === 0) fail(label, `${extensionPath}.ids`, "must not be empty");
  return ids.map((id, lodIndex) => index(
    id,
    materials,
    label,
    `${extensionPath}.ids[${lodIndex}]`,
  ));
};
