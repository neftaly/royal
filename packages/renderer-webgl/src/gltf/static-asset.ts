import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
} from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { GltfAssetBounds } from "@royal/renderer-core";
import type { TextureSourceRef } from "../texture/asset-owner";
import type { DecodedDracoPrimitive } from "./draco";
import { parseGlb } from "./glb";
import {
  prepareStaticMatrixBatches,
  prepareStaticInstanceBatches,
  type StaticInstanceBatch,
} from "./instance-transforms";
import { staticGltfBounds } from "./static-bounds";
import {
  array,
  fail,
  finiteTuple,
  index,
  nodeLocalMatrix,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import {
  decodedPositions,
  readFloatVectors,
  readIndices,
  readInstanceVectors,
  readPositions,
  validateDecodedVectors,
  type AccessorContext,
} from "./accessor-reader";
import {
  createTextureAssetReader,
  prepareMaterial,
  resolveAssetUri,
} from "./static-material";
import { canonicalMaterialUsesTextureCoordinateSet } from "../surface/canonical-material";
import { normalizeLodThresholds } from "../surface/lod-selection";

export type PreparedStaticLodMembership = Readonly<{
  group: string;
  level: number;
  thresholds: readonly number[];
}>;

export type PreparedStaticMaterialLod = Readonly<{
  levels: readonly CanonicalSurfaceMaterial[];
  thresholds: readonly number[];
}>;

export type PreparedStaticGltfPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instanceBatch?: StaticInstanceBatch & Readonly<{ key: string }>;
  localModel: Mat4;
  lods?: readonly PreparedStaticLodMembership[];
  material: CanonicalSurfaceMaterial;
  materialLod?: PreparedStaticMaterialLod;
  materialVariants?: ReadonlyMap<string, CanonicalSurfaceMaterial>;
  materialVariantLods?: ReadonlyMap<string, PreparedStaticMaterialLod>;
}>;

export type PreparedStaticGltf = Readonly<{
  bounds: GltfAssetBounds;
  lights: readonly PreparedStaticGltfLight[];
  primitives: readonly PreparedStaticGltfPrimitive[];
  textureAssets: readonly TextureSourceRef[];
}>;

export type PreparedStaticGltfLight = Readonly<{
  color: readonly [number, number, number];
  innerConeAngle: number;
  intensity: number;
  kind: "directional" | "point" | "spot";
  localModel: Mat4;
  outerConeAngle: number;
  range: number;
}>;

type StaticDracoDecoder = (
  primitive: JsonObject,
  path: string,
) => DecodedDracoPrimitive;

type PreparedMeshPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  material: CanonicalSurfaceMaterial;
  materialLod?: PreparedStaticMaterialLod;
  materialVariants?: ReadonlyMap<string, CanonicalSurfaceMaterial>;
  materialVariantLods?: ReadonlyMap<string, PreparedStaticMaterialLod>;
}>;

const finiteNumber = (
  value: unknown,
  fallback: number,
  label: string,
  path: string,
): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(label, path, "must be finite");
  }
  return value;
};

/** Converges repeated ordinary node occurrences on the authored instance ABI. */
export const batchRepeatedStaticPrimitives = (
  primitives: readonly PreparedStaticGltfPrimitive[],
): readonly PreparedStaticGltfPrimitive[] => {
  const repeated = new Map<string, PreparedStaticGltfPrimitive[]>();
  let hasRepeatedGeometry = false;
  for (const primitive of primitives) {
    if (
      primitive.instanceBatch !== undefined
      || primitive.lods !== undefined
      || primitive.materialLod !== undefined
      || primitive.materialVariantLods !== undefined
    ) continue;
    const key = primitive.geometry.key;
    const group = repeated.get(key);
    if (group === undefined) repeated.set(key, [primitive]);
    else {
      group.push(primitive);
      hasRepeatedGeometry = true;
    }
  }
  if (!hasRepeatedGeometry) return primitives;
  const emitted = new Set<string>();
  const result: PreparedStaticGltfPrimitive[] = [];
  for (const primitive of primitives) {
    if (primitive.instanceBatch !== undefined || primitive.lods !== undefined) {
      result.push(primitive);
      continue;
    }
    const key = primitive.geometry.key;
    const group = repeated.get(key)!;
    if (group.length === 1) {
      result.push(primitive);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const models = Array<Mat4>(group.length);
    for (let index = 0; index < group.length; index += 1) {
      models[index] = group[index]!.localModel;
    }
    const batches = prepareStaticMatrixBatches(models);
    for (let batch = 0; batch < batches.length; batch += 1) {
      result.push({
        geometry: primitive.geometry,
        instanceBatch: {
          ...batches[batch]!,
          key: `${key}:repeated:${batches[batch]!.handedness}`,
        },
        localModel: identityMat4(),
        material: primitive.material,
        ...(primitive.materialLod === undefined ? {} : { materialLod: primitive.materialLod }),
        ...(primitive.materialVariants === undefined
          ? {}
          : { materialVariants: primitive.materialVariants }),
        ...(primitive.materialVariantLods === undefined
          ? {}
          : { materialVariantLods: primitive.materialVariantLods }),
      });
    }
  }
  return result;
};

const prepareStaticDocument = (
  document: JsonObject,
  binary: Uint8Array,
  container: "glb" | "gltf",
  contentKey: string,
  label: string,
  sourceUri: string,
  decodeDraco?: StaticDracoDecoder,
): PreparedStaticGltf => {
  if (contentKey.length === 0) throw new TypeError("Royal glTF contentKey must not be empty");
  const asset = object(document.asset, label, "asset");
  if (asset.version !== "2.0") fail(label, "asset.version", "must be 2.0");
  // Static ingestion intentionally ignores animation declarations. The current
  // node transforms are the bind/default pose; animation support can layer over
  // this canonical result without making otherwise renderable assets fail.
  optionalArray(document.animations, label, "animations");
  if (optionalArray(document.skins, label, "skins").length > 0) {
    fail(label, "skins", "are not supported yet");
  }
  const requiredExtensions = optionalArray(
    document.extensionsRequired, label, "extensionsRequired",
  );
  for (let extensionIndex = 0; extensionIndex < requiredExtensions.length; extensionIndex += 1) {
    const extension = requiredExtensions[extensionIndex];
    if (
      extension !== "KHR_materials_unlit"
      && extension !== "KHR_materials_emissive_strength"
      && extension !== "KHR_materials_ior"
      && extension !== "KHR_materials_specular"
      && extension !== "KHR_materials_transmission"
      && extension !== "KHR_materials_volume"
      && extension !== "EXT_texture_avif"
      && extension !== "EXT_texture_webp"
      && extension !== "EXT_mesh_gpu_instancing"
      && extension !== "KHR_texture_transform"
      && extension !== "KHR_lights_punctual"
      && extension !== "KHR_materials_variants"
      && extension !== "MSFT_lod"
      && !(extension === "KHR_draco_mesh_compression" && decodeDraco !== undefined)
      && !(extension === "KHR_mesh_quantization" && decodeDraco !== undefined)
    ) {
      fail(label, `extensionsRequired[${extensionIndex}]`, "is unsupported");
    }
  }

  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length !== 1) fail(label, "buffers", "must contain exactly one buffer");
  const buffer = object(buffers[0], label, "buffers[0]");
  if (container === "glb" && buffer.uri !== undefined) {
    fail(label, "buffers[0].uri", "must be omitted for a GLB BIN chunk");
  }
  if (container === "gltf" && (typeof buffer.uri !== "string" || buffer.uri.length === 0)) {
    fail(label, "buffers[0].uri", "must be a non-empty external or data URI");
  }
  const bufferByteLength = nonNegativeInteger(buffer.byteLength, label, "buffers[0].byteLength");
  const padding = binary.byteLength - bufferByteLength;
  if (padding < 0 || (container === "glb" ? padding > 3 : padding !== 0)) {
    fail(
      label,
      "buffers[0].byteLength",
      container === "glb" ? "does not match the padded GLB BIN chunk" : "does not match the external buffer",
    );
  }
  const accessors = array(document.accessors, label, "accessors");
  const bufferViews = array(document.bufferViews, label, "bufferViews");
  const meshes = array(document.meshes, label, "meshes");
  const materials = optionalArray(document.materials, label, "materials");
  const documentExtensions = document.extensions === undefined
    ? {}
    : object(document.extensions, label, "extensions");
  const punctualExtension = documentExtensions.KHR_lights_punctual === undefined
    ? undefined
    : object(
      documentExtensions.KHR_lights_punctual,
      label,
      "extensions.KHR_lights_punctual",
    );
  const punctualLightDefinitions = optionalArray(
    punctualExtension?.lights,
    label,
    "extensions.KHR_lights_punctual.lights",
  );
  const variantsExtension = documentExtensions.KHR_materials_variants === undefined
    ? undefined
    : object(
      documentExtensions.KHR_materials_variants,
      label,
      "extensions.KHR_materials_variants",
    );
  const variantDefinitions = optionalArray(
    variantsExtension?.variants,
    label,
    "extensions.KHR_materials_variants.variants",
  );
  const variantNames = variantDefinitions.map((definition, variantIndex) => {
    const path = `extensions.KHR_materials_variants.variants[${variantIndex}]`;
    const variant = object(definition, label, path);
    if (typeof variant.name !== "string" || variant.name.length === 0) {
      return fail(label, `${path}.name`, "must be a non-empty string");
    }
    return variant.name;
  });
  if (new Set(variantNames).size !== variantNames.length) {
    fail(label, "extensions.KHR_materials_variants.variants", "names must be unique");
  }
  const textureAsset = createTextureAssetReader(
    document,
    binary,
    bufferByteLength,
    bufferViews,
    contentKey,
    sourceUri,
    label,
  );
  const nodes = array(document.nodes, label, "nodes");
  const scenes = array(document.scenes, label, "scenes");
  const context: AccessorContext = {
    accessors,
    binary,
    bufferByteLength,
    bufferViews,
    label,
  };
  let defaultMaterial: CanonicalSurfaceMaterial | undefined;
  const preparedMaterials = new Map<number, CanonicalSurfaceMaterial>();
  const preparePrimitiveMaterial = (
    materialIndex: unknown,
    path: string,
  ): CanonicalSurfaceMaterial => {
    if (materialIndex === undefined && defaultMaterial !== undefined) return defaultMaterial;
    if (typeof materialIndex === "number") {
      const retained = preparedMaterials.get(materialIndex);
      if (retained !== undefined) return retained;
    }
    const prepared = prepareMaterial(materials, textureAsset, materialIndex, label, path);
    if (materialIndex === undefined) defaultMaterial = prepared;
    else if (typeof materialIndex === "number") preparedMaterials.set(materialIndex, prepared);
    return prepared;
  };
  const materialLodIds = (materialIndex: number): readonly number[] => {
    const path = `materials[${materialIndex}]`;
    const material = object(materials[materialIndex], label, path);
    if (material.extensions === undefined) return [];
    const extensions = object(material.extensions, label, `${path}.extensions`);
    if (extensions.MSFT_lod === undefined) return [];
    const extensionPath = `${path}.extensions.MSFT_lod`;
    const extension = object(extensions.MSFT_lod, label, extensionPath);
    const ids = array(extension.ids, label, `${extensionPath}.ids`);
    if (ids.length === 0) fail(label, `${extensionPath}.ids`, "must not be empty");
    return ids.map((id, lodIndex) => index(
      id,
      materials,
      label,
      `${extensionPath}.ids[${lodIndex}]`,
    ));
  };
  const materialGraphState = new Uint8Array(materials.length);
  const validateMaterialLodGraph = (materialIndex: number): void => {
    if (materialGraphState[materialIndex] === 1) {
      fail(label, `materials[${materialIndex}]`, "is part of an MSFT_lod cycle");
    }
    if (materialGraphState[materialIndex] === 2) return;
    materialGraphState[materialIndex] = 1;
    for (const lodMaterial of materialLodIds(materialIndex)) {
      validateMaterialLodGraph(lodMaterial);
    }
    materialGraphState[materialIndex] = 2;
  };
  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    validateMaterialLodGraph(materialIndex);
  }
  const preparedMaterialLods = new Map<number, PreparedStaticMaterialLod>();
  const prepareMaterialLod = (
    materialIndex: number | undefined,
  ): PreparedStaticMaterialLod | undefined => {
    if (materialIndex === undefined) return undefined;
    const retained = preparedMaterialLods.get(materialIndex);
    if (retained !== undefined) return retained;
    const ids = materialLodIds(materialIndex);
    if (ids.length === 0) return undefined;
    const path = `materials[${materialIndex}]`;
    const material = object(materials[materialIndex], label, path);
    const extras = material.extras === undefined
      ? undefined
      : object(material.extras, label, `${path}.extras`);
    const hints = extras?.MSFT_screencoverage === undefined
      ? undefined
      : array(extras.MSFT_screencoverage, label, `${path}.extras.MSFT_screencoverage`);
    const levels = [
      preparePrimitiveMaterial(materialIndex, path),
      ...ids.map((id) => preparePrimitiveMaterial(id, path)),
    ];
    const prepared = { levels, thresholds: normalizeLodThresholds(hints, levels.length) };
    preparedMaterialLods.set(materialIndex, prepared);
    return prepared;
  };
  const materialSetUsesTextureCoordinates = (
    material: CanonicalSurfaceMaterial,
    materialLod: PreparedStaticMaterialLod | undefined,
    variants: ReadonlyMap<string, CanonicalSurfaceMaterial> | undefined,
    variantLods: ReadonlyMap<string, PreparedStaticMaterialLod> | undefined,
    set: 0 | 1,
  ): boolean => {
    if (canonicalMaterialUsesTextureCoordinateSet(material, set)) return true;
    for (const level of materialLod?.levels ?? []) {
      if (canonicalMaterialUsesTextureCoordinateSet(level, set)) return true;
    }
    if (variants === undefined) return false;
    for (const variant of variants.values()) {
      if (canonicalMaterialUsesTextureCoordinateSet(variant, set)) return true;
    }
    for (const lod of variantLods?.values() ?? []) {
      for (const level of lod.levels) {
        if (canonicalMaterialUsesTextureCoordinateSet(level, set)) return true;
      }
    }
    return false;
  };
  const preparedMeshes: Array<readonly PreparedMeshPrimitive[] | undefined> = [];
  const prepareMesh = (meshIndex: number): readonly PreparedMeshPrimitive[] => {
    const retained = preparedMeshes[meshIndex];
    if (retained !== undefined) return retained;
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], label, meshPath);
    if (mesh.weights !== undefined) fail(label, `${meshPath}.weights`, "are not supported yet");
    const primitives = array(mesh.primitives, label, `${meshPath}.primitives`);
    const prepared = primitives.map((primitiveValue, primitiveIndex): PreparedMeshPrimitive => {
      const path = `${meshPath}.primitives[${primitiveIndex}]`;
      const primitive = object(primitiveValue, label, path);
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        fail(label, `${path}.mode`, "must be TRIANGLES in the static profile");
      }
      if (primitive.targets !== undefined) fail(label, `${path}.targets`, "are not supported yet");
      const attributes = object(primitive.attributes, label, `${path}.attributes`);
      const extensions = primitive.extensions === undefined
        ? {}
        : object(primitive.extensions, label, `${path}.extensions`);
      const hasDraco = extensions.KHR_draco_mesh_compression !== undefined;
      const decoded = hasDraco
        ? decodeDraco?.(primitive, path)
          ?? fail(label, `${path}.extensions.KHR_draco_mesh_compression`, "is unsupported")
        : undefined;
      const positionAccessor = index(
        attributes.POSITION, accessors, label, `${path}.attributes.POSITION`,
      );
      const decodedPositionValues = decoded?.attributes.get("POSITION");
      const { bounds, positions } = decodedPositionValues === undefined
        ? readPositions(context, positionAccessor)
        : decodedPositions(decodedPositionValues, label, `${path}.attributes.POSITION`);
      const vertexCount = positions.length / 3;
      const decodedNormalValues = decoded?.attributes.get("NORMAL");
      const normals = attributes.NORMAL === undefined
        ? undefined
        : decodedNormalValues === undefined
          ? readFloatVectors(
            context,
            index(attributes.NORMAL, accessors, label, `${path}.attributes.NORMAL`),
            "VEC3",
            3,
            "NORMAL",
          )
          : validateDecodedVectors(
            decodedNormalValues,
            3,
            label,
            `${path}.attributes.NORMAL`,
          );
      if (normals !== undefined && normals.length / 3 !== vertexCount) {
        fail(label, `${path}.attributes.NORMAL`, "count must match POSITION");
      }
      const decodedTextureCoordinates = decoded?.attributes.get("TEXCOORD_0");
      const textureCoordinates0 = attributes.TEXCOORD_0 === undefined
        ? undefined
        : decodedTextureCoordinates === undefined
          ? readFloatVectors(
            context,
            index(attributes.TEXCOORD_0, accessors, label, `${path}.attributes.TEXCOORD_0`),
            "VEC2",
            2,
            "TEXCOORD_0",
          )
          : validateDecodedVectors(
            decodedTextureCoordinates,
            2,
            label,
            `${path}.attributes.TEXCOORD_0`,
          );
      if (textureCoordinates0 !== undefined && textureCoordinates0.length / 2 !== vertexCount) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "count must match POSITION");
      }
      const materialIndex = primitive.material === undefined
        ? undefined
        : index(primitive.material, materials, label, `${path}.material`);
      const material = preparePrimitiveMaterial(materialIndex, path);
      const materialLod = prepareMaterialLod(materialIndex);
      let materialVariants: Map<string, CanonicalSurfaceMaterial> | undefined;
      let materialVariantLods: Map<string, PreparedStaticMaterialLod> | undefined;
      if (extensions.KHR_materials_variants !== undefined) {
        const extensionPath = `${path}.extensions.KHR_materials_variants`;
        const extension = object(
          extensions.KHR_materials_variants,
          label,
          extensionPath,
        );
        const mappings = array(extension.mappings, label, `${extensionPath}.mappings`);
        materialVariants = new Map();
        for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex += 1) {
          const mappingPath = `${extensionPath}.mappings[${mappingIndex}]`;
          const mapping = object(mappings[mappingIndex], label, mappingPath);
          const mappedMaterialIndex = index(
            mapping.material,
            materials,
            label,
            `${mappingPath}.material`,
          );
          const mappedMaterial = preparePrimitiveMaterial(mappedMaterialIndex, mappingPath);
          const mappedMaterialLod = prepareMaterialLod(mappedMaterialIndex);
          const mappedVariants = array(mapping.variants, label, `${mappingPath}.variants`);
          if (mappedVariants.length === 0) {
            fail(label, `${mappingPath}.variants`, "must not be empty");
          }
          for (let variantIndex = 0; variantIndex < mappedVariants.length; variantIndex += 1) {
            const name = variantNames[index(
              mappedVariants[variantIndex],
              variantNames,
              label,
              `${mappingPath}.variants[${variantIndex}]`,
            )]!;
            if (materialVariants.has(name)) {
              fail(label, `${mappingPath}.variants[${variantIndex}]`, `duplicates variant ${JSON.stringify(name)}`);
            }
            materialVariants.set(name, mappedMaterial);
            if (mappedMaterialLod !== undefined) {
              materialVariantLods ??= new Map();
              materialVariantLods.set(name, mappedMaterialLod);
            }
          }
        }
        if (materialVariants.size === 0) materialVariants = undefined;
      }
      const usesTextureCoordinates0 = materialSetUsesTextureCoordinates(
        material,
        materialLod,
        materialVariants,
        materialVariantLods,
        0,
      );
      const usesTextureCoordinates1 = materialSetUsesTextureCoordinates(
        material,
        materialLod,
        materialVariants,
        materialVariantLods,
        1,
      );
      const decodedTextureCoordinates1 = usesTextureCoordinates1
        ? decoded?.attributes.get("TEXCOORD_1")
        : undefined;
      const textureCoordinates1 = !usesTextureCoordinates1 || attributes.TEXCOORD_1 === undefined
        ? undefined
        : decodedTextureCoordinates1 === undefined
          ? readFloatVectors(
            context,
            index(attributes.TEXCOORD_1, accessors, label, `${path}.attributes.TEXCOORD_1`),
            "VEC2",
            2,
            "TEXCOORD_1",
          )
          : validateDecodedVectors(
            decodedTextureCoordinates1,
            2,
            label,
            `${path}.attributes.TEXCOORD_1`,
          );
      if (textureCoordinates1 !== undefined && textureCoordinates1.length / 2 !== vertexCount) {
        fail(label, `${path}.attributes.TEXCOORD_1`, "count must match POSITION");
      }
      const decodedTangents = decoded?.attributes.get("TANGENT");
      const tangents = attributes.TANGENT === undefined
        ? undefined
        : decodedTangents === undefined
          ? readFloatVectors(
            context,
            index(attributes.TANGENT, accessors, label, `${path}.attributes.TANGENT`),
            "VEC4",
            4,
            "TANGENT",
          )
          : validateDecodedVectors(
            decodedTangents,
            4,
            label,
            `${path}.attributes.TANGENT`,
          );
      if (tangents !== undefined && tangents.length / 4 !== vertexCount) {
        fail(label, `${path}.attributes.TANGENT`, "count must match POSITION");
      }
      const indexAccessor = primitive.indices === undefined
        ? undefined
        : index(primitive.indices, accessors, label, `${path}.indices`);
      const indices = decoded?.indices ?? readIndices(context, indexAccessor, vertexCount);
      if (indices.length < 3 || indices.length % 3 !== 0) {
        fail(label, path, "triangle index count must be a positive multiple of 3");
      }
      for (let item = 0; item < indices.length; item += 1) {
        if (indices[item]! >= vertexCount) {
          fail(label, `${path}.indices[${item}]`, "decoded vertex index is out of range");
        }
      }
      if (usesTextureCoordinates0 && textureCoordinates0 === undefined) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "is required by the material");
      }
      if (usesTextureCoordinates1 && textureCoordinates1 === undefined) {
        fail(label, `${path}.attributes.TEXCOORD_1`, "is required by the material");
      }
      return {
        geometry: {
          bounds,
          indices,
          key: `${contentKey}:mesh:${meshIndex}:primitive:${primitiveIndex}`,
          ...(normals === undefined ? {} : { normals }),
          positions,
          ...(tangents === undefined ? {} : { tangents }),
          ...(textureCoordinates0 === undefined ? {} : { textureCoordinates0 }),
          ...(textureCoordinates1 === undefined ? {} : { textureCoordinates1 }),
        },
        material,
        ...(materialLod === undefined ? {} : { materialLod }),
        ...(materialVariants === undefined ? {} : { materialVariants }),
        ...(materialVariantLods === undefined ? {} : { materialVariantLods }),
      };
    });
    preparedMeshes[meshIndex] = prepared;
    return prepared;
  };

  const prepareNodeInstances = (
    node: JsonObject,
    nodeModel: Mat4,
    path: string,
  ): readonly StaticInstanceBatch[] | undefined => {
    if (node.extensions === undefined) return undefined;
    const extensions = object(node.extensions, label, `${path}.extensions`);
    if (extensions.EXT_mesh_gpu_instancing === undefined) return undefined;
    const extensionPath = `${path}.extensions.EXT_mesh_gpu_instancing`;
    const extension = object(extensions.EXT_mesh_gpu_instancing, label, extensionPath);
    const attributes = object(extension.attributes, label, `${extensionPath}.attributes`);
    for (const semantic of Object.keys(attributes)) {
      if (semantic !== "TRANSLATION" && semantic !== "ROTATION" && semantic !== "SCALE") {
        fail(label, `${extensionPath}.attributes.${semantic}`, "is unsupported");
      }
    }
    const translation = attributes.TRANSLATION === undefined
      ? undefined
      : readInstanceVectors(
        context,
        index(attributes.TRANSLATION, accessors, label, `${extensionPath}.attributes.TRANSLATION`),
        "VEC3",
        3,
        "TRANSLATION",
      );
    const rotation = attributes.ROTATION === undefined
      ? undefined
      : readInstanceVectors(
        context,
        index(attributes.ROTATION, accessors, label, `${extensionPath}.attributes.ROTATION`),
        "VEC4",
        4,
        "ROTATION",
      );
    const scale = attributes.SCALE === undefined
      ? undefined
      : readInstanceVectors(
        context,
        index(attributes.SCALE, accessors, label, `${extensionPath}.attributes.SCALE`),
        "VEC3",
        3,
        "SCALE",
      );
    const count = translation?.count ?? rotation?.count ?? scale?.count
      ?? fail(label, `${extensionPath}.attributes`, "must not be empty");
    if (
      (translation !== undefined && translation.count !== count)
      || (rotation !== undefined && rotation.count !== count)
      || (scale !== undefined && scale.count !== count)
    ) fail(label, `${extensionPath}.attributes`, "accessor counts must match");
    try {
      return prepareStaticInstanceBatches(nodeModel, {
        count,
        ...(rotation === undefined ? {} : { rotations: rotation.values }),
        ...(scale === undefined ? {} : { scales: scale.values }),
        ...(translation === undefined ? {} : { translations: translation.values }),
      });
    } catch (error) {
      return fail(
        label,
        extensionPath,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const sceneIndex = document.scene === undefined ? 0 : index(document.scene, scenes, label, "scene");
  const selectedScene = object(scenes[sceneIndex], label, `scenes[${sceneIndex}]`);
  const roots = array(selectedScene.nodes, label, `scenes[${sceneIndex}].nodes`);
  const claimed = new Set<number>();
  const nodeLodIds = (node: JsonObject, path: string): readonly number[] => {
    if (node.extensions === undefined) return [];
    const extensions = object(node.extensions, label, `${path}.extensions`);
    if (extensions.MSFT_lod === undefined) return [];
    const extensionPath = `${path}.extensions.MSFT_lod`;
    const extension = object(extensions.MSFT_lod, label, extensionPath);
    const ids = array(extension.ids, label, `${extensionPath}.ids`);
    if (ids.length === 0) fail(label, `${extensionPath}.ids`, "must not be empty");
    return ids.map((id, lodIndex) => index(
      id,
      nodes,
      label,
      `${extensionPath}.ids[${lodIndex}]`,
    ));
  };
  const referencedLodNodes = new Set<number>();
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    for (const lodNode of nodeLodIds(node, path)) referencedLodNodes.add(lodNode);
  }
  const graphState = new Uint8Array(nodes.length);
  const validateNodeGraph = (nodeIndex: number): void => {
    if (graphState[nodeIndex] === 1) {
      fail(label, `nodes[${nodeIndex}]`, "is part of a child/MSFT_lod cycle");
    }
    if (graphState[nodeIndex] === 2) return;
    graphState[nodeIndex] = 1;
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    const children = optionalArray(node.children, label, `${path}.children`);
    for (let child = 0; child < children.length; child += 1) {
      validateNodeGraph(index(children[child], nodes, label, `${path}.children[${child}]`));
    }
    for (const lodNode of nodeLodIds(node, path)) validateNodeGraph(lodNode);
    graphState[nodeIndex] = 2;
  };
  for (let root = 0; root < roots.length; root += 1) {
    validateNodeGraph(index(roots[root], nodes, label, `scenes[${sceneIndex}].nodes[${root}]`));
  }
  const lights: PreparedStaticGltfLight[] = [];
  const primitives: PreparedStaticGltfPrimitive[] = [];
  const visit = (
    nodeIndex: number,
    parentModel: Mat4,
    lods?: readonly PreparedStaticLodMembership[],
    applyOwnLod = true,
  ): void => {
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    if (applyOwnLod) {
      const lodIds = nodeLodIds(node, path);
      if (lodIds.length > 0) {
        const levelCount = lodIds.length + 1;
        const extras = node.extras === undefined
          ? undefined
          : object(node.extras, label, `${path}.extras`);
        const hints = extras?.MSFT_screencoverage === undefined
          ? undefined
          : array(extras.MSFT_screencoverage, label, `${path}.extras.MSFT_screencoverage`);
        const thresholds = normalizeLodThresholds(hints, levelCount);
        const group = `${contentKey}:node:${nodeIndex}:lod`;
        const highMembership = { group, level: 0, thresholds };
        visit(
          nodeIndex,
          parentModel,
          lods === undefined ? [highMembership] : [...lods, highMembership],
          false,
        );
        for (let level = 1; level < levelCount; level += 1) {
          const membership = { group, level, thresholds };
          visit(
            lodIds[level - 1]!,
            parentModel,
            lods === undefined ? [membership] : [...lods, membership],
            false,
          );
        }
        return;
      }
    }
    if (claimed.has(nodeIndex)) fail(label, `nodes[${nodeIndex}]`, "is cyclic or has multiple parents");
    claimed.add(nodeIndex);
    if (node.skin !== undefined) fail(label, `${path}.skin`, "is not supported yet");
    const localModel = nodeLocalMatrix(node, label, path);
    const worldModel = multiplyMat4Into(identityMat4(), parentModel, localModel);
    const instanceBatches = prepareNodeInstances(node, worldModel, path);
    if (node.extensions !== undefined) {
      const extensions = object(node.extensions, label, `${path}.extensions`);
      if (extensions.KHR_lights_punctual !== undefined) {
        const extensionPath = `${path}.extensions.KHR_lights_punctual`;
        const extension = object(extensions.KHR_lights_punctual, label, extensionPath);
        const lightIndex = index(
          extension.light,
          punctualLightDefinitions,
          label,
          `${extensionPath}.light`,
        );
        const lightPath = `extensions.KHR_lights_punctual.lights[${lightIndex}]`;
        const light = object(punctualLightDefinitions[lightIndex], label, lightPath);
        const kind = light.type === "directional"
          || light.type === "point"
          || light.type === "spot"
          ? light.type
          : fail(label, `${lightPath}.type`, "must be directional, point, or spot");
        const color = finiteTuple(light.color, 3, [1, 1, 1], label, `${lightPath}.color`);
        for (let channel = 0; channel < 3; channel += 1) {
          if (color[channel]! < 0) fail(label, `${lightPath}.color[${channel}]`, "must not be negative");
        }
        const intensity = finiteNumber(light.intensity, 1, label, `${lightPath}.intensity`);
        if (intensity < 0) fail(label, `${lightPath}.intensity`, "must not be negative");
        const range = finiteNumber(light.range, 0, label, `${lightPath}.range`);
        if (light.range !== undefined && range <= 0) {
          fail(label, `${lightPath}.range`, "must be positive");
        }
        const spot = kind === "spot"
          ? object(light.spot ?? {}, label, `${lightPath}.spot`)
          : undefined;
        const innerConeAngle = finiteNumber(
          spot?.innerConeAngle,
          0,
          label,
          `${lightPath}.spot.innerConeAngle`,
        );
        const outerConeAngle = finiteNumber(
          spot?.outerConeAngle,
          Math.PI / 4,
          label,
          `${lightPath}.spot.outerConeAngle`,
        );
        if (innerConeAngle < 0) {
          fail(label, `${lightPath}.spot.innerConeAngle`, "must not be negative");
        }
        if (
          outerConeAngle <= 0
          || outerConeAngle > Math.PI / 2
          || innerConeAngle >= outerConeAngle
        ) fail(label, `${lightPath}.spot.outerConeAngle`, "must exceed innerConeAngle and be at most PI/2");
        lights.push({
          color: [color[0]!, color[1]!, color[2]!],
          innerConeAngle,
          intensity,
          kind,
          localModel: worldModel,
          outerConeAngle,
          range,
        });
      }
    }
    if (node.mesh !== undefined) {
      const meshIndex = index(node.mesh, meshes, label, `${path}.mesh`);
      for (const primitive of prepareMesh(meshIndex)) {
        if (instanceBatches === undefined) {
          primitives.push({
            ...primitive,
            localModel: worldModel,
            ...(lods === undefined ? {} : { lods }),
          });
          continue;
        }
        for (let batch = 0; batch < instanceBatches.length; batch += 1) {
          primitives.push({
            ...primitive,
            instanceBatch: {
              ...instanceBatches[batch]!,
              key: `${contentKey}:node:${nodeIndex}:instances:${batch}`,
            },
            localModel: worldModel,
            ...(lods === undefined ? {} : { lods }),
          });
        }
      }
    }
    const children = optionalArray(node.children, label, `${path}.children`);
    for (let child = 0; child < children.length; child += 1) {
      visit(
        index(children[child], nodes, label, `${path}.children[${child}]`),
        worldModel,
        lods,
      );
    }
  };
  for (let root = 0; root < roots.length; root += 1) {
    const rootIndex = index(roots[root], nodes, label, `scenes[${sceneIndex}].nodes[${root}]`);
    if (!referencedLodNodes.has(rootIndex)) visit(rootIndex, identityMat4());
  }
  if (primitives.length === 0) fail(label, `scenes[${sceneIndex}]`, "has no renderable primitives");
  const batchedPrimitives = batchRepeatedStaticPrimitives(primitives);
  const claimedTextures = new Map<string, TextureSourceRef>();
  const claimTexture = (asset: TextureSourceRef | undefined): void => {
    if (asset === undefined) return;
    claimedTextures.set(`${asset.contentKey as string}:${asset.colorSpace ?? "srgb"}`, asset);
  };
  const forEachPrimitiveMaterial = (
    primitive: PreparedStaticGltfPrimitive,
    visitMaterial: (material: CanonicalSurfaceMaterial) => void,
  ): void => {
    visitMaterial(primitive.material);
    for (const level of primitive.materialLod?.levels ?? []) visitMaterial(level);
    for (const material of primitive.materialVariants?.values() ?? []) visitMaterial(material);
    for (const lod of primitive.materialVariantLods?.values() ?? []) {
      for (const level of lod.levels) visitMaterial(level);
    }
  };
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => claimTexture(material.baseColorAsset));
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.emissiveAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.metallicRoughnessAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.normalAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.occlusionAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.specularColorAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.specularTextureAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.thicknessAsset);
    });
  }
  for (const primitive of batchedPrimitives) {
    forEachPrimitiveMaterial(primitive, (material) => {
      if (material.kind === "standard") claimTexture(material.transmissionAsset);
    });
  }
  return {
    bounds: staticGltfBounds(batchedPrimitives),
    lights,
    primitives: batchedPrimitives,
    textureAssets: [...claimedTextures.values()],
  };
};

/** Validates and lowers the first static GLB profile without browser or GL resource work. */
export const prepareStaticGlb = (
  bytes: Uint8Array,
  contentKey: string,
  label = "glTF asset",
  sourceUri = "asset.glb",
): PreparedStaticGltf => {
  const parsed = parseGlb(bytes, label);
  const document = object(parsed.document, label, "document");
  const binary = parsed.binaryChunk
    ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
  return prepareStaticDocument(document, binary, "glb", contentKey, label, sourceUri);
};

const prepareDocumentWithCodecs = async (
  document: JsonObject,
  binary: Uint8Array,
  container: "glb" | "gltf",
  contentKey: string,
  label: string,
  sourceUri: string,
): Promise<PreparedStaticGltf> => {
  const extensionsUsed = optionalArray(document.extensionsUsed, label, "extensionsUsed");
  const extensionsRequired = optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  );
  const usesDraco = extensionsUsed.includes("KHR_draco_mesh_compression")
    || extensionsRequired.includes("KHR_draco_mesh_compression");
  const decodeDraco = usesDraco
    ? (await import("./draco")).createStaticDracoDecoder(document, binary, label)
    : undefined;
  return prepareStaticDocument(
    document,
    binary,
    container,
    contentKey,
    label,
    sourceUri,
    decodeDraco,
  );
};

const parseJsonDocument = (bytes: Uint8Array, label: string): JsonObject => {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(label, "document", `is not valid UTF-8 JSON: ${detail}`);
  }
  return object(value, label, "document");
};

/** Selects GLB or JSON glTF ingestion and fetches only the declared external buffer. */
export const prepareStaticGltfSource = async (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  read: (uri: string) => Promise<Uint8Array>,
): Promise<PreparedStaticGltf> => {
  if (
    bytes.byteLength >= 4
    && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46_54_6c_67
  ) {
    const parsed = parseGlb(bytes, label);
    const document = object(parsed.document, label, "document");
    const binary = parsed.binaryChunk
      ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
    return prepareDocumentWithCodecs(
      document,
      binary,
      "glb",
      contentKey,
      label,
      sourceUri,
    );
  }
  const document = parseJsonDocument(bytes, label);
  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length !== 1) fail(label, "buffers", "must contain exactly one buffer");
  const buffer = object(buffers[0], label, "buffers[0]");
  if (typeof buffer.uri !== "string" || buffer.uri.length === 0) {
    fail(label, "buffers[0].uri", "must be a non-empty external or data URI");
  }
  const binary = await read(resolveAssetUri(sourceUri, buffer.uri as string));
  return prepareDocumentWithCodecs(
    document,
    binary,
    "gltf",
    contentKey,
    label,
    sourceUri,
  );
};
