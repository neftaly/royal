import {
  parseVirtualTextureManifest,
  virtualTexturePageUri,
  type VirtualTextureManifest,
  type VirtualTexturePageId,
} from "./manifest";
import { parseKtx2Etc2Page } from "./ktx2-etc2";
import { decodeBrowserImageElement } from "../texture/browser-image-element";

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

/** Cold page production only; residency, publication, and scheduling stay runtime-owned. */
export type VirtualTexturePageSource = Readonly<{
  close?(): void;
  manifest: VirtualTextureManifest;
  read(
    page: VirtualTexturePageId,
    signal: AbortSignal,
  ): Promise<DecodedVirtualTexturePage | undefined>;
}>;

const absoluteUri = (uri: string): string => new URL(
  uri,
  typeof document === "undefined" ? "http://localhost/" : document.baseURI,
).href;

const decodeWithImageElement = async (
  blob: Blob,
  storedPageSize: number,
  signal: AbortSignal,
): Promise<DecodedVirtualTexturePage> => {
  const decoded = await decodeBrowserImageElement(blob, signal);
  try {
    if (decoded.width === storedPageSize && decoded.height === storedPageSize) {
      return {
        close: decoded.close,
        kind: "image",
        source: decoded.source,
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = storedPageSize;
    canvas.height = storedPageSize;
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("Royal VT could not allocate a raster page canvas");
    context.clearRect(0, 0, storedPageSize, storedPageSize);
    context.drawImage(decoded.source, 0, 0, storedPageSize, storedPageSize);
    decoded.close();
    return {
      close: () => {
        canvas.width = 1;
        canvas.height = 1;
      },
      kind: "image",
      source: canvas,
    };
  } catch (error) {
    decoded.close();
    throw error;
  }
};

const decodeImagePage = async (
  blob: Blob,
  storedPageSize: number,
  signal: AbortSignal,
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
    return decodeWithImageElement(blob, storedPageSize, signal);
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
  return decodeImagePage(await response.blob(), storedPageSize, signal);
};

/** Opens an authored manifest as the same page-source contract used by generated VT. */
export const openAuthoredVirtualTexturePageSource = async (
  manifestUri: string,
  signal: AbortSignal,
): Promise<VirtualTexturePageSource> => {
  const uri = absoluteUri(manifestUri);
  const response = await fetch(uri, { signal });
  if (!response.ok) {
    throw new Error(`Royal VT manifest request failed with HTTP ${response.status}`);
  }
  const manifest = parseVirtualTextureManifest(await response.json());
  return {
    manifest,
    read: (page, pageSignal) => readVirtualTexturePage(uri, manifest, page, pageSignal),
  };
};
