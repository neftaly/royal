import type { TextureColorSpace } from "@royal/renderer-core";
import { throwIfAborted } from "../resource-io";
import {
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  type LoadedTextureSource,
} from "../texture/sources";
import { createVirtualTextureCanvas, virtualTextureCanvasContext } from "./canvas";
import { rasterizeGeneratedVirtualTexturePage } from "./page-rasterizer";
import type { VirtualTexturePageSource } from "./runtime";
import {
  generatedVirtualTextureManifest,
  type VirtualTextureManifestModel,
  type VirtualTextureManifestParseResult,
  type VirtualTexturePageId,
} from "./model";

const GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE = 256;
const GENERATED_RASTER_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP = 64;
const GENERATED_VIRTUAL_TEXTURE_MANIFEST_URI_PREFIX = "royal-generated-vt:";

export const GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION = GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE + 1;

export type RasterVirtualTextureSource = {
  canvasSource?: CanvasImageSource;
  readonly colorSpace?: TextureColorSpace;
  readonly decodedBytes: number;
  readonly height: number;
  readonly label: string;
  readonly source: LoadedTextureSource;
  readonly width: number;
};

export type AutomaticVirtualTextureSource = VirtualTexturePageSource & {
  readonly manifest: VirtualTextureManifestParseResult & { readonly manifest: VirtualTextureManifestModel };
  readonly retainedSourceBytes: number;
};

export type AutomaticVirtualTextureSourceDefinition = {
  readonly loadPage: VirtualTexturePageSource["loadPage"];
  readonly manifest: VirtualTextureManifestModel;
  readonly retainedSourceBytes: number;
};

const generatedManifestUri = (key: string): string =>
  `${GENERATED_VIRTUAL_TEXTURE_MANIFEST_URI_PREFIX}${encodeURIComponent(key)}`;

export const automaticVirtualTextureSource = (
  textureKey: string,
  definition: AutomaticVirtualTextureSourceDefinition,
): AutomaticVirtualTextureSource => ({
  loadPage: definition.loadPage,
  manifest: { diagnostics: [], manifest: definition.manifest },
  manifestUri: generatedManifestUri(textureKey),
  retainedSourceBytes: definition.retainedSourceBytes,
});

export const generatedRasterVirtualTextureManifest = (
  source: RasterVirtualTextureSource,
): VirtualTextureManifestModel => generatedVirtualTextureManifest({
  ...(source.colorSpace === undefined ? {} : { colorSpace: source.colorSpace }),
  height: source.height,
  pageSize: GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE,
  physicalSlotCap: GENERATED_RASTER_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP,
  width: source.width,
});

const canvasSource = (source: RasterVirtualTextureSource): CanvasImageSource => {
  if (source.canvasSource !== undefined) return source.canvasSource;
  if (isDecodedCompressedTexture(source.source)) {
    throw new Error(`Compressed source ${source.label} cannot be cropped through Canvas 2D`);
  }
  if (!isDecodedRgbaTexture(source.source)) {
    source.canvasSource = source.source;
    return source.canvasSource;
  }

  const canvas = createVirtualTextureCanvas(source.width, source.height, source.label);
  const context = virtualTextureCanvasContext(canvas, source.label);
  if (typeof globalThis.ImageData !== "function") {
    throw new Error(`ImageData is unavailable for ${source.label}`);
  }
  context.putImageData(new globalThis.ImageData(
    new Uint8ClampedArray(source.source.data),
    source.source.width,
    source.source.height,
  ), 0, 0);
  source.canvasSource = canvas;
  return source.canvasSource;
};

export const generatedRasterVirtualTexturePageImage = (
  source: RasterVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): TexImageSource => rasterizeGeneratedVirtualTexturePage({
  height: source.height,
  image: canvasSource(source),
  label: source.label,
  width: source.width,
}, manifest, page);

export const automaticRasterVirtualTextureSource = (
  textureKey: string,
  source: RasterVirtualTextureSource,
): AutomaticVirtualTextureSource => automaticVirtualTextureSource(textureKey, {
  loadPage: (activeManifest, page, signal) => {
    throwIfAborted(signal);
    return {
      kind: "page",
      promise: Promise.resolve({
        image: generatedRasterVirtualTexturePageImage(source, activeManifest, page),
        kind: "image",
      }),
    };
  },
  manifest: generatedRasterVirtualTextureManifest(source),
  retainedSourceBytes: source.decodedBytes,
});
