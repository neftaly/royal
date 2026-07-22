import {
  array,
  index,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import { readStaticMaterialInputs } from "./static-material-inputs";
import { createStaticTextureImagePlanner } from "./static-texture-image-plan";

type ImageClaim = (imageIndex: number) => void;

/**
 * Builds one selected-primitive image-demand collector. Material LOD and
 * variant traversal is shared for every primitive while image selection uses
 * the same capability-aware plan as canonical material preparation.
 */
export const createStaticPrimitiveImageDemand = (
  document: JsonObject,
  label: string,
  etc2Available: boolean,
  claimImage: ImageClaim,
): ((primitive: JsonObject, path: string) => void) => {
  const materials = optionalArray(document.materials, label, "materials");
  const textures = optionalArray(document.textures, label, "textures");
  const planTextureImages = createStaticTextureImagePlanner(document, label, etc2Available);
  const claimedMaterials = new Set<number>();
  const claimTexture = (
    value: unknown,
    colorSpace: "linear" | "srgb",
    path: string,
  ): void => {
    if (value === undefined) return;
    const textureInfo = object(value, label, path);
    const textureIndex = index(textureInfo.index, textures, label, `${path}.index`);
    const plan = planTextureImages(textureIndex, colorSpace);
    claimImage(plan.primary.imageIndex);
    if (plan.fallback !== undefined) {
      claimImage(plan.fallback.imageIndex);
    }
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
    );
    if (extensions.KHR_materials_unlit === undefined) {
      claimTexture(
        pbr.metallicRoughnessTexture,
        "linear",
        `${materialPath}.pbrMetallicRoughness.metallicRoughnessTexture`,
      );
      claimTexture(material.normalTexture, "linear", `${materialPath}.normalTexture`);
      claimTexture(material.occlusionTexture, "linear", `${materialPath}.occlusionTexture`);
      claimTexture(material.emissiveTexture, "srgb", `${materialPath}.emissiveTexture`);
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
      );
      claimTexture(
        volumeExtension?.thicknessTexture,
        "linear",
        `${materialPath}.extensions.KHR_materials_volume.thicknessTexture`,
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
