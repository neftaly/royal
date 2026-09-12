import { nativeBlockSize, nativeBlockBytes, type NativeTextureFormat } from "../texture/native-storage";
import type { VirtualTextureManifest } from "./manifest";

const PAGE_FORMATS = {
  "ktx2-etc2": "etc2-rgba",
  "ktx2-astc-6x6": "astc-6x6",
  "ktx2-astc-8x8": "astc-8x8",
  "ktx2-bc1": "bc1-rgba",
  "ktx2-bc3": "bc3-rgba",
  "ktx2-bc7": "bc7-rgba",
} as const satisfies Record<string, NativeTextureFormat>;
export type VirtualTexturePageEncoding = "image" | keyof typeof PAGE_FORMATS;
export const isVirtualTexturePageEncoding = (value: unknown): value is VirtualTexturePageEncoding =>
  typeof value === "string" && (value === "image" || Object.hasOwn(PAGE_FORMATS, value));
export const virtualTexturePageFormat = (encoding: VirtualTexturePageEncoding): NativeTextureFormat | undefined =>
  encoding === "image" ? undefined : PAGE_FORMATS[encoding];

export const virtualTexturePageBytes = (manifest: VirtualTextureManifest): number => {
  const extent = manifest.pageSize + manifest.borderTexels * 2;
  const format = virtualTexturePageFormat(manifest.pageEncoding);
  return format === undefined ? extent ** 2 * 4
    : Math.ceil(extent / nativeBlockSize(format)) ** 2 * nativeBlockBytes(format);
};
