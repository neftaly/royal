import type { TextureColorSpace } from "@royal/renderer-core";

export const DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS = 24;

export type VirtualTexturePageId = Readonly<{ mip: number; x: number; y: number }>;
export type VirtualTextureMipLayout = Readonly<{
  byteOffset: number;
  height: number;
  width: number;
}>;

export type VirtualTextureManifest = Readonly<{
  borderTexels: number;
  colorSpace: TextureColorSpace;
  entries: ReadonlyMap<number | string, string>;
  height: number;
  mipCount: number;
  mipLayouts: readonly VirtualTextureMipLayout[];
  pageAddressing: "complete" | "sparse";
  pageEncoding: "image" | "ktx2-etc2";
  pageSize: number;
  physicalByteBudget?: number;
  physicalSlots?: number;
  tableByteLength: number;
  tableHeight: number;
  tableWidth: number;
  uriTemplate?: string;
  width: number;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
};

const optionalPositiveInteger = (value: unknown, label: string): number | undefined =>
  value === undefined ? undefined : positiveInteger(value, label);

const nonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const nonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};

export const virtualTexturePageLabel = ({ mip, x, y }: VirtualTexturePageId): string =>
  `${mip}/${x}/${y}`;

const PACKED_MIP_STRIDE = 0x100;
const PACKED_ROW_STRIDE = 0x1_000_000;

/** Numeric identity covers ordinary manifests; exact strings cover oversized author data. */
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

const TEMPLATE_TOKEN = /\{([^}]+)\}/gu;
const validateTemplate = (template: string): void => {
  const allowed = new Set(["key", "mip", "page", "x", "y"]);
  for (const match of template.matchAll(TEMPLATE_TOKEN)) {
    if (!allowed.has(match[1]!)) {
      throw new TypeError(`Royal VT uriTemplate has unsupported token {${match[1]}}`);
    }
  }
  if (!template.includes("{page}") && (
    !template.includes("{mip}") || !template.includes("{x}") || !template.includes("{y}")
  )) {
    throw new TypeError("Royal VT uriTemplate must contain {page} or {mip}, {x}, and {y}");
  }
};

/** Strictly lowers manifest JSON to retained addressing and page-table layout. */
export const parseVirtualTextureManifest = (input: unknown): VirtualTextureManifest => {
  if (!isRecord(input)) throw new TypeError("Royal VT manifest must be an object");
  if (input.contractVersion !== 2) {
    throw new TypeError("Royal VT manifest contractVersion must be 2");
  }
  if (!Array.isArray(input.virtualSize) || input.virtualSize.length !== 2) {
    throw new TypeError("Royal VT manifest virtualSize must contain width and height");
  }
  const width = positiveInteger(input.virtualSize[0], "Royal VT manifest virtualSize[0]");
  const height = positiveInteger(input.virtualSize[1], "Royal VT manifest virtualSize[1]");
  const pageSize = positiveInteger(input.pageSize, "Royal VT manifest pageSize");
  const borderTexels = positiveInteger(input.borderTexels, "Royal VT manifest borderTexels");
  const storedPageSize = pageSize + borderTexels * 2;
  if (!Number.isSafeInteger(storedPageSize)) {
    throw new RangeError("Royal VT stored page dimensions exceed safe integer capacity");
  }
  const derivedMipCount = derivedVirtualTextureMipCount(width, height, pageSize);
  const mipCount = optionalPositiveInteger(input.mipCount, "Royal VT manifest mipCount")
    ?? derivedMipCount;
  if (mipCount > derivedMipCount) {
    throw new RangeError(`Royal VT manifest mipCount must not exceed ${derivedMipCount}`);
  }
  const colorSpace = input.colorSpace === undefined ? "srgb" : input.colorSpace;
  if (colorSpace !== "srgb" && colorSpace !== "linear") {
    throw new TypeError("Royal VT manifest colorSpace must be srgb or linear");
  }
  const pageEncoding = input.pageEncoding === undefined ? "image" : input.pageEncoding;
  if (pageEncoding !== "image" && pageEncoding !== "ktx2-etc2") {
    throw new TypeError("Royal VT manifest pageEncoding must be image or ktx2-etc2");
  }
  if (pageEncoding === "ktx2-etc2" && storedPageSize % 4 !== 0) {
    throw new RangeError("Royal VT KTX2/ETC2 stored page size must be block-compatible");
  }
  if (!isRecord(input.pages)) throw new TypeError("Royal VT manifest pages must be an object");
  const uriTemplate = input.pages.uriTemplate === undefined
    ? undefined
    : nonEmptyString(input.pages.uriTemplate, "Royal VT manifest pages.uriTemplate");
  if (uriTemplate !== undefined) validateTemplate(uriTemplate);
  const rawEntries = input.pages.entries;
  if (rawEntries !== undefined && !Array.isArray(rawEntries)) {
    throw new TypeError("Royal VT manifest pages.entries must be an array");
  }
  if (uriTemplate === undefined && (rawEntries === undefined || rawEntries.length === 0)) {
    throw new TypeError("Royal VT manifest must provide page entries or a URI template");
  }
  const { layouts, tableByteLength, tableHeight, tableWidth } = buildMipLayouts(
    width,
    height,
    pageSize,
    mipCount,
  );
  const entries = new Map<number | string, string>();
  for (let index = 0; index < (rawEntries?.length ?? 0); index += 1) {
    const raw = rawEntries![index];
    if (!isRecord(raw)) throw new TypeError(`Royal VT pages.entries[${index}] must be an object`);
    const page = {
      mip: nonNegativeInteger(raw.mip, `Royal VT pages.entries[${index}].mip`),
      x: nonNegativeInteger(raw.x, `Royal VT pages.entries[${index}].x`),
      y: nonNegativeInteger(raw.y, `Royal VT pages.entries[${index}].y`),
    };
    if (page.mip >= mipCount) {
      throw new RangeError(`Royal VT pages.entries[${index}].mip is outside mipCount`);
    }
    const layout = layouts[page.mip]!;
    if (page.x >= layout.width || page.y >= layout.height) {
      throw new RangeError(`Royal VT pages.entries[${index}] is outside its mip grid`);
    }
    const key = virtualTexturePageKey(page);
    if (entries.has(key)) throw new TypeError(`Royal VT page ${virtualTexturePageLabel(page)} is duplicated`);
    entries.set(key, nonEmptyString(raw.uri, `Royal VT pages.entries[${index}].uri`));
  }
  const physicalSlots = optionalPositiveInteger(
    input.physicalSlots,
    "Royal VT manifest physicalSlots",
  );
  const physicalByteBudget = optionalPositiveInteger(
    input.physicalByteBudget,
    "Royal VT manifest physicalByteBudget",
  );
  return {
    borderTexels,
    colorSpace,
    entries,
    height,
    mipCount,
    mipLayouts: layouts,
    pageAddressing: uriTemplate === undefined ? "sparse" : "complete",
    pageEncoding,
    pageSize,
    ...(physicalByteBudget === undefined ? {} : { physicalByteBudget }),
    ...(physicalSlots === undefined ? {} : { physicalSlots }),
    tableByteLength,
    tableHeight,
    tableWidth,
    ...(uriTemplate === undefined ? {} : { uriTemplate }),
    width,
  };
};

/** Builds the retained layout for a complete runtime-generated raster source. */
export const createGeneratedVirtualTextureManifest = (options: Readonly<{
  borderTexels: number;
  colorSpace: TextureColorSpace;
  height: number;
  pageSize: number;
  width: number;
}>): VirtualTextureManifest => {
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
    entries: new Map(),
    height,
    mipCount,
    mipLayouts: layouts,
    pageAddressing: "complete",
    pageEncoding: "image",
    pageSize,
    tableByteLength,
    tableHeight,
    tableWidth,
    width,
  };
};

export const virtualTexturePageUri = (
  manifest: VirtualTextureManifest,
  page: VirtualTexturePageId,
): string | undefined => {
  const key = virtualTexturePageKey(page);
  const explicit = manifest.entries.get(key);
  if (explicit !== undefined) return explicit;
  const template = manifest.uriTemplate;
  if (template === undefined) return undefined;
  const label = virtualTexturePageLabel(page);
  return template.replace(TEMPLATE_TOKEN, (_match, token: string) => {
    switch (token) {
      case "key": return String(key);
      case "mip": return String(page.mip);
      case "page": return label;
      case "x": return String(page.x);
      case "y": return String(page.y);
      default: return "";
    }
  });
};
