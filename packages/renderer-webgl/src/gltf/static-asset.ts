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

export type PreparedStaticGltfPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instanceBatch?: StaticInstanceBatch & Readonly<{ key: string }>;
  localModel: Mat4;
  material: CanonicalSurfaceMaterial;
}>;

export type PreparedStaticGltf = Readonly<{
  bounds: GltfAssetBounds;
  primitives: readonly PreparedStaticGltfPrimitive[];
  textureAssets: readonly TextureSourceRef[];
}>;

type StaticDracoDecoder = (
  primitive: JsonObject,
  path: string,
) => DecodedDracoPrimitive;

type PreparedMeshPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  material: CanonicalSurfaceMaterial;
}>;

/** Converges repeated ordinary node occurrences on the authored instance ABI. */
export const batchRepeatedStaticPrimitives = (
  primitives: readonly PreparedStaticGltfPrimitive[],
): readonly PreparedStaticGltfPrimitive[] => {
  const repeated = new Map<string, PreparedStaticGltfPrimitive[]>();
  let hasRepeatedGeometry = false;
  for (const primitive of primitives) {
    if (primitive.instanceBatch !== undefined) continue;
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
    if (primitive.instanceBatch !== undefined) {
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
      && extension !== "EXT_texture_avif"
      && extension !== "EXT_mesh_gpu_instancing"
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
      const material = preparePrimitiveMaterial(primitive.material, path);
      if (material.requiresTextureCoordinates && textureCoordinates0 === undefined) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "is required by the base color texture");
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
        },
        material,
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
  const primitives: PreparedStaticGltfPrimitive[] = [];
  const visit = (nodeIndex: number, parentModel: Mat4): void => {
    if (claimed.has(nodeIndex)) fail(label, `nodes[${nodeIndex}]`, "is cyclic or has multiple parents");
    claimed.add(nodeIndex);
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    if (node.skin !== undefined) fail(label, `${path}.skin`, "is not supported yet");
    const localModel = nodeLocalMatrix(node, label, path);
    const worldModel = multiplyMat4Into(identityMat4(), parentModel, localModel);
    const instanceBatches = prepareNodeInstances(node, worldModel, path);
    if (node.mesh !== undefined) {
      const meshIndex = index(node.mesh, meshes, label, `${path}.mesh`);
      for (const primitive of prepareMesh(meshIndex)) {
        if (instanceBatches === undefined) {
          primitives.push({ ...primitive, localModel: worldModel });
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
          });
        }
      }
    }
    const children = optionalArray(node.children, label, `${path}.children`);
    for (let child = 0; child < children.length; child += 1) {
      visit(index(children[child], nodes, label, `${path}.children[${child}]`), worldModel);
    }
  };
  for (let root = 0; root < roots.length; root += 1) {
    visit(index(roots[root], nodes, label, `scenes[${sceneIndex}].nodes[${root}]`), identityMat4());
  }
  if (primitives.length === 0) fail(label, `scenes[${sceneIndex}]`, "has no renderable primitives");
  const batchedPrimitives = batchRepeatedStaticPrimitives(primitives);
  const claimedTextures = new Map<string, TextureSourceRef>();
  const claimTexture = (asset: TextureSourceRef | undefined): void => {
    if (asset === undefined) return;
    claimedTextures.set(`${asset.contentKey as string}:${asset.colorSpace ?? "srgb"}`, asset);
  };
  for (const primitive of batchedPrimitives) {
    claimTexture(primitive.material.baseColorAsset);
  }
  for (const primitive of batchedPrimitives) {
    if (primitive.material.kind === "standard") {
      claimTexture(primitive.material.emissiveAsset);
    }
  }
  for (const primitive of batchedPrimitives) {
    if (primitive.material.kind === "standard") {
      claimTexture(primitive.material.metallicRoughnessAsset);
    }
  }
  for (const primitive of batchedPrimitives) {
    if (primitive.material.kind === "standard") claimTexture(primitive.material.normalAsset);
  }
  return {
    bounds: staticGltfBounds(batchedPrimitives),
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
