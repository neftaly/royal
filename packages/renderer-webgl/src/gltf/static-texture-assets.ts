import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import { textureStorageKey, type TextureSourceRef } from "../texture/source";

type StaticMaterialLod = Readonly<{
  levels: readonly CanonicalSurfaceMaterial[];
}>;

type StaticPrimitiveMaterials = Readonly<{
  material: CanonicalSurfaceMaterial;
  materialLod?: StaticMaterialLod;
  materialVariantLods?: ReadonlyMap<string, StaticMaterialLod>;
  materialVariants?: ReadonlyMap<string, CanonicalSurfaceMaterial>;
}>;

/**
 * Collects each prepared texture once. Immediately visible color maps lead;
 * maps which publish atomically are kept adjacent by material so decoded work
 * spends as little time as possible waiting on the rest of its coherent set.
 */
export const collectStaticTextureAssets = (
  primitives: readonly StaticPrimitiveMaterials[],
): readonly TextureSourceRef[] => {
  const claims = new Map<string, TextureSourceRef>();
  const materialSet = new Set<CanonicalSurfaceMaterial>();
  const materials: CanonicalSurfaceMaterial[] = [];
  const claim = (asset: TextureSourceRef | undefined): void => {
    if (asset === undefined) return;
    const key = textureStorageKey(asset);
    if (!claims.has(key)) claims.set(key, asset);
  };
  const retainMaterial = (material: CanonicalSurfaceMaterial): void => {
    if (materialSet.has(material)) return;
    materialSet.add(material);
    materials.push(material);
  };
  for (const primitive of primitives) {
    retainMaterial(primitive.material);
    for (const level of primitive.materialLod?.levels ?? []) retainMaterial(level);
    for (const material of primitive.materialVariants?.values() ?? []) retainMaterial(material);
    for (const lod of primitive.materialVariantLods?.values() ?? []) {
      for (const level of lod.levels) retainMaterial(level);
    }
  }
  for (const material of materials) claim(material.baseColorAsset);
  for (const material of materials) {
    if (material.kind === "standard") claim(material.emissiveAsset);
  }
  for (const material of materials) {
    if (material.kind !== "standard") continue;
    claim(material.metallicRoughnessAsset);
    claim(material.normalAsset);
    claim(material.occlusionAsset);
    claim(material.specularColorAsset);
    claim(material.specularTextureAsset);
  }
  for (const material of materials) {
    if (material.kind !== "standard") continue;
    claim(material.thicknessAsset);
    claim(material.transmissionAsset);
  }
  return [...claims.values()];
};
