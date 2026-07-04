import type { TextureColorSpace } from "@royal/renderer-core";

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
  readonly borderTexels?: number;
  readonly colorSpace?: TextureColorSpace;
  readonly height: number;
  readonly id?: string;
  readonly mipCount?: number;
  readonly pageSize: number;
  readonly pages: readonly VirtualTexturePageEntry[];
  readonly physicalByteBudget?: number;
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
  readonly fallbackMipOffset?: number;
  readonly fallbackPage?: VirtualTexturePageId;
  readonly fallbackPageKey?: string;
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

const readNonNegativeInteger = (value: unknown): number | undefined =>
  isNonNegativeInteger(value) ? value : undefined;

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
  const borderTexels = readNonNegativeInteger(payload.borderTexels ?? payload.border ?? payload.tileBorder);
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
  const physicalByteBudget = isPositiveInteger(root.physicalByteBudget)
    ? root.physicalByteBudget
    : isRecord(root.demoBudget) && isPositiveInteger(root.demoBudget.byteBudget)
      ? root.demoBudget.byteBudget
      : undefined;

  return {
    diagnostics,
    manifest: {
      ...(borderTexels === undefined ? {} : { borderTexels }),
      ...(colorSpace === undefined ? {} : { colorSpace }),
      height,
      ...(id === undefined ? {} : { id }),
      ...(mipCount === undefined ? {} : { mipCount }),
      pageSize,
      pages: entries,
      ...(physicalByteBudget === undefined ? {} : { physicalByteBudget }),
      ...(physicalSlots === undefined ? {} : { physicalSlots }),
      ...(uriTemplate === undefined ? {} : { uriTemplate }),
      width,
    },
  };
};

export const virtualTextureExplicitPageUrisByKey = (
  manifest: VirtualTextureManifestModel,
): ReadonlyMap<string, string> => {
  const pageUrisByKey = new Map<string, string>();
  for (const page of manifest.pages) {
    if (page.uri !== undefined) pageUrisByKey.set(virtualTexturePageKey(page), page.uri);
  }
  return pageUrisByKey;
};

export const virtualTexturePageUri = (
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
  pageUrisByKey: ReadonlyMap<string, string> = virtualTextureExplicitPageUrisByKey(manifest),
): string | undefined => {
  const key = virtualTexturePageKey(page);
  const explicitUri = pageUrisByKey.get(key);
  if (explicitUri !== undefined) return explicitUri;
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

  ensureResident(
    page: VirtualTexturePageId,
    options: { readonly protectedPages?: ReadonlySet<string> } = {},
  ): VirtualTextureAtlasAssignment {
    const pageKey = virtualTexturePageKey(page);
    const existing = this.#recordsByPage.get(pageKey);
    if (existing !== undefined) {
      const touched = { ...existing, referenceBit: true };
      this.#setRecord(touched);
      return touched;
    }

    const { evicted, slot } = this.#allocateSlot(options.protectedPages);
    if (evicted !== undefined) {
      this.#recordsByPage.delete(evicted.pageKey);
      this.#recordsBySlot.delete(evicted.slot);
      this.#dirty.push(this.#downgradeOrInvalidate(evicted));
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

  #allocateSlot(protectedPages: ReadonlySet<string> | undefined): { readonly evicted?: VirtualTextureResidentPage; readonly slot: number } {
    const freeSlot = this.#freeSlots.shift();
    if (freeSlot !== undefined) return { slot: freeSlot };

    const slotCount = this.slotCount;
    for (let attempts = 0; attempts < slotCount * 3; attempts += 1) {
      const slot = this.#clockHand;
      this.#clockHand = (this.#clockHand + 1) % slotCount;
      const record = this.#recordsBySlot.get(slot);
      if (record === undefined) return { slot };
      if (protectedPages?.has(record.pageKey)) continue;
      if (record.referenceBit) {
        this.#setRecord({ ...record, referenceBit: false });
        continue;
      }
      return { evicted: record, slot };
    }

    const fallbackSlot = this.#clockHand;
    this.#clockHand = (this.#clockHand + 1) % slotCount;
    const evicted = this.#recordsBySlot.get(fallbackSlot);
    if (evicted !== undefined && protectedPages?.has(evicted.pageKey)) {
      for (let slot = 0; slot < slotCount; slot += 1) {
        const record = this.#recordsBySlot.get(slot);
        if (record !== undefined && !protectedPages.has(record.pageKey)) {
          return { evicted: record, slot };
        }
      }
    }
    return evicted === undefined ? { slot: fallbackSlot } : { evicted, slot: fallbackSlot };
  }

  #setRecord(record: VirtualTextureResidentPage): void {
    this.#recordsByPage.set(record.pageKey, record);
    this.#recordsBySlot.set(record.slot, record);
  }

  #downgradeOrInvalidate(evicted: VirtualTextureResidentPage): VirtualTexturePageTableUpdate {
    const fallback = this.resolveResidentFallback(parentVirtualTexturePage(evicted.page));
    if (fallback === undefined) return { page: evicted.page, pageKey: evicted.pageKey };
    return {
      fallbackMipOffset: fallback.page.mip - evicted.page.mip,
      fallbackPage: fallback.page,
      fallbackPageKey: fallback.pageKey,
      page: evicted.page,
      pageKey: evicted.pageKey,
      slot: fallback.slot,
    };
  }
}

export const encodeVirtualTexturePageTableRgba8 = (
  update: Pick<VirtualTexturePageTableUpdate, "fallbackMipOffset" | "slot">,
): readonly [number, number, number, number] => {
  if (update.slot === undefined) return [0, 0, 0, 0];
  const encodedSlot = update.slot + 1;
  // A is reserved for future page-table flags/addressing. Material data belongs in atlases.
  const reservedAlpha = 0xff;
  return [
    encodedSlot & 0xff,
    (encodedSlot >> 8) & 0xff,
    update.fallbackMipOffset ?? 0,
    reservedAlpha,
  ];
};
