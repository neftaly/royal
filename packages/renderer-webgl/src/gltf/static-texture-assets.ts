import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { TextureSourceRef } from "../texture/asset-owner";
import { textureStorageKey } from "../texture/asset-owner";

type StaticMaterialLod = Readonly<{
  levels: readonly CanonicalSurfaceMaterial[];
}>;

type StaticPrimitiveMaterials = Readonly<{
  material: CanonicalSurfaceMaterial;
  materialLod?: StaticMaterialLod;
  materialVariantLods?: ReadonlyMap<string, StaticMaterialLod>;
  materialVariants?: ReadonlyMap<string, CanonicalSurfaceMaterial>;
}>;

const TEXTURE_PRIORITY_COUNT = 9;

/** Collects each prepared texture once, ordered by its earliest visible contribution. */
export const collectStaticTextureAssets = (
  primitives: readonly StaticPrimitiveMaterials[],
): readonly TextureSourceRef[] => {
  const buckets = Array.from(
    { length: TEXTURE_PRIORITY_COUNT },
    () => new Map<string, TextureSourceRef>(),
  );
  const priorities = new Map<string, number>();
  const materials = new Set<CanonicalSurfaceMaterial>();
  const claim = (asset: TextureSourceRef | undefined, priority: number): void => {
    if (asset === undefined) return;
    const key = textureStorageKey(asset);
    const previous = priorities.get(key);
    if (previous !== undefined && previous <= priority) return;
    if (previous !== undefined) buckets[previous]!.delete(key);
    priorities.set(key, priority);
    buckets[priority]!.set(key, asset);
  };
  const collectMaterial = (material: CanonicalSurfaceMaterial): void => {
    if (materials.has(material)) return;
    materials.add(material);
    claim(material.baseColorAsset, 0);
    if (material.kind === "unlit") return;
    claim(material.emissiveAsset, 1);
    claim(material.metallicRoughnessAsset, 2);
    claim(material.normalAsset, 3);
    claim(material.occlusionAsset, 4);
    claim(material.specularColorAsset, 5);
    claim(material.specularTextureAsset, 6);
    claim(material.thicknessAsset, 7);
    claim(material.transmissionAsset, 8);
  };
  for (const primitive of primitives) {
    collectMaterial(primitive.material);
    for (const level of primitive.materialLod?.levels ?? []) collectMaterial(level);
    for (const material of primitive.materialVariants?.values() ?? []) collectMaterial(material);
    for (const lod of primitive.materialVariantLods?.values() ?? []) {
      for (const level of lod.levels) collectMaterial(level);
    }
  }
  const assets: TextureSourceRef[] = [];
  for (const bucket of buckets) {
    for (const asset of bucket.values()) assets.push(asset);
  }
  return assets;
};
