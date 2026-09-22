import type { TextureColorSpace } from "@royal/renderer-core";

export { DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS } from "./automatic-policy";

export type VirtualTexturePageId = Readonly<{ mip: number; x: number; y: number }>;
export type VirtualTextureMipLayout = Readonly<{
  byteOffset: number;
  height: number;
  width: number;
}>;

export type VirtualTextureLayout = Readonly<{
  borderTexels: number;
  colorSpace: TextureColorSpace;
  height: number;
  mipCount: number;
  mipLayouts: readonly VirtualTextureMipLayout[];
  pageSize: number;
  tableByteLength: number;
  tableHeight: number;
  tableWidth: number;
  width: number;
}>;

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
};

export const virtualTexturePageLabel = ({ mip, x, y }: VirtualTexturePageId): string =>
  `${mip}/${x}/${y}`;

const PACKED_MIP_STRIDE = 0x100;
const PACKED_ROW_STRIDE = 0x1_000_000;

/** Numeric identity covers generated layouts; exact strings cover large page grids. */
export const virtualTexturePageKey = (page: VirtualTexturePageId): number | string =>
  virtualTexturePageKeyParts(page.mip, page.x, page.y);

export const virtualTexturePageKeyParts = (
  mip: number,
  x: number,
  y: number,
): number | string => mip <= 0xff && x <= 0xffff && y <= 0xffff
  ? mip + x * PACKED_MIP_STRIDE + y * PACKED_ROW_STRIDE
  : `${mip}/${x}/${y}`;

export const derivedVirtualTextureMipCount = (
  width: number,
  height: number,
  pageSize: number,
): number => {
  let pagesX = Math.ceil(width / pageSize);
  let pagesY = Math.ceil(height / pageSize);
  let count = 1;
  while (pagesX > 1 || pagesY > 1) {
    pagesX = Math.ceil(pagesX / 2);
    pagesY = Math.ceil(pagesY / 2);
    count += 1;
  }
  return count;
};

const buildMipLayouts = (
  width: number,
  height: number,
  pageSize: number,
  mipCount: number,
): Readonly<{
  layouts: readonly VirtualTextureMipLayout[];
  tableByteLength: number;
  tableHeight: number;
  tableWidth: number;
}> => {
  const layouts: VirtualTextureMipLayout[] = [];
  const tableWidth = 2 ** Math.ceil(Math.log2(Math.ceil(width / pageSize)));
  const tableHeight = 2 ** Math.ceil(Math.log2(Math.ceil(height / pageSize)));
  let tableByteLength = 0;
  for (let mip = 0; mip < mipCount; mip += 1) {
    const mipWidth = Math.max(1, Math.ceil(width / (pageSize * 2 ** mip)));
    const mipHeight = Math.max(1, Math.ceil(height / (pageSize * 2 ** mip)));
    layouts.push({ byteOffset: tableByteLength, height: mipHeight, width: mipWidth });
    tableByteLength += Math.max(1, tableWidth / 2 ** mip)
      * Math.max(1, tableHeight / 2 ** mip) * 4;
  }
  if (!Number.isSafeInteger(tableByteLength)) {
    throw new RangeError("Royal VT page table exceeds safe integer capacity");
  }
  return { layouts, tableByteLength, tableHeight, tableWidth };
};

/** Builds the retained layout for a complete runtime-generated raster source. */
export const createGeneratedVirtualTextureLayout = (options: Readonly<{
  borderTexels: number;
  colorSpace: TextureColorSpace;
  height: number;
  pageSize: number;
  width: number;
}>): VirtualTextureLayout => {
  const width = positiveInteger(options.width, "Royal generated VT width");
  const height = positiveInteger(options.height, "Royal generated VT height");
  const pageSize = positiveInteger(options.pageSize, "Royal generated VT pageSize");
  const borderTexels = positiveInteger(
    options.borderTexels,
    "Royal generated VT borderTexels",
  );
  const storedPageSize = pageSize + borderTexels * 2;
  if (!Number.isSafeInteger(storedPageSize)) {
    throw new RangeError("Royal generated VT stored page dimensions exceed safe integer capacity");
  }
  const mipCount = derivedVirtualTextureMipCount(width, height, pageSize);
  const { layouts, tableByteLength, tableHeight, tableWidth } = buildMipLayouts(
    width,
    height,
    pageSize,
    mipCount,
  );
  return {
    borderTexels,
    colorSpace: options.colorSpace,
    height,
    mipCount,
    mipLayouts: layouts,
    pageSize,
    tableByteLength,
    tableHeight,
    tableWidth,
    width,
  };
};

export const virtualTexturePageBytes = (layout: VirtualTextureLayout): number =>
  (layout.pageSize + layout.borderTexels * 2) ** 2 * 4;
