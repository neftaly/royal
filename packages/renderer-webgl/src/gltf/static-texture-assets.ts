import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import {
  decodedTextureKey,
  textureStorageKey,
  type TextureSourceRef,
} from "../texture/source";

type StaticMaterialLod = Readonly<{
  levels: readonly CanonicalSurfaceMaterial[];
}>;

type StaticPrimitiveMaterials = Readonly<{
  material: CanonicalSurfaceMaterial;
  materialLod?: StaticMaterialLod;
  materialVariantLods?: ReadonlyMap<string, StaticMaterialLod>;
  materialVariants?: ReadonlyMap<string, CanonicalSurfaceMaterial>;
}>;

const collectStaticMaterials = (
  primitives: readonly StaticPrimitiveMaterials[],
): readonly CanonicalSurfaceMaterial[] => {
  const materialSet = new Set<CanonicalSurfaceMaterial>();
  const materials: CanonicalSurfaceMaterial[] = [];
  let found = true;
  const retainSet = (
    material: CanonicalSurfaceMaterial,
    lod: StaticMaterialLod | undefined,
    phase: number,
  ): void => {
    const levels = lod?.levels;
    const selected = levels === undefined
      ? phase === 0 ? material : undefined
      : levels[levels.length - phase - 1];
    if (selected === undefined) return;
    found = true;
    if (!materialSet.has(selected)) {
      materialSet.add(selected);
      materials.push(selected);
    }
  };
  for (let phase = 0; found; phase += 1) {
    found = false;
    for (const primitive of primitives) {
      retainSet(primitive.material, primitive.materialLod, phase);
      for (const [name, material] of primitive.materialVariants ?? []) {
        retainSet(
          material,
          primitive.materialVariantLods?.get(name),
          phase,
        );
      }
    }
  }
  return materials;
};

/**
 * Collects each prepared texture once. Immediately visible color maps lead;
 * maps which publish atomically are kept adjacent by material so decoded work
 * spends as little time as possible waiting on the rest of its coherent set.
 */
export const collectStaticTextureAssets = (
  primitives: readonly StaticPrimitiveMaterials[],
): readonly TextureSourceRef[] => {
  const claims = new Map<string, TextureSourceRef>();
  const materials = collectStaticMaterials(primitives);
  const claim = (asset: TextureSourceRef | undefined): void => {
    if (asset === undefined) return;
    const key = textureStorageKey(asset);
    if (!claims.has(key)) claims.set(key, asset);
  };
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

/** Collects base-color sources whose authored MASK materials require CPU alpha. */
export const collectStaticAlphaMaskTextureAssets = (
  primitives: readonly StaticPrimitiveMaterials[],
): readonly TextureSourceRef[] => {
  const claimed = new Set<string>();
  const assets: TextureSourceRef[] = [];
  for (const material of collectStaticMaterials(primitives)) {
    const asset = material.alphaCutoff === undefined ? undefined : material.baseColorAsset;
    if (asset === undefined) continue;
    const key = decodedTextureKey(asset);
    if (claimed.has(key)) continue;
    claimed.add(key);
    assets.push(asset);
  }
  return assets;
};
