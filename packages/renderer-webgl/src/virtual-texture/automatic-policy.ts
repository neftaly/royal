import type { DecodedImageTextureSource, DecodedTextureSource, TexturePreviewSource } from "../texture/source";

export const DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS = 24;
export const AUTOMATIC_VT_MIN_LONG_EDGE = 257;
export const AUTOMATIC_VT_PAGE_SIZE = 128;
export const AUTOMATIC_VT_BORDER_TEXELS = 2;
const AUTOMATIC_VT_MIN_SOURCE_TEXELS = DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS
  * (AUTOMATIC_VT_PAGE_SIZE + AUTOMATIC_VT_BORDER_TEXELS * 2) ** 2;

export const automaticVirtualTextureEligible = (
  source: DecodedTextureSource,
): source is DecodedImageTextureSource => source.kind === undefined
  && Math.max(source.width, source.height) >= AUTOMATIC_VT_MIN_LONG_EDGE
  && source.width * source.height > AUTOMATIC_VT_MIN_SOURCE_TEXELS;

export const automaticVirtualTextureHasPreview = (
  source: DecodedTextureSource,
): source is DecodedTextureSource & Readonly<{ preview: TexturePreviewSource }> =>
  source.kind !== undefined && source.preview !== undefined;

export const texturePreviewReady = (preview: TexturePreviewSource): boolean =>
  preview.raster !== undefined;
