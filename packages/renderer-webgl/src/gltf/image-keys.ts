import { resolveResourceUri } from "../resource-io";
import type { GltfImage } from "./schema";

export type GltfImageKind = "basisu" | "image" | "svg";

export const gltfImageLoadKey = (
  assetKey: string,
  src: string,
  imageIndex: number | undefined,
  image: GltfImage,
  kind: GltfImageKind,
): string | undefined => {
  if (image.uri !== undefined) {
    const url = resolveResourceUri(src, image.uri);
    if (kind === "basisu") return `${assetKey}:basisu-uri:${url}`;
    if (kind === "svg") return `${assetKey}:svg-uri:${url}`;
    return url;
  }
  if (image.bufferView !== undefined) {
    const prefix = kind === "basisu"
      ? "basisu-buffer-view"
      : kind === "svg"
        ? "svg-buffer-view"
        : "image-buffer-view";
    return `${assetKey}:${prefix}:${image.bufferView}:image-index:${imageIndex ?? ""}:${image.mimeType ?? ""}`;
  }

  return undefined;
};
