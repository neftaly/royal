import type { LinearRgba, TextureContentKey, TextureSampler, Vec3 } from "@royal/renderer-core";
import { canvasSupportsImageMimeType } from "../capabilities";
import {
  identityMat4,
  multiplyMat4,
  transformDirection,
  transformPoint,
  type Mat4,
} from "../math/mat4";
import { worldBounds } from "../math/picking";
import { normalizeLodThresholds, type LodLevelMembership, type LodSet } from "../lod";
import { resolveResourceUri } from "./io";
import { gltfComponentCount, readGltfFloatAccessor, readGltfIndices } from "./accessors";
import type { DecodedGltfDracoPrimitive } from "./codecs/draco";
import { readGltfSceneImageBasedLight } from "./image-based-light";
import { gltfImageLoadKey, type GltfImageKind } from "./image-keys";
import { generateGltfPrimitiveNormals } from "./normals";
import type {
  GltfContentExtras,
  GltfDocument,
  GltfImage,
  GltfMaterial,
  GltfMeshPrimitive,
  GltfPunctualLight,
  GltfSampler,
  GltfSceneNode,
  GltfTexture,
  GltfTextureInfo,
} from "./schema";
import { gltfTextureCoordinates } from "./texture-coordinates";
import {
  gltfInstanceTransformMat4,
  gltfInstancingAttributeCount,
  gltfNodeMat4,
} from "./transforms";
import type {
  GltfGeometryDrawMode,
  LoadedGltfMaterial,
  LoadedGltfMaterialExtensionTextures,
  LoadedGltfMaterialTextureSlot,
  LoadedGltfMaterialVariant,
  LoadedGltfPrimitive,
  LoadedGltfPrimitiveMaterial,
} from "./prepared-asset";
import { isSvgMimeType, isSvgUri } from "../svg-texture";
import {
  DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
  type SurfaceMaterialAlphaMode,
  type SurfaceMaterialExtensionFactors,
} from "../webgl/materials";
import type { SurfaceImageBasedLight, SurfaceLight } from "../webgl/lights";

export type GltfMaterialExtensionTextureDefinition = {
  readonly colorSpace: "linear" | "srgb";
  readonly key: keyof LoadedGltfMaterialExtensionTextures;
  readonly textureInfo: (material: GltfMaterial | undefined) => GltfTextureInfo | undefined;
};

/** Shared declarative metadata used by scene preparation and material binding. */
export const GLTF_MATERIAL_EXTENSION_TEXTURES = [
  {
    colorSpace: "linear",
    key: "anisotropyTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_anisotropy?.anisotropyTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatNormalTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatRoughnessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatTexture,
  },
  {
    colorSpace: "srgb",
    key: "diffuseTransmissionColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionColorTexture,
  },
  {
    colorSpace: "linear",
    key: "diffuseTransmissionTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionTexture,
  },
  {
    colorSpace: "linear",
    key: "iridescenceTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_iridescence?.iridescenceTexture,
  },
  {
    colorSpace: "linear",
    key: "iridescenceThicknessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_iridescence?.iridescenceThicknessTexture,
  },
  {
    colorSpace: "linear",
    key: "materialTransmissionTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_transmission?.transmissionTexture,
  },
  {
    colorSpace: "srgb",
    key: "sheenColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_sheen?.sheenColorTexture,
  },
  {
    colorSpace: "linear",
    key: "sheenRoughnessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_sheen?.sheenRoughnessTexture,
  },
  {
    colorSpace: "srgb",
    key: "specularColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_specular?.specularColorTexture,
  },
  {
    colorSpace: "linear",
    key: "specularTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_specular?.specularTexture,
  },
  {
    colorSpace: "linear",
    key: "thicknessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_volume?.thicknessTexture,
  },
] as const satisfies readonly GltfMaterialExtensionTextureDefinition[];

export type GltfSceneReaderDiagnosticSink = {
  readonly recordDiagnostic: (message: string, dedupeKey?: string) => void;
};

export type GltfSceneFacts = {
  readonly hasMaterialLod: boolean;
  readonly hasMaterialVariants: boolean;
  readonly hasNodeLod: boolean;
  readonly imageBasedLight?: SurfaceImageBasedLight;
  readonly lights: readonly SurfaceLight[];
  readonly primitives: readonly LoadedGltfPrimitive[];
  readonly variants: readonly string[];
};

export type ReadGltfSceneInput = {
  readonly assetKey: string;
  readonly buffers: readonly ArrayBuffer[];
  readonly diagnostics: GltfSceneReaderDiagnosticSink;
  readonly document: GltfDocument;
  readonly dracoPrimitives: ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive>;
  readonly src: string;
};

type GltfTextureImageSelection = {
  readonly imageIndex: number;
  readonly kind: GltfImageKind;
};

const finiteNumber = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positiveFiniteNumber = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const clampedFiniteNumber = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => Math.min(max, Math.max(min, finiteNumber(value, fallback)));

const nonNegativeFiniteNumber = (value: number | undefined, fallback: number): number =>
  Math.max(0, finiteNumber(value, fallback));

const gltfSamplerMagFilter = (value: number | undefined): NonNullable<TextureSampler["magFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    default:
      return "linear";
  }
};

const gltfSamplerMinFilter = (value: number | undefined): NonNullable<TextureSampler["minFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    case 9729:
      return "linear";
    case 9984:
      return "nearest-mipmap-nearest";
    case 9985:
      return "linear-mipmap-nearest";
    case 9986:
      return "nearest-mipmap-linear";
    default:
      return "linear-mipmap-linear";
  }
};

const gltfSamplerWrap = (value: number | undefined): NonNullable<TextureSampler["wrapS"]> => {
  switch (value) {
    case 33071:
      return "clamp-to-edge";
    case 33648:
      return "mirrored-repeat";
    default:
      return "repeat";
  }
};

const gltfTextureSampler = (sampler: GltfSampler | undefined): TextureSampler => ({
  magFilter: gltfSamplerMagFilter(sampler?.magFilter),
  minFilter: gltfSamplerMinFilter(sampler?.minFilter),
  wrapS: gltfSamplerWrap(sampler?.wrapS),
  wrapT: gltfSamplerWrap(sampler?.wrapT),
});

const gltfTextureIdentity = (
  assetKey: string,
  src: string,
  textureIndex: number,
  imageIndex: number | undefined,
  image: GltfImage,
  kind: GltfImageKind,
): string => {
  if (image.uri !== undefined) {
    const prefix = kind === "basisu" ? "basisu-uri" : kind === "svg" ? "svg-uri" : "image-uri";
    return `${assetKey}:${prefix}:${resolveResourceUri(src, image.uri)}`;
  }
  if (image.bufferView !== undefined) {
    const prefix = kind === "basisu" ? "basisu-buffer-view" : kind === "svg" ? "svg-buffer-view" : "image-buffer-view";
    return `${assetKey}:${prefix}:${image.bufferView}:${image.mimeType ?? ""}`;
  }
  return `${assetKey}:texture-index:${textureIndex}:image-index:${imageIndex ?? ""}`;
};

const gltfContentKeyFromExtras = (extras: GltfContentExtras | undefined): TextureContentKey | undefined => {
  const contentKey = extras?.contentKey;
  return typeof contentKey === "number" || typeof contentKey === "string" ? contentKey : undefined;
};

const gltfTextureContentKey = (
  texture: GltfTexture | undefined,
  image: GltfImage | undefined,
): TextureContentKey | undefined =>
  gltfContentKeyFromExtras(texture?.extras) ?? gltfContentKeyFromExtras(image?.extras);

const gltfImageSourceUri = (src: string, image: GltfImage | undefined): string | undefined =>
  image?.uri === undefined ? undefined : resolveResourceUri(src, image.uri);

const gltfImageLooksSvg = (image: GltfImage | undefined): boolean => {
  if (image === undefined) return false;
  if (isSvgMimeType(image.mimeType)) return true;
  return image.uri !== undefined && isSvgUri(image.uri);
};

const gltfTextureImageSelection = (
  texture: GltfTexture | undefined,
  images: readonly GltfImage[] | undefined,
): GltfTextureImageSelection | undefined => {
  const svgSource = texture?.extensions?.GS_texture_svg?.source;
  if (svgSource !== undefined) return { imageIndex: svgSource, kind: "svg" };
  const basisuSource = texture?.extensions?.KHR_texture_basisu?.source;
  if (basisuSource !== undefined) return { imageIndex: basisuSource, kind: "basisu" };
  const webpSource = texture?.extensions?.EXT_texture_webp?.source;
  const imageIndex = webpSource !== undefined && canvasSupportsImageMimeType("image/webp")
    ? webpSource
    : texture?.source;
  return imageIndex === undefined
    ? undefined
    : { imageIndex, kind: gltfImageLooksSvg(images?.[imageIndex]) ? "svg" : "image" };
};

const gltfMaterialTextureSlot = (
  document: GltfDocument,
  assetKey: string,
  src: string,
  textureInfo: GltfTextureInfo | undefined,
): LoadedGltfMaterialTextureSlot | undefined => {
  if (textureInfo === undefined) return undefined;
  const textureIndex = textureInfo.index;
  const texture = textureIndex === undefined ? undefined : document.textures?.[textureIndex];
  const imageSelection = gltfTextureImageSelection(texture, document.images);
  const imageIndex = imageSelection?.imageIndex;
  const imageKind = imageSelection?.kind ?? "image";
  const image = imageIndex === undefined ? undefined : document.images?.[imageIndex];
  const imageUri = image === undefined ? undefined : gltfImageLoadKey(assetKey, src, imageIndex, image, imageKind);
  const sampler = texture === undefined
    ? undefined
    : gltfTextureSampler(texture.sampler === undefined ? undefined : document.samplers?.[texture.sampler]);
  const textureUri = textureIndex === undefined || image === undefined
    ? undefined
    : gltfTextureIdentity(assetKey, src, textureIndex, imageIndex, image, imageKind);
  const contentKey = gltfTextureContentKey(texture, image);
  const sourceUri = gltfImageSourceUri(src, image);
  if (contentKey === undefined && imageUri === undefined && sampler === undefined
    && sourceUri === undefined && textureUri === undefined) return undefined;
  return {
    ...(contentKey === undefined ? {} : { contentKey }),
    ...(imageUri === undefined ? {} : { imageUri }),
    ...(sampler === undefined ? {} : { sampler }),
    ...(sourceUri === undefined ? {} : { sourceUri }),
    ...(textureUri === undefined ? {} : { textureUri }),
    coordinates: gltfTextureCoordinates(textureInfo),
  };
};

const gltfMaterialExtensionTextureSlots = (
  document: GltfDocument,
  assetKey: string,
  src: string,
  material: GltfMaterial | undefined,
): LoadedGltfMaterialExtensionTextures | undefined => {
  const slots: Partial<Record<keyof LoadedGltfMaterialExtensionTextures, LoadedGltfMaterialTextureSlot>> = {};
  for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
    const slot = gltfMaterialTextureSlot(document, assetKey, src, texture.textureInfo(material));
    if (slot !== undefined) slots[texture.key] = slot;
  }
  return Object.keys(slots).length === 0 ? undefined : slots;
};

const gltfColor = (values: readonly number[] | undefined): LinearRgba | undefined => {
  if (values === undefined || values.length < 3) return undefined;
  return [values[0] ?? 1, values[1] ?? 1, values[2] ?? 1, values[3] ?? 1];
};

const gltfMaterialAlphaMode = (mode: unknown): SurfaceMaterialAlphaMode => {
  switch (mode) {
    case "MASK": return "MASK";
    case "BLEND": return "BLEND";
    default: return "OPAQUE";
  }
};

const gltfIor = (value: number | undefined): number => {
  if (value === 0) return 0;
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.ior;
};

const gltfIridescenceIor = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceIor;

const gltfSpecularColorFactor = (values: readonly number[] | undefined): Vec3 => [
  nonNegativeFiniteNumber(values?.[0], 1),
  nonNegativeFiniteNumber(values?.[1], 1),
  nonNegativeFiniteNumber(values?.[2], 1),
];

const gltfSheenColorFactor = (values: readonly number[] | undefined): Vec3 => [
  clampedFiniteNumber(values?.[0], 0, 0, 1),
  clampedFiniteNumber(values?.[1], 0, 0, 1),
  clampedFiniteNumber(values?.[2], 0, 0, 1),
];

const gltfDiffuseTransmissionColorFactor = (values: readonly number[] | undefined): Vec3 => [
  clampedFiniteNumber(values?.[0], 1, 0, 1),
  clampedFiniteNumber(values?.[1], 1, 0, 1),
  clampedFiniteNumber(values?.[2], 1, 0, 1),
];

const readGltfMaterialExtensionFactors = (
  material: GltfMaterial | undefined,
): SurfaceMaterialExtensionFactors | undefined => {
  const extensions = material?.extensions;
  const anisotropy = extensions?.KHR_materials_anisotropy;
  const specular = extensions?.KHR_materials_specular;
  const ior = extensions?.KHR_materials_ior;
  const sheen = extensions?.KHR_materials_sheen;
  const iridescence = extensions?.KHR_materials_iridescence;
  const clearcoat = extensions?.KHR_materials_clearcoat;
  const dispersion = extensions?.KHR_materials_dispersion;
  const diffuseTransmission = extensions?.KHR_materials_diffuse_transmission;
  const transmission = extensions?.KHR_materials_transmission;
  const volume = extensions?.KHR_materials_volume;
  if (anisotropy === undefined && specular === undefined && ior === undefined && sheen === undefined
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
    diffuseTransmissionColorFactor: gltfDiffuseTransmissionColorFactor(diffuseTransmission?.diffuseTransmissionColorFactor),
    diffuseTransmissionFactor: clampedFiniteNumber(diffuseTransmission?.diffuseTransmissionFactor, 0, 0, 1),
    dispersionFactor: nonNegativeFiniteNumber(dispersion?.dispersion, 0),
    ior: gltfIor(ior?.ior),
    iridescenceFactor: clampedFiniteNumber(iridescence?.iridescenceFactor, 0, 0, 1),
    iridescenceIor: gltfIridescenceIor(iridescence?.iridescenceIor),
    iridescenceThicknessMaximum: nonNegativeFiniteNumber(
      iridescence?.iridescenceThicknessMaximum,
      DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceThicknessMaximum,
    ),
    iridescenceThicknessMinimum: nonNegativeFiniteNumber(
      iridescence?.iridescenceThicknessMinimum,
      DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceThicknessMinimum,
    ),
    sheenColorFactor: gltfSheenColorFactor(sheen?.sheenColorFactor),
    sheenRoughnessFactor: clampedFiniteNumber(sheen?.sheenRoughnessFactor, 0, 0, 1),
    specularColorFactor: gltfSpecularColorFactor(specular?.specularColorFactor),
    specularFactor: clampedFiniteNumber(specular?.specularFactor, 1, 0, 1),
    thicknessFactor: nonNegativeFiniteNumber(volume?.thicknessFactor, 0),
    transmissionFactor: clampedFiniteNumber(transmission?.transmissionFactor, 0, 0, 1),
  };
};

const gltfLightColor = (light: GltfPunctualLight): LinearRgba => {
  const intensity = Math.max(0, finiteNumber(light.intensity, 1));
  return [
    (light.color?.[0] ?? 1) * intensity,
    (light.color?.[1] ?? 1) * intensity,
    (light.color?.[2] ?? 1) * intensity,
    1,
  ];
};

const gltfSpotConeAngles = (light: GltfPunctualLight): { readonly innerConeAngle: number; readonly outerConeAngle: number } => {
  const outerConeAngle = Math.min(Math.PI / 2, Math.max(0.0001, finiteNumber(light.spot?.outerConeAngle, Math.PI / 4)));
  const innerConeAngle = Math.min(outerConeAngle - 0.0001, Math.max(0, finiteNumber(light.spot?.innerConeAngle, 0)));
  return { innerConeAngle, outerConeAngle };
};

const gltfEmissiveColor = (material: GltfMaterial | undefined): LinearRgba | undefined => {
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

const gltfPrimitiveMode = (mode: number | undefined): GltfGeometryDrawMode | undefined => {
  switch (mode ?? 4) {
    case 0: return "points";
    case 1: return "lines";
    case 2: return "line-loop";
    case 3: return "line-strip";
    case 4: return "triangles";
    case 5: return "triangle-strip";
    case 6: return "triangle-fan";
    default: return undefined;
  }
};

const gltfPrimitiveTexCoords = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  set: 0 | 1,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  const semantic = `TEXCOORD_${set}`;
  const decodedTexCoords = decodedAttributes?.get(semantic);
  if (decodedTexCoords !== undefined) return decodedTexCoords;
  const accessor = primitive.attributes?.[semantic];
  return accessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, accessor);
};

const gltfVertexColors = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  positions: Float32Array,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  const colorAccessor = primitive.attributes?.COLOR_0;
  const colors = decodedAttributes?.get("COLOR_0")
    ?? (colorAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, colorAccessor));
  if (colors === undefined) return undefined;
  const vertexCount = positions.length / 3;
  const accessorComponentCount = colorAccessor === undefined
    ? undefined
    : gltfComponentCount(document.accessors?.[colorAccessor]?.type ?? "VEC4");
  const componentCount = accessorComponentCount ?? colors.length / Math.max(vertexCount, 1);
  if (componentCount === 4 && colors.length === vertexCount * 4) return colors;
  if (componentCount !== 3 || colors.length !== vertexCount * 3) return undefined;
  const output = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index += 1) {
    output.set([colors[index * 3] ?? 1, colors[index * 3 + 1] ?? 1, colors[index * 3 + 2] ?? 1, 1], index * 4);
  }
  return output;
};

const mat4OrientationDeterminant = (matrix: Mat4): number =>
  matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
  - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
  + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);

const readGltfMaterial = (
  document: GltfDocument,
  src: string,
  assetKey: string,
  materialIndex: number | undefined,
): LoadedGltfMaterial => {
  const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
  const baseColorTexture = gltfMaterialTextureSlot(document, assetKey, src, material?.pbrMetallicRoughness?.baseColorTexture);
  const metallicRoughnessTexture = gltfMaterialTextureSlot(document, assetKey, src, material?.pbrMetallicRoughness?.metallicRoughnessTexture);
  const normalTexture = gltfMaterialTextureSlot(document, assetKey, src, material?.normalTexture);
  const emissiveTexture = gltfMaterialTextureSlot(document, assetKey, src, material?.emissiveTexture);
  const occlusionTexture = gltfMaterialTextureSlot(document, assetKey, src, material?.occlusionTexture);
  const color = gltfColor(material?.pbrMetallicRoughness?.baseColorFactor);
  const emissive = gltfEmissiveColor(material);
  const extensionFactors = readGltfMaterialExtensionFactors(material);
  const extensionTextures = gltfMaterialExtensionTextureSlots(document, assetKey, src, material);
  const alphaMode = gltfMaterialAlphaMode(material?.alphaMode);
  return {
    alphaMode,
    ...(alphaMode === "MASK" ? { alphaCutoff: finiteNumber(material?.alphaCutoff, 0.5) } : {}),
    ...(baseColorTexture === undefined ? {} : { baseColorTexture }),
    ...(emissiveTexture === undefined ? {} : { emissiveTexture }),
    ...(metallicRoughnessTexture === undefined ? {} : { metallicRoughnessTexture }),
    ...(normalTexture === undefined ? {} : { normalTexture }),
    ...(occlusionTexture === undefined ? {} : { occlusionTexture }),
    ...(color === undefined ? {} : { color }),
    ...(emissive === undefined ? {} : { emissive }),
    ...(extensionFactors === undefined ? {} : { extensionFactors }),
    ...(extensionTextures === undefined ? {} : { extensionTextures }),
    doubleSided: material?.doubleSided === true,
    metallicFactor: clampedFiniteNumber(material?.pbrMetallicRoughness?.metallicFactor, 1, 0, 1),
    normalScale: material?.normalTexture?.scale ?? 1,
    occlusionStrength: clampedFiniteNumber(material?.occlusionTexture?.strength, 1, 0, 1),
    roughnessFactor: clampedFiniteNumber(material?.pbrMetallicRoughness?.roughnessFactor, 1, 0, 1),
    ...(materialIndex === undefined ? {} : { sourceMaterialIndex: materialIndex }),
    ...(material?.extensions?.KHR_materials_unlit === undefined ? {} : { unlit: true }),
  };
};

const readGltfMaterialLod = (
  document: GltfDocument,
  src: string,
  assetKey: string,
  materialIndex: number | undefined,
): LodSet<LoadedGltfMaterial> | undefined => {
  const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
  const lodIds = material?.extensions?.MSFT_lod?.ids ?? [];
  if (materialIndex === undefined || lodIds.length === 0) return undefined;
  const levels = [
    readGltfMaterial(document, src, assetKey, materialIndex),
    ...lodIds.map((id) => readGltfMaterial(document, src, assetKey, id)),
  ];
  return { levels, thresholds: normalizeLodThresholds(material?.extras?.MSFT_screencoverage, levels.length) };
};

const readGltfMaterialVariants = (
  document: GltfDocument,
  src: string,
  assetKey: string,
  primitive: GltfMeshPrimitive,
  variantCount: number,
): readonly LoadedGltfMaterialVariant[] =>
  (primitive.extensions?.KHR_materials_variants?.mappings ?? [])
    .map((mapping): LoadedGltfMaterialVariant | undefined => {
      const materialIndex = mapping.material;
      const variants = (mapping.variants ?? [])
        .filter((variant) => Number.isInteger(variant) && variant >= 0 && variant < variantCount);
      if (materialIndex === undefined || !Number.isInteger(materialIndex) || materialIndex < 0
        || document.materials?.[materialIndex] === undefined || variants.length === 0) return undefined;
      const material = readGltfMaterial(document, src, assetKey, materialIndex);
      const materialLod = readGltfMaterialLod(document, src, assetKey, materialIndex);
      return { material, ...(materialLod === undefined ? {} : { materialLod }), variants };
    })
    .filter((mapping): mapping is LoadedGltfMaterialVariant => mapping !== undefined);

const gltfNodeInstanceTransforms = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  sceneNode: GltfSceneNode,
  nodeIndex: number,
  diagnostics: GltfSceneReaderDiagnosticSink,
): readonly Mat4[] => {
  const attributes = sceneNode.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (attributes === undefined) return [identityMat4()];
  const entries = Object.entries(attributes);
  if (entries.length === 0) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing has no attributes`);
  for (const [semantic, accessorIndex] of entries) {
    if (typeof accessorIndex !== "number" || !Number.isInteger(accessorIndex) || accessorIndex < 0
      || document.accessors?.[accessorIndex] === undefined) {
      throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} references invalid accessor ${accessorIndex}`);
    }
  }
  const typedEntries = entries as [string, number][];
  const counts = typedEntries.map(([, accessorIndex]) => gltfInstancingAttributeCount(document, accessorIndex)!);
  if (new Set(counts).size !== 1) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing attributes must have matching counts`);
  const instanceCount = counts[0]!;
  const supported = new Set(["ROTATION", "SCALE", "TRANSLATION"]);
  const unsupported = typedEntries.map(([semantic]) => semantic).filter((semantic) => !supported.has(semantic));
  if (unsupported.length > 0) diagnostics.recordDiagnostic(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ignored custom attributes: ${unsupported.join(", ")}`);
  const validate = (semantic: "ROTATION" | "SCALE" | "TRANSLATION"): void => {
    const accessorIndex = attributes[semantic];
    if (accessorIndex === undefined) return;
    const accessor = document.accessors![accessorIndex]!;
    const valid = semantic === "ROTATION"
      ? accessor.type === "VEC4" && (accessor.componentType === 5126
        || ((accessor.componentType === 5120 || accessor.componentType === 5122) && accessor.normalized === true))
      : accessor.type === "VEC3" && accessor.componentType === 5126 && accessor.normalized !== true;
    if (!valid) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} has an invalid accessor format`);
  };
  validate("TRANSLATION");
  validate("ROTATION");
  validate("SCALE");
  const translations = attributes.TRANSLATION === undefined ? undefined : readGltfFloatAccessor(document, buffers, attributes.TRANSLATION);
  const rotations = attributes.ROTATION === undefined ? undefined : readGltfFloatAccessor(document, buffers, attributes.ROTATION);
  const scales = attributes.SCALE === undefined ? undefined : readGltfFloatAccessor(document, buffers, attributes.SCALE);
  for (const [semantic, values] of [["TRANSLATION", translations], ["ROTATION", rotations], ["SCALE", scales]] as const) {
    if (values?.some((value) => !Number.isFinite(value)) === true) {
      throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} contains non-finite values`);
    }
  }
  if (rotations !== undefined) {
    for (let index = 0; index < instanceCount; index += 1) {
      const offset = index * 4;
      const lengthSquared = rotations[offset]! ** 2 + rotations[offset + 1]! ** 2
        + rotations[offset + 2]! ** 2 + rotations[offset + 3]! ** 2;
      if (!(lengthSquared > 1e-12)) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ROTATION ${index} is a zero quaternion`);
    }
  }
  return Array.from({ length: instanceCount }, (_, index) => gltfInstanceTransformMat4(translations, rotations, scales, index));
};

type TraversalContext = ReadGltfSceneInput & {
  readonly lights: SurfaceLight[];
  readonly primitives: LoadedGltfPrimitive[];
  readonly referencedLodNodes: ReadonlySet<number>;
  readonly variantCount: number;
};

const appendNodeLight = (
  context: TraversalContext,
  sceneNode: GltfSceneNode,
  nodeIndex: number,
  nodeModel: Mat4,
): void => {
  const lightIndex = sceneNode.extensions?.KHR_lights_punctual?.light;
  if (lightIndex === undefined) return;
  if (!Number.isInteger(lightIndex) || lightIndex < 0) {
    context.diagnostics.recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: invalid light index ${lightIndex}`);
    return;
  }
  const light = context.document.extensions?.KHR_lights_punctual?.lights?.[lightIndex];
  if (light === undefined) {
    context.diagnostics.recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: missing light ${lightIndex}`);
    return;
  }
  const color = gltfLightColor(light);
  const direction = transformDirection(nodeModel, [0, 0, -1]);
  const position = transformPoint(nodeModel, [0, 0, 0]);
  const range = positiveFiniteNumber(light.range);
  switch (light.type) {
    case "directional":
      context.lights.push({ color, direction, kind: "directional" });
      return;
    case "point":
      context.lights.push({ color, kind: "point", position, ...(range === undefined ? {} : { range }) });
      return;
    case "spot": {
      const { innerConeAngle, outerConeAngle } = gltfSpotConeAngles(light);
      context.lights.push({ color, direction, innerConeAngle, kind: "spot", outerConeAngle, position, ...(range === undefined ? {} : { range }) });
      return;
    }
    default:
      context.diagnostics.recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: unsupported light type ${light.type ?? "missing"}`);
  }
};

const appendNodeTreePrimitives = (
  context: TraversalContext,
  nodeIndex: number,
  parentModel: Mat4,
  parentPath: readonly number[],
  nodeLod?: LodLevelMembership,
  applyOwnLod = true,
): void => {
  const sceneNode = context.document.nodes?.[nodeIndex];
  if (sceneNode === undefined) return;
  if (parentPath.includes(nodeIndex)) {
    context.diagnostics.recordDiagnostic(
      `glTF node tree cycle skipped at node ${nodeIndex}`,
      `gltf-node-cycle:${context.assetKey}:${[...parentPath, nodeIndex].join(":")}`,
    );
    return;
  }
  const lodIds = applyOwnLod
    ? (sceneNode.extensions?.MSFT_lod?.ids ?? [])
      .filter((id) => Number.isInteger(id) && id >= 0 && context.document.nodes?.[id] !== undefined)
    : [];
  if (lodIds.length > 0) {
    const levelCount = lodIds.length + 1;
    const thresholds = normalizeLodThresholds(sceneNode.extras?.MSFT_screencoverage, levelCount);
    const group = `node:${nodeIndex}`;
    appendNodeTreePrimitives(context, nodeIndex, parentModel, parentPath, { group, level: 0, levelCount, thresholds }, false);
    for (const [lodIndex, lodNodeIndex] of lodIds.entries()) {
      appendNodeTreePrimitives(context, lodNodeIndex, parentModel, parentPath, {
        group,
        level: lodIndex + 1,
        levelCount,
        thresholds,
      }, false);
    }
    return;
  }
  const nodePath = [...parentPath, nodeIndex];
  const nodeModel = multiplyMat4(parentModel, gltfNodeMat4(sceneNode));
  appendNodeLight(context, sceneNode, nodeIndex, nodeModel);
  const instanceTransforms = gltfNodeInstanceTransforms(context.document, context.buffers, sceneNode, nodeIndex, context.diagnostics);
  const localModels = instanceTransforms.map((transform) => multiplyMat4(nodeModel, transform));
  const localModelDeterminants = localModels.map(mat4OrientationDeterminant);
  const mesh = sceneNode.mesh === undefined ? undefined : context.document.meshes?.[sceneNode.mesh];
  for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
    const dracoPrimitive = context.dracoPrimitives.get(primitive);
    const decodedAttributes = dracoPrimitive?.attributes;
    const positionAccessor = primitive.attributes?.POSITION;
    const positions = decodedAttributes?.get("POSITION")
      ?? (positionAccessor === undefined ? undefined : readGltfFloatAccessor(context.document, context.buffers, positionAccessor));
    if (positions === undefined) continue;
    const mode = gltfPrimitiveMode(primitive.mode);
    if (mode === undefined) {
      const unsupportedMode = primitive.mode ?? 4;
      context.diagnostics.recordDiagnostic(
        `glTF primitive ${nodeIndex}:${primitiveIndex} skipped: unsupported primitive mode ${unsupportedMode}`,
        `gltf-primitive-mode:${context.assetKey}:${unsupportedMode}`,
      );
      continue;
    }
    const normalAccessor = primitive.attributes?.NORMAL;
    const tangentAccessor = primitive.attributes?.TANGENT;
    const baseNormals = decodedAttributes?.get("NORMAL")
      ?? (normalAccessor === undefined ? undefined : readGltfFloatAccessor(context.document, context.buffers, normalAccessor));
    const tangents = decodedAttributes?.get("TANGENT")
      ?? (tangentAccessor === undefined ? undefined : readGltfFloatAccessor(context.document, context.buffers, tangentAccessor));
    const colors = gltfVertexColors(context.document, context.buffers, primitive, positions, decodedAttributes);
    const texCoords0 = gltfPrimitiveTexCoords(context.document, context.buffers, primitive, 0, decodedAttributes);
    const texCoords1 = gltfPrimitiveTexCoords(context.document, context.buffers, primitive, 1, decodedAttributes);
    const indices = dracoPrimitive?.indices
      ?? (primitive.indices === undefined ? undefined : readGltfIndices(context.document, context.buffers, primitive.indices));
    const normals = baseNormals ?? generateGltfPrimitiveNormals(positions, indices, mode);
    const material = readGltfMaterial(context.document, context.src, context.assetKey, primitive.material);
    const materialLod = readGltfMaterialLod(context.document, context.src, context.assetKey, primitive.material);
    const materialVariants = readGltfMaterialVariants(
      context.document,
      context.src,
      context.assetKey,
      primitive,
      context.variantCount,
    );
    const baseMaterial: LoadedGltfPrimitiveMaterial = {
      material,
      ...(materialLod === undefined ? {} : { materialLod }),
      selectionKey: "base",
    };
    context.primitives.push({
      baseMaterial,
      ...(colors === undefined ? {} : { colors }),
      ...(indices === undefined ? {} : { indices }),
      instanceTransforms,
      key: `node:${nodeIndex}:primitive:${primitiveIndex}`,
      localBounds: localModels.map((model) => worldBounds(positions, model)),
      localModelDeterminants,
      localModels,
      material,
      ...(materialLod === undefined ? {} : { materialLod }),
      ...(materialVariants.length === 0 ? {} : { materialVariants }),
      mode,
      meshNodeIndex: nodeIndex,
      nodePath,
      ...(nodeLod === undefined ? {} : { nodeLod }),
      ...(normals === undefined ? {} : { normals }),
      objectBounds: worldBounds(positions, identityMat4()),
      positions,
      ...(tangents === undefined ? {} : { tangents }),
      ...(texCoords0 === undefined ? {} : { texCoords0 }),
      ...(texCoords1 === undefined ? {} : { texCoords1 }),
    });
  }
  for (const childIndex of sceneNode.children ?? []) {
    if (context.referencedLodNodes.has(childIndex)) continue;
    appendNodeTreePrimitives(context, childIndex, nodeModel, nodePath, nodeLod, nodeLod === undefined);
  }
};

/** Reads decoded glTF data into renderer-ready, WebGL-independent scene facts. */
export const readGltfScene = (input: ReadGltfSceneInput): GltfSceneFacts => {
  const lights: SurfaceLight[] = [];
  const primitives: LoadedGltfPrimitive[] = [];
  const variants = Object.freeze((input.document.extensions?.KHR_materials_variants?.variants ?? [])
    .map((variant, index) => typeof variant.name === "string" ? variant.name : String(index)));
  const sceneIndex = input.document.scene ?? 0;
  const imageBasedLight = readGltfSceneImageBasedLight(input.document, input.src, input.assetKey, sceneIndex, {
    recordDiagnostic: (message) => input.diagnostics.recordDiagnostic(message),
    recordUnsupportedGltfImageBasedLight: (message) =>
      input.diagnostics.recordDiagnostic(message, `gltf-image-based-light:${message}`),
  });
  const referencedLodNodes = new Set<number>();
  for (const node of input.document.nodes ?? []) {
    for (const id of node.extensions?.MSFT_lod?.ids ?? []) {
      if (Number.isInteger(id) && id >= 0) referencedLodNodes.add(id);
    }
  }
  const context: TraversalContext = {
    ...input,
    lights,
    primitives,
    referencedLodNodes,
    variantCount: variants.length,
  };
  for (const nodeIndex of input.document.scenes?.[sceneIndex]?.nodes ?? []) {
    if (!referencedLodNodes.has(nodeIndex)) appendNodeTreePrimitives(context, nodeIndex, identityMat4(), []);
  }
  return {
    hasMaterialLod: primitives.some((primitive) => primitive.materialLod !== undefined
      || primitive.materialVariants?.some((variant) => variant.materialLod !== undefined) === true),
    hasMaterialVariants: primitives.some((primitive) => primitive.materialVariants !== undefined),
    hasNodeLod: primitives.some((primitive) => primitive.nodeLod !== undefined),
    ...(imageBasedLight === undefined ? {} : { imageBasedLight }),
    lights,
    primitives,
    variants,
  };
};
