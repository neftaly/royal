import {
  array,
  fail,
  index,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import { selectedStaticNodeIndices } from "./static-node-selection";
import { createStaticPrimitiveImageDemand } from "./static-image-demand";
import { planMeshoptBufferViews } from "./meshopt";

export type StaticGltfByteRange = Readonly<{
  byteLength: number;
  byteOffset: number;
}>;

/** Optional selected-scene request; omitted means the complete resource is required. */
export type StaticGltfResourceRequest = Readonly<{
  byteLength: number;
  ranges: readonly StaticGltfByteRange[];
}>;

const MAX_RANGE_REQUESTS_PER_BUFFER = 8;
const FULL_READ_RATIO = 0.8;

const claimView = (
  value: unknown,
  bufferViews: readonly unknown[],
  claimedViews: Set<number>,
  label: string,
  path: string,
): void => {
  claimedViews.add(index(value, bufferViews, label, path));
};

const claimAccessor = (
  value: unknown,
  accessors: readonly unknown[],
  bufferViews: readonly unknown[],
  claimedViews: Set<number>,
  label: string,
  path: string,
): void => {
  const accessorIndex = index(value, accessors, label, path);
  const accessorPath = `accessors[${accessorIndex}]`;
  const accessor = object(accessors[accessorIndex], label, accessorPath);
  if (accessor.bufferView !== undefined) {
    claimView(
      accessor.bufferView,
      bufferViews,
      claimedViews,
      label,
      `${accessorPath}.bufferView`,
    );
  }
  if (accessor.sparse === undefined) return;
  const sparse = object(accessor.sparse, label, `${accessorPath}.sparse`);
  const indices = object(sparse.indices, label, `${accessorPath}.sparse.indices`);
  const values = object(sparse.values, label, `${accessorPath}.sparse.values`);
  claimView(
    indices.bufferView,
    bufferViews,
    claimedViews,
    label,
    `${accessorPath}.sparse.indices.bufferView`,
  );
  claimView(
    values.bufferView,
    bufferViews,
    claimedViews,
    label,
    `${accessorPath}.sparse.values.bufferView`,
  );
};

const mergeRanges = (
  ranges: StaticGltfByteRange[],
): readonly StaticGltfByteRange[] => {
  ranges.sort((left, right) => left.byteOffset - right.byteOffset);
  const merged: StaticGltfByteRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (
      previous === undefined
      || range.byteOffset > previous.byteOffset + previous.byteLength
    ) {
      merged.push(range);
      continue;
    }
    const end = Math.max(
      previous.byteOffset + previous.byteLength,
      range.byteOffset + range.byteLength,
    );
    merged[merged.length - 1] = {
      byteLength: end - previous.byteOffset,
      byteOffset: previous.byteOffset,
    };
  }
  return merged;
};

/** Selected downstream bufferViews, shared by range planning and demanded codecs. */
export const selectedStaticGltfBufferViewIndices = (
  document: JsonObject,
  label: string,
  sceneIndex?: number,
  etc2Available = true,
): ReadonlySet<number> => {
  const accessors = array(document.accessors, label, "accessors");
  const bufferViews = array(document.bufferViews, label, "bufferViews");
  const meshes = array(document.meshes, label, "meshes");
  const nodes = array(document.nodes, label, "nodes");
  const images = optionalArray(document.images, label, "images");
  const claimedViews = new Set<number>();
  const claimAccessorValue = (value: unknown, path: string): void => {
    claimAccessor(value, accessors, bufferViews, claimedViews, label, path);
  };
  const claimPrimitiveImages = createStaticPrimitiveImageDemand(
    document,
    label,
    etc2Available,
    (imageIndex) => {
      const imagePath = `images[${imageIndex}]`;
      const image = object(images[imageIndex], label, imagePath);
      if (image.bufferView !== undefined) {
        claimView(image.bufferView, bufferViews, claimedViews, label, `${imagePath}.bufferView`);
      }
    },
  );

  for (const nodeIndex of selectedStaticNodeIndices(document, label, sceneIndex)) {
    const nodePath = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, nodePath);
    if (node.extensions !== undefined) {
      const extensions = object(node.extensions, label, `${nodePath}.extensions`);
      if (extensions.EXT_mesh_gpu_instancing !== undefined) {
        const extensionPath = `${nodePath}.extensions.EXT_mesh_gpu_instancing`;
        const extension = object(extensions.EXT_mesh_gpu_instancing, label, extensionPath);
        const attributes = object(extension.attributes, label, `${extensionPath}.attributes`);
        for (const [semantic, accessor] of Object.entries(attributes)) {
          claimAccessorValue(accessor, `${extensionPath}.attributes.${semantic}`);
        }
      }
    }
    if (node.mesh === undefined) continue;
    const meshIndex = index(node.mesh, meshes, label, `${nodePath}.mesh`);
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], label, meshPath);
    const primitives = array(mesh.primitives, label, `${meshPath}.primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      const primitivePath = `${meshPath}.primitives[${primitiveIndex}]`;
      const primitive = object(primitives[primitiveIndex], label, primitivePath);
      claimPrimitiveImages(primitive, primitivePath);
      const attributes = object(primitive.attributes, label, `${primitivePath}.attributes`);
      for (const [semantic, accessor] of Object.entries(attributes)) {
        claimAccessorValue(accessor, `${primitivePath}.attributes.${semantic}`);
      }
      if (primitive.indices !== undefined) {
        claimAccessorValue(primitive.indices, `${primitivePath}.indices`);
      }
      if (primitive.extensions === undefined) continue;
      const extensions = object(primitive.extensions, label, `${primitivePath}.extensions`);
      if (extensions.KHR_draco_mesh_compression === undefined) continue;
      const extensionPath = `${primitivePath}.extensions.KHR_draco_mesh_compression`;
      const extension = object(extensions.KHR_draco_mesh_compression, label, extensionPath);
      claimView(
        extension.bufferView,
        bufferViews,
        claimedViews,
        label,
        `${extensionPath}.bufferView`,
      );
    }
  }
  return claimedViews;
};

/** Builds byte ranges from one already-computed selected-view set. */
export const planStaticGltfBufferRequestsForViews = (
  document: JsonObject,
  label: string,
  claimedViews: ReadonlySet<number>,
): readonly (StaticGltfResourceRequest | undefined)[] => {
  const buffers = array(document.buffers, label, "buffers");
  const bufferViews = array(document.bufferViews, label, "bufferViews");
  const meshoptByView = new Map(
    planMeshoptBufferViews(document, label).map((plan) => [plan.viewIndex, plan]),
  );

  const rangesByBuffer = Array.from(
    { length: buffers.length },
    () => [] as StaticGltfByteRange[],
  );
  for (const viewIndex of claimedViews) {
    const meshopt = meshoptByView.get(viewIndex);
    if (meshopt !== undefined) {
      if (meshopt.sourceLength !== 0) {
        rangesByBuffer[meshopt.sourceBuffer]!.push({
          byteLength: meshopt.sourceLength,
          byteOffset: meshopt.sourceOffset,
        });
      }
      continue;
    }
    const path = `bufferViews[${viewIndex}]`;
    const view = object(bufferViews[viewIndex], label, path);
    const bufferIndex = index(view.buffer, buffers, label, `${path}.buffer`);
    const byteOffset = view.byteOffset === undefined
      ? 0
      : nonNegativeInteger(view.byteOffset, label, `${path}.byteOffset`);
    const byteLength = nonNegativeInteger(view.byteLength, label, `${path}.byteLength`);
    const buffer = object(buffers[bufferIndex], label, `buffers[${bufferIndex}]`);
    const bufferByteLength = nonNegativeInteger(
      buffer.byteLength,
      label,
      `buffers[${bufferIndex}].byteLength`,
    );
    if (
      !Number.isSafeInteger(byteOffset + byteLength)
      || byteOffset + byteLength > bufferByteLength
    ) fail(label, path, "exceeds its source buffer");
    if (byteLength !== 0) rangesByBuffer[bufferIndex]!.push({ byteLength, byteOffset });
  }

  return buffers.map((value, bufferIndex) => {
    const path = `buffers[${bufferIndex}]`;
    const buffer = object(value, label, path);
    const byteLength = nonNegativeInteger(buffer.byteLength, label, `${path}.byteLength`);
    const ranges = mergeRanges(rangesByBuffer[bufferIndex]!);
    const requestedBytes = ranges.reduce((total, range) => total + range.byteLength, 0);
    return ranges.length > MAX_RANGE_REQUESTS_PER_BUFFER
      || (byteLength > 0 && requestedBytes / byteLength >= FULL_READ_RATIO)
      ? undefined
      : { byteLength, ranges };
  });
};

/**
 * Pure selected-scene byte demand. Sparse full-sized buffers preserve the
 * canonical downstream ABI; the browser shell decides whether HTTP ranges are
 * available and falls back to a complete response when they are not.
 */
export const planStaticGltfBufferRequests = (
  document: JsonObject,
  label: string,
  sceneIndex?: number,
  etc2Available = true,
): readonly (StaticGltfResourceRequest | undefined)[] =>
  planStaticGltfBufferRequestsForViews(
    document,
    label,
    selectedStaticGltfBufferViewIndices(document, label, sceneIndex, etc2Available),
  );
