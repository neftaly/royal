import type { LinearRgba, Vec3 } from "@royal/renderer-core";
import { normalizeLodThresholds, type LodSet } from "../lod";
import {
  DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
  type SurfaceMaterialAlphaMode,
  type SurfaceMaterialExtensionFactors,
} from "../webgl/materials";
import type {
  LoadedGltfMaterial,
  LoadedGltfMaterialExtensionTextures,
  LoadedGltfMaterialTextureSlot,
  LoadedGltfMaterialVariant,
} from "./prepared-asset";
import type { GltfDocument, GltfMaterial, GltfMeshPrimitive, GltfTextureInfo } from "./schema";
import { GLTF_MATERIAL_EXTENSION_TEXTURES } from "./material-texture-definitions";
import {
  clampedFiniteNumber,
  finiteNumber,
  nonNegativeFiniteNumber,
  positiveFiniteNumber,
} from "./numbers";

export type GltfMaterialReader = Readonly<{
  document: GltfDocument;
  textureSlot: (textureInfo: GltfTextureInfo | undefined) => LoadedGltfMaterialTextureSlot | undefined;
}>;

const extensionTextureSlots = (
  reader: GltfMaterialReader,
  material: GltfMaterial | undefined,
): LoadedGltfMaterialExtensionTextures | undefined => {
  const slots: Partial<Record<keyof LoadedGltfMaterialExtensionTextures, LoadedGltfMaterialTextureSlot>> = {};
  for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
    const slot = reader.textureSlot(texture.textureInfo(material));
    if (slot !== undefined) slots[texture.key] = slot;
  }
  return Object.keys(slots).length === 0 ? undefined : slots;
};

const color = (values: readonly number[] | undefined): LinearRgba | undefined => {
  if (values === undefined || values.length < 3) return undefined;
  return [values[0] ?? 1, values[1] ?? 1, values[2] ?? 1, values[3] ?? 1];
};

const alphaMode = (mode: unknown): SurfaceMaterialAlphaMode => {
  switch (mode) {
    case "MASK": return "MASK";
    case "BLEND": return "BLEND";
    default: return "OPAQUE";
  }
};

const ior = (value: number | undefined): number => {
  if (value === 0) return 0;
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.ior;
};

const iridescenceIor = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceIor;

const specularColorFactor = (values: readonly number[] | undefined): Vec3 => [
  nonNegativeFiniteNumber(values?.[0], 1),
  nonNegativeFiniteNumber(values?.[1], 1),
  nonNegativeFiniteNumber(values?.[2], 1),
];

const sheenColorFactor = (values: readonly number[] | undefined): Vec3 => [
  clampedFiniteNumber(values?.[0], 0, 0, 1),
  clampedFiniteNumber(values?.[1], 0, 0, 1),
  clampedFiniteNumber(values?.[2], 0, 0, 1),
];

const diffuseTransmissionColorFactor = (values: readonly number[] | undefined): Vec3 => [
  clampedFiniteNumber(values?.[0], 1, 0, 1),
  clampedFiniteNumber(values?.[1], 1, 0, 1),
  clampedFiniteNumber(values?.[2], 1, 0, 1),
];

const extensionFactors = (
  material: GltfMaterial | undefined,
): SurfaceMaterialExtensionFactors | undefined => {
  const extensions = material?.extensions;
  const anisotropy = extensions?.KHR_materials_anisotropy;
  const specular = extensions?.KHR_materials_specular;
  const materialIor = extensions?.KHR_materials_ior;
  const sheen = extensions?.KHR_materials_sheen;
  const iridescence = extensions?.KHR_materials_iridescence;
  const clearcoat = extensions?.KHR_materials_clearcoat;
  const dispersion = extensions?.KHR_materials_dispersion;
  const diffuseTransmission = extensions?.KHR_materials_diffuse_transmission;
  const transmission = extensions?.KHR_materials_transmission;
  const volume = extensions?.KHR_materials_volume;
  if (anisotropy === undefined && specular === undefined && materialIor === undefined && sheen === undefined
    && iridescence === undefined && clearcoat === undefined && dispersion === undefined
    && diffuseTransmission === undefined && transmission === undefined && volume === undefined) return undefined;
  return {
    anisotropyRotation: finiteNumber(anisotropy?.anisotropyRotation, 0),
    anisotropyStrength: clampedFiniteNumber(anisotropy?.anisotropyStrength, 0, 0, 1),
    attenuationColor: [
      nonNegativeFiniteNumber(volume?.attenuationColor?.[0], 1),
      nonNegativeFiniteNumber(volume?.attenuationColor?.[1], 1),
      nonNegativeFiniteNumber(volume?.attenuationColor?.[2], 1),
    ],
    attenuationDistance: positiveFiniteNumber(volume?.attenuationDistance)
      ?? DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.attenuationDistance,
    clearcoatFactor: clampedFiniteNumber(clearcoat?.clearcoatFactor, 0, 0, 1),
    clearcoatNormalScale: finiteNumber(clearcoat?.clearcoatNormalTexture?.scale, 1),
    clearcoatRoughnessFactor: clampedFiniteNumber(clearcoat?.clearcoatRoughnessFactor, 0, 0, 1),
    diffuseTransmissionColorFactor: diffuseTransmissionColorFactor(diffuseTransmission?.diffuseTransmissionColorFactor),
    diffuseTransmissionFactor: clampedFiniteNumber(diffuseTransmission?.diffuseTransmissionFactor, 0, 0, 1),
    dispersionFactor: nonNegativeFiniteNumber(dispersion?.dispersion, 0),
    ior: ior(materialIor?.ior),
    iridescenceFactor: clampedFiniteNumber(iridescence?.iridescenceFactor, 0, 0, 1),
    iridescenceIor: iridescenceIor(iridescence?.iridescenceIor),
    iridescenceThicknessMaximum: nonNegativeFiniteNumber(
      iridescence?.iridescenceThicknessMaximum,
      DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceThicknessMaximum,
    ),
    iridescenceThicknessMinimum: nonNegativeFiniteNumber(
      iridescence?.iridescenceThicknessMinimum,
      DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceThicknessMinimum,
    ),
    sheenColorFactor: sheenColorFactor(sheen?.sheenColorFactor),
    sheenRoughnessFactor: clampedFiniteNumber(sheen?.sheenRoughnessFactor, 0, 0, 1),
    specularColorFactor: specularColorFactor(specular?.specularColorFactor),
    specularFactor: clampedFiniteNumber(specular?.specularFactor, 1, 0, 1),
    thicknessFactor: nonNegativeFiniteNumber(volume?.thicknessFactor, 0),
    transmissionFactor: clampedFiniteNumber(transmission?.transmissionFactor, 0, 0, 1),
  };
};

const emissiveColor = (material: GltfMaterial | undefined): LinearRgba | undefined => {
  const factor = material?.emissiveFactor;
  const strength = Math.max(0, finiteNumber(material?.extensions?.KHR_materials_emissive_strength?.emissiveStrength, 1));
  const emissive: LinearRgba = [
    (factor?.[0] ?? 0) * strength,
    (factor?.[1] ?? 0) * strength,
    (factor?.[2] ?? 0) * strength,
    1,
  ];
  return emissive[0] === 0 && emissive[1] === 0 && emissive[2] === 0 ? undefined : emissive;
};

export const readGltfMaterial = (
  reader: GltfMaterialReader,
  materialIndex: number | undefined,
): LoadedGltfMaterial => {
  const material = materialIndex === undefined ? undefined : reader.document.materials?.[materialIndex];
  const baseColorTexture = reader.textureSlot(material?.pbrMetallicRoughness?.baseColorTexture);
  const metallicRoughnessTexture = reader.textureSlot(material?.pbrMetallicRoughness?.metallicRoughnessTexture);
  const normalTexture = reader.textureSlot(material?.normalTexture);
  const emissiveTexture = reader.textureSlot(material?.emissiveTexture);
  const occlusionTexture = reader.textureSlot(material?.occlusionTexture);
  const materialColor = color(material?.pbrMetallicRoughness?.baseColorFactor);
  const emissive = emissiveColor(material);
  const factors = extensionFactors(material);
  const textures = extensionTextureSlots(reader, material);
  const mode = alphaMode(material?.alphaMode);
  return {
    alphaMode: mode,
    ...(mode === "MASK" ? { alphaCutoff: finiteNumber(material?.alphaCutoff, 0.5) } : {}),
    ...(baseColorTexture === undefined ? {} : { baseColorTexture }),
    ...(emissiveTexture === undefined ? {} : { emissiveTexture }),
    ...(metallicRoughnessTexture === undefined ? {} : { metallicRoughnessTexture }),
    ...(normalTexture === undefined ? {} : { normalTexture }),
    ...(occlusionTexture === undefined ? {} : { occlusionTexture }),
    ...(materialColor === undefined ? {} : { color: materialColor }),
    ...(emissive === undefined ? {} : { emissive }),
    ...(factors === undefined ? {} : { extensionFactors: factors }),
    ...(textures === undefined ? {} : { extensionTextures: textures }),
    doubleSided: material?.doubleSided === true,
    metallicFactor: clampedFiniteNumber(material?.pbrMetallicRoughness?.metallicFactor, 1, 0, 1),
    normalScale: material?.normalTexture?.scale ?? 1,
    occlusionStrength: clampedFiniteNumber(material?.occlusionTexture?.strength, 1, 0, 1),
    roughnessFactor: clampedFiniteNumber(material?.pbrMetallicRoughness?.roughnessFactor, 1, 0, 1),
    ...(materialIndex === undefined ? {} : { sourceMaterialIndex: materialIndex }),
    ...(material?.extensions?.KHR_materials_unlit === undefined ? {} : { unlit: true }),
  };
};

export const readGltfMaterialLod = (
  reader: GltfMaterialReader,
  materialIndex: number | undefined,
): LodSet<LoadedGltfMaterial> | undefined => {
  const material = materialIndex === undefined ? undefined : reader.document.materials?.[materialIndex];
  const lodIds = material?.extensions?.MSFT_lod?.ids ?? [];
  if (materialIndex === undefined || lodIds.length === 0) return undefined;
  const levels = [
    readGltfMaterial(reader, materialIndex),
    ...lodIds.map((id) => readGltfMaterial(reader, id)),
  ];
  return { levels, thresholds: normalizeLodThresholds(material?.extras?.MSFT_screencoverage, levels.length) };
};

export const readGltfMaterialVariants = (
  reader: GltfMaterialReader,
  primitive: GltfMeshPrimitive,
  variantCount: number,
): readonly LoadedGltfMaterialVariant[] =>
  (primitive.extensions?.KHR_materials_variants?.mappings ?? [])
    .map((mapping): LoadedGltfMaterialVariant | undefined => {
      const materialIndex = mapping.material;
      const variants = (mapping.variants ?? [])
        .filter((variant) => Number.isInteger(variant) && variant >= 0 && variant < variantCount);
      if (materialIndex === undefined || !Number.isInteger(materialIndex) || materialIndex < 0
        || reader.document.materials?.[materialIndex] === undefined || variants.length === 0) return undefined;
      const material = readGltfMaterial(reader, materialIndex);
      const materialLod = readGltfMaterialLod(reader, materialIndex);
      return { material, ...(materialLod === undefined ? {} : { materialLod }), variants };
    })
    .filter((mapping): mapping is LoadedGltfMaterialVariant => mapping !== undefined);
