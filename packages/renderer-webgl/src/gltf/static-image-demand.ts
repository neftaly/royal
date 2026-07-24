import {
  array,
  index,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import { readStaticMaterialInputs } from "./static-material-inputs";
import { createStaticTextureImagePlanner } from "./static-texture-image-plan";
import { selectedTextureCoordinateSet } from "./static-texture-coordinate-set";

export type StaticTextureDemand = Readonly<{
  colorSpace: "linear" | "srgb";
  coordinateSet: 0 | 1;
  priority: 0 | 1 | 2 | 3;
  retainAlpha: boolean;
  textureIndex: number;
}>;

type TextureClaim = (demand: StaticTextureDemand) => void;

/**
 * Builds one selected-primitive logical texture-demand collector. Material LOD
 * and variant traversal is shared by early external discovery, selected buffer
 * demand, and canonical material preparation.
 */
export const createStaticPrimitiveTextureDemand = (
  document: JsonObject,
  label: string,
  claimTextureDemand: TextureClaim,
): ((primitive: JsonObject, path: string) => void) => {
  const materials = optionalArray(document.materials, label, "materials");
  const textures = optionalArray(document.textures, label, "textures");
  const claimedMaterials = new Set<number>();
  const claimTexture = (
    value: unknown,
    colorSpace: "linear" | "srgb",
    path: string,
    retainAlpha = false,
    priority: StaticTextureDemand["priority"] = 2,
  ): void => {
    if (value === undefined) return;
    const textureInfo = object(value, label, path);
    const textureIndex = index(textureInfo.index, textures, label, `${path}.index`);
    claimTextureDemand({
      colorSpace,
      coordinateSet: selectedTextureCoordinateSet(textureInfo, label, path),
      priority,
      retainAlpha,
      textureIndex,
    });
  };
  const claimMaterial = (value: unknown, path: string): void => {
    const materialIndex = index(value, materials, label, path);
    if (claimedMaterials.has(materialIndex)) return;
    claimedMaterials.add(materialIndex);
    const materialPath = `materials[${materialIndex}]`;
    const material = object(materials[materialIndex], label, materialPath);
    const {
      extensions,
      pbr,
      specularExtension,
      transmissionExtension,
      volumeExtension,
    } = readStaticMaterialInputs(material, label, materialPath);
    claimTexture(
      pbr.baseColorTexture,
      "srgb",
      `${materialPath}.pbrMetallicRoughness.baseColorTexture`,
      material.alphaMode === "MASK",
      0,
    );
    if (extensions.KHR_materials_unlit === undefined) {
      claimTexture(
        pbr.metallicRoughnessTexture,
        "linear",
        `${materialPath}.pbrMetallicRoughness.metallicRoughnessTexture`,
      );
      claimTexture(material.normalTexture, "linear", `${materialPath}.normalTexture`);
      claimTexture(material.occlusionTexture, "linear", `${materialPath}.occlusionTexture`);
      claimTexture(
        material.emissiveTexture,
        "srgb",
        `${materialPath}.emissiveTexture`,
        false,
        1,
      );
      claimTexture(
        specularExtension?.specularTexture,
        "linear",
        `${materialPath}.extensions.KHR_materials_specular.specularTexture`,
      );
      claimTexture(
        specularExtension?.specularColorTexture,
        "srgb",
        `${materialPath}.extensions.KHR_materials_specular.specularColorTexture`,
      );
      claimTexture(
        transmissionExtension?.transmissionTexture,
        "linear",
        `${materialPath}.extensions.KHR_materials_transmission.transmissionTexture`,
        false,
        3,
      );
      claimTexture(
        volumeExtension?.thicknessTexture,
        "linear",
        `${materialPath}.extensions.KHR_materials_volume.thicknessTexture`,
        false,
        3,
      );
    }
    if (extensions.MSFT_lod === undefined) return;
    const extensionPath = `${materialPath}.extensions.MSFT_lod`;
    const extension = object(extensions.MSFT_lod, label, extensionPath);
    const ids = array(extension.ids, label, `${extensionPath}.ids`);
    for (let lodIndex = 0; lodIndex < ids.length; lodIndex += 1) {
      claimMaterial(ids[lodIndex], `${extensionPath}.ids[${lodIndex}]`);
    }
  };
  return (primitive, path) => {
    if (primitive.material !== undefined) claimMaterial(primitive.material, `${path}.material`);
    if (primitive.extensions === undefined) return;
    const extensions = object(primitive.extensions, label, `${path}.extensions`);
    if (extensions.KHR_materials_variants === undefined) return;
    const extensionPath = `${path}.extensions.KHR_materials_variants`;
    const extension = object(extensions.KHR_materials_variants, label, extensionPath);
    const mappings = array(extension.mappings, label, `${extensionPath}.mappings`);
    for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex += 1) {
      const mappingPath = `${extensionPath}.mappings[${mappingIndex}]`;
      const mapping = object(mappings[mappingIndex], label, mappingPath);
      claimMaterial(mapping.material, `${mappingPath}.material`);
    }
  };
};

/**
 * Builds one selected-primitive encoded-image collector while preserving the
 * exact capability-aware preferred/fallback plan.
 */
export const createStaticPrimitiveImageDemand = (
  document: JsonObject,
  label: string,
  etc2Available: boolean,
  claimImage: (imageIndex: number) => void,
): ((primitive: JsonObject, path: string) => void) => {
  const planTextureImages = createStaticTextureImagePlanner(document, label, etc2Available);
  return createStaticPrimitiveTextureDemand(document, label, ({ colorSpace, textureIndex }) => {
    const plan = planTextureImages(textureIndex, colorSpace);
    claimImage(plan.primary.imageIndex);
    if (plan.fallback !== undefined) claimImage(plan.fallback.imageIndex);
  });
};
