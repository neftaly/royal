import type { DecodedTextureSource, TextureSourceRef } from "./asset-owner";

const diagnosticLabel = (asset: TextureSourceRef): string => {
  if (asset.kind === "embedded-asset") return asset.label;
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `texture ${JSON.stringify(source)}`;
};

/** Cold browser IO/decode adapter for the source-format-independent texture owner. */
export const decodeTextureWithBrowser = async (
  asset: TextureSourceRef,
  signal: AbortSignal,
): Promise<DecodedTextureSource> => {
  const blob = asset.kind === "embedded-asset"
    ? new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.mimeType })
    : await (async () => {
      const response = await fetch(asset.src, { signal });
      if (!response.ok) {
        throw new Error(`${diagnosticLabel(asset)} fetch failed with HTTP ${response.status}`);
      }
      return response.blob();
    })();
  if (signal.aborted) throw new DOMException("Texture decode was aborted", "AbortError");
  if (typeof globalThis.createImageBitmap !== "function") {
    throw new Error(`${diagnosticLabel(asset)} requires browser image decoding support`);
  }
  const bitmap = await globalThis.createImageBitmap(blob, {
    colorSpaceConversion: "none",
    imageOrientation: "none",
    premultiplyAlpha: "none",
  });
  if (signal.aborted) {
    bitmap.close();
    throw new DOMException("Texture decode was aborted", "AbortError");
  }
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close();
    throw new Error(`${diagnosticLabel(asset)} decoded to an empty image`);
  }
  return {
    close: () => bitmap.close(),
    height: bitmap.height,
    source: bitmap,
    width: bitmap.width,
  };
};
