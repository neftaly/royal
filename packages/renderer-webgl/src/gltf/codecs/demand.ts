import type { GltfDocument } from "../schema";

export type GltfCodecDemand = {
  readonly basisu: boolean;
  readonly draco: boolean;
  readonly meshopt: boolean;
};

/** Codecs referenced by document payloads, independent of extension declarations. */
export const gltfCodecDemand = (document: GltfDocument): GltfCodecDemand => ({
  basisu: (document.textures ?? []).some((texture) =>
    texture.extensions?.KHR_texture_basisu !== undefined),
  draco: (document.meshes ?? []).some((mesh) =>
    (mesh.primitives ?? []).some((primitive) =>
      primitive.extensions?.KHR_draco_mesh_compression !== undefined)),
  meshopt:
    (document.bufferViews ?? []).some((bufferView) =>
      bufferView.extensions?.EXT_meshopt_compression !== undefined)
    || (document.buffers ?? []).some((buffer) =>
      buffer.extensions?.EXT_meshopt_compression !== undefined),
});
