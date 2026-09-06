import { createStaticMaterialSetPreparer } from "./static-material-set";
import { createStaticMeshPreparer, type StaticDracoDecoder } from "./static-mesh";
import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
} from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { GltfAssetBounds, TextureVersion } from "@royal/renderer-core";
import type { TextureSourceRef } from "../texture/source";
import type { StaticDracoTaskExecutor } from "./draco";
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
  finiteNumber,
  finiteTuple,
  index,
  nodeLocalMatrix,
  nonNegativeInteger,
  object,
  optionalArray,
  type GltfJsonValue,
  type JsonObject,
} from "./gltf-values";
import {
  readInstanceVectors,
  type AccessorContext,
} from "./accessor-reader";
import {
  createTextureAssetReader,
} from "./static-material";
import { normalizeLodThresholds, type LodGroupId } from "../surface/lod-selection";
import {
  validateStaticGltfDeclarations,
  type StaticGltfDeclarations,
} from "./static-declarations";
import {
  collectStaticAlphaMaskTextureAssets,
  collectStaticTextureAssets,
} from "./static-texture-assets";
import {
  readCanonicalStaticGltfSource,
  type StaticGltfResourceReader,
} from "./static-source";
import {
  selectedStaticSceneIndex,
  staticDocumentScenes,
  staticNodeLodIds,
  type GltfDocumentScene,
} from "./static-node-selection";
import {
  staticGeometryTaskKeyMap,
  type StaticGeometryTaskPlan,
} from "./static-geometry-plan";
export type PreparedStaticLodMembership = Readonly<{
  group: LodGroupId;
  level: number;
  thresholds: readonly number[];
}>;

export type PreparedStaticMaterialLod = Readonly<{
  levels: readonly CanonicalSurfaceMaterial[];
  thresholds: readonly number[];
}>;

export type PreparedStaticGltfPrimitive = Readonly<{
  /** @internal Replaced with root-owned canonical geometry before publication. */
  deferredGeometryKey?: string;
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
  /** Base-color images whose MASK materials require retained CPU alpha. */
  alphaMaskTextureAssets: readonly TextureSourceRef[];
  bounds: GltfAssetBounds;
  lights: readonly PreparedStaticGltfLight[];
  /** Authored nodes reachable from the selected scene, including authored LOD members. */
  nodeCount: number;
  primitives: readonly PreparedStaticGltfPrimitive[];
  /** Actual selected scene after resolving the document default. */
  sceneIndex: number;
  /** Complete lightweight scene inventory; unselected content is not prepared. */
  scenes: readonly GltfDocumentScene[];
  /** Uninterpreted glTF root `extras`, retained from the canonical document parse. */
  rootExtras?: GltfJsonValue;
  textureAssets: readonly TextureSourceRef[];
  /** Unique document-declared material variant names in authored order. */
  variantNames: readonly string[];
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

type StaticDocumentPreflight = Readonly<{
  bufferByteLength: number;
  usesMeshQuantization: boolean;
  usesDraco: boolean;
}>;

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
        ...(primitive.deferredGeometryKey === undefined
          ? {}
          : { deferredGeometryKey: primitive.deferredGeometryKey }),
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

/** Rejects invalid static-profile input before any codec or semantic work starts. */
const preflightStaticDocument = (
  document: JsonObject,
  binary: Uint8Array,
  container: "glb" | "gltf",
  contentKey: string,
  label: string,
  dracoAvailable: boolean,
  meshoptAvailable: boolean,
  validatedDeclarations?: StaticGltfDeclarations,
): StaticDocumentPreflight => {
  if (contentKey.length === 0) throw new TypeError("Royal glTF contentKey must not be empty");
  const declarations = validatedDeclarations ?? validateStaticGltfDeclarations(
    document,
    label,
    dracoAvailable,
    meshoptAvailable,
  );

  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length !== 1) fail(label, "buffers", "must contain exactly one buffer");
  const buffer = object(buffers[0], label, "buffers[0]");
  if (validatedDeclarations === undefined && container === "glb" && buffer.uri !== undefined) {
    fail(label, "buffers[0].uri", "must be omitted for a GLB BIN chunk");
  }
  if (
    validatedDeclarations === undefined
    && container === "gltf"
    && (typeof buffer.uri !== "string" || buffer.uri.length === 0)
  ) {
    fail(label, "buffers[0].uri", "must be a non-empty external or data URI");
  }
  const bufferByteLength = nonNegativeInteger(buffer.byteLength, label, "buffers[0].byteLength");
  const padding = binary.byteLength - bufferByteLength;
  if (
    padding < 0
    || (validatedDeclarations === undefined
      ? container === "glb" ? padding > 3 : padding !== 0
      : padding !== 0)
  ) {
    fail(
      label,
      "buffers[0].byteLength",
      validatedDeclarations !== undefined
        ? "does not match the canonical buffer"
        : container === "glb"
          ? "does not match the padded GLB BIN chunk"
          : "does not match the external buffer",
    );
  }
  return {
    bufferByteLength,
    ...declarations,
  };
};

const prepareStaticDocument = (
  document: JsonObject,
  binary: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  preflight: StaticDocumentPreflight,
  decodeDraco?: StaticDracoDecoder,
  selectedSceneIndex?: number,
  resourceVersion?: TextureVersion,
  geometryTasks?: StaticGeometryTaskPlan,
  computeGeometryTaskKeys?: ReadonlySet<string>,
): PreparedStaticGltf => {
  const { bufferByteLength } = preflight;
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
    resourceVersion,
  );
  const nodes = array(document.nodes, label, "nodes");
  const scenes = array(document.scenes, label, "scenes");
  const context: AccessorContext = {
    accessors,
    binary,
    bufferByteLength,
    bufferViews,
    label,
    meshQuantization: preflight.usesMeshQuantization,
  };
  const preparePrimitiveMaterialSet = createStaticMaterialSetPreparer(
    materials, textureAsset, variantNames, label,
  );
  const prepareMesh = createStaticMeshPreparer(
    meshes,
    context,
    contentKey,
    preparePrimitiveMaterialSet,
    decodeDraco,
    geometryTasks,
    computeGeometryTaskKeys,
  );

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

  const documentScenes = staticDocumentScenes(scenes, label);
  const sceneIndex = selectedStaticSceneIndex(document, scenes, label, selectedSceneIndex);
  const selectedScene = object(scenes[sceneIndex], label, `scenes[${sceneIndex}]`);
  const roots = array(selectedScene.nodes, label, `scenes[${sceneIndex}].nodes`);
  const claimed = new Set<number>();
  const nodeLodIds = (node: JsonObject, path: string): readonly number[] =>
    staticNodeLodIds(node, nodes, label, path);
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
  const lodGroupIds = new Int32Array(nodes.length);
  lodGroupIds.fill(-1);
  let nextLodGroupId = 0;
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
        let group = lodGroupIds[nodeIndex]!;
        if (group < 0) {
          group = nextLodGroupId;
          nextLodGroupId += 1;
          lodGroupIds[nodeIndex] = group;
        }
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
  return {
    alphaMaskTextureAssets: collectStaticAlphaMaskTextureAssets(batchedPrimitives),
    bounds: staticGltfBounds(batchedPrimitives),
    lights,
    nodeCount: claimed.size,
    primitives: batchedPrimitives,
    ...(document.extras === undefined
      ? {}
      : { rootExtras: document.extras as GltfJsonValue }),
    sceneIndex,
    scenes: documentScenes,
    textureAssets: collectStaticTextureAssets(batchedPrimitives),
    variantNames,
  };
};

/** Validates and lowers the first static GLB profile without browser or GL resource work. */
export const prepareStaticGlb = (
  bytes: Uint8Array,
  contentKey: string,
  label = "glTF asset",
  sourceUri = "asset.glb",
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
): PreparedStaticGltf => {
  const parsed = parseGlb(bytes, label);
  const document = object(parsed.document, label, "document");
  const binary = parsed.binaryChunk
    ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
  const preflight = preflightStaticDocument(
    document,
    binary,
    "glb",
    contentKey,
    label,
    false,
    false,
  );
  return prepareStaticDocument(
    document,
    binary,
    contentKey,
    label,
    sourceUri,
    preflight,
    undefined,
    sceneIndex,
    resourceVersion,
  );
};

const prepareDocumentWithCodecs = async (
  document: JsonObject,
  binary: Uint8Array,
  container: "glb" | "gltf",
  contentKey: string,
  label: string,
  sourceUri: string,
  executeDracoTasks?: StaticDracoTaskExecutor,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
  validatedDeclarations?: StaticGltfDeclarations,
  geometryTasks?: StaticGeometryTaskPlan,
  computeGeometryTaskKeys?: ReadonlySet<string>,
): Promise<PreparedStaticGltf> => {
  const preflight = preflightStaticDocument(
    document,
    binary,
    container,
    contentKey,
    label,
    true,
    true,
    validatedDeclarations,
  );
  const geometryTaskKeys = staticGeometryTaskKeyMap(geometryTasks);
  const decodeDraco = preflight.usesDraco
    ? await import("./draco").then((module) =>
      module.prepareSelectedStaticDracoDecoder(
        document,
        binary,
        label,
        executeDracoTasks,
        sceneIndex,
        geometryTasks === undefined
          ? undefined
          : (meshIndex, primitiveIndex) => {
            const key = geometryTaskKeys.get(`${meshIndex}:${primitiveIndex}`);
            return key === undefined || computeGeometryTaskKeys?.has(key) !== false;
          },
      ))
    : undefined;
  return prepareStaticDocument(
    document,
    binary,
    contentKey,
    label,
    sourceUri,
    preflight,
    decodeDraco,
    sceneIndex,
    resourceVersion,
    geometryTasks,
    computeGeometryTaskKeys,
  );
};

/** Selects GLB or JSON glTF ingestion and fetches only the declared external buffer. */
export const prepareStaticGltfSource = async (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  read: StaticGltfResourceReader,
  executeDracoTasks?: StaticDracoTaskExecutor,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
  geometryTasks?: StaticGeometryTaskPlan,
  computeGeometryTaskKeys?: ReadonlySet<string>,
): Promise<PreparedStaticGltf> => {
  const canonical = await readCanonicalStaticGltfSource(
    bytes,
    label,
    sourceUri,
    read,
    sceneIndex,
    resourceVersion,
    geometryTasks,
    computeGeometryTaskKeys,
  );
  return prepareDocumentWithCodecs(
    canonical.document,
    canonical.binary,
    canonical.container,
    contentKey,
    label,
    sourceUri,
    executeDracoTasks,
    sceneIndex,
    resourceVersion,
    canonical.declarations,
    geometryTasks ?? canonical.geometryTasks,
    computeGeometryTaskKeys,
  );
};
