import type { DecodedImageTextureSource, DecodedTextureSource, EncodedSvgTextureSource } from "../texture/source";

export const DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS = 24;
export const AUTOMATIC_VT_MIN_LONG_EDGE = 257;
export const AUTOMATIC_VT_PAGE_SIZE = 128;
export const AUTOMATIC_VT_BORDER_TEXELS = 2;
const AUTOMATIC_VT_MIN_SOURCE_TEXELS = DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS
  * (AUTOMATIC_VT_PAGE_SIZE + AUTOMATIC_VT_BORDER_TEXELS * 2) ** 2;

export const automaticVirtualTextureEligible = (
  source: DecodedTextureSource,
): source is DecodedImageTextureSource => source.kind !== "ktx2-etc2"
  && Math.max(source.width, source.height) >= AUTOMATIC_VT_MIN_LONG_EDGE
  && source.width * source.height > AUTOMATIC_VT_MIN_SOURCE_TEXELS;

export const automaticVirtualTextureIsSvg = (
  source: DecodedTextureSource,
): source is DecodedImageTextureSource & Readonly<{ encodedSvg: EncodedSvgTextureSource }> =>
  source.kind !== "ktx2-etc2" && source.encodedSvg !== undefined;

export const automaticVirtualTextureHasPreview = (
  source: DecodedTextureSource,
): source is DecodedImageTextureSource & Readonly<{ svgPreview: NonNullable<DecodedImageTextureSource["svgPreview"]> }> =>
  source.kind !== "ktx2-etc2" && source.svgPreview !== undefined;
