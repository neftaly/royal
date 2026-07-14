import type {
  LinearRgba,
  TextureContentKey,
  TextureRef,
} from "@royal/renderer-core";
import { GLTF_MATERIAL_EXTENSION_TEXTURES } from "./scene-reader";
import type { GltfTextureCoordinates } from "./texture-coordinates";
import type {
  LoadedGltfMaterial,
  LoadedGltfMaterialTextureSlot,
  LoadedGltfPrimitive,
  LoadedGltfPrimitiveMaterial,
} from "./prepared-asset";
import {
  surfaceMaterialBatchKey,
  type SurfaceMaterial,
  type SurfaceMaterialTextureCoordinates,
  type TextureAssetUploadRef,
} from "../webgl/materials";

type LoadedGltfSurfaceTextures = {
  readonly clearcoatRoughnessTexture?: TextureAssetUploadRef;
  readonly clearcoatTexture?: TextureAssetUploadRef;
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

type TextureColorSpace = NonNullable<TextureRef["colorSpace"]>;

export type GltfPreparedPrimitiveMaterial = {
  readonly material: SurfaceMaterial;
  readonly materialBatchClassId: number;
};

const DEFAULT_COLOR: LinearRgba = [0.5, 0.5, 0.5, 1];
const TEXTURE_COLOR: LinearRgba = [1, 1, 1, 1];

const loadedGltfSurfaceMaterial = (
  loadedMaterial: LoadedGltfMaterial,
  baseColor: TextureRef,
  textures: LoadedGltfSurfaceTextures,
): SurfaceMaterial => {
  const emissive = loadedMaterial.emissive;
  const extensionFactors = loadedMaterial.extensionFactors;
  const common = {
    baseColor,
    baseColorFactor: loadedMaterial.color ?? TEXTURE_COLOR,
    alphaMode: loadedMaterial.alphaMode,
    ...(loadedMaterial.alphaMode === "MASK" ? { alphaCutoff: loadedMaterial.alphaCutoff ?? 0.5 } : {}),
    doubleSided: loadedMaterial.doubleSided,
    ...(emissive === undefined ? {} : { emissive }),
    ...(textures.emissiveTexture === undefined ? {} : { emissiveTexture: textures.emissiveTexture }),
    ...(extensionFactors === undefined ? {} : { extensionFactors }),
    ...(textures.textureCoordinates === undefined ? {} : { textureCoordinates: textures.textureCoordinates }),
  };
  if (loadedMaterial.unlit === true) return { ...common, kind: "unlit" };

  return {
    ...common,
    kind: "standard",
    ...(textures.clearcoatRoughnessTexture === undefined
      ? {}
      : { clearcoatRoughnessTexture: textures.clearcoatRoughnessTexture }),
    ...(textures.clearcoatTexture === undefined ? {} : { clearcoatTexture: textures.clearcoatTexture }),
    ...(textures.iridescenceTexture === undefined ? {} : { iridescenceTexture: textures.iridescenceTexture }),
    ...(textures.iridescenceThicknessTexture === undefined
      ? {}
      : { iridescenceThicknessTexture: textures.iridescenceThicknessTexture }),
    ...(textures.materialTransmissionTexture === undefined
      ? {}
      : { materialTransmissionTexture: textures.materialTransmissionTexture }),
    metallicFactor: loadedMaterial.metallicFactor ?? 1,
    ...(textures.metallicRoughnessTexture === undefined
      ? {}
      : { metallicRoughnessTexture: textures.metallicRoughnessTexture }),
    ...(textures.normalTexture === undefined ? {} : { normalTexture: textures.normalTexture }),
    normalScale: loadedMaterial.normalScale ?? 1,
    ...(textures.occlusionTexture === undefined ? {} : { occlusionTexture: textures.occlusionTexture }),
    occlusionStrength: loadedMaterial.occlusionStrength ?? 1,
    roughnessFactor: loadedMaterial.roughnessFactor ?? 1,
    ...(textures.sheenColorTexture === undefined ? {} : { sheenColorTexture: textures.sheenColorTexture }),
    ...(textures.sheenRoughnessTexture === undefined
      ? {}
      : { sheenRoughnessTexture: textures.sheenRoughnessTexture }),
    ...(textures.specularColorTexture === undefined
      ? {}
      : { specularColorTexture: textures.specularColorTexture }),
    ...(textures.specularTexture === undefined ? {} : { specularTexture: textures.specularTexture }),
    ...(textures.thicknessTexture === undefined ? {} : { thicknessTexture: textures.thicknessTexture }),
  };
};

const textureContentKeyProps = (
  textureUri: string,
  authored: TextureContentKey | undefined,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): { readonly contentKey?: TextureContentKey } => {
  const contentKey = authored ?? contentKeys.get(textureUri);
  return contentKey === undefined ? {} : { contentKey };
};

const textureSlotRef = (
  slot: LoadedGltfMaterialTextureSlot | undefined,
  colorSpace: TextureColorSpace,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): TextureAssetUploadRef | undefined => {
  if (slot?.textureUri === undefined) return undefined;
  return {
    colorSpace,
    ...textureContentKeyProps(slot.textureUri, slot.contentKey, contentKeys),
    kind: "asset",
    preparedOnly: true,
    ...(slot.sampler === undefined ? {} : { sampler: slot.sampler }),
    uri: slot.textureUri,
  };
};

const baseColorTextureRef = (
  material: LoadedGltfMaterial,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): TextureAssetUploadRef | undefined => textureSlotRef(material.baseColorTexture, "srgb", contentKeys);

const surfaceTextures = (
  material: LoadedGltfMaterial,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): LoadedGltfSurfaceTextures => {
  const extensionTextures = material.extensionTextures;
  const textures: {
    -readonly [Key in keyof Omit<LoadedGltfSurfaceTextures, "textureCoordinates">]?: TextureAssetUploadRef
  } = {};
  const textureCoordinates: {
    -readonly [Key in keyof SurfaceMaterialTextureCoordinates]?: GltfTextureCoordinates
  } = {};
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
    if (slot !== undefined) textureCoordinates[key] = slot.coordinates;
  };

  setTexture("emissiveTexture", textureSlotRef(material.emissiveTexture, "srgb", contentKeys));
  setTexture(
    "metallicRoughnessTexture",
    textureSlotRef(material.metallicRoughnessTexture, "linear", contentKeys),
  );
  setTexture("normalTexture", textureSlotRef(material.normalTexture, "linear", contentKeys));
  setTexture("occlusionTexture", textureSlotRef(material.occlusionTexture, "linear", contentKeys));
  setCoordinates("baseColorTexture", material.baseColorTexture);
  setCoordinates("emissiveTexture", material.emissiveTexture);
  setCoordinates("metallicRoughnessTexture", material.metallicRoughnessTexture);
  setCoordinates("normalTexture", material.normalTexture);
  setCoordinates("occlusionTexture", material.occlusionTexture);
  for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
    const slot = extensionTextures?.[texture.key];
    setTexture(texture.key, textureSlotRef(slot, texture.colorSpace, contentKeys));
    setCoordinates(texture.key, slot);
  }

  return {
    ...textures,
    ...(Object.keys(textureCoordinates).length === 0 ? {} : { textureCoordinates }),
  };
};

export const gltfMaterialTextureRefs = (
  material: LoadedGltfMaterial,
  contentKeys: ReadonlyMap<string, TextureContentKey>,
): readonly TextureAssetUploadRef[] => {
  const refs = [
    baseColorTextureRef(material, contentKeys),
    textureSlotRef(material.emissiveTexture, "srgb", contentKeys),
    textureSlotRef(material.metallicRoughnessTexture, "linear", contentKeys),
    textureSlotRef(material.normalTexture, "linear", contentKeys),
    textureSlotRef(material.occlusionTexture, "linear", contentKeys),
    ...GLTF_MATERIAL_EXTENSION_TEXTURES.map((texture) =>
      textureSlotRef(material.extensionTextures?.[texture.key], texture.colorSpace, contentKeys)),
  ];
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
  selection: number | string | undefined,
): number | undefined => {
  if (selection === undefined) return undefined;
  if (typeof selection === "number") {
    return Number.isInteger(selection) && selection >= 0 && selection < variants.length
      ? selection
      : undefined;
  }
  const index = variants.indexOf(selection);
  return index === -1 ? undefined : index;
};

/** Owns prepared surface-material identity and image-readiness invalidation. */
export class GltfMaterialPreparationArena {
  #batchClassIdCount = 0;
  readonly #batchClassIds = new Map<string, number>();
  #materialPrimitives = new WeakMap<LoadedGltfMaterial, Set<LoadedGltfPrimitive>>();
  #prepared = new WeakMap<
    LoadedGltfPrimitive,
    WeakMap<LoadedGltfMaterial, GltfPreparedPrimitiveMaterial>
  >();

  prepare(
    primitive: LoadedGltfPrimitive,
    loadedMaterial: LoadedGltfMaterial,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
    baseColorImageReady: boolean,
  ): GltfPreparedPrimitiveMaterial {
    let materialPrimitives = this.#materialPrimitives.get(loadedMaterial);
    if (materialPrimitives === undefined) {
      materialPrimitives = new Set();
      this.#materialPrimitives.set(loadedMaterial, materialPrimitives);
    }
    materialPrimitives.add(primitive);

    let primitiveCache = this.#prepared.get(primitive);
    if (primitiveCache === undefined) {
      primitiveCache = new WeakMap();
      this.#prepared.set(primitive, primitiveCache);
    }
    const cached = primitiveCache.get(loadedMaterial);
    if (cached !== undefined) return cached;

    const baseColor = baseColorTextureRef(loadedMaterial, contentKeys);
    const material = loadedGltfSurfaceMaterial(
      loadedMaterial,
      loadedMaterial.baseColorTexture?.imageUri !== undefined
        && baseColorImageReady
        && baseColor !== undefined
        ? baseColor
        : {
            color: loadedMaterial.baseColorTexture?.textureUri === undefined
              ? TEXTURE_COLOR
              : DEFAULT_COLOR,
            kind: "solid",
          },
      surfaceTextures(loadedMaterial, contentKeys),
    );
    const prepared = {
      material,
      materialBatchClassId: this.#batchClassId(surfaceMaterialBatchKey(material)),
    };
    primitiveCache.set(loadedMaterial, prepared);
    return prepared;
  }

  invalidate(materials: Iterable<LoadedGltfMaterial>): void {
    for (const material of materials) {
      for (const primitive of this.#materialPrimitives.get(material) ?? []) {
        this.#prepared.get(primitive)?.delete(material);
      }
    }
  }

  clear(): void {
    this.#batchClassIds.clear();
    this.#batchClassIdCount = 0;
    this.#materialPrimitives = new WeakMap();
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
