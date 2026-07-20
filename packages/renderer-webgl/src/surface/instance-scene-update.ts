import type { GltfInstanceTransforms } from "@royal/renderer-core";
import {
  createGltfInstanceUpdateWorkspace,
  updateGltfInstanceBatchRangeInto,
  type GltfInstanceUpdateWorkspace,
} from "../gltf/instance-transforms";
import type { WorldBounds, MutableWorldBounds } from "./surface-visibility";
import { includeTransformedBounds, includeWorldBounds } from "./surface-visibility";
import type { CanonicalSurfaceScene } from "./scene-lowering";

export type CanonicalInstanceSceneUpdateWorkspace = Readonly<{
  batches: Set<Float32Array>;
  bounds: Set<WorldBounds>;
  matrices: GltfInstanceUpdateWorkspace;
}>;

export const createCanonicalInstanceSceneUpdateWorkspace = (
): CanonicalInstanceSceneUpdateWorkspace => ({
  batches: new Set(),
  bounds: new Set(),
  matrices: createGltfInstanceUpdateWorkspace(),
});

const resetBounds = (bounds: WorldBounds): MutableWorldBounds => {
  const mutable = bounds as MutableWorldBounds;
  mutable.min[0] = Infinity;
  mutable.min[1] = Infinity;
  mutable.min[2] = Infinity;
  mutable.max[0] = -Infinity;
  mutable.max[1] = -Infinity;
  mutable.max[2] = -Infinity;
  return mutable;
};

/** Updates lowering-owned pose caches for one source while its scale cohorts stay stable. */
export const updateCanonicalGltfInstanceSource = (
  scene: CanonicalSurfaceScene,
  source: GltfInstanceTransforms,
  startIndex: number,
  count: number,
  workspace: CanonicalInstanceSceneUpdateWorkspace,
): boolean => {
  const batches = workspace.batches;
  const bounds = workspace.bounds;
  batches.clear();
  bounds.clear();
  let updated = false;
  for (const surface of scene.surfaces) {
    const instances = surface.instances;
    if (instances?.source !== source) continue;
    if (
      instances.innerCount === undefined
      || instances.innerModels === undefined
      || instances.sourceIndices === undefined
      || instances.sourceOrdered === undefined
    ) throw new Error("Royal explicit instance update metadata is incomplete");
    if (!batches.has(instances.localModels)) {
      batches.add(instances.localModels);
      updateGltfInstanceBatchRangeInto(
        {
          innerCount: instances.innerCount,
          ...(instances.innerIndices === undefined
            ? {}
            : { innerIndices: instances.innerIndices }),
          innerModels: instances.innerModels,
          localModels: instances.localModels,
          sourceIndices: instances.sourceIndices,
          sourceOrdered: instances.sourceOrdered,
        },
        source,
        startIndex,
        count,
        workspace.matrices,
      );
    }
    instances.revision = source.poseVersion;
    if (instances.sourceOrdered) {
      instances.updateStart = startIndex * instances.innerCount;
      instances.updateCount = count * instances.innerCount;
    } else {
      let first = -1;
      let last = -1;
      const endIndex = startIndex + count;
      for (let index = 0; index < instances.sourceIndices.length; index += 1) {
        const sourceIndex = instances.sourceIndices[index]!;
        if (sourceIndex < startIndex || sourceIndex >= endIndex) continue;
        if (first < 0) first = index;
        last = index;
      }
      instances.updateStart = Math.max(0, first);
      instances.updateCount = last < first ? 0 : last - first + 1;
    }
    if (!bounds.has(surface.worldBounds)) {
      bounds.add(surface.worldBounds);
      const worldBounds = resetBounds(surface.worldBounds);
      for (let offset = 0; offset < instances.localModels.length; offset += 16) {
        includeTransformedBounds(
          worldBounds,
          surface.geometry.bounds,
          instances.localModels,
          offset,
        );
      }
    }
    updated = true;
  }
  batches.clear();
  bounds.clear();
  return updated;
};

/** Rebuilds shared LOD selection bounds after instance-owned world bounds move. */
export const refreshCanonicalInstanceLodBounds = (
  scene: CanonicalSurfaceScene,
): void => {
  for (const group of scene.lodGroups) resetBounds(group.selectionBounds);
  for (const surface of scene.surfaces) {
    for (const membership of surface.lods ?? []) {
      includeWorldBounds(
        membership.selectionBounds as MutableWorldBounds,
        surface.worldBounds,
      );
    }
  }
};
