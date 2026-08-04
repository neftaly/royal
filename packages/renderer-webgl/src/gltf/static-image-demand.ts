import {
  array,
  index,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import {
  readStaticMaterialInputs,
  staticMaterialLodIds,
} from "./static-material-inputs";
import { createStaticTextureImagePlanner } from "./static-texture-image-plan";
import { selectedTextureCoordinateSet } from "./static-texture-coordinate-set";

export type StaticTextureDemand = Readonly<{
  colorSpace: "linear" | "srgb";
  coordinateSet: 0 | 1;
  /** Texture-slot tier followed by lowest-to-preferred material phase. */
  priority: number;
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
  const claimedMaterialPhases: (number | undefined)[] = [];
  let materialPhase = 0;
  const claimTexture = (
    value: unknown,
    colorSpace: "linear" | "srgb",
    path: string,
    retainAlpha = false,
    priority = 2,
  ): void => {
    if (value === undefined) return;
    const textureInfo = object(value, label, path);
    const textureIndex = index(textureInfo.index, textures, label, `${path}.index`);
    claimTextureDemand({
      colorSpace,
      coordinateSet: selectedTextureCoordinateSet(textureInfo, label, path),
      priority: priority * materials.length + materialPhase,
      retainAlpha,
      textureIndex,
    });
  };
  const claimMaterial = (value: unknown, path: string, phase?: number): void => {
    const materialIndex = index(value, materials, label, path);
    const materialPath = `materials[${materialIndex}]`;
    const material = object(materials[materialIndex], label, materialPath);
    const {
      extensions,
      pbr,
      specularExtension,
      transmissionExtension,
      volumeExtension,
    } = readStaticMaterialInputs(material, label, materialPath);
    const lodIds = staticMaterialLodIds(materials, extensions, label, materialPath);
    phase ??= lodIds.length;
    const claimedPhase = claimedMaterialPhases[materialIndex];
    if (claimedPhase !== undefined && claimedPhase <= phase) return;
    claimedMaterialPhases[materialIndex] = phase;
    // Direct IDs descend in authored order, so the last ID owns phase zero.
    const extensionPath = `${materialPath}.extensions.MSFT_lod`;
    for (let lodIndex = lodIds.length - 1; lodIndex >= 0; lodIndex -= 1) {
      claimMaterial(
        lodIds[lodIndex],
        `${extensionPath}.ids[${lodIndex}]`,
        lodIds.length - lodIndex - 1,
      );
    }
    materialPhase = phase;
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
      claimTexture(
        material.normalTexture,
        "linear",
        `${materialPath}.normalTexture`,
      );
      claimTexture(
        material.occlusionTexture,
        "linear",
        `${materialPath}.occlusionTexture`,
      );
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
 * exact extension-aware preferred/fallback plan.
 */
export const createStaticPrimitiveImageDemand = (
  document: JsonObject,
  label: string,
  claimImage: (imageIndex: number) => void,
): ((primitive: JsonObject, path: string) => void) => {
  const planTextureImages = createStaticTextureImagePlanner(document, label);
  return createStaticPrimitiveTextureDemand(document, label, ({ colorSpace, textureIndex }) => {
    const plan = planTextureImages(textureIndex, colorSpace);
    claimImage(plan.primary.imageIndex);
    if (plan.fallback !== undefined) claimImage(plan.fallback.imageIndex);
  });
};
