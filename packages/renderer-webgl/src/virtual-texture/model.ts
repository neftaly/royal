import type { TextureColorSpace } from "@royal/renderer-core";

export interface VirtualTexturePageId {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
}

export interface VirtualTexturePageEntry extends VirtualTexturePageId {
  readonly uri: string;
}

export interface VirtualTextureManifestModel {
  /** Physical gutter texels stored on every side of each logical page. */
  readonly borderTexels: number;
  readonly colorSpace?: TextureColorSpace;
  readonly height: number;
  readonly mipCount?: number;
  /** Whether every in-bounds logical page can be loaded, or only authored entries exist. */
  readonly pageAddressing: "complete" | "sparse";
  /** Transport/upload representation shared by every physical page. */
  readonly pageEncoding: "image" | "ktx2-basis";
  /** Logical square page interior; decoded page images additionally include both gutters. */
  readonly pageSize: number;
  readonly pages: readonly VirtualTexturePageEntry[];
  /** Maximum atlas plus page-table allocation, charged using stored guttered cells. */
  readonly physicalByteBudget?: number;
  /** Requested maximum resident page cells; hardware and byte budgets may reduce it. */
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
  readonly fallbackPage?: VirtualTexturePageId;
  readonly fallbackPageKey?: string;
  readonly page: VirtualTexturePageId;
  readonly pageKey: string;
  readonly residentMip?: number;
  readonly slot?: number;
}

type QueuedVirtualTexturePageTableUpdate = {
  readonly kind: "reconcile" | "transaction";
  readonly update: VirtualTexturePageTableUpdate;
};

declare const residentTransactionAuthority: unique symbol;

export interface VirtualTextureResidentTransaction {
  readonly assignment: VirtualTextureAtlasAssignment;
  readonly [residentTransactionAuthority]: "VirtualTextureResidentTransaction";
}

interface ProtectedVirtualTexturePageKeys {
  has(pageKey: string): boolean;
}

type MutableVirtualTextureResidentTransaction = {
  readonly assignment: VirtualTextureAtlasAssignment;
  readonly baseRevision: number;
  readonly clearedReferenceSlots: ReadonlySet<number>;
  readonly clockHand: number;
  committed: boolean;
  readonly fallbackRecord?: VirtualTextureResidentPage;
  readonly freeSlot?: number;
  readonly owner: VirtualTextureAtlasPageTable;
};

const EMPTY_TEXTURE_SLOT_SET: ReadonlySet<number> = new Set<number>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const readDimensions = (value: unknown): readonly [number, number] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;

  const width = value[0];
  const height = value[1];
  return isPositiveInteger(width) && isPositiveInteger(height) ? [width, height] : undefined;
};

const readColorSpace = (value: unknown): TextureColorSpace | undefined =>
  value === "linear" || value === "srgb" ? value : undefined;

export const virtualTexturePageKey = (page: VirtualTexturePageId): string =>
  `${page.mip}/${page.x}/${page.y}`;

export const virtualTextureMipDimension = (baseDimension: number, mip: number): number =>
  Math.max(1, Math.ceil(baseDimension / (2 ** mip)));

export const derivedVirtualTextureMipCount = (
  width: number,
  height: number,
  pageSize: number,
): number => {
  let mipWidth = Math.ceil(width / pageSize);
  let mipHeight = Math.ceil(height / pageSize);
  let mipCount = 1;
  while (mipWidth > 1 || mipHeight > 1) {
    mipWidth = Math.ceil(mipWidth / 2);
    mipHeight = Math.ceil(mipHeight / 2);
    mipCount += 1;
  }
  return mipCount;
};

export const generatedVirtualTexturePageCount = (
  width: number,
  height: number,
  pageSize: number,
): number => {
  if (!isPositiveInteger(width) || !isPositiveInteger(height) || !isPositiveInteger(pageSize)) {
    throw new RangeError("Generated virtual texture dimensions and page size must be positive safe integers");
  }
  let pages = 0;
  let mipWidth = Math.ceil(width / pageSize);
  let mipHeight = Math.ceil(height / pageSize);
  while (true) {
    const mipPages = Math.max(1, mipWidth) * Math.max(1, mipHeight);
    if (!Number.isSafeInteger(mipPages) || !Number.isSafeInteger(pages + mipPages)) {
      throw new RangeError("Generated virtual texture page count exceeds safe integer capacity");
    }
    pages += mipPages;
    if (mipWidth <= 1 && mipHeight <= 1) return pages;
    mipWidth = Math.ceil(mipWidth / 2);
    mipHeight = Math.ceil(mipHeight / 2);
  }
};

export interface GeneratedVirtualTextureManifestOptions {
  /** Physical gutter texels on every side. @defaultValue `1` */
  readonly borderTexels?: number;
  readonly colorSpace?: TextureColorSpace;
  readonly height: number;
  readonly pageSize: number;
  readonly physicalSlotCap: number;
  readonly width: number;
}

/**
 * Shared policy for generated raster and vector sources. Page production may
 * differ, but both source kinds must expose identical logical mip and residency
 * constraints for the same dimensions.
 */
export const generatedVirtualTextureManifest = (
  options: GeneratedVirtualTextureManifestOptions,
): VirtualTextureManifestModel => {
  const width = Math.max(1, Math.ceil(options.width));
  const height = Math.max(1, Math.ceil(options.height));
  const borderTexels = options.borderTexels ?? 1;
  if (
    !isPositiveInteger(width)
    || !isPositiveInteger(height)
    || !isPositiveInteger(borderTexels)
    || !isPositiveInteger(options.pageSize)
    || !isPositiveInteger(options.physicalSlotCap)
  ) {
    throw new RangeError(
      "Generated virtual texture dimensions, page size, border, and physical slot cap must be positive safe integers",
    );
  }
  const pageSize = Math.min(options.pageSize, Math.max(width, height));
  const storedPageSize = pageSize + borderTexels * 2;
  if (!isPositiveInteger(storedPageSize)) {
    throw new RangeError("Generated virtual texture stored page size exceeds safe integer capacity");
  }
  const physicalSlots = Math.min(
    options.physicalSlotCap,
    generatedVirtualTexturePageCount(width, height, pageSize),
  );

  return {
    borderTexels,
    ...(options.colorSpace === undefined ? {} : { colorSpace: options.colorSpace }),
    height,
    pageAddressing: "complete",
    pageEncoding: "image",
    pageSize,
    pages: [],
    physicalSlots,
    width,
  };
};

/** Physical square cell extent, including both page gutters. */
export const virtualTextureStoredPageSize = (manifest: VirtualTextureManifestModel): number => {
  const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  if (!isPositiveInteger(storedPageSize)) {
    throw new RangeError("Virtual texture stored page size must be a positive safe integer");
  }
  return storedPageSize;
};

/** Decoded/uploaded RGBA8 byte cost of one physical page cell. */
export const virtualTextureDecodedPageBytes = (manifest: VirtualTextureManifestModel): number => {
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  const bytes = storedPageSize * storedPageSize * 4;
  if (!isPositiveInteger(bytes)) {
    throw new RangeError("Virtual texture decoded page byte size exceeds safe integer capacity");
  }
  return bytes;
};

/** Retained CPU payload and atlas storage bytes for one physical page cell. */
export const virtualTextureStoredPageBytes = (manifest: VirtualTextureManifestModel): number => {
  if (manifest.pageEncoding === "image") return virtualTextureDecodedPageBytes(manifest);
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  const bytes = Math.ceil(storedPageSize / 4) ** 2 * 16;
  if (!isPositiveInteger(bytes)) {
    throw new RangeError("Virtual texture compressed page byte size exceeds safe integer capacity");
  }
  return bytes;
};

/** Actual texel dimensions of mip `mip`, including NPOT rounding. */
export const virtualTextureMipTexelSize = (
  manifest: Pick<VirtualTextureManifestModel, "height" | "width">,
  mip: number,
): readonly [width: number, height: number] => {
  if (!isNonNegativeInteger(mip)) throw new RangeError("Virtual texture mip must be a non-negative safe integer");
  return [
    virtualTextureMipDimension(manifest.width, mip),
    virtualTextureMipDimension(manifest.height, mip),
  ];
};

export const parentVirtualTexturePage = (page: VirtualTexturePageId): VirtualTexturePageId => ({
  mip: page.mip + 1,
  x: Math.floor(page.x / 2),
  y: Math.floor(page.y / 2),
});

const readPageEntry = (
  value: unknown,
): VirtualTexturePageEntry | undefined => {
  if (!isRecord(value)) return undefined;

  const mip = value.mip;
  const x = value.x;
  const y = value.y;
  const page = isNonNegativeInteger(mip) && isNonNegativeInteger(x) && isNonNegativeInteger(y)
    ? { mip, x, y }
    : undefined;
  if (page === undefined) return undefined;

  const uri = typeof value.uri === "string" && value.uri.length > 0 ? value.uri : undefined;
  if (uri === undefined) return undefined;

  return {
    ...page,
    uri,
  };
};

const readUriTemplate = (pages: unknown): string | undefined => {
  if (isRecord(pages) && typeof pages.uriTemplate === "string" && pages.uriTemplate.length > 0) {
    return pages.uriTemplate;
  }
  return undefined;
};

export const parseVirtualTextureManifest = (input: unknown): VirtualTextureManifestParseResult => {
  const diagnostics: VirtualTextureManifestDiagnostic[] = [];
  const root = isRecord(input) ? input : undefined;
  if (root === undefined) {
    return {
      diagnostics: [{
        code: "vt.manifest.invalid",
        message: "Virtual texture manifest must be an object.",
        severity: "error",
      }],
    };
  }
  if (root.contractVersion !== 2) {
    return { diagnostics: [{
      code: "vt.manifest.contractVersion",
      message: "Virtual texture manifest contractVersion must be 2.",
      severity: "error",
    }] };
  }

  const dimensions = readDimensions(root.virtualSize);
  const pageSize = isPositiveInteger(root.pageSize) ? root.pageSize : undefined;
  const borderTexels = isPositiveInteger(root.borderTexels) ? root.borderTexels : undefined;
  if (borderTexels === undefined) {
    diagnostics.push({
      code: "vt.manifest.borderTexels",
      message: "Virtual texture manifest borderTexels must be a positive integer.",
      severity: "error",
    });
  }
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

  const pages = root.pages;
  const rawEntries = isRecord(pages) ? pages.entries : undefined;
  const entries = Array.isArray(rawEntries)
    ? rawEntries.flatMap((entry) => {
      const page = readPageEntry(entry);
      return page === undefined ? [] : [page];
    })
    : [];
  const uriTemplate = readUriTemplate(pages);
  if (entries.length === 0 && uriTemplate === undefined) {
    diagnostics.push({
      code: "vt.pages.empty",
      message: "Virtual texture manifest does not reference page entries or a URI template.",
      severity: "unsupported",
    });
  }

  if (dimensions === undefined || pageSize === undefined || borderTexels === undefined) {
    return { diagnostics };
  }
  const storedPageSize = pageSize + borderTexels * 2;
  if (!isPositiveInteger(storedPageSize)) {
    diagnostics.push({
      code: "vt.manifest.borderTexels",
      message: "Virtual texture manifest stored page size exceeds safe integer capacity.",
      severity: "error",
    });
    return { diagnostics };
  }

  const [width, height] = dimensions;
  const derivedMipCount = derivedVirtualTextureMipCount(width, height, pageSize);
  const colorSpace = readColorSpace(root.colorSpace);
  const pageEncoding = root.pageEncoding === undefined || root.pageEncoding === "image"
    ? "image"
    : root.pageEncoding === "ktx2-basis" ? "ktx2-basis" : undefined;
  const explicitMipCount = root.mipCount;
  const mipCount = isPositiveInteger(explicitMipCount) && explicitMipCount <= derivedMipCount
    ? explicitMipCount
    : undefined;
  if (explicitMipCount !== undefined && mipCount === undefined) {
    diagnostics.push({
      code: "vt.manifest.mipCount",
      message: `Virtual texture manifest mipCount must be an integer from 1 through ${derivedMipCount}.`,
      severity: "error",
    });
    return { diagnostics };
  }
  const physicalSlots = isPositiveInteger(root.physicalSlots) ? root.physicalSlots : undefined;
  const physicalByteBudget = isPositiveInteger(root.physicalByteBudget) ? root.physicalByteBudget : undefined;
  if (root.colorSpace !== undefined && colorSpace === undefined) {
    diagnostics.push({
      code: "vt.manifest.colorSpace",
      message: "Virtual texture manifest colorSpace must be linear or srgb when present.",
      severity: "error",
    });
  }
  if (pageEncoding === undefined) {
    diagnostics.push({
      code: "vt.manifest.pageEncoding",
      message: "Virtual texture manifest pageEncoding must be image or ktx2-basis when present.",
      severity: "error",
    });
  }
  if (pageEncoding === "ktx2-basis" && storedPageSize % 4 !== 0) {
    diagnostics.push({
      code: "vt.manifest.pageEncoding",
      message: "Virtual texture ktx2-basis stored page size must be a multiple of four texels.",
      severity: "error",
    });
  }
  if (root.physicalSlots !== undefined && physicalSlots === undefined) {
    diagnostics.push({
      code: "vt.manifest.physicalSlots",
      message: "Virtual texture manifest physicalSlots must be a positive integer when present.",
      severity: "error",
    });
  }
  if (root.physicalByteBudget !== undefined && physicalByteBudget === undefined) {
    diagnostics.push({
      code: "vt.manifest.physicalByteBudget",
      message: "Virtual texture manifest physicalByteBudget must be a positive integer when present.",
      severity: "error",
    });
  }
  if (rawEntries !== undefined && !Array.isArray(rawEntries)) {
    diagnostics.push({
      code: "vt.pages.entries",
      message: "Virtual texture manifest pages.entries must be an array when present.",
      severity: "error",
    });
  }
  const effectiveMipCount = mipCount ?? derivedMipCount;
  const pageKeys = new Set<string>();
  if (Array.isArray(rawEntries)) {
    for (const [index, entry] of rawEntries.entries()) {
      const page = readPageEntry(entry);
      if (page === undefined) {
        diagnostics.push({
          code: "vt.pages.entry",
          message: `Virtual texture manifest page entry ${index} is malformed.`,
          severity: "error",
        });
        continue;
      }
      const mipWidth = virtualTextureMipDimension(Math.ceil(width / pageSize), page.mip);
      const mipHeight = virtualTextureMipDimension(Math.ceil(height / pageSize), page.mip);
      if (page.mip >= effectiveMipCount || page.x >= mipWidth || page.y >= mipHeight) {
        diagnostics.push({
          code: "vt.pages.bounds",
          message: `Virtual texture manifest page entry ${index} is outside its declared mip grid.`,
          severity: "error",
        });
      }
      const key = virtualTexturePageKey(page);
      if (pageKeys.has(key)) {
        diagnostics.push({
          code: "vt.pages.duplicate",
          message: `Virtual texture manifest contains duplicate page key ${key}.`,
          severity: "error",
        });
      }
      pageKeys.add(key);
    }
  }
  if (pageEncoding === undefined || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  return {
    diagnostics,
    manifest: {
      borderTexels,
      ...(colorSpace === undefined ? {} : { colorSpace }),
      height,
      ...(mipCount === undefined ? {} : { mipCount }),
      pageAddressing: uriTemplate === undefined ? "sparse" : "complete",
      pageEncoding,
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
    pageUrisByKey.set(virtualTexturePageKey(page), page.uri);
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

export class VirtualTextureAtlasPageTable {
  #activePageKeys: Set<string> | undefined;
  readonly #dirty: QueuedVirtualTexturePageTableUpdate[] = [];
  #dirtyHead = 0;
  readonly #freeSlots: number[];
  readonly #recordsByPage = new Map<string, VirtualTextureResidentPage>();
  readonly #recordsBySlot = new Map<number, VirtualTextureResidentPage>();
  #clockHand = 0;
  #revision = 0;

  constructor(options: VirtualTextureAtlasPageTableOptions) {
    if (!isPositiveInteger(options.slotCount)) {
      throw new Error("Virtual texture atlas slot count must be a positive integer.");
    }
    this.#freeSlots = Array.from({ length: options.slotCount }, (_unused, index) => index);
  }

  get residentCount(): number {
    return this.#recordsByPage.size;
  }

  /** Number of cached pages that participate in the current page-table mapping. */
  get activeResidentCount(): number {
    if (this.#activePageKeys === undefined) return this.#recordsByPage.size;
    let count = 0;
    for (const pageKey of this.#activePageKeys) {
      if (this.#recordsByPage.has(pageKey)) count += 1;
    }
    return count;
  }

  get slotCount(): number {
    return this.#freeSlots.length + this.#recordsBySlot.size;
  }

  /**
   * Reconciles logical page-table visibility independently from atlas cache
   * residency. Coarse mappings are queued before fine mappings so overlapping
   * active descendants always win when the updates reach the GPU.
   */
  reconcileActivePageKeys(pageKeys: ReadonlySet<string>): boolean {
    const previous = this.#activePageKeys;
    let identical = previous !== undefined && previous.size === pageKeys.size;
    if (identical) {
      for (const pageKey of pageKeys) {
        if (previous?.has(pageKey) !== true) {
          identical = false;
          break;
        }
      }
    }
    if (identical) return false;

    const wasActive = (pageKey: string): boolean => previous?.has(pageKey) ?? true;
    this.#activePageKeys = new Set(pageKeys);
    const supersededPendingReconciliation = this.#dropPendingReconciliationUpdates();

    if (supersededPendingReconciliation) {
      // The GPU may have consumed any prefix of the superseded delta. Queue a
      // complete, authoritative mapping from the current cache so convergence
      // no longer depends on which part of that delta reached it. Every
      // resident contributes at most one update, bounding the replacement by
      // physical slot count. Transaction updates remain ahead of this snapshot.
      const inactiveRecords: VirtualTextureResidentPage[] = [];
      const activeRecords: VirtualTextureResidentPage[] = [];
      for (const record of this.#recordsByPage.values()) {
        if (this.#activePageKeys.has(record.pageKey)) activeRecords.push(record);
        else inactiveRecords.push(record);
      }
      for (const record of inactiveRecords) {
        const fallback = this.#residentFallbackRecord(
          parentVirtualTexturePage(record.page),
          record.pageKey,
        );
        this.#queueReconciliationUpdate(this.#fallbackUpdate(record, fallback));
      }
      // Broad coarse mappings precede fine mappings, which must win in
      // overlapping regions.
      activeRecords.sort((left, right) => right.page.mip - left.page.mip);
      for (const record of activeRecords) {
        this.#queueReconciliationUpdate({
          page: record.page,
          pageKey: record.pageKey,
          residentMip: record.page.mip,
          slot: record.slot,
        });
      }
      this.#revision += 1;
      return true;
    }

    const changedPageKeys = new Set<string>();
    let maximumChangedMip = -1;
    // First withdraw records that ceased to be active. Their replacement may
    // only be an active cached ancestor; an inactive prewarm must never leak
    // back into the current page table as an eviction fallback.
    for (const record of this.#recordsByPage.values()) {
      if (wasActive(record.pageKey) && !this.#activePageKeys.has(record.pageKey)) {
        changedPageKeys.add(record.pageKey);
        maximumChangedMip = Math.max(maximumChangedMip, record.page.mip);
        const fallback = this.#residentFallbackRecord(
          parentVirtualTexturePage(record.page),
          record.pageKey,
        );
        this.#queueReconciliationUpdate(this.#fallbackUpdate(record, fallback));
      }
      else if (!wasActive(record.pageKey) && this.#activePageKeys.has(record.pageKey)) {
        changedPageKeys.add(record.pageKey);
        maximumChangedMip = Math.max(maximumChangedMip, record.page.mip);
      }
    }

    // A changed coarse page can cover an unchanged fine mapping. Republish
    // only newly active records and affected active descendants, coarse to
    // fine. This keeps ordinary camera motion proportional to changed regions
    // instead of rewriting the complete active set.
    const activeRecords = [...this.#recordsByPage.values()]
      .filter((record) => (
        this.#activePageKeys?.has(record.pageKey) === true
        && (
          !wasActive(record.pageKey)
          || this.#hasChangedAncestor(record.page, changedPageKeys, maximumChangedMip)
        )
      ))
      .sort((left, right) => right.page.mip - left.page.mip);
    for (const record of activeRecords) {
      this.#queueReconciliationUpdate({
        page: record.page,
        pageKey: record.pageKey,
        residentMip: record.page.mip,
        slot: record.slot,
      });
    }
    this.#revision += 1;
    return true;
  }

  isActivePageKey(pageKey: string): boolean {
    return this.#activePageKeys?.has(pageKey) ?? true;
  }

  residentPage(pageKey: string): VirtualTextureResidentPage | undefined {
    return this.#recordsByPage.get(pageKey);
  }

  activeResidentPages(): readonly VirtualTextureResidentPage[] {
    return [...this.residentPageValues()].filter((record) => this.isActivePageKey(record.pageKey));
  }

  residentPages(): readonly VirtualTextureResidentPage[] {
    return [...this.residentPageValues()];
  }

  residentPageValues(): IterableIterator<VirtualTextureResidentPage> {
    return this.#recordsByPage.values();
  }

  ensureResident(
    page: VirtualTexturePageId,
    options: { readonly protectedPages?: ProtectedVirtualTexturePageKeys } = {},
  ): VirtualTextureAtlasAssignment {
    const transaction = this.planResident(page, options);
    this.commitResident(transaction);
    return transaction.assignment;
  }

  planResident(
    page: VirtualTexturePageId,
    options: { readonly protectedPages?: ProtectedVirtualTexturePageKeys } = {},
  ): VirtualTextureResidentTransaction {
    const pageKey = virtualTexturePageKey(page);
    const existing = this.#recordsByPage.get(pageKey);
    if (existing !== undefined) {
      const touched = { ...existing, referenceBit: true };
      return {
        assignment: touched,
        baseRevision: this.#revision,
        clearedReferenceSlots: EMPTY_TEXTURE_SLOT_SET,
        clockHand: this.#clockHand,
        committed: false,
        fallbackRecord: existing,
        owner: this,
      } as unknown as VirtualTextureResidentTransaction;
    }
    const allocation = this.#planSlot(options.protectedPages);
    const evicted = allocation.evicted;
    const fallbackRecord = evicted === undefined ? undefined : this.#residentFallbackRecord(
      parentVirtualTexturePage(evicted.page),
      evicted.pageKey,
    );
    const assignment: VirtualTextureAtlasAssignment = {
      ...(evicted === undefined ? {} : { evicted }),
      page,
      pageKey,
      slot: allocation.slot,
    };
    return {
      assignment,
      baseRevision: this.#revision,
      clearedReferenceSlots: allocation.clearedReferenceSlots,
      clockHand: allocation.clockHand,
      committed: false,
      ...(fallbackRecord === undefined ? {} : { fallbackRecord }),
      ...(allocation.freeSlot === undefined ? {} : { freeSlot: allocation.freeSlot }),
      owner: this,
    } as unknown as VirtualTextureResidentTransaction;
  }

  commitResident(transaction: VirtualTextureResidentTransaction): void {
    const mutable = transaction as unknown as MutableVirtualTextureResidentTransaction;
    if (mutable.owner !== this) throw new Error("Virtual texture resident transaction belongs to another page table");
    if (mutable.committed) throw new Error("Virtual texture resident transaction was already committed");
    if (mutable.baseRevision !== this.#revision) throw new Error("Virtual texture resident transaction is stale");
    mutable.committed = true;
    const assignment = mutable.assignment;
    const existing = this.#recordsByPage.get(assignment.pageKey);
    if (existing !== undefined) {
      this.#setRecord({ ...existing, referenceBit: true });
      this.#revision += 1;
      return;
    }
    if (mutable.freeSlot !== undefined) {
      const shifted = this.#freeSlots.shift();
      if (shifted !== mutable.freeSlot) throw new Error("Virtual texture resident transaction free slot changed");
    }
    for (const slot of mutable.clearedReferenceSlots) {
      const current = this.#recordsBySlot.get(slot);
      if (current !== undefined) this.#setRecord({ ...current, referenceBit: false });
    }
    this.#clockHand = mutable.clockHand;
    if (assignment.evicted !== undefined) {
      this.#recordsByPage.delete(assignment.evicted.pageKey);
      this.#recordsBySlot.delete(assignment.evicted.slot);
      if (this.isActivePageKey(assignment.evicted.pageKey)) {
        this.#queueTransactionUpdate(this.#fallbackUpdate(assignment.evicted, mutable.fallbackRecord));
      }
    }
    const record: VirtualTextureResidentPage = { ...assignment, referenceBit: true };
    this.#setRecord(record);
    if (this.isActivePageKey(assignment.pageKey)) {
      this.#queueTransactionUpdate({ page: assignment.page, pageKey: assignment.pageKey, slot: assignment.slot });
    }
    this.#revision += 1;
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
      if (record !== undefined && this.isActivePageKey(record.pageKey)) {
        const touched = { ...record, referenceBit: true };
        this.#setRecord(touched);
        this.#revision += 1;
        return touched;
      }
      page = parentVirtualTexturePage(page);
    }
    return undefined;
  }

  takeDirtyPageTableUpdates(): readonly VirtualTexturePageTableUpdate[] {
    const updates = this.#dirty.slice(this.#dirtyHead).map(({ update }) => update);
    this.#dirty.length = 0;
    this.#dirtyHead = 0;
    return updates;
  }

  get dirtyPageTableUpdateCount(): number {
    return this.#dirty.length - this.#dirtyHead;
  }

  dirtyPageTableUpdate(index: number): VirtualTexturePageTableUpdate | undefined {
    if (!Number.isSafeInteger(index) || index < 0) return undefined;
    return this.#dirty[this.#dirtyHead + index]?.update;
  }

  commitDirtyPageTableUpdate(): void {
    if (this.#dirtyHead >= this.#dirty.length) {
      throw new Error("Virtual texture page table has no dirty update to commit");
    }
    this.#dirtyHead += 1;
    if (this.#dirtyHead === this.#dirty.length) {
      this.#dirty.length = 0;
      this.#dirtyHead = 0;
    } else {
      this.#compactDirtyPrefix();
    }
  }

  #compactDirtyPrefix(force = false): void {
    // Keep acknowledged entries from retaining update/page objects during a
    // long partial drain. The threshold avoids shifting the hot queue for each
    // successful page-table write while placing a fixed bound on dead prefix.
    if (this.#dirtyHead === 0 || (!force && this.#dirtyHead < 64)) return;
    this.#dirty.copyWithin(0, this.#dirtyHead);
    this.#dirty.length -= this.#dirtyHead;
    this.#dirtyHead = 0;
  }

  #dropPendingReconciliationUpdates(): boolean {
    this.#compactDirtyPrefix(true);
    let found = false;
    let writeIndex = 0;
    for (const entry of this.#dirty) {
      if (entry.kind === "reconcile") {
        found = true;
      } else {
        this.#dirty[writeIndex] = entry;
        writeIndex += 1;
      }
    }
    this.#dirty.length = writeIndex;
    return found;
  }

  #queueReconciliationUpdate(update: VirtualTexturePageTableUpdate): void {
    this.#dirty.push({ kind: "reconcile", update });
  }

  #queueTransactionUpdate(update: VirtualTexturePageTableUpdate): void {
    this.#dirty.push({ kind: "transaction", update });
  }


  #planSlot(protectedPages: ProtectedVirtualTexturePageKeys | undefined): {
    readonly clearedReferenceSlots: ReadonlySet<number>;
    readonly clockHand: number;
    readonly evicted?: VirtualTextureResidentPage;
    readonly freeSlot?: number;
    readonly slot: number;
  } {
    const freeSlot = this.#freeSlots[0];
    if (freeSlot !== undefined) {
      return { clearedReferenceSlots: EMPTY_TEXTURE_SLOT_SET, clockHand: this.#clockHand, freeSlot, slot: freeSlot };
    }

    const clearedReferenceSlots = new Set<number>();
    const slotCount = this.slotCount;
    let clockHand = this.#clockHand;
    for (let attempts = 0; attempts < slotCount * 3; attempts += 1) {
      const slot = clockHand;
      clockHand = (clockHand + 1) % slotCount;
      const record = this.#recordsBySlot.get(slot);
      if (record === undefined) return { clearedReferenceSlots, clockHand, slot };
      if (protectedPages?.has(record.pageKey)) continue;
      if (record.referenceBit && !clearedReferenceSlots.has(record.slot)) {
        clearedReferenceSlots.add(record.slot);
        continue;
      }
      return { clearedReferenceSlots, clockHand, evicted: record, slot };
    }

    const fallbackSlot = clockHand;
    clockHand = (clockHand + 1) % slotCount;
    const evicted = this.#recordsBySlot.get(fallbackSlot);
    if (evicted !== undefined && protectedPages?.has(evicted.pageKey)) {
      for (let slot = 0; slot < slotCount; slot += 1) {
        const record = this.#recordsBySlot.get(slot);
        if (record !== undefined && !protectedPages.has(record.pageKey)) {
          return { clearedReferenceSlots, clockHand, evicted: record, slot };
        }
      }
    }
    return evicted === undefined
      ? { clearedReferenceSlots, clockHand, slot: fallbackSlot }
      : { clearedReferenceSlots, clockHand, evicted, slot: fallbackSlot };
  }

  #setRecord(record: VirtualTextureResidentPage): void {
    this.#recordsByPage.set(record.pageKey, record);
    this.#recordsBySlot.set(record.slot, record);
  }

  #hasChangedAncestor(
    page: VirtualTexturePageId,
    changedPageKeys: ReadonlySet<string>,
    maximumChangedMip: number,
  ): boolean {
    let ancestor = page;
    while (ancestor.mip < maximumChangedMip) {
      ancestor = parentVirtualTexturePage(ancestor);
      if (changedPageKeys.has(virtualTexturePageKey(ancestor))) return true;
    }
    return false;
  }

  #residentFallbackRecord(
    requested: VirtualTexturePageId,
    excludedPageKey: string,
  ): VirtualTextureResidentPage | undefined {
    let page = requested;
    const maxMip = requested.mip + 32;
    while (page.mip <= maxMip) {
      const record = this.#recordsByPage.get(virtualTexturePageKey(page));
      if (
        record !== undefined
        && record.pageKey !== excludedPageKey
        && this.isActivePageKey(record.pageKey)
      ) return record;
      page = parentVirtualTexturePage(page);
    }
    return undefined;
  }

  #fallbackUpdate(
    evicted: VirtualTextureResidentPage,
    fallback: VirtualTextureResidentPage | undefined,
  ): VirtualTexturePageTableUpdate {
    if (fallback === undefined) return { page: evicted.page, pageKey: evicted.pageKey };
    const current = this.#recordsByPage.get(fallback.pageKey);
    if (current !== undefined) this.#setRecord({ ...current, referenceBit: true });
    return {
      fallbackPage: fallback.page,
      fallbackPageKey: fallback.pageKey,
      page: evicted.page,
      pageKey: evicted.pageKey,
      residentMip: fallback.page.mip,
      slot: fallback.slot,
    };
  }
}

export const encodeVirtualTexturePageTableRgba8 = (
  update: Pick<VirtualTexturePageTableUpdate, "residentMip" | "slot">,
): readonly [number, number, number, number] => {
  if (update.slot === undefined) return [0, 0, 0, 0];
  if (!Number.isSafeInteger(update.slot) || update.slot < 0 || update.slot >= 65_535) {
    throw new Error("Virtual texture page-table slot must be an integer from 0 through 65534.");
  }
  const encodedSlot = update.slot + 1;
  // A is reserved for future page-table flags/addressing. Material data belongs in atlases.
  const reservedAlpha = 0xff;
  return [
    encodedSlot & 0xff,
    (encodedSlot >> 8) & 0xff,
    update.residentMip ?? 0,
    reservedAlpha,
  ];
};
