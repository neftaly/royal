import type { TextureContentKey } from "@royal/renderer-core";
import type { CountedTextureDeclaration } from "../frame/plan";
import {
  geometryDeclarationBucketKey,
  gltfGeometryDeclaration,
} from "../geometry-recipes";
import type { PreparedAssetDependencyManifest } from "../resource-arena";
import { textureCacheKey, type TextureAssetUploadRef } from "../webgl/materials";
import { gltfMaterialTextureRefs } from "./material-preparation-arena";
import type {
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
  PreparedGltfAsset,
} from "./prepared-asset";
import { preparedAssetMaterials } from "./prepared-asset-materials";

export type PreparedAssetGeometryAssociation = {
  readonly key: string;
  readonly primitive: LoadedGltfPrimitive;
};

export type PreparedAssetDependencyPlan = {
  readonly geometryAssociations: readonly PreparedAssetGeometryAssociation[];
  readonly manifest: PreparedAssetDependencyManifest;
};

const materialDependencies = (
  materials: readonly LoadedGltfMaterial[],
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): PreparedAssetDependencyManifest["ordinaryTextures"] => {
  const byKey = new Map<string, CountedTextureDeclaration<TextureAssetUploadRef> & { count: number }>();
  const textures: Array<CountedTextureDeclaration<TextureAssetUploadRef> & { count: number }> = [];
  for (const material of materials) {
    for (const texture of gltfMaterialTextureRefs(material, contentKeys)) {
      const key = textureCacheKey(texture);
      const existing = byKey.get(key);
      if (existing === undefined) {
        const entry = { count: 1, key, texture };
        byKey.set(key, entry);
        textures.push(entry);
      } else existing.count += 1;
    }
  }
  return textures;
};

/** Pure dependency planning for a prepared glTF asset. */
export const planPreparedAssetDependencies = (
  asset: PreparedGltfAsset,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
  assetKey: string,
): PreparedAssetDependencyPlan => {
  const materials = preparedAssetMaterials(asset);
  const geometryAssociations: PreparedAssetGeometryAssociation[] = [];
  const geometries = asset.primitives.map((primitive, index) => {
    const declaration = gltfGeometryDeclaration({
      ...(primitive.colors === undefined ? {} : { colors: primitive.colors }),
      ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
      mode: primitive.mode,
      ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
      positions: primitive.positions,
      ...(primitive.tangents === undefined ? {} : { tangents: primitive.tangents }),
      ...(primitive.texCoords0 === undefined ? {} : { texCoords0: primitive.texCoords0 }),
      ...(primitive.texCoords1 === undefined ? {} : { texCoords1: primitive.texCoords1 }),
    });
    const key = JSON.stringify([
      "gltf-geometry-owner-v1",
      assetKey,
      primitive.key,
      index,
      geometryDeclarationBucketKey(declaration),
    ]);
    geometryAssociations.push({ key, primitive });
    return { count: 1, declaration, key };
  });
  return {
    geometryAssociations,
    manifest: {
      geometries,
      iblKeys: asset.imageBasedLight?.specular === undefined
        ? []
        : [{ count: 1, key: asset.imageBasedLight.specular.key }],
      ordinaryTextures: materialDependencies(materials, contentKeys),
      virtualTextures: [],
      requiresHdrComposition: materials.some((material) =>
        material.alphaMode === "BLEND"
        || (material.extensionFactors?.transmissionFactor ?? 0) > 0
      ),
    },
  };
};
