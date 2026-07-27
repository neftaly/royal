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
  /** Matrix used only to identify the rendered base occurrence and its active LOD. */
  sourceModel: CanonicalDrawSurface["model"];
  /** Matrix used to present the borrowed geometry in the edge mask. */
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
  const presentationNodes = nodes.map((node): GltfNode => ({
    asset: node.asset,
    kind: "gltf",
    ...(node.transform === undefined ? {} : { transform: node.transform }),
  }));
  const explicitSourceNodes: GltfNode[] = [];
  const sourceOccurrenceByNode = new Map<GltfNode, number>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.sourceTransform === undefined) continue;
    const sourceNode: GltfNode = {
      asset: node.asset,
      kind: "gltf",
      transform: node.sourceTransform,
    };
    explicitSourceNodes.push(sourceNode);
    sourceOccurrenceByNode.set(sourceNode, index);
  }
  const syntheticScene: Scene = {
    camera: baseScene.camera,
    clearColor: baseScene.clearColor,
    kind: "scene",
    nodes: [...presentationNodes, ...explicitSourceNodes],
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
  const presentationOccurrenceByNode = new Map<GltfNode, number>();
  for (let index = 0; index < nodes.length; index += 1) {
    presentationOccurrenceByNode.set(presentationNodes[index]!, index);
  }
  const surfaces: CanonicalEdgeSurface[] = [];
  const presentationSurfacesByOccurrence = Array.from(
    { length: nodes.length },
    (): CanonicalDrawSurface[] => [],
  );
  const sourceSurfacesByOccurrence = Array.from(
    { length: nodes.length },
    (): CanonicalDrawSurface[] => [],
  );
  for (const surface of lowered.surfaces) {
    if (surface.node.kind !== "gltf") continue;
    const presentationOccurrence = presentationOccurrenceByNode.get(surface.node);
    if (presentationOccurrence !== undefined) {
      presentationSurfacesByOccurrence[presentationOccurrence]!.push(surface);
      continue;
    }
    const sourceOccurrence = sourceOccurrenceByNode.get(surface.node);
    if (sourceOccurrence !== undefined) {
      sourceSurfacesByOccurrence[sourceOccurrence]!.push(surface);
    }
  }
  const indicesByOccurrence = Array.from(
    { length: nodes.length },
    (): number[] => [],
  );
  for (let occurrence = 0; occurrence < nodes.length; occurrence += 1) {
    const node = nodes[occurrence]!;
    const presentationSurfaces = presentationSurfacesByOccurrence[occurrence]!;
    const explicitSourceSurfaces = sourceSurfacesByOccurrence[occurrence]!;
    const sourceSurfaces = node.sourceTransform === undefined
      ? presentationSurfaces
      : explicitSourceSurfaces;
    if (presentationSurfaces.length !== sourceSurfaces.length) {
      throw new Error("Royal outline glTF source and presentation lowering diverged");
    }
    for (let index = 0; index < presentationSurfaces.length; index += 1) {
      const presentation = presentationSurfaces[index]!;
      const source = sourceSurfaces[index]!;
      if (
        presentation.geometry.key !== source.geometry.key
        || presentation.instances?.key !== source.instances?.key
      ) {
        throw new Error("Royal outline glTF source and presentation geometry diverged");
      }
      const surfaceIndex = surfaces.length;
      surfaces.push({
        asset: node.asset,
        geometry: presentation.geometry,
        ...(presentation.instances === undefined
          ? {}
          : { instances: presentation.instances }),
        model: presentation.model,
        modelHandedness: presentation.modelHandedness,
        node,
        sourceModel: source.model,
        worldBounds: presentation.worldBounds,
      });
      indicesByOccurrence[occurrence]!.push(surfaceIndex);
    }
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
  for (let occurrence = 0; occurrence < nodes.length; occurrence += 1) {
    const node = nodes[occurrence]!;
    const surfaceIndices = indicesByOccurrence[occurrence]!;
    if (surfaceIndices.length === 0) continue;
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
