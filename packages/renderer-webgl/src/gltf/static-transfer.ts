import type { PreparedStaticGltf } from "./static-asset";

const retainViewBuffer = (
  buffers: Set<ArrayBuffer>,
  view: ArrayBufferView<ArrayBufferLike> | undefined,
): void => {
  if (view?.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
};

/**
 * Enumerates the exact transferable storage owned by one prepared static asset.
 *
 * This is deliberately structural rather than reflective: adding a new typed
 * storage field to the canonical artifact must make transfer ownership an
 * explicit review decision.
 */
export const preparedStaticGltfTransferBuffers = (
  prepared: PreparedStaticGltf,
): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();
  for (const primitive of prepared.primitives) {
    if (primitive.deferredGeometryKey !== undefined) {
      retainViewBuffer(buffers, primitive.instanceBatch?.localModels);
      continue;
    }
    const geometry = primitive.geometry;
    retainViewBuffer(buffers, geometry.indices);
    retainViewBuffer(buffers, geometry.colors);
    retainViewBuffer(buffers, geometry.normals);
    retainViewBuffer(buffers, geometry.positions);
    retainViewBuffer(buffers, geometry.tangents);
    retainViewBuffer(buffers, geometry.textureCoordinates0);
    retainViewBuffer(buffers, geometry.textureCoordinates1);
    retainViewBuffer(buffers, primitive.instanceBatch?.localModels);
  }
  for (const texture of prepared.textureAssets) {
    if (texture.kind === "embedded-asset") retainViewBuffer(buffers, texture.bytes);
    if (texture.fallback?.kind === "embedded-asset") {
      retainViewBuffer(buffers, texture.fallback.bytes);
    }
  }
  return [...buffers];
};
