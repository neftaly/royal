import type {
  LinearRgba,
  TextureColorSpace,
  TextureContentKey,
  TextureRef,
} from "@royal/renderer-core";
import {
  GLTF_CORE_MATERIAL_TEXTURES,
  GLTF_MATERIAL_EXTENSION_TEXTURES,
} from "./material-texture-definitions";
import type { GltfTextureCoordinates } from "./texture-coordinates";
import type {
  LoadedGltfMaterial,
  LoadedGltfMaterialTextureSlot,
  LoadedGltfPrimitive,
  LoadedGltfPrimitiveMaterial,
} from "./prepared-asset";
import {
  type SurfaceMaterial,
  type SurfaceMaterialPublication,
  type SurfaceMaterialTextureCoordinates,
  type TextureAssetUploadRef,
} from "../webgl/materials";

type LoadedGltfSurfaceTextures = {
  readonly anisotropyTexture?: TextureAssetUploadRef;
  readonly clearcoatNormalTexture?: TextureAssetUploadRef;
  readonly clearcoatRoughnessTexture?: TextureAssetUploadRef;
  readonly clearcoatTexture?: TextureAssetUploadRef;
  readonly diffuseTransmissionColorTexture?: TextureAssetUploadRef;
  readonly diffuseTransmissionTexture?: TextureAssetUploadRef;
  readonly emissiveTexture?: TextureAssetUploadRef;
  readonly iridescenceTexture?: TextureAssetUploadRef;
  readonly iridescenceThicknessTexture?: TextureAssetUploadRef;
  readonly materialTransmissionTexture?: TextureAssetUploadRef;
  readonly metallicRoughnessTexture?: TextureAssetUploadRef;
  readonly normalTexture?: TextureAssetUploadRef;
  readonly occlusionTexture?: TextureAssetUploadRef;
  readonly sheenColorTexture?: TextureAssetUploadRef;
  readonly sheenRoughnessTexture?: TextureAssetUploadRef;
  readonly specularColorTexture?: TextureAssetUploadRef;
  readonly specularTexture?: TextureAssetUploadRef;
  readonly thicknessTexture?: TextureAssetUploadRef;
  readonly textureCoordinates?: SurfaceMaterialTextureCoordinates;
};

export type GltfPreparedPrimitiveMaterial = {
  readonly material: SurfaceMaterial;
  readonly materialBatchClassId: number;
};

// Perceptual 50% sRGB gray represented in Royal's scene-linear color space.
const DEFAULT_COLOR: LinearRgba = [0.21404114, 0.21404114, 0.21404114, 1];
const TEXTURE_COLOR: LinearRgba = [1, 1, 1, 1];

const omitPublicationState = (key: string, value: unknown): unknown =>
  key === "publication" ? undefined : value;

/** Value identity preserves automatic instancing across equivalent assets. */
const surfaceMaterialBatchKey = (material: SurfaceMaterial): string =>
  JSON.stringify(material, omitPublicationState);

type SurfaceMaterialBuildKey = keyof SurfaceMaterial | "metallicFactor" | "roughnessFactor";

const loadedGltfSurfaceMaterial = (
  loadedMaterial: LoadedGltfMaterial,
  baseColor: TextureRef,
  textures: LoadedGltfSurfaceTextures,
  criticalImagePending: boolean,
  publication?: SurfaceMaterialPublication,
): SurfaceMaterial => {
  const material: Partial<Record<SurfaceMaterialBuildKey, unknown>> & {
    baseColor: TextureRef;
    kind: "standard" | "unlit";
  } = {
    baseColor,
    baseColorFactor: loadedMaterial.color ?? TEXTURE_COLOR,
    alphaMode: loadedMaterial.alphaMode,
    doubleSided: loadedMaterial.doubleSided,
    kind: loadedMaterial.unlit === true ? "unlit" : "standard",
  };
  material.basePending = criticalImagePending ? true : undefined;
  material.publication = publication;
  material.alphaCutoff = loadedMaterial.alphaMode === "MASK" ? loadedMaterial.alphaCutoff ?? 0.5 : undefined;
  material.emissive = loadedMaterial.emissive;
  material.emissiveTexture = textures.emissiveTexture;
  material.extensionFactors = loadedMaterial.extensionFactors;
  material.textureCoordinates = textures.textureCoordinates;
  if (material.kind === "standard") {
    material.metallicFactor = loadedMaterial.metallicFactor ?? 1;
    material.normalScale = loadedMaterial.normalScale ?? 1;
    material.occlusionStrength = loadedMaterial.occlusionStrength ?? 1;
    material.roughnessFactor = loadedMaterial.roughnessFactor ?? 1;
    Object.assign(material, textures);
  }
  return material as SurfaceMaterial;
};

const textureSlotRef = (
  slot: LoadedGltfMaterialTextureSlot | undefined,
  colorSpace: TextureColorSpace,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
  readyImageKeys?: ReadonlySet<string>,
): TextureAssetUploadRef | undefined => {
  if (slot?.textureUri === undefined) return undefined;
  if (readyImageKeys !== undefined && slot.imageUri !== undefined && !readyImageKeys.has(slot.imageUri)) {
    return undefined;
  }
  const texture: { -readonly [Key in keyof TextureAssetUploadRef]: TextureAssetUploadRef[Key] } = {
    colorSpace,
    kind: "asset",
    preparedOnly: true,
    uri: slot.textureUri,
  };
  const contentKey = slot.contentKey ?? contentKeys.get(slot.textureUri);
  if (contentKey !== undefined) texture.contentKey = contentKey;
  if (slot.sampler !== undefined) texture.sampler = slot.sampler;
  return texture;
};

const surfaceTextures = (
  material: LoadedGltfMaterial,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
  readyImageKeys: ReadonlySet<string>,
): LoadedGltfSurfaceTextures => {
  const extensionTextures = material.extensionTextures;
  const textures: { -readonly [Key in keyof LoadedGltfSurfaceTextures]: LoadedGltfSurfaceTextures[Key] } = {};
  const textureCoordinates: {
    -readonly [Key in keyof SurfaceMaterialTextureCoordinates]?: GltfTextureCoordinates
  } = {};
  let hasTextureCoordinates = false;
  const setTexture = (
    key: keyof Omit<LoadedGltfSurfaceTextures, "textureCoordinates">,
    texture: TextureAssetUploadRef | undefined,
  ): void => {
    if (texture !== undefined) textures[key] = texture;
  };
  const setCoordinates = (
    key: keyof SurfaceMaterialTextureCoordinates,
    slot: LoadedGltfMaterialTextureSlot | undefined,
  ): void => {
    if (slot !== undefined) {
      textureCoordinates[key] = slot.coordinates;
      hasTextureCoordinates = true;
    }
  };

  for (const [key, colorSpace] of GLTF_CORE_MATERIAL_TEXTURES) {
    const slot = material[key];
    setCoordinates(key, slot);
    if (key !== "baseColorTexture") {
      setTexture(key, textureSlotRef(slot, colorSpace, contentKeys, readyImageKeys));
    }
  }
  for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
    const slot = extensionTextures?.[texture.key];
    setTexture(texture.key, textureSlotRef(slot, texture.colorSpace, contentKeys, readyImageKeys));
    setCoordinates(texture.key, slot);
  }

  if (hasTextureCoordinates) textures.textureCoordinates = textureCoordinates;
  return textures;
};

export const gltfMaterialTextureRefs = (
  material: LoadedGltfMaterial,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): readonly TextureAssetUploadRef[] => {
  const refs: (TextureAssetUploadRef | undefined)[] = [];
  for (const [key, colorSpace] of GLTF_CORE_MATERIAL_TEXTURES) {
    refs.push(textureSlotRef(material[key], colorSpace, contentKeys));
  }
  for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
    refs.push(textureSlotRef(material.extensionTextures?.[texture.key], texture.colorSpace, contentKeys));
  }
  return refs.filter((ref): ref is TextureAssetUploadRef => ref !== undefined);
};

export const gltfPrimitiveMaterialForVariant = (
  variantIndex: number,
  primitive: LoadedGltfPrimitive,
): LoadedGltfPrimitiveMaterial => {
  const variant = primitive.materialVariants?.find((mapping) => mapping.variants.includes(variantIndex));
  if (variant === undefined) return primitive.baseMaterial;
  return {
    material: variant.material,
    ...(variant.materialLod === undefined ? {} : { materialLod: variant.materialLod }),
    selectionKey: `variant:${variantIndex}`,
  };
};

export const selectedGltfVariantIndex = (
  variants: readonly string[],
  selection: string | undefined,
): number | undefined => {
  if (selection === undefined) return undefined;
  const index = variants.indexOf(selection);
  return index === -1 ? undefined : index;
};

/** Owns prepared surface-material identity and image-readiness invalidation. */
export class GltfMaterialPreparationArena {
  #batchClassIdCount = 0;
  readonly #batchClassIds = new Map<string, number>();
  #prepared = new WeakMap<LoadedGltfMaterial, GltfPreparedPrimitiveMaterial>();

  prepare(
    loadedMaterial: LoadedGltfMaterial,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
    readyImageKeys: ReadonlySet<string>,
    criticalImagePending = false,
    publication?: SurfaceMaterialPublication,
  ): GltfPreparedPrimitiveMaterial {
    const cached = this.#prepared.get(loadedMaterial);
    if (cached !== undefined) return cached;

    const baseColor = textureSlotRef(
      loadedMaterial.baseColorTexture,
      "srgb",
      contentKeys,
      readyImageKeys,
    );
    const material = loadedGltfSurfaceMaterial(
      loadedMaterial,
      loadedMaterial.baseColorTexture?.imageUri !== undefined
        && baseColor !== undefined
        ? baseColor
        : {
            color: loadedMaterial.baseColorTexture?.textureUri === undefined
              ? TEXTURE_COLOR
              : DEFAULT_COLOR,
            kind: "solid",
          },
      surfaceTextures(loadedMaterial, contentKeys, readyImageKeys),
      criticalImagePending,
      publication,
    );
    const prepared = {
      material,
      materialBatchClassId: this.#batchClassId(surfaceMaterialBatchKey(material)),
    };
    this.#prepared.set(loadedMaterial, prepared);
    return prepared;
  }

  invalidate(materials: Iterable<LoadedGltfMaterial>): void {
    for (const material of materials) this.#prepared.delete(material);
  }

  clear(): void {
    this.#batchClassIds.clear();
    this.#batchClassIdCount = 0;
    this.#prepared = new WeakMap();
  }

  #batchClassId(key: string): number {
    const existing = this.#batchClassIds.get(key);
    if (existing !== undefined) return existing;
    this.#batchClassIdCount += 1;
    if (!Number.isSafeInteger(this.#batchClassIdCount)) {
      throw new Error("Royal glTF material batch-class ID space is exhausted");
    }
    this.#batchClassIds.set(key, this.#batchClassIdCount);
    return this.#batchClassIdCount;
  }
}
