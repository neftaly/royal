import type { TextureVersion } from "@royal/renderer-core";
import {
  array,
  index,
  integer,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import { createStaticPrimitiveTextureDemand } from "./static-image-demand";
import { resolveAssetUri } from "./static-material";
import { selectedStaticNodeIndices } from "./static-node-selection";

export type StaticGeometryTask = Readonly<{
  key: string;
  meshIndex: number;
  primitiveIndex: number;
}>;

export type StaticGeometryTaskPlan = Readonly<{
  tasks: readonly StaticGeometryTask[];
}>;

export const staticExternalGeometryResourceIdentity = (
  document: JsonObject,
  label: string,
  sourceUri: string,
): string | undefined => {
  const buffers = array(document.buffers, label, "buffers");
  const identities: Array<readonly [uri: string, byteLength: number]> = [];
  for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex += 1) {
    const path = `buffers[${bufferIndex}]`;
    const buffer = object(buffers[bufferIndex], label, path);
    if (typeof buffer.uri !== "string" || buffer.uri.length === 0) return undefined;
    const uri = resolveAssetUri(sourceUri, buffer.uri);
    if (uri.startsWith("data:")) return undefined;
    identities.push([
      uri,
      nonNegativeInteger(buffer.byteLength, label, `${path}.byteLength`),
    ]);
  }
  return JSON.stringify(identities);
};

export const staticGeometryDeclarationKey = (
  document: JsonObject,
  label: string,
  resourceIdentity: string,
  primitive: JsonObject,
  path: string,
  usesTextureCoordinates1: boolean,
  usesMeshQuantization: boolean,
  resourceVersion?: TextureVersion,
): string => {
  const accessors = array(document.accessors, label, "accessors");
  const bufferViews = array(document.bufferViews, label, "bufferViews");
  const attributes = object(primitive.attributes, label, `${path}.attributes`);
  const accessorIndices = new Set<number>();
  const attributeDeclarations = Object.keys(attributes).sort().map((semantic) => {
    const accessorIndex = index(
      attributes[semantic],
      accessors,
      label,
      `${path}.attributes.${semantic}`,
    );
    accessorIndices.add(accessorIndex);
    return [semantic, accessorIndex] as const;
  });
  if (primitive.indices !== undefined) {
    accessorIndices.add(index(primitive.indices, accessors, label, `${path}.indices`));
  }
  const viewIndices = new Set<number>();
  const accessorDeclarations = [...accessorIndices]
    .sort((left, right) => left - right)
    .map((accessorIndex) => {
      const accessorPath = `accessors[${accessorIndex}]`;
      const accessor = object(accessors[accessorIndex], label, accessorPath);
      if (accessor.bufferView !== undefined) {
        viewIndices.add(index(
          accessor.bufferView,
          bufferViews,
          label,
          `${accessorPath}.bufferView`,
        ));
      }
      if (accessor.sparse !== undefined) {
        const sparse = object(accessor.sparse, label, `${accessorPath}.sparse`);
        const sparseIndices = object(
          sparse.indices,
          label,
          `${accessorPath}.sparse.indices`,
        );
        const sparseValues = object(
          sparse.values,
          label,
          `${accessorPath}.sparse.values`,
        );
        viewIndices.add(index(
          sparseIndices.bufferView,
          bufferViews,
          label,
          `${accessorPath}.sparse.indices.bufferView`,
        ));
        viewIndices.add(index(
          sparseValues.bufferView,
          bufferViews,
          label,
          `${accessorPath}.sparse.values.bufferView`,
        ));
      }
      return [accessorIndex, accessor] as const;
    });
  const extensions = primitive.extensions === undefined
    ? undefined
    : object(primitive.extensions, label, `${path}.extensions`);
  const draco = extensions?.KHR_draco_mesh_compression;
  if (draco !== undefined) {
    const declaration = object(
      draco,
      label,
      `${path}.extensions.KHR_draco_mesh_compression`,
    );
    viewIndices.add(index(
      declaration.bufferView,
      bufferViews,
      label,
      `${path}.extensions.KHR_draco_mesh_compression.bufferView`,
    ));
  }
  const viewDeclarations = [...viewIndices]
    .sort((left, right) => left - right)
    .map((viewIndex) => [viewIndex, bufferViews[viewIndex]] as const);
  const primitiveMode = primitive.mode === undefined
    ? 4
    : integer(primitive.mode, label, `${path}.mode`);
  return JSON.stringify([
    resourceIdentity,
    resourceVersion === undefined ? null : [typeof resourceVersion, resourceVersion],
    usesMeshQuantization,
    primitiveMode,
    attributeDeclarations,
    primitive.indices ?? null,
    draco ?? null,
    accessorDeclarations,
    viewDeclarations,
    usesTextureCoordinates1,
  ]);
};

/**
 * Pure root-document geometry task planning.
 *
 * External immutable resource identity plus the complete extraction
 * declaration is authoritative. The plan performs no buffer read or decode.
 */
export const planStaticGltfGeometryTasks = (
  document: JsonObject,
  label: string,
  sourceUri: string,
  sceneIndex?: number,
  resourceVersion?: TextureVersion,
): StaticGeometryTaskPlan | undefined => {
  const resourceIdentity = staticExternalGeometryResourceIdentity(
    document,
    label,
    sourceUri,
  );
  if (resourceIdentity === undefined) return undefined;
  const meshes = array(document.meshes, label, "meshes");
  const nodes = array(document.nodes, label, "nodes");
  const usesMeshQuantization = optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  ).includes("KHR_mesh_quantization");
  const selectedMeshes = new Set<number>();
  for (const nodeIndex of selectedStaticNodeIndices(document, label, sceneIndex)) {
    const nodePath = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, nodePath);
    if (node.mesh !== undefined) {
      selectedMeshes.add(index(node.mesh, meshes, label, `${nodePath}.mesh`));
    }
  }
  const tasks: StaticGeometryTask[] = [];
  for (const meshIndex of selectedMeshes) {
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], label, meshPath);
    const primitives = array(mesh.primitives, label, `${meshPath}.primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      const primitivePath = `${meshPath}.primitives[${primitiveIndex}]`;
      const primitive = object(primitives[primitiveIndex], label, primitivePath);
      let usesTextureCoordinates1 = false;
      createStaticPrimitiveTextureDemand(document, label, ({ coordinateSet }) => {
        usesTextureCoordinates1 ||= coordinateSet === 1;
      })(primitive, primitivePath);
      tasks.push({
        key: staticGeometryDeclarationKey(
          document,
          label,
          resourceIdentity,
          primitive,
          primitivePath,
          usesTextureCoordinates1,
          usesMeshQuantization,
          resourceVersion,
        ),
        meshIndex,
        primitiveIndex,
      });
    }
  }
  return tasks.length === 0 ? undefined : { tasks };
};

export const staticGeometryTaskKeyMap = (
  plan: StaticGeometryTaskPlan | undefined,
): ReadonlyMap<string, string> => new Map(
  plan?.tasks.map(({ key, meshIndex, primitiveIndex }) =>
    [`${meshIndex}:${primitiveIndex}`, key]) ?? [],
);
