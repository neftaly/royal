import {
  type VirtualTexturePageAddress,
  type VirtualTexturePageId,
  type VirtualTextureRuntimeOptions,
  virtualTexturePageId,
} from "./virtual-texture-runtime";

export type VirtualTextureManifestFormat = "rgba8";

export type VirtualTextureManifestPageSource = {
  readonly baseUri: string | null;
  readonly entries: Readonly<Record<VirtualTexturePageId, string>>;
  readonly uriTemplate: string | null;
};

export type VirtualTextureManifest = {
  readonly borderTexels: number;
  readonly bytesPerTexel: number;
  readonly format: VirtualTextureManifestFormat;
  readonly id: string;
  readonly mipCount: number;
  readonly pageSize: number;
  readonly pageSource: VirtualTextureManifestPageSource;
  readonly physicalSlots: number;
  readonly runtimeOptions: VirtualTextureRuntimeOptions;
  readonly virtualSize: readonly [number, number];
};

export const parseVirtualTextureManifest = (input: unknown): VirtualTextureManifest => {
  const manifest = requireRecord(input, "Virtual texture manifest");
  const id = requireNonEmptyString(manifest.id, "id");
  const virtualSize = parseVirtualSize(manifest.virtualSize);
  const pageSize = requirePositiveInteger(manifest.pageSize, "pageSize");
  const borderTexels = optionalNonNegativeInteger(manifest.borderTexels, "borderTexels", 0);
  const bytesPerTexel = optionalPositiveInteger(manifest.bytesPerTexel, "bytesPerTexel", 4);
  const physicalSlots = requirePositiveInteger(manifest.physicalSlots, "physicalSlots");
  const mipCount = optionalPositiveInteger(manifest.mipCount, "mipCount", computeMipCount(virtualSize, pageSize));
  const format = parseFormat(manifest.format);
  const pageSource = parsePageSource(manifest.pages);

  return {
    borderTexels,
    bytesPerTexel,
    format,
    id,
    mipCount,
    pageSize,
    pageSource,
    physicalSlots,
    runtimeOptions: {
      borderTexels,
      bytesPerTexel,
      mipCount,
      pageSize,
      physicalSlots,
      virtualSize,
    },
    virtualSize,
  };
};

export const resolveVirtualTextureManifestPageUri = (
  manifest: VirtualTextureManifest,
  page: VirtualTexturePageAddress,
): string | null => {
  const normalized = validateManifestPage(manifest, page);
  const id = virtualTexturePageId(normalized);
  const explicit = manifest.pageSource.entries[id];
  const uri = explicit ?? templatePageUri(manifest.pageSource.uriTemplate, id, normalized);
  if (uri === null) return null;
  if (manifest.pageSource.baseUri === null) return uri;
  return new URL(uri, manifest.pageSource.baseUri).href;
};

const computeMipCount = (virtualSize: readonly [number, number], pageSize: number): number => {
  let widthPages = Math.ceil(virtualSize[0] / pageSize);
  let heightPages = Math.ceil(virtualSize[1] / pageSize);
  let count = 1;
  while (widthPages > 1 || heightPages > 1) {
    widthPages = Math.max(1, Math.ceil(widthPages / 2));
    heightPages = Math.max(1, Math.ceil(heightPages / 2));
    count += 1;
  }
  return count;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalNonEmptyString = (value: unknown, label: string, fallback: string | null): string | null => {
  if (value === undefined || value === null) return fallback;
  return requireNonEmptyString(value, label);
};

const optionalNonNegativeInteger = (value: unknown, label: string, fallback: number): number => {
  if (value === undefined) return fallback;
  return requireNonNegativeInteger(value, label);
};

const optionalPositiveInteger = (value: unknown, label: string, fallback: number): number => {
  if (value === undefined) return fallback;
  return requirePositiveInteger(value, label);
};

const parseEntries = (value: unknown): Readonly<Record<VirtualTexturePageId, string>> => {
  if (value === undefined) return {};
  if (Array.isArray(value)) {
    const entries: Record<VirtualTexturePageId, string> = {};
    for (const [index, item] of value.entries()) {
      const entry = requireRecord(item, `pages.entries[${index}]`);
      const page = {
        mip: requireNonNegativeInteger(entry.mip, `pages.entries[${index}].mip`),
        x: requireNonNegativeInteger(entry.x, `pages.entries[${index}].x`),
        y: requireNonNegativeInteger(entry.y, `pages.entries[${index}].y`),
      };
      entries[virtualTexturePageId(page)] = requireNonEmptyString(entry.uri, `pages.entries[${index}].uri`);
    }
    return entries;
  }

  const record = requireRecord(value, "pages.entries");
  const entries: Record<VirtualTexturePageId, string> = {};
  for (const [id, uri] of Object.entries(record)) {
    if (!/^m\d+\/\d+\/\d+$/.test(id)) {
      throw new Error(`Virtual texture manifest pages.entries key ${id} must be a page id`);
    }
    entries[id as VirtualTexturePageId] = requireNonEmptyString(uri, `pages.entries.${id}`);
  }
  return entries;
};

const parseFormat = (value: unknown): VirtualTextureManifestFormat => {
  if (value === undefined || value === "rgba8") return "rgba8";
  throw new Error("Virtual texture manifest format must be rgba8");
};

const parsePageSource = (value: unknown): VirtualTextureManifestPageSource => {
  if (value === undefined) {
    return { baseUri: null, entries: {}, uriTemplate: null };
  }

  const pages = requireRecord(value, "pages");
  const baseUri = optionalNonEmptyString(pages.baseUri, "pages.baseUri", null);
  const uriTemplate = optionalNonEmptyString(pages.uriTemplate, "pages.uriTemplate", null);
  return {
    baseUri,
    entries: parseEntries(pages.entries),
    uriTemplate,
  };
};

const parseVirtualSize = (value: unknown): readonly [number, number] => {
  if (Array.isArray(value)) {
    if (value.length !== 2) throw new Error("Virtual texture manifest virtualSize must have width and height");
    return [
      requirePositiveInteger(value[0], "virtualSize[0]"),
      requirePositiveInteger(value[1], "virtualSize[1]"),
    ];
  }

  const size = requireRecord(value, "virtualSize");
  return [
    requirePositiveInteger(size.width, "virtualSize.width"),
    requirePositiveInteger(size.height, "virtualSize.height"),
  ];
};

const pagesAtMip = (
  virtualSize: readonly [number, number],
  pageSize: number,
  mip: number,
): readonly [number, number] => [
  Math.max(1, Math.ceil(Math.ceil(virtualSize[0] / pageSize) / 2 ** mip)),
  Math.max(1, Math.ceil(Math.ceil(virtualSize[1] / pageSize) / 2 ** mip)),
];

const requireNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Virtual texture manifest ${label} must be a non-empty string`);
  }
  return value;
};

const requireNonNegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Virtual texture manifest ${label} must be a non-negative integer`);
  }
  return value as number;
};

const requirePositiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Virtual texture manifest ${label} must be a positive integer`);
  }
  return value as number;
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
};

const templatePageUri = (
  template: string | null,
  id: VirtualTexturePageId,
  page: VirtualTexturePageAddress,
): string | null => {
  if (template === null) return null;
  return template
    .replaceAll("{page}", id)
    .replaceAll("{mip}", String(page.mip))
    .replaceAll("{x}", String(page.x))
    .replaceAll("{y}", String(page.y));
};

const validateManifestPage = (
  manifest: VirtualTextureManifest,
  page: VirtualTexturePageAddress,
): VirtualTexturePageAddress => {
  const mip = requireNonNegativeInteger(page.mip, "page.mip");
  if (mip >= manifest.mipCount) {
    throw new Error(`Virtual texture manifest page mip ${mip} exceeds mip count ${manifest.mipCount}`);
  }

  const x = requireNonNegativeInteger(page.x, "page.x");
  const y = requireNonNegativeInteger(page.y, "page.y");
  const pages = pagesAtMip(manifest.virtualSize, manifest.pageSize, mip);
  if (x >= pages[0] || y >= pages[1]) {
    throw new Error(`Virtual texture manifest page m${mip}/${x}/${y} is outside ${pages[0]}x${pages[1]} mip bounds`);
  }
  return { mip, x, y };
};
