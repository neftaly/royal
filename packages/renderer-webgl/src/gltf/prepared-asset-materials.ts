import type {
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
  PreparedGltfAsset,
} from "./prepared-asset";

/**
 * Purely groups materials that must preserve one visible publication across an
 * authored LOD transition. Unrelated materials remain independent even when
 * they belong to the same asset.
 */
export const preparedGltfMaterialPublicationGroups = (
  primitives: readonly LoadedGltfPrimitive[],
): readonly (readonly LoadedGltfMaterial[])[] => {
  const groups: Array<readonly LoadedGltfMaterial[]> = [];
  for (const primitive of primitives) {
    groups.push(primitive.baseMaterial.materialLod?.levels ?? [primitive.baseMaterial.material]);
    for (const variant of primitive.materialVariants ?? []) {
      groups.push(variant.materialLod?.levels ?? [variant.material]);
    }
  }
  return groups;
};

/** Collects every material reachable through base, LOD, and variant paths once by identity. */
export const preparedGltfPrimitiveMaterials = (
  primitives: readonly LoadedGltfPrimitive[],
): readonly LoadedGltfMaterial[] => [...new Set(preparedGltfMaterialPublicationGroups(primitives).flat())];

export const preparedAssetMaterials = (asset: PreparedGltfAsset): readonly LoadedGltfMaterial[] =>
  preparedGltfPrimitiveMaterials(asset.primitives);
