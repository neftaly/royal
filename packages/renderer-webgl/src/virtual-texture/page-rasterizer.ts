import { createVirtualTextureCanvas, virtualTextureCanvasContext } from "./canvas";
import { validateVirtualTexturePageImage } from "./page-image";
import {
  virtualTextureMipTexelSize,
  virtualTexturePageKey,
  virtualTextureStoredPageSize,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./model";

export interface GeneratedVirtualTextureRasterSource {
  readonly height: number;
  readonly image: CanvasImageSource;
  readonly label: string;
  readonly width: number;
}

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Produces the canonical periodic crop for a generated raster VT.
 * The repeated full-mip pattern supplies internal gutters, outer wrap gutters,
 * and deterministic padding after partial NPOT edge pages in one operation.
 */
export const rasterizeGeneratedVirtualTexturePage = (
  source: GeneratedVirtualTextureRasterSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): HTMLCanvasElement | OffscreenCanvas => {
  if (!positiveFinite(source.width) || !positiveFinite(source.height)) {
    throw new RangeError(`Generated virtual texture source dimensions are invalid for ${source.label}`);
  }
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  const [mipWidth, mipHeight] = virtualTextureMipTexelSize(manifest, page.mip);
  const canvas = createVirtualTextureCanvas(
    storedPageSize,
    storedPageSize,
    `generated virtual texture page ${source.label} ${virtualTexturePageKey(page)}`,
  );
  const context = virtualTextureCanvasContext(canvas, source.label);
  const pattern = context.createPattern(source.image, "repeat");
  if (pattern === null) {
    throw new Error(`Canvas 2D could not create a repeating virtual texture pattern for ${source.label}`);
  }
  pattern.setTransform({
    a: mipWidth / source.width,
    b: 0,
    c: 0,
    d: mipHeight / source.height,
    e: manifest.borderTexels - page.x * manifest.pageSize,
    f: manifest.borderTexels - page.y * manifest.pageSize,
  });
  context.fillStyle = pattern;
  context.fillRect(0, 0, storedPageSize, storedPageSize);
  if (validateVirtualTexturePageImage(manifest, canvas).kind !== "valid") {
    throw new Error(`Generated virtual texture page ${source.label} has an invalid stored extent`);
  }
  return canvas;
};
