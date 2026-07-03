import { resolveResourceUri } from "./io";
import type { GltfImage } from "./schema";

export type GltfImageKind = "basisu" | "image";

export const gltfImageLoadKey = (
  assetKey: string,
  src: string,
  imageIndex: number | undefined,
  image: GltfImage,
  kind: GltfImageKind,
): string | undefined => {
  if (image.uri !== undefined) {
    const url = resolveResourceUri(src, image.uri);
    return kind === "basisu" ? `${assetKey}:basisu-uri:${url}` : url;
  }
  if (image.bufferView !== undefined) {
    const prefix = kind === "basisu" ? "basisu-buffer-view" : "image-buffer-view";
    return `${assetKey}:${prefix}:${image.bufferView}:image-index:${imageIndex ?? ""}:${image.mimeType ?? ""}`;
  }

  return undefined;
};
