import type { LoadedTextureSource } from "../texture/sources";
import {
  generatedVirtualTextureManifest,
  type VirtualTextureManifestModel,
} from "./model";

const AUTOMATIC_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION = 16_384;
const AUTOMATIC_SVG_VIRTUAL_TEXTURE_PAGE_SIZE = 256;
const AUTOMATIC_SVG_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP = 64;
const loadedSvgTextureSources = new WeakMap<object, SvgVirtualTextureSource>();

export type SvgVirtualTextureSource = {
  readonly height: number;
  readonly image: HTMLImageElement;
  readonly label: string;
  readonly text: string;
  readonly width: number;
};

export const registerSvgVirtualTextureSource = (
  image: HTMLImageElement,
  source: SvgVirtualTextureSource,
): void => {
  loadedSvgTextureSources.set(image, source);
};

/** True for sources decoded through Royal's ordinary SVG image path. */
export const isLoadedSvgTextureSource = (source: LoadedTextureSource): boolean =>
  typeof source === "object" && source !== null && loadedSvgTextureSources.has(source);

export const svgVirtualTextureSourceForImage = (
  source: LoadedTextureSource,
): SvgVirtualTextureSource | undefined => typeof source === "object" && source !== null
  ? loadedSvgTextureSources.get(source)
  : undefined;

export const automaticSvgVirtualTextureManifest = (
  source: Pick<SvgVirtualTextureSource, "height" | "width">,
): VirtualTextureManifestModel => {
  if (
    !Number.isFinite(source.width)
    || source.width <= 0
    || !Number.isFinite(source.height)
    || source.height <= 0
  ) {
    throw new RangeError("SVG virtual texture dimensions must be finite and greater than zero");
  }
  const largestSourceDimension = Math.max(source.width, source.height);
  const logicalDimension = (dimension: number): number => Math.max(1, Math.ceil(
    AUTOMATIC_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION * (dimension / largestSourceDimension),
  ));
  return generatedVirtualTextureManifest({
    colorSpace: "srgb",
    height: logicalDimension(source.height),
    pageSize: AUTOMATIC_SVG_VIRTUAL_TEXTURE_PAGE_SIZE,
    physicalSlotCap: AUTOMATIC_SVG_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP,
    width: logicalDimension(source.width),
  });
};
