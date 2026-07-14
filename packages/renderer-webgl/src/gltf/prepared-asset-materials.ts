import type {
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
  PreparedGltfAsset,
} from "./prepared-asset";

/** Collects every material reachable through base, LOD, and variant paths once by identity. */
export const preparedGltfPrimitiveMaterials = (
  primitives: readonly LoadedGltfPrimitive[],
): readonly LoadedGltfMaterial[] => {
  const materials = new Set<LoadedGltfMaterial>();
  for (const primitive of primitives) {
    materials.add(primitive.material);
    for (const material of primitive.materialLod?.levels ?? []) materials.add(material);
    for (const variant of primitive.materialVariants ?? []) {
      materials.add(variant.material);
      for (const material of variant.materialLod?.levels ?? []) materials.add(material);
    }
  }
  return [...materials];
};

export const preparedAssetMaterials = (asset: PreparedGltfAsset): readonly LoadedGltfMaterial[] =>
  preparedGltfPrimitiveMaterials(asset.primitives);
