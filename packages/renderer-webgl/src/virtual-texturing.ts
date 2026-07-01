import type { Rgba, TextureColorSpace } from "@royal/renderer-core";

export interface VirtualTexturePageId {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
}

export interface VirtualTexturePageEntry extends VirtualTexturePageId {
  readonly height?: number;
  readonly id: string;
  readonly uri?: string;
  readonly width?: number;
}

export interface VirtualTextureManifestModel {
  readonly colorSpace?: TextureColorSpace;
  readonly fallbackColor?: Rgba;
  readonly height: number;
  readonly id?: string;
  readonly mipCount?: number;
  readonly pageSize: number;
  readonly pages: readonly VirtualTexturePageEntry[];
  readonly physicalSlots?: number;
  readonly uriTemplate?: string;
  readonly width: number;
}

export interface VirtualTextureManifestDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "unsupported" | "warning";
}

export interface VirtualTextureManifestParseResult {
  readonly diagnostics: readonly VirtualTextureManifestDiagnostic[];
  readonly manifest?: VirtualTextureManifestModel;
}

export interface VirtualTextureAtlasPageTableOptions {
  readonly slotCount: number;
}

export interface VirtualTextureAtlasAssignment {
  readonly evicted?: VirtualTextureResidentPage;
  readonly page: VirtualTexturePageId;
  readonly pageKey: string;
  readonly slot: number;
}

export interface VirtualTextureResidentPage extends VirtualTextureAtlasAssignment {
  readonly referenceBit: boolean;
}

export interface VirtualTexturePageTableUpdate {
  readonly page: VirtualTexturePageId;
  readonly pageKey: string;
  readonly slot?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const readDimensions = (value: unknown): readonly [number, number] | undefined => {
  if (isPositiveInteger(value)) return [value, value];
  if (!Array.isArray(value) || value.length < 2) return undefined;

  const width = value[0];
  const height = value[1];
  return isPositiveInteger(width) && isPositiveInteger(height) ? [width, height] : undefined;
};

const readWidthHeight = (value: Record<string, unknown>): readonly [number, number] | undefined => {
  const width = value.width ?? value.textureWidth;
  const height = value.height ?? value.textureHeight;
  return isPositiveInteger(width) && isPositiveInteger(height) ? [width, height] : undefined;
};

const readColorSpace = (value: unknown): TextureColorSpace | undefined =>
  value === "linear" || value === "srgb" ? value : undefined;

const readRgba = (value: unknown): Rgba | undefined => {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [r, g, b, a] = value;
  return typeof r === "number"
    && typeof g === "number"
    && typeof b === "number"
    && typeof a === "number"
    ? [r, g, b, a]
    : undefined;
};

const pageIdFromKey = (key: string): VirtualTexturePageId | undefined => {
  const match = /^(?:mip-?|m)?(\d+)\/(\d+)\/(\d+)$/.exec(key)
    ?? /^mip-(\d+)\/x(\d+)-y(\d+)$/.exec(key)
    ?? /^page:(\d+):(\d+):(\d+)$/.exec(key);
  if (match === null) return undefined;

  const [, mipText, xText, yText] = match;
  const mip = Number(mipText);
  const x = Number(xText);
  const y = Number(yText);
  return isNonNegativeInteger(mip) && isNonNegativeInteger(x) && isNonNegativeInteger(y)
    ? { mip, x, y }
    : undefined;
};

export const virtualTexturePageKey = (page: VirtualTexturePageId): string =>
  `${page.mip}/${page.x}/${page.y}`;

export const parentVirtualTexturePage = (page: VirtualTexturePageId): VirtualTexturePageId => ({
  mip: page.mip + 1,
  x: Math.floor(page.x / 2),
  y: Math.floor(page.y / 2),
});

const readPageEntry = (
  value: unknown,
  fallbackKey: string | undefined,
): VirtualTexturePageEntry | undefined => {
  if (typeof value === "string") {
    if (fallbackKey === undefined) return undefined;
    const page = pageIdFromKey(fallbackKey);
    return page === undefined
      ? undefined
      : { ...page, id: fallbackKey, uri: value };
  }
  if (!isRecord(value)) return undefined;

  const mip = value.mip;
  const x = value.x;
  const y = value.y;
  const fallbackPage = fallbackKey === undefined ? undefined : pageIdFromKey(fallbackKey);
  const page = isNonNegativeInteger(mip) && isNonNegativeInteger(x) && isNonNegativeInteger(y)
    ? { mip, x, y }
    : fallbackPage;
  if (page === undefined) return undefined;

  const id = typeof value.id === "string" && value.id.length > 0
    ? value.id
    : fallbackKey ?? virtualTexturePageKey(page);
  const uri = typeof value.uri === "string" && value.uri.length > 0 ? value.uri : undefined;
  const width = isPositiveInteger(value.width) ? value.width : undefined;
  const height = isPositiveInteger(value.height) ? value.height : undefined;

  return {
    ...page,
    id,
    ...(height === undefined ? {} : { height }),
    ...(uri === undefined ? {} : { uri }),
    ...(width === undefined ? {} : { width }),
  };
};

const readPageEntries = (pages: unknown): readonly VirtualTexturePageEntry[] => {
  if (Array.isArray(pages)) {
    return pages.flatMap((entry) => {
      const page = readPageEntry(entry, undefined);
      return page === undefined ? [] : [page];
    });
  }
  if (!isRecord(pages)) return [];

  const entries = pages.entries;
  if (Array.isArray(entries)) {
    return entries.flatMap((entry) => {
      const page = readPageEntry(entry, undefined);
      return page === undefined ? [] : [page];
    });
  }
  if (!isRecord(entries)) return [];

  return Object.entries(entries).flatMap(([key, entry]) => {
    const page = readPageEntry(entry, key);
    return page === undefined ? [] : [page];
  });
};

const readUriTemplate = (root: Record<string, unknown>, pages: unknown): string | undefined => {
  if (isRecord(pages) && typeof pages.uriTemplate === "string" && pages.uriTemplate.length > 0) {
    return pages.uriTemplate;
  }
  const variants = root.variants;
  if (!Array.isArray(variants)) return undefined;

  for (const variant of variants) {
    if (isRecord(variant) && typeof variant.uriTemplate === "string" && variant.uriTemplate.length > 0) {
      return variant.uriTemplate;
    }
  }
  return undefined;
};

const manifestPayload = (input: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(input)) return undefined;
  return isRecord(input.virtualTexture) ? input.virtualTexture : input;
};

export const parseVirtualTextureManifest = (input: unknown): VirtualTextureManifestParseResult => {
  const diagnostics: VirtualTextureManifestDiagnostic[] = [];
  const root = isRecord(input) ? input : undefined;
  const payload = manifestPayload(input);
  if (root === undefined || payload === undefined) {
    return {
      diagnostics: [{
        code: "vt.manifest.invalid",
        message: "Virtual texture manifest must be an object.",
        severity: "error",
      }],
    };
  }

  const dimensions = readDimensions(payload.virtualSize)
    ?? readDimensions(payload.dimensions)
    ?? readWidthHeight(payload);
  const pageSize = isPositiveInteger(payload.pageSize)
    ? payload.pageSize
    : isPositiveInteger(payload.usableTileSize)
      ? payload.usableTileSize
      : undefined;
  if (dimensions === undefined) {
    diagnostics.push({
      code: "vt.manifest.dimensions",
      message: "Virtual texture manifest is missing texture width and height.",
      severity: "error",
    });
  }
  if (pageSize === undefined) {
    diagnostics.push({
      code: "vt.manifest.pageSize",
      message: "Virtual texture manifest is missing a positive page size.",
      severity: "error",
    });
  }

  const pages = root.pages ?? payload.pages;
  const entries = readPageEntries(pages);
  const uriTemplate = readUriTemplate(root, pages);
  if (isRecord(pages) && pages.kind === "generated") {
    diagnostics.push({
      code: "vt.pages.generated",
      message: "Generated virtual texture pages parse as metadata but are not uploadable runtime pages yet.",
      severity: "unsupported",
    });
  }
  if (entries.length === 0 && uriTemplate === undefined) {
    diagnostics.push({
      code: "vt.pages.empty",
      message: "Virtual texture manifest does not reference page entries or a URI template.",
      severity: "unsupported",
    });
  }

  if (dimensions === undefined || pageSize === undefined) {
    return { diagnostics };
  }

  const [width, height] = dimensions;
  const colorSpace = readColorSpace(payload.colorSpace);
  const fallbackColor = readRgba(payload.fallbackColor);
  const id = typeof root.id === "string" && root.id.length > 0
    ? root.id
    : typeof root.assetId === "string" && root.assetId.length > 0
      ? root.assetId
      : undefined;
  const mipCount = isPositiveInteger(payload.mipCount) ? payload.mipCount : undefined;
  const physicalSlots = isPositiveInteger(root.physicalSlots)
    ? root.physicalSlots
    : isRecord(root.demoBudget) && isPositiveInteger(root.demoBudget.cacheSlots)
      ? root.demoBudget.cacheSlots
      : undefined;

  return {
    diagnostics,
    manifest: {
      ...(colorSpace === undefined ? {} : { colorSpace }),
      ...(fallbackColor === undefined ? {} : { fallbackColor }),
      height,
      ...(id === undefined ? {} : { id }),
      ...(mipCount === undefined ? {} : { mipCount }),
      pageSize,
      pages: entries,
      ...(physicalSlots === undefined ? {} : { physicalSlots }),
      ...(uriTemplate === undefined ? {} : { uriTemplate }),
      width,
    },
  };
};

export const virtualTexturePageUri = (
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): string | undefined => {
  const key = virtualTexturePageKey(page);
  const entry = manifest.pages.find((candidate) =>
    candidate.mip === page.mip && candidate.x === page.x && candidate.y === page.y);
  if (entry?.uri !== undefined) return entry.uri;
  if (manifest.uriTemplate === undefined) return undefined;

  return manifest.uriTemplate
    .replaceAll("{page}", `m${page.mip}/${page.x}/${page.y}`)
    .replaceAll("{mip}", String(page.mip))
    .replaceAll("{x}", String(page.x))
    .replaceAll("{y}", String(page.y))
    .replaceAll("{key}", key);
};

export const firstVirtualTexturePageUri = (
  manifest: VirtualTextureManifestModel,
): string | undefined => {
  const firstEntry = manifest.pages.find((entry) => entry.uri !== undefined);
  if (firstEntry?.uri !== undefined) return firstEntry.uri;
  return virtualTexturePageUri(manifest, { mip: 0, x: 0, y: 0 });
};

export class VirtualTextureAtlasPageTable {
  readonly #dirty: VirtualTexturePageTableUpdate[] = [];
  readonly #freeSlots: number[];
  readonly #recordsByPage = new Map<string, VirtualTextureResidentPage>();
  readonly #recordsBySlot = new Map<number, VirtualTextureResidentPage>();
  #clockHand = 0;

  constructor(options: VirtualTextureAtlasPageTableOptions) {
    if (!isPositiveInteger(options.slotCount)) {
      throw new Error("Virtual texture atlas slot count must be a positive integer.");
    }
    this.#freeSlots = Array.from({ length: options.slotCount }, (_unused, index) => index);
  }

  get residentCount(): number {
    return this.#recordsByPage.size;
  }

  get slotCount(): number {
    return this.#freeSlots.length + this.#recordsBySlot.size;
  }

  ensureResident(page: VirtualTexturePageId): VirtualTextureAtlasAssignment {
    const pageKey = virtualTexturePageKey(page);
    const existing = this.#recordsByPage.get(pageKey);
    if (existing !== undefined) {
      const touched = { ...existing, referenceBit: true };
      this.#setRecord(touched);
      return touched;
    }

    const { evicted, slot } = this.#allocateSlot();
    if (evicted !== undefined) {
      this.#recordsByPage.delete(evicted.pageKey);
      this.#recordsBySlot.delete(evicted.slot);
      this.#dirty.push({ page: evicted.page, pageKey: evicted.pageKey });
    }

    const record: VirtualTextureResidentPage = {
      ...(evicted === undefined ? {} : { evicted }),
      page,
      pageKey,
      referenceBit: true,
      slot,
    };
    this.#setRecord(record);
    this.#dirty.push({ page, pageKey, slot });
    return record;
  }

  residentSlot(page: VirtualTexturePageId): number | undefined {
    const record = this.#recordsByPage.get(virtualTexturePageKey(page));
    return record?.slot;
  }

  resolveResidentFallback(
    requested: VirtualTexturePageId,
    options: { readonly maxMip?: number } = {},
  ): VirtualTextureAtlasAssignment | undefined {
    const maxMip = options.maxMip ?? requested.mip + 32;
    let page = requested;
    while (page.mip <= maxMip) {
      const record = this.#recordsByPage.get(virtualTexturePageKey(page));
      if (record !== undefined) {
        const touched = { ...record, referenceBit: true };
        this.#setRecord(touched);
        return touched;
      }
      page = parentVirtualTexturePage(page);
    }
    return undefined;
  }

  takeDirtyPageTableUpdates(): readonly VirtualTexturePageTableUpdate[] {
    const updates = this.#dirty.slice();
    this.#dirty.length = 0;
    return updates;
  }

  #allocateSlot(): { readonly evicted?: VirtualTextureResidentPage; readonly slot: number } {
    const freeSlot = this.#freeSlots.shift();
    if (freeSlot !== undefined) return { slot: freeSlot };

    const slotCount = this.slotCount;
    for (let attempts = 0; attempts < slotCount * 2; attempts += 1) {
      const slot = this.#clockHand;
      this.#clockHand = (this.#clockHand + 1) % slotCount;
      const record = this.#recordsBySlot.get(slot);
      if (record === undefined) return { slot };
      if (record.referenceBit) {
        this.#setRecord({ ...record, referenceBit: false });
        continue;
      }
      return { evicted: record, slot };
    }

    const fallbackSlot = this.#clockHand;
    this.#clockHand = (this.#clockHand + 1) % slotCount;
    const evicted = this.#recordsBySlot.get(fallbackSlot);
    return evicted === undefined ? { slot: fallbackSlot } : { evicted, slot: fallbackSlot };
  }

  #setRecord(record: VirtualTextureResidentPage): void {
    this.#recordsByPage.set(record.pageKey, record);
    this.#recordsBySlot.set(record.slot, record);
  }
}
