import type { GltfAssetBounds } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import {
  emptyWorldBounds,
  includeTransformedBounds,
} from "../surface/surface-visibility";

type StaticBoundsPrimitive = Readonly<{
  geometry: Pick<CanonicalTriangleGeometry, "bounds">;
  instanceBatch?: Readonly<{ localModels: Float32Array }>;
  localModel: Mat4;
}>;

/** Computes one selected glTF scene bound without allocating per primitive or instance. */
export const staticGltfBounds = (
  primitives: readonly StaticBoundsPrimitive[],
): GltfAssetBounds => {
  if (primitives.length === 0) {
    throw new RangeError("Royal cannot compute glTF bounds without a renderable primitive");
  }
  const result = emptyWorldBounds();
  for (const primitive of primitives) {
    const localModels = primitive.instanceBatch?.localModels;
    if (localModels === undefined) {
      includeTransformedBounds(result, primitive.geometry.bounds, primitive.localModel);
      continue;
    }
    for (let offset = 0; offset < localModels.length; offset += 16) {
      includeTransformedBounds(result, primitive.geometry.bounds, localModels, offset);
    }
  }
  return result;
};
