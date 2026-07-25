import type { TextureVersion } from "@royal/renderer-core";
import {
  decodedTextureKey,
  textureStorageKey,
  type TextureSourceRef,
} from "../texture/source";
import {
  array,
  index,
  object,
  optionalArray,
} from "./gltf-values";
import {
  createStaticPrimitiveTextureDemand,
  type StaticTextureDemand,
} from "./static-image-demand";
import { createTextureAssetReader } from "./static-material";
import { createStaticTextureImagePlanner } from "./static-texture-image-plan";
import { selectedStaticNodeIndices } from "./static-node-selection";
import { parseStaticGltfDocument } from "./static-source";
import {
  planStaticGltfGeometryTasks,
  type StaticGeometryTaskPlan,
} from "./static-geometry-plan";

export type EarlyStaticTextureClaims = Readonly<{
  alphaMaskTextureAssets: readonly TextureSourceRef[];
  textureAssets: readonly TextureSourceRef[];
}>;

export type EarlyStaticGltfRoot = Readonly<{
  geometryTasks?: StaticGeometryTaskPlan;
  textureClaims: EarlyStaticTextureClaims;
}>;

const EMPTY_CLAIMS: EarlyStaticTextureClaims = {
  alphaMaskTextureAssets: [],
  textureAssets: [],
};

/**
 * Pure root-document discovery for selected external material images.
 *
 * Embedded images remain coupled to canonical buffer preparation. External
 * images can enter the ordinary bounded texture owner as soon as root bytes
 * exist, without waiting for geometry reads, codecs, or worker lowering.
 */
export const discoverExternalStaticGltfTextures = (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
): EarlyStaticTextureClaims => {
  const document = parseStaticGltfDocument(bytes, label);
  return discoverExternalStaticGltfDocumentTextures(
    document,
    contentKey,
    label,
    sourceUri,
    sceneIndex,
    resourceVersion,
  );
};

const discoverExternalStaticGltfDocumentTextures = (
  document: ReturnType<typeof parseStaticGltfDocument>,
  contentKey: string,
  label: string,
  sourceUri: string,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
): EarlyStaticTextureClaims => {
  const nodes = array(document.nodes, label, "nodes");
  const meshes = array(document.meshes, label, "meshes");
  const images = optionalArray(document.images, label, "images");
  const bufferViews = optionalArray(document.bufferViews, label, "bufferViews");
  if (images.length === 0) return EMPTY_CLAIMS;
  const planTextureImages = createStaticTextureImagePlanner(
    document,
    label,
  );
  const readTextureAsset = createTextureAssetReader(
    document,
    new Uint8Array(),
    0,
    bufferViews,
    contentKey,
    sourceUri,
    label,
    resourceVersion,
  );
  const textureAssets = new Map<string, TextureSourceRef>();
  const alphaMaskTextureAssets = new Map<string, TextureSourceRef>();
  const demands: StaticTextureDemand[] = [];
  const claimPrimitive = createStaticPrimitiveTextureDemand(
    document,
    label,
    (demand) => demands.push(demand),
  );
  for (const nodeIndex of selectedStaticNodeIndices(document, label, sceneIndex)) {
    const nodePath = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, nodePath);
    if (node.mesh === undefined) continue;
    const meshIndex = index(node.mesh, meshes, label, `${nodePath}.mesh`);
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], label, meshPath);
    const primitives = array(mesh.primitives, label, `${meshPath}.primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      const primitivePath = `${meshPath}.primitives[${primitiveIndex}]`;
      claimPrimitive(
        object(primitives[primitiveIndex], label, primitivePath),
        primitivePath,
      );
    }
  }
  demands.sort((left, right) => left.priority - right.priority);
  for (const { colorSpace, retainAlpha, textureIndex } of demands) {
    const plan = planTextureImages(textureIndex, colorSpace);
    const sources = plan.fallback === undefined
      ? [plan.primary]
      : [plan.primary, plan.fallback];
    let external = true;
    for (const source of sources) {
      const imagePath = `images[${source.imageIndex}]`;
      const image = object(images[source.imageIndex], label, imagePath);
      if (image.bufferView !== undefined) external = false;
    }
    if (!external) continue;
    const asset = readTextureAsset(
      textureIndex,
      `textures[${textureIndex}]`,
      colorSpace,
    );
    textureAssets.set(textureStorageKey(asset), asset);
    if (retainAlpha) alphaMaskTextureAssets.set(decodedTextureKey(asset), asset);
  }
  return {
    alphaMaskTextureAssets: [...alphaMaskTextureAssets.values()],
    textureAssets: [...textureAssets.values()],
  };
};

/** Parses one small JSON root once for early texture and geometry planning. */
export const discoverEarlyStaticGltfRoot = (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
): EarlyStaticGltfRoot => {
  const document = parseStaticGltfDocument(bytes, label);
  const geometryTasks = planStaticGltfGeometryTasks(
    document,
    label,
    sourceUri,
    sceneIndex,
    resourceVersion,
  );
  return {
    ...(geometryTasks === undefined ? {} : { geometryTasks }),
    textureClaims: discoverExternalStaticGltfDocumentTextures(
      document,
      contentKey,
      label,
      sourceUri,
      sceneIndex,
      resourceVersion,
    ),
  };
};
