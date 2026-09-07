import type { GltfAssetRef } from "@royal/renderer-core";
import { mat4ValuesEqual } from "../../../packages/renderer-webgl/src/math/mat4";
import type { CanonicalDrawSurface } from "../../../packages/renderer-webgl/src/surface/scene-lowering";
import type { CanonicalEdgeSurface } from "../../../packages/renderer-webgl/src/surface/edge-overlay-scene";

// Original full-scan matching semantics, retained only as a differential oracle.
const sameGltfAssetIdentity = (
  left: GltfAssetRef,
  right: GltfAssetRef,
): boolean => left.src === right.src
  && left.sceneIndex === right.sceneIndex
  && left.version === right.version;

/** @internal */
export type BorrowedSurfaceSourceKind = "automatic-member" | "whole-surface";

/**
 * @internal
 * Identifies a resident-world surface that has the exact geometry provenance and
 * source placement requested by a non-picking edge presentation. Coincident
 * mounted occurrences are deliberately interchangeable here: application and
 * picking identity never enter this renderer-owned equivalence relation.
 */
export const matchingBorrowedSurfaceSourceKind = (
  surface: CanonicalDrawSurface,
  requested: CanonicalEdgeSurface,
): BorrowedSurfaceSourceKind | null => {
  const instances = surface.instances;
  if (
    requested.instances === undefined
    && instances?.automaticSourceOccurrences !== undefined
  ) {
    const sources = instances.automaticSourceOccurrences;
    if (
      sources.length !== instances.count
      || instances.localModels.length !== instances.count * 16
    ) {
      throw new Error("Royal automatic instance sources diverged from their transform cohort");
    }
    for (let instance = 0; instance < sources.length; instance += 1) {
      const source = sources[instance]!;
      if (
        source.geometryKey !== requested.geometry.key
        || !sameGltfAssetIdentity(source.asset, requested.asset)
      ) continue;
      const offset = instance * 16;
      let transformMatches = true;
      for (let component = 0; component < 16; component += 1) {
        if (!Object.is(
          instances.localModels[offset + component],
          Math.fround(requested.sourceModel[component]!),
        )) {
          transformMatches = false;
          break;
        }
      }
      if (transformMatches) return "automatic-member";
    }
  }
  if (
    surface.node.kind !== "gltf"
    || surface.geometry.key !== requested.geometry.key
    || surface.instances?.key !== requested.instances?.key
    || !mat4ValuesEqual(surface.model, requested.sourceModel)
    || !sameGltfAssetIdentity(surface.node.asset, requested.asset)
  ) return null;
  if (surface.gltfOccurrence === undefined) {
    throw new Error("Royal rendered glTF surface is missing mounted occurrence identity");
  }
  return "whole-surface";
};
