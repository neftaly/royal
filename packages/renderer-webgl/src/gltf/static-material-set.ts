import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import { canonicalMaterialUsesTextureCoordinateSet } from "../surface/canonical-material";
import { normalizeLodThresholds } from "../surface/lod-selection";
import { array, fail, index, object, type JsonObject } from "./gltf-values";
import { prepareMaterial, type createTextureAssetReader } from "./static-material";
import { staticMaterialLodIds } from "./static-material-inputs";
import type { PreparedStaticMaterialLod } from "./static-asset";

/** Per-document material cache and LOD/variant validation, independent of mesh decoding. */
export const createStaticMaterialSetPreparer = (
  materials: unknown[],
  textureAsset: ReturnType<typeof createTextureAssetReader>,
  variantNames: readonly string[],
  label: string,
) => {
  let defaultMaterial: CanonicalSurfaceMaterial | undefined;
  const preparedMaterials = new Map<number, CanonicalSurfaceMaterial>();
  const preparePrimitiveMaterial = (
    materialIndex: unknown,
    path: string,
  ): CanonicalSurfaceMaterial => {
    if (materialIndex === undefined && defaultMaterial !== undefined) return defaultMaterial;
    if (typeof materialIndex === "number") {
      const retained = preparedMaterials.get(materialIndex);
      if (retained !== undefined) return retained;
    }
    const prepared = prepareMaterial(materials, textureAsset, materialIndex, label, path);
    if (materialIndex === undefined) defaultMaterial = prepared;
    else if (typeof materialIndex === "number") preparedMaterials.set(materialIndex, prepared);
    return prepared;
  };
  const materialLodIds = (materialIndex: number): readonly number[] => {
    const path = `materials[${materialIndex}]`;
    const material = object(materials[materialIndex], label, path);
    const extensions =
      material.extensions === undefined
        ? {}
        : object(material.extensions, label, `${path}.extensions`);
    return staticMaterialLodIds(materials, extensions, label, path);
  };
  const materialGraphState = new Uint8Array(materials.length);
  const validateMaterialLodGraph = (materialIndex: number): void => {
    if (materialGraphState[materialIndex] === 1) {
      fail(label, `materials[${materialIndex}]`, "is part of an MSFT_lod cycle");
    }
    if (materialGraphState[materialIndex] === 2) return;
    materialGraphState[materialIndex] = 1;
    for (const lodMaterial of materialLodIds(materialIndex)) {
      validateMaterialLodGraph(lodMaterial);
    }
    materialGraphState[materialIndex] = 2;
  };
  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    validateMaterialLodGraph(materialIndex);
  }
  const preparedMaterialLods = new Map<number, PreparedStaticMaterialLod>();
  const prepareMaterialLod = (
    materialIndex: number | undefined,
  ): PreparedStaticMaterialLod | undefined => {
    if (materialIndex === undefined) return undefined;
    const retained = preparedMaterialLods.get(materialIndex);
    if (retained !== undefined) return retained;
    const ids = materialLodIds(materialIndex);
    if (ids.length === 0) return undefined;
    const path = `materials[${materialIndex}]`;
    const material = object(materials[materialIndex], label, path);
    const extras =
      material.extras === undefined ? undefined : object(material.extras, label, `${path}.extras`);
    const hints =
      extras?.MSFT_screencoverage === undefined
        ? undefined
        : array(extras.MSFT_screencoverage, label, `${path}.extras.MSFT_screencoverage`);
    const levels = [
      preparePrimitiveMaterial(materialIndex, path),
      ...ids.map((id) => preparePrimitiveMaterial(id, path)),
    ];
    const prepared = { levels, thresholds: normalizeLodThresholds(hints, levels.length) };
    preparedMaterialLods.set(materialIndex, prepared);
    return prepared;
  };
  const materialSetUsesTextureCoordinates = (
    material: CanonicalSurfaceMaterial,
    materialLod: PreparedStaticMaterialLod | undefined,
    variants: ReadonlyMap<string, CanonicalSurfaceMaterial> | undefined,
    variantLods: ReadonlyMap<string, PreparedStaticMaterialLod> | undefined,
    set: 0 | 1,
  ): boolean => {
    if (canonicalMaterialUsesTextureCoordinateSet(material, set)) return true;
    for (const level of materialLod?.levels ?? []) {
      if (canonicalMaterialUsesTextureCoordinateSet(level, set)) return true;
    }
    if (variants === undefined) return false;
    for (const variant of variants.values()) {
      if (canonicalMaterialUsesTextureCoordinateSet(variant, set)) return true;
    }
    for (const lod of variantLods?.values() ?? []) {
      for (const level of lod.levels) {
        if (canonicalMaterialUsesTextureCoordinateSet(level, set)) return true;
      }
    }
    return false;
  };
  const preparePrimitiveMaterialSet = (
    primitive: JsonObject,
    extensions: JsonObject,
    path: string,
  ) => {
    const materialIndex =
      primitive.material === undefined
        ? undefined
        : index(primitive.material, materials, label, `${path}.material`);
    const material = preparePrimitiveMaterial(materialIndex, path);
    const materialLod = prepareMaterialLod(materialIndex);
    let materialVariants: Map<string, CanonicalSurfaceMaterial> | undefined;
    let materialVariantLods: Map<string, PreparedStaticMaterialLod> | undefined;
    if (extensions.KHR_materials_variants !== undefined) {
      const extensionPath = `${path}.extensions.KHR_materials_variants`;
      const extension = object(extensions.KHR_materials_variants, label, extensionPath);
      const mappings = array(extension.mappings, label, `${extensionPath}.mappings`);
      materialVariants = new Map();
      for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex += 1) {
        const mappingPath = `${extensionPath}.mappings[${mappingIndex}]`;
        const mapping = object(mappings[mappingIndex], label, mappingPath);
        const mappedMaterialIndex = index(
          mapping.material,
          materials,
          label,
          `${mappingPath}.material`,
        );
        const mappedMaterial = preparePrimitiveMaterial(mappedMaterialIndex, mappingPath);
        const mappedMaterialLod = prepareMaterialLod(mappedMaterialIndex);
        const mappedVariants = array(mapping.variants, label, `${mappingPath}.variants`);
        if (mappedVariants.length === 0) {
          fail(label, `${mappingPath}.variants`, "must not be empty");
        }
        for (let variantIndex = 0; variantIndex < mappedVariants.length; variantIndex += 1) {
          const name =
            variantNames[
              index(
                mappedVariants[variantIndex],
                variantNames,
                label,
                `${mappingPath}.variants[${variantIndex}]`,
              )
            ]!;
          if (materialVariants.has(name)) {
            fail(
              label,
              `${mappingPath}.variants[${variantIndex}]`,
              `duplicates variant ${JSON.stringify(name)}`,
            );
          }
          materialVariants.set(name, mappedMaterial);
          if (mappedMaterialLod !== undefined) {
            materialVariantLods ??= new Map();
            materialVariantLods.set(name, mappedMaterialLod);
          }
        }
      }
      if (materialVariants.size === 0) materialVariants = undefined;
    }
    return {
      material,
      materialLod,
      materialVariants,
      materialVariantLods,
      usesTextureCoordinates0: materialSetUsesTextureCoordinates(
        material,
        materialLod,
        materialVariants,
        materialVariantLods,
        0,
      ),
      usesTextureCoordinates1: materialSetUsesTextureCoordinates(
        material,
        materialLod,
        materialVariants,
        materialVariantLods,
        1,
      ),
    };
  };
  return preparePrimitiveMaterialSet;
};
