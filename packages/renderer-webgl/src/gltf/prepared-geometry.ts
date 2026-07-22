import type { PreparedStaticGltf } from "./static-asset";

/** Borrowed indexed triangle channels from one prepared glTF mesh identity. */
export type BorrowedGltfGeometry = Readonly<{
  readonly indices: ArrayLike<number>;
  readonly positions: ArrayLike<number>;
}>;

/**
 * One highest-detail selected-scene geometry batch in glTF asset space.
 * `transforms` contains `transformCount` packed column-major 4x4 matrices.
 */
export type BorrowedGltfGeometryBatch = Readonly<{
  readonly geometry: BorrowedGltfGeometry;
  readonly transformCount: number;
  readonly transforms: ArrayLike<number>;
}>;

/** Receives a borrowed batch which is valid only for the callback invocation. */
export type GltfAssetGeometryVisitor = (batch: BorrowedGltfGeometryBatch) => void;

const isHighestDetailGeometry = (
  lods: PreparedStaticGltf["primitives"][number]["lods"],
): boolean => lods?.every((lod) => lod.level === 0) ?? true;

/** Pure cold traversal over the canonical artifact; it copies no geometry or transforms. */
export const visitPreparedGltfGeometry = (
  prepared: PreparedStaticGltf,
  visitor: GltfAssetGeometryVisitor,
): number => {
  let batchCount = 0;
  for (const primitive of prepared.primitives) {
    // Multiple authored LOD levels occupy the same physical space. Spatial
    // consumers receive only the highest-detail authority, never the union.
    if (!isHighestDetailGeometry(primitive.lods)) continue;
    const transforms = primitive.instanceBatch?.localModels ?? primitive.localModel;
    visitor({
      geometry: primitive.geometry,
      transformCount: transforms.length / 16,
      transforms,
    });
    batchCount += 1;
  }
  return batchCount;
};
