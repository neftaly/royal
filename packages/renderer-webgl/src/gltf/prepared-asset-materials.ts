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
  const components = new Map<LoadedGltfMaterial, Set<LoadedGltfMaterial>>();
  const merge = (group: readonly LoadedGltfMaterial[]): void => {
    const component = new Set(group);
    for (const material of group) {
      for (const member of components.get(material) ?? []) component.add(member);
    }
    for (const material of component) components.set(material, component);
  };
  for (const primitive of primitives) {
    merge(primitive.baseMaterial.materialLod?.levels ?? [primitive.baseMaterial.material]);
    for (const variant of primitive.materialVariants ?? []) {
      merge(variant.materialLod?.levels ?? [variant.material]);
    }
  }
  return [...new Set(components.values())].map((component) => [...component]);
};

/** Collects every material reachable through base, LOD, and variant paths once by identity. */
export const preparedGltfPrimitiveMaterials = (
  primitives: readonly LoadedGltfPrimitive[],
): readonly LoadedGltfMaterial[] => [...new Set(preparedGltfMaterialPublicationGroups(primitives).flat())];

export const preparedAssetMaterials = (asset: PreparedGltfAsset): readonly LoadedGltfMaterial[] =>
  preparedGltfPrimitiveMaterials(asset.primitives);
