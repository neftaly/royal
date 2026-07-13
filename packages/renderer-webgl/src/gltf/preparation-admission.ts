import { gltfComponentCount } from "./accessors";
import { dataUriDecodedByteLength } from "./io";
import type { GltfDocument, GltfMeshPrimitive } from "./schema";

const MAX_GLTF_NODE_TRAVERSAL_DEPTH = 512;
const MAX_GLTF_NODE_TRAVERSAL_WORK = 1_000_000;

export interface GltfPreparationCpuEstimate {
  /** Conservative pre-decode bound; publication shrinks this to exact recipe bytes. */
  readonly assetDecode: number;
  /** Conservative upper bound for typed geometry arrays retained by scene preparation. */
  readonly geometry: number;
  /** Conservative codec/copy workspace requested only while preparation is active. */
  readonly transientPeak: number;
}

const checkedAdd = (left: number, right: number, label: string): number => {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} exceeds safe integer capacity`);
  }
  return value;
};

const checkedProduct = (left: number, right: number, label: string): number => {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw new Error(`${label} requires non-negative safe integers`);
  }
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds safe integer capacity`);
  return value;
};

const checkedNodeIndex = (
  document: GltfDocument,
  value: number,
  label: string,
): number => {
  if (!Number.isSafeInteger(value) || value < 0 || document.nodes?.[value] === undefined) {
    throw new Error(`${label} references invalid node ${String(value)}`);
  }
  return value;
};

const nodeEdges = (document: GltfDocument, nodeIndex: number): readonly number[] => {
  const node = document.nodes?.[nodeIndex];
  if (node === undefined) return [];
  return [
    ...(node.children ?? []).map((child) =>
      checkedNodeIndex(document, child, `glTF node ${nodeIndex} child`)),
    ...(node.extensions?.MSFT_lod?.ids ?? []).map((lod) =>
      checkedNodeIndex(document, lod, `glTF node ${nodeIndex} MSFT_lod`)),
  ];
};

/**
 * Rejects malformed combined child/LOD graphs before recursive scene reading.
 * The explicit stack avoids making validation itself vulnerable to deep input.
 */
export const assertGltfNodeTraversalSafe = (document: GltfDocument): void => {
  const nodes = document.nodes ?? [];
  const state = new Uint8Array(nodes.length); // 0 unseen, 1 active, 2 complete
  let work = 0;
  for (let root = 0; root < nodes.length; root += 1) {
    if (state[root] !== 0) continue;
    const stack: Array<{ edges: readonly number[]; index: number; node: number }> = [];
    state[root] = 1;
    stack.push({ edges: nodeEdges(document, root), index: 0, node: root });
    while (stack.length > 0) {
      if (stack.length > MAX_GLTF_NODE_TRAVERSAL_DEPTH) {
        throw new Error(
          `glTF node traversal depth exceeds ${MAX_GLTF_NODE_TRAVERSAL_DEPTH}`,
        );
      }
      const frame = stack[stack.length - 1]!;
      if (frame.index >= frame.edges.length) {
        state[frame.node] = 2;
        stack.pop();
        continue;
      }
      const next = frame.edges[frame.index]!;
      frame.index += 1;
      work += 1;
      if (work > MAX_GLTF_NODE_TRAVERSAL_WORK) {
        throw new Error(
          `glTF node traversal work exceeds ${MAX_GLTF_NODE_TRAVERSAL_WORK}`,
        );
      }
      if (state[next] === 1) {
        throw new Error(`glTF node graph contains a child/MSFT_lod cycle through node ${next}`);
      }
      if (state[next] === 2) continue;
      state[next] = 1;
      stack.push({ edges: nodeEdges(document, next), index: 0, node: next });
    }
  }
};

const accessorFloatBytes = (
  document: GltfDocument,
  accessorIndex: number | undefined,
  label: string,
): number => {
  if (accessorIndex === undefined) return 0;
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined) throw new Error(`${label} references missing accessor ${accessorIndex}`);
  return checkedProduct(
    checkedProduct(accessor.count, gltfComponentCount(accessor.type), `${label} element count`),
    Float32Array.BYTES_PER_ELEMENT,
    `${label} decoded byte size`,
  );
};

const accessorIndexBytes = (
  document: GltfDocument,
  accessorIndex: number | undefined,
  label: string,
): number => {
  if (accessorIndex === undefined) return 0;
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined) throw new Error(`${label} references missing accessor ${accessorIndex}`);
  // Uint32 is the widest index representation Royal can retain.
  return checkedProduct(accessor.count, Uint32Array.BYTES_PER_ELEMENT, `${label} decoded byte size`);
};

const primitiveGeometryBytes = (
  document: GltfDocument,
  primitive: GltfMeshPrimitive,
  label: string,
): number => {
  const attributes = primitive.attributes;
  const positions = accessorFloatBytes(document, attributes?.POSITION, `${label} POSITION`);
  if (positions === 0) return 0;
  let bytes = positions;
  // Missing normals are generated as one float triplet per position vertex.
  bytes = checkedAdd(
    bytes,
    attributes?.NORMAL === undefined
      ? positions
      : accessorFloatBytes(document, attributes.NORMAL, `${label} NORMAL`),
    `${label} geometry bytes`,
  );
  bytes = checkedAdd(bytes, accessorFloatBytes(document, attributes?.TANGENT, `${label} TANGENT`), `${label} geometry bytes`);
  if (attributes?.COLOR_0 !== undefined) {
    const accessor = document.accessors?.[attributes.COLOR_0];
    if (accessor === undefined) throw new Error(`${label} COLOR_0 references missing accessor ${attributes.COLOR_0}`);
    // VEC3 colors are expanded to retained VEC4 float colors.
    bytes = checkedAdd(
      bytes,
      checkedProduct(accessor.count, 4 * Float32Array.BYTES_PER_ELEMENT, `${label} COLOR_0 decoded byte size`),
      `${label} geometry bytes`,
    );
  }
  bytes = checkedAdd(bytes, accessorFloatBytes(document, attributes?.TEXCOORD_0, `${label} TEXCOORD_0`), `${label} geometry bytes`);
  bytes = checkedAdd(bytes, accessorFloatBytes(document, attributes?.TEXCOORD_1, `${label} TEXCOORD_1`), `${label} geometry bytes`);
  bytes = checkedAdd(bytes, accessorIndexBytes(document, primitive.indices, `${label} indices`), `${label} geometry bytes`);
  return bytes;
};

const meshGeometryBytes = (document: GltfDocument, meshIndex: number, label: string): number => {
  const mesh = document.meshes?.[meshIndex];
  if (mesh === undefined) throw new Error(`${label} references missing mesh ${meshIndex}`);
  let bytes = 0;
  for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
    bytes = checkedAdd(
      bytes,
      primitiveGeometryBytes(document, primitive, `${label} mesh ${meshIndex} primitive ${primitiveIndex}`),
      `${label} mesh geometry bytes`,
    );
  }
  return bytes;
};

const estimateReachableGeometryBytes = (document: GltfDocument): number => {
  const referencedLodNodes = new Set<number>();
  for (const [nodeIndex, node] of (document.nodes ?? []).entries()) {
    for (const lod of node.extensions?.MSFT_lod?.ids ?? []) {
      referencedLodNodes.add(checkedNodeIndex(document, lod, `glTF node ${nodeIndex} MSFT_lod`));
    }
  }
  const sceneIndex = document.scene ?? 0;
  const roots = document.scenes?.[sceneIndex]?.nodes ?? [];
  const stack: Array<{ applyOwnLod: boolean; depth: number; node: number; nodeLod: boolean }> = roots
    .filter((node) => !referencedLodNodes.has(node))
    .map((node) => ({
      applyOwnLod: true,
      depth: 1,
      node: checkedNodeIndex(document, node, `glTF scene ${sceneIndex}`),
      nodeLod: false,
    }));
  let bytes = 0;
  let work = 0;
  while (stack.length > 0) {
    const task = stack.pop()!;
    work += 1;
    if (work > MAX_GLTF_NODE_TRAVERSAL_WORK) {
      throw new Error(`glTF node traversal work exceeds ${MAX_GLTF_NODE_TRAVERSAL_WORK}`);
    }
    if (task.depth > MAX_GLTF_NODE_TRAVERSAL_DEPTH) {
      throw new Error(`glTF node traversal depth exceeds ${MAX_GLTF_NODE_TRAVERSAL_DEPTH}`);
    }
    const node = document.nodes?.[task.node];
    if (node === undefined) throw new Error(`glTF traversal reached missing node ${task.node}`);
    if (node.extensions?.KHR_node_visibility?.visible === false) continue;
    const lodIds = task.applyOwnLod ? (node.extensions?.MSFT_lod?.ids ?? []) : [];
    if (lodIds.length > 0) {
      stack.push({ applyOwnLod: false, depth: task.depth + 1, node: task.node, nodeLod: true });
      for (const lod of lodIds) {
        stack.push({
          applyOwnLod: false,
          depth: task.depth + 1,
          node: checkedNodeIndex(document, lod, `glTF node ${task.node} MSFT_lod`),
          nodeLod: true,
        });
      }
      continue;
    }
    if (node.mesh !== undefined) {
      bytes = checkedAdd(bytes, meshGeometryBytes(document, node.mesh, `glTF node ${task.node}`), "glTF geometry estimate");
    }
    for (const child of node.children ?? []) {
      if (referencedLodNodes.has(child)) continue;
      stack.push({
        applyOwnLod: !task.nodeLod,
        depth: task.depth + 1,
        node: checkedNodeIndex(document, child, `glTF node ${task.node} child`),
        nodeLod: task.nodeLod,
      });
    }
  }
  return bytes;
};

/** Computes reservations from declarations before external buffers/codecs run. */
export const estimateGltfPreparationCpu = (document: GltfDocument): GltfPreparationCpuEstimate => {
  assertGltfNodeTraversalSafe(document);
  let sourceBytes = 0;
  for (const [index, buffer] of (document.buffers ?? []).entries()) {
    const { byteLength } = buffer;
    if (!Number.isSafeInteger(byteLength) || (byteLength ?? -1) < 0) {
      throw new Error(`glTF buffer ${index} requires a non-negative safe integer byteLength for admission`);
    }
    sourceBytes = checkedAdd(sourceBytes, byteLength as number, "glTF declared buffer bytes");
  }
  let meshoptBytes = 0;
  let largestMeshoptBytes = 0;
  for (const [index, bufferView] of (document.bufferViews ?? []).entries()) {
    if (
      bufferView.extensions?.EXT_meshopt_compression === undefined
      && bufferView.extensions?.KHR_meshopt_compression === undefined
    ) continue;
    if (!Number.isSafeInteger(bufferView.byteLength) || bufferView.byteLength < 0) {
      throw new Error(`glTF meshopt bufferView ${index} has invalid byteLength ${String(bufferView.byteLength)}`);
    }
    meshoptBytes = checkedAdd(meshoptBytes, bufferView.byteLength, "glTF meshopt decoded bytes");
    largestMeshoptBytes = Math.max(largestMeshoptBytes, bufferView.byteLength);
  }
  let embeddedImageBytes = 0;
  const imageSources = new Set<string>();
  for (const [index, image] of (document.images ?? []).entries()) {
    if (image.uri?.startsWith("data:") === true) {
      const sourceKey = `uri:${image.uri}`;
      if (imageSources.has(sourceKey)) continue;
      imageSources.add(sourceKey);
      embeddedImageBytes = checkedAdd(
        embeddedImageBytes,
        dataUriDecodedByteLength(image.uri),
        "glTF embedded image bytes",
      );
      continue;
    }
    if (image.bufferView === undefined) continue;
    const bufferView = document.bufferViews?.[image.bufferView];
    if (bufferView === undefined) {
      throw new Error(`glTF image ${index} references invalid bufferView ${image.bufferView}`);
    }
    const sourceKey = `bufferView:${image.bufferView}`;
    if (imageSources.has(sourceKey)) continue;
    imageSources.add(sourceKey);
    embeddedImageBytes = checkedAdd(
      embeddedImageBytes,
      bufferView.byteLength,
      "glTF embedded image bytes",
    );
  }
  const geometry = estimateReachableGeometryBytes(document);
  return {
    assetDecode: checkedAdd(
      checkedAdd(sourceBytes, meshoptBytes, "glTF retained asset decode bytes"),
      embeddedImageBytes,
      "glTF retained asset decode bytes",
    ),
    geometry,
    // meshopt currently creates a target and then a copied ArrayBuffer; decoded
    // geometry is also conservatively charged as active preparation workspace.
    transientPeak: checkedAdd(
      checkedProduct(largestMeshoptBytes, 2, "glTF meshopt workspace"),
      geometry,
      "glTF preparation transient peak",
    ),
  };
};
