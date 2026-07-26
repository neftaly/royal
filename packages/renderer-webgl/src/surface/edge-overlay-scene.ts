import type {
  EdgeMaterial,
  GltfInstancesNode,
  GltfNode,
  OutlineGltfNode,
  Scene,
} from "@royal/renderer-core";
import type { PreparedStaticGltf } from "../gltf/static-asset";
import type { CanonicalCamera } from "./camera-source-owner";
import {
  prepareCanonicalSurfaceScene,
  type CanonicalDrawSurface,
} from "./scene-lowering";

export type CanonicalEdgeSurface = Readonly<{
  asset: OutlineGltfNode["asset"];
  geometry: CanonicalDrawSurface["geometry"];
  instances?: CanonicalDrawSurface["instances"];
  model: CanonicalDrawSurface["model"];
  modelHandedness: CanonicalDrawSurface["modelHandedness"];
  node: OutlineGltfNode;
  worldBounds: CanonicalDrawSurface["worldBounds"];
}>;

export type CanonicalEdgeOccurrence = Readonly<{
  /** Exact non-zero value encoded into the mask for occurrence boundaries. */
  objectId: number;
  surfaceIndices: readonly number[];
}>;

export type CanonicalEdgeRun = Readonly<{
  material: EdgeMaterial;
  occurrences: readonly CanonicalEdgeOccurrence[];
}>;

export type CanonicalEdgeOverlayScene = Readonly<{
  runs: readonly CanonicalEdgeRun[];
  surfaces: readonly CanonicalEdgeSurface[];
}>;

const MAX_MASK_OBJECT_ID = 255;

const edgeStyleKey = (material: EdgeMaterial): string => JSON.stringify([
  material.color,
  material.widthCssPixels,
]);

/**
 * Reuses ordinary glTF lowering to preserve selected scenes, nested transforms,
 * authored instances, and primitive LOD identity without creating another
 * visual or picking resource owner.
 */
export const prepareCanonicalEdgeOverlayScene = (
  baseScene: Scene,
  nodes: readonly OutlineGltfNode[],
  preparedGltf: (
    node: GltfNode | GltfInstancesNode,
  ) => PreparedStaticGltf | undefined,
  camera: CanonicalCamera,
): CanonicalEdgeOverlayScene => {
  if (nodes.length === 0) return { runs: [], surfaces: [] };
  const syntheticNodes = nodes.map((node): GltfNode => ({
    asset: node.asset,
    kind: "gltf",
    ...(node.transform === undefined ? {} : { transform: node.transform }),
  }));
  const syntheticScene: Scene = {
    camera: baseScene.camera,
    clearColor: baseScene.clearColor,
    kind: "scene",
    nodes: syntheticNodes,
    ...(baseScene.exposureEv100 === undefined
      ? {}
      : { exposureEv100: baseScene.exposureEv100 }),
    ...(baseScene.toneMapping === undefined
      ? {}
      : { toneMapping: baseScene.toneMapping }),
  };
  const lowered = prepareCanonicalSurfaceScene(
    syntheticScene,
    preparedGltf,
    camera,
    undefined,
    undefined,
    { includeLighting: false, includePicking: false },
  );
  const nodeBySynthetic = new Map<GltfNode, OutlineGltfNode>();
  for (let index = 0; index < nodes.length; index += 1) {
    nodeBySynthetic.set(syntheticNodes[index]!, nodes[index]!);
  }
  const surfaces: CanonicalEdgeSurface[] = [];
  const indicesByNode = new Map<OutlineGltfNode, number[]>();
  for (const source of lowered.surfaces) {
    if (source.node.kind !== "gltf") continue;
    const node = nodeBySynthetic.get(source.node);
    if (node === undefined) continue;
    const surfaceIndex = surfaces.length;
    surfaces.push({
      asset: node.asset,
      geometry: source.geometry,
      ...(source.instances === undefined ? {} : { instances: source.instances }),
      model: source.model,
      modelHandedness: source.modelHandedness,
      node,
      worldBounds: source.worldBounds,
    });
    const indices = indicesByNode.get(node);
    if (indices === undefined) indicesByNode.set(node, [surfaceIndex]);
    else indices.push(surfaceIndex);
  }

  const runs: CanonicalEdgeRun[] = [];
  let activeKey = "";
  let activeMaterial: EdgeMaterial | undefined;
  let activeOccurrences: CanonicalEdgeOccurrence[] = [];
  const flush = (): void => {
    if (activeMaterial === undefined || activeOccurrences.length === 0) return;
    runs.push({ material: activeMaterial, occurrences: activeOccurrences });
    activeOccurrences = [];
  };
  for (const node of nodes) {
    const surfaceIndices = indicesByNode.get(node);
    if (surfaceIndices === undefined || surfaceIndices.length === 0) continue;
    const key = edgeStyleKey(node.material);
    if (
      activeMaterial === undefined
      || key !== activeKey
      || activeOccurrences.length === MAX_MASK_OBJECT_ID
    ) {
      flush();
      activeKey = key;
      activeMaterial = node.material;
    }
    activeOccurrences.push({
      objectId: activeOccurrences.length + 1,
      surfaceIndices,
    });
  }
  flush();
  return { runs, surfaces };
};
