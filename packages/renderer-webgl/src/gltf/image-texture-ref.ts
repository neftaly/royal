import type { TextureColorSpace, TextureContentKey, TextureSampler } from "@royal/renderer-core";
import type { TextureAssetUploadRef } from "../webgl/materials";

export type GltfImageTextureRefInput = Readonly<{
  colorSpace: TextureColorSpace;
  contentKey?: TextureContentKey;
  sampler?: TextureSampler;
  sourceUri?: string;
  textureUri: string;
}>;

/** One cache/upload identity shared by material preparation and image publication. */
export const gltfImageTextureRef = (
  image: GltfImageTextureRefInput,
): TextureAssetUploadRef => ({
  colorSpace: image.colorSpace,
  ...(image.contentKey === undefined ? {} : { contentKey: image.contentKey }),
  kind: "asset",
  ...(image.sourceUri === undefined ? { preparedOnly: true } : {}),
  // Embedded recipes and external URIs can both reconstruct decoded sources.
  releaseSourceAfterUpload: true,
  ...(image.sampler === undefined ? {} : { sampler: image.sampler }),
  src: image.sourceUri ?? image.textureUri,
});
