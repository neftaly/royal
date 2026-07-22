import {
  array,
  fail,
  index,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

/** One glTF document scene available for exact selection. */
export type GltfDocumentScene = Readonly<{
  /** Zero-based value accepted by `gltf({ sceneIndex })`. */
  index: number;
  /** Authored display name when the document provides one. */
  name?: string;
}>;

/** Reads the complete document scene inventory without preparing unselected content. */
export const staticDocumentScenes = (
  scenes: readonly unknown[],
  label: string,
): readonly GltfDocumentScene[] => scenes.map((value, sceneIndex) => {
  const path = `scenes[${sceneIndex}]`;
  const scene = object(value, label, path);
  if (scene.name !== undefined && typeof scene.name !== "string") {
    return fail(label, `${path}.name`, "must be a string");
  }
  return {
    index: sceneIndex,
    ...(scene.name === undefined ? {} : { name: scene.name }),
  };
});

/** Reads one validated MSFT_lod edge list shared by inventory and lowering. */
export const staticNodeLodIds = (
  node: JsonObject,
  nodes: readonly unknown[],
  label: string,
  path: string,
): readonly number[] => {
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

/** Resolves an explicit zero-based scene selection or the document default. */
export const selectedStaticSceneIndex = (
  document: JsonObject,
  scenes: readonly unknown[],
  label: string,
  sceneIndex?: number,
): number => index(
  sceneIndex ?? document.scene ?? 0,
  scenes,
  label,
  sceneIndex === undefined ? "scene" : "sceneIndex",
);

/** Collects nodes reachable through the selected scene and its authored LOD graph. */
export const selectedStaticNodeIndices = (
  document: JsonObject,
  label: string,
  selectedSceneIndex?: number,
): readonly number[] => {
  const nodes = array(document.nodes, label, "nodes");
  const scenes = array(document.scenes, label, "scenes");
  const sceneIndex = selectedStaticSceneIndex(document, scenes, label, selectedSceneIndex);
  const scene = object(scenes[sceneIndex], label, `scenes[${sceneIndex}]`);
  const roots = array(scene.nodes, label, `scenes[${sceneIndex}].nodes`);
  const selected: number[] = [];
  const state = new Uint8Array(nodes.length);
  const visit = (nodeIndex: number): void => {
    if (state[nodeIndex] === 1) fail(label, `nodes[${nodeIndex}]`, "is part of a child/MSFT_lod cycle");
    if (state[nodeIndex] === 2) return;
    state[nodeIndex] = 1;
    selected.push(nodeIndex);
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    const children = optionalArray(node.children, label, `${path}.children`);
    for (let child = 0; child < children.length; child += 1) {
      visit(index(children[child], nodes, label, `${path}.children[${child}]`));
    }
    for (const lodNode of staticNodeLodIds(node, nodes, label, path)) visit(lodNode);
    state[nodeIndex] = 2;
  };
  for (let root = 0; root < roots.length; root += 1) {
    visit(index(roots[root], nodes, label, `scenes[${sceneIndex}].nodes[${root}]`));
  }
  return selected;
};

/** Collects only mesh definitions reachable through the selected scene and its LOD graph. */
export const selectedStaticMeshIndices = (
  document: JsonObject,
  label: string,
  selectedSceneIndex?: number,
): readonly number[] => {
  const meshes = array(document.meshes, label, "meshes");
  const nodes = array(document.nodes, label, "nodes");
  const selected = new Set<number>();
  for (const nodeIndex of selectedStaticNodeIndices(document, label, selectedSceneIndex)) {
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    if (node.mesh !== undefined) {
      selected.add(index(node.mesh, meshes, label, `${path}.mesh`));
    }
  }
  return [...selected];
};
