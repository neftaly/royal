import type { VirtualTextureManifest, VirtualTexturePageId } from "./manifest";
import { virtualTexturePageUri } from "./manifest";
import { parseKtx2Etc2Page } from "./ktx2-etc2";

export type DecodedVirtualTexturePage = Readonly<{
  close(): void;
  kind: "image";
  source: TexImageSource;
}> | Readonly<{
  blocks: Uint8Array;
  close(): void;
  colorSpace: "linear" | "srgb";
  kind: "etc2-rgba";
}>;

const decodeWithImageElement = async (
  blob: Blob,
  storedPageSize: number,
): Promise<DecodedVirtualTexturePage> => {
  if (typeof document === "undefined") throw new Error("Royal VT SVG decode requires a document");
  const objectUri = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Royal VT browser image decode failed"));
      image.src = objectUri;
    });
    if (image.naturalWidth === storedPageSize && image.naturalHeight === storedPageSize) {
      let live = true;
      return {
        close: () => {
          if (!live) return;
          live = false;
          image.src = "";
          URL.revokeObjectURL(objectUri);
        },
        kind: "image",
        source: image,
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = storedPageSize;
    canvas.height = storedPageSize;
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("Royal VT could not allocate a raster page canvas");
    context.clearRect(0, 0, storedPageSize, storedPageSize);
    context.drawImage(image, 0, 0, storedPageSize, storedPageSize);
    image.src = "";
    URL.revokeObjectURL(objectUri);
    return {
      close: () => {
        canvas.width = 1;
        canvas.height = 1;
      },
      kind: "image",
      source: canvas,
    };
  } catch (error) {
    image.src = "";
    URL.revokeObjectURL(objectUri);
    throw error;
  }
};

const decodeImagePage = async (
  blob: Blob,
  storedPageSize: number,
): Promise<DecodedVirtualTexturePage> => {
  const options: ImageBitmapOptions = {
    colorSpaceConversion: "none",
    imageOrientation: "none",
    premultiplyAlpha: "none",
  };
  let source: ImageBitmap;
  try {
    source = await createImageBitmap(blob, options);
  } catch {
    return decodeWithImageElement(blob, storedPageSize);
  }
  if (source.width !== storedPageSize || source.height !== storedPageSize) {
    source.close();
    source = await createImageBitmap(blob, {
      ...options,
      resizeHeight: storedPageSize,
      resizeQuality: "high",
      resizeWidth: storedPageSize,
    });
  }
  if (source.width !== storedPageSize || source.height !== storedPageSize) {
    const width = source.width;
    const height = source.height;
    source.close();
    throw new Error(
      `Royal VT page decoded to ${width}x${height}; expected ${storedPageSize}x${storedPageSize}`,
    );
  }
  return { close: () => source.close(), kind: "image", source };
};

/** Browser I/O/decode seam; it owns no residency, scheduling, or GPU state. */
export const readVirtualTexturePage = async (
  manifestUri: string,
  manifest: VirtualTextureManifest,
  page: VirtualTexturePageId,
  signal: AbortSignal,
): Promise<DecodedVirtualTexturePage | undefined> => {
  const relative = virtualTexturePageUri(manifest, page);
  if (relative === undefined) return undefined;
  const response = await fetch(new URL(relative, manifestUri), { signal });
  if (!response.ok) {
    throw new Error(`Royal VT page request failed with HTTP ${response.status}`);
  }
  const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  if (manifest.pageEncoding === "ktx2-etc2") {
    const parsed = parseKtx2Etc2Page(new Uint8Array(await response.arrayBuffer()));
    if (parsed.width !== storedPageSize || parsed.height !== storedPageSize) {
      throw new RangeError("Royal VT KTX2 page dimensions do not match the manifest");
    }
    return {
      blocks: parsed.blocks,
      close: () => undefined,
      colorSpace: parsed.colorSpace,
      kind: "etc2-rgba",
    };
  }
  return decodeImagePage(await response.blob(), storedPageSize);
};
