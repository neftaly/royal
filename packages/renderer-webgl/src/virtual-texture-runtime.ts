export type VirtualTexturePageAddress = {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
};

export type VirtualTexturePageId = `m${number}/${number}/${number}`;

export type VirtualTexturePhysicalSlot = {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
};

export type VirtualTexturePageTableFlag = "exact" | "fallback" | "resident" | "unmapped";

export type VirtualTexturePageTableEntry = {
  readonly encodedRgba8: readonly [number, number, number, number];
  readonly flags: readonly VirtualTexturePageTableFlag[];
  readonly mipDelta: number | null;
  readonly physicalSlot: VirtualTexturePhysicalSlot | null;
  readonly residentMip: number | null;
  readonly residentPageId: VirtualTexturePageId | null;
  readonly updatedFrame: number;
  readonly uploadSerial: number | null;
  readonly version: number;
  readonly virtualPage: VirtualTexturePageAddress;
};

export type VirtualTextureDirtyPageTableEntry = {
  readonly batchIndex?: number;
  readonly drainedFrame?: number;
  readonly entry: VirtualTexturePageTableEntry;
  readonly op: "evict" | "missing" | "resolve" | "upload";
  readonly reason: string | null;
  readonly sequence: number;
  readonly tableCoord: VirtualTexturePageAddress;
};

export type VirtualTextureResidentPage = {
  readonly id: VirtualTexturePageId;
  readonly loadedFrame: number;
  readonly mip: number;
  readonly slot: number;
  readonly slotX: number;
  readonly slotY: number;
  readonly uploadSerial: number;
  readonly x: number;
  readonly y: number;
  lastUsedFrame: number;
};

export type VirtualTextureResolveResult =
  | {
    readonly entry: VirtualTexturePageTableEntry;
    readonly kind: "exact";
    readonly mipDelta: 0;
    readonly page: VirtualTextureResidentPage;
    readonly requested: VirtualTexturePageAddress;
  }
  | {
    readonly entry: VirtualTexturePageTableEntry;
    readonly kind: "fallback";
    readonly mipDelta: number;
    readonly page: VirtualTextureResidentPage;
    readonly requested: VirtualTexturePageAddress;
  }
  | {
    readonly entry: VirtualTexturePageTableEntry;
    readonly kind: "missing";
    readonly mipDelta: null;
    readonly page: null;
    readonly requested: VirtualTexturePageAddress;
  };

export type VirtualTextureMakeResidentResult = {
  readonly entry: VirtualTexturePageTableEntry;
  readonly evicted: VirtualTextureResidentPage | null;
  readonly page: VirtualTextureResidentPage;
};

export type VirtualTextureRuntimeOptions = {
  readonly borderTexels?: number;
  readonly bytesPerTexel?: number;
  readonly mipCount?: number;
  readonly pageSize: number;
  readonly physicalSlots: number;
  readonly virtualSize: readonly [number, number];
};

export type VirtualTextureSlotSnapshot = {
  readonly loadedFrame: number | null;
  readonly mip: number | null;
  readonly pageId: VirtualTexturePageId | null;
  readonly slot: number;
  readonly slotX: number;
  readonly slotY: number;
  readonly status: "free" | "resident";
  readonly uploadSerial: number | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly lastUsedFrame: number | null;
};

export type VirtualTextureDebugSnapshot = {
  readonly cache: {
    readonly byMip: Readonly<Record<string, number>>;
    readonly capacity: number;
    readonly freeSlots: number;
    readonly residentPages: number;
    readonly slotColumns: number;
    readonly slotRows: number;
  };
  readonly config: {
    readonly borderTexels: number;
    readonly bytesPerPage: number;
    readonly bytesPerTexel: number;
    readonly mipCount: number;
    readonly pageSize: number;
    readonly paddedPageSize: number;
    readonly physicalSlots: number;
    readonly virtualSize: readonly [number, number];
  };
  readonly dirtyEntriesPending: number;
  readonly pageTableEntries: readonly VirtualTexturePageTableEntry[];
  readonly slots: readonly VirtualTextureSlotSnapshot[];
  readonly staleResidentReferences: number;
  readonly version: number;
};

type MutableSlot = {
  loadedFrame: number | null;
  mip: number | null;
  pageId: VirtualTexturePageId | null;
  slot: number;
  slotX: number;
  slotY: number;
  status: "free" | "resident";
  uploadSerial: number | null;
  x: number | null;
  y: number | null;
  lastUsedFrame: number | null;
};

type ResidentWrite = {
  readonly page: VirtualTexturePageAddress;
  readonly resident: VirtualTextureResidentPage | null;
  readonly frame: number;
  readonly op: "evict" | "missing" | "resolve" | "upload";
  readonly reason: string | null;
};

export const virtualTexturePageId = (page: VirtualTexturePageAddress): VirtualTexturePageId =>
  `m${page.mip}/${page.x}/${page.y}`;

export const virtualTextureParentPage = (
  page: VirtualTexturePageAddress,
  mipCount: number,
): VirtualTexturePageAddress | null =>
  page.mip + 1 >= mipCount
    ? null
    : {
      mip: page.mip + 1,
      x: Math.floor(page.x / 2),
      y: Math.floor(page.y / 2),
    };

export class VirtualTextureRuntime {
  readonly #borderTexels: number;
  readonly #bytesPerTexel: number;
  readonly #mipCount: number;
  readonly #pageSize: number;
  readonly #physicalSlots: number;
  readonly #slotColumns: number;
  readonly #slotRows: number;
  readonly #virtualSize: readonly [number, number];
  readonly #freeSlots: number[];
  readonly #pages = new Map<VirtualTexturePageId, VirtualTextureResidentPage>();
  readonly #pageTable = new Map<VirtualTexturePageId, VirtualTexturePageTableEntry>();
  readonly #dirtyEntries: VirtualTextureDirtyPageTableEntry[] = [];
  readonly #slots: MutableSlot[];
  #uploadSerial = 0;
  #version = 0;

  constructor(options: VirtualTextureRuntimeOptions) {
    this.#virtualSize = validateVirtualSize(options.virtualSize);
    this.#pageSize = validatePositiveInteger(options.pageSize, "pageSize");
    this.#borderTexels = validateNonNegativeInteger(options.borderTexels ?? 0, "borderTexels");
    this.#bytesPerTexel = validatePositiveInteger(options.bytesPerTexel ?? 4, "bytesPerTexel");
    this.#physicalSlots = validatePositiveInteger(options.physicalSlots, "physicalSlots");
    this.#mipCount = options.mipCount === undefined
      ? computeMipCount(this.#virtualSize, this.#pageSize)
      : validatePositiveInteger(options.mipCount, "mipCount");
    this.#slotColumns = Math.ceil(Math.sqrt(this.#physicalSlots));
    this.#slotRows = Math.ceil(this.#physicalSlots / this.#slotColumns);
    if (this.#slotColumns > 256 || this.#slotRows > 256) {
      throw new Error("Virtual texture RGBA8 page-table encoding supports at most 256 slot columns and rows");
    }
    this.#slots = Array.from({ length: this.#physicalSlots }, (_, slot) => emptySlot(slot, this.#slotColumns));
    this.#freeSlots = this.#slots.map((slot) => slot.slot);
  }

  get mipCount(): number {
    return this.#mipCount;
  }

  get slotColumns(): number {
    return this.#slotColumns;
  }

  get slotRows(): number {
    return this.#slotRows;
  }

  drainDirtyEntries(frame = 0): readonly VirtualTextureDirtyPageTableEntry[] {
    const drained = this.#dirtyEntries.map((entry, index) => ({
      ...entry,
      batchIndex: index,
      drainedFrame: frame,
    }));
    this.#dirtyEntries.length = 0;
    return drained;
  }

  makeResident(page: VirtualTexturePageAddress, frame = 0): VirtualTextureMakeResidentResult {
    const normalized = this.#validatePage(page);
    const id = virtualTexturePageId(normalized);
    const existing = this.#pages.get(id);
    if (existing !== undefined) {
      existing.lastUsedFrame = frame;
      this.#slots[existing.slot] = slotFromPage(existing, this.#slotColumns);
      const entry = this.#writeEntry({ frame, op: "upload", page: normalized, reason: null, resident: existing });
      return { entry, evicted: null, page: existing };
    }

    let slot = this.#freeSlots.shift();
    let evicted: VirtualTextureResidentPage | null = null;
    if (slot === undefined) {
      evicted = this.#evictionCandidate();
      this.#pages.delete(evicted.id);
      slot = evicted.slot;
    }

    const resident: VirtualTextureResidentPage = {
      id,
      loadedFrame: frame,
      lastUsedFrame: frame,
      mip: normalized.mip,
      slot,
      slotX: slot % this.#slotColumns,
      slotY: Math.floor(slot / this.#slotColumns),
      uploadSerial: this.#uploadSerial,
      x: normalized.x,
      y: normalized.y,
    };
    this.#uploadSerial += 1;
    this.#pages.set(id, resident);
    this.#slots[slot] = slotFromPage(resident, this.#slotColumns);
    const entry = this.#writeEntry({ frame, op: "upload", page: normalized, reason: null, resident });

    if (evicted !== null) this.#downgradeEntriesUsing(evicted, frame);
    return { entry, evicted, page: resident };
  }

  parentPage(page: VirtualTexturePageAddress): VirtualTexturePageAddress | null {
    return virtualTextureParentPage(this.#validatePage(page), this.#mipCount);
  }

  resolve(page: VirtualTexturePageAddress, frame = 0): VirtualTextureResolveResult {
    const requested = this.#validatePage(page);
    const exact = this.#pages.get(virtualTexturePageId(requested));
    if (exact !== undefined) {
      exact.lastUsedFrame = frame;
      this.#slots[exact.slot] = slotFromPage(exact, this.#slotColumns);
      return {
        entry: this.#writeEntry({ frame, op: "resolve", page: requested, reason: null, resident: exact }),
        kind: "exact",
        mipDelta: 0,
        page: exact,
        requested,
      };
    }

    const fallback = this.#residentParent(requested);
    if (fallback !== null) {
      fallback.lastUsedFrame = frame;
      this.#slots[fallback.slot] = slotFromPage(fallback, this.#slotColumns);
      return {
        entry: this.#writeEntry({ frame, op: "resolve", page: requested, reason: null, resident: fallback }),
        kind: "fallback",
        mipDelta: fallback.mip - requested.mip,
        page: fallback,
        requested,
      };
    }

    return {
      entry: this.#writeEntry({ frame, op: "missing", page: requested, reason: "no-resident-parent", resident: null }),
      kind: "missing",
      mipDelta: null,
      page: null,
      requested,
    };
  }

  slotAddress(slot: number): VirtualTexturePhysicalSlot {
    const normalized = validateSlot(slot, this.#physicalSlots);
    return {
      slot: normalized,
      x: normalized % this.#slotColumns,
      y: Math.floor(normalized / this.#slotColumns),
    };
  }

  debugSnapshot(): VirtualTextureDebugSnapshot {
    const byMip: Record<string, number> = {};
    for (const page of this.#pages.values()) {
      const key = `mip${page.mip}`;
      byMip[key] = (byMip[key] ?? 0) + 1;
    }

    return {
      cache: {
        byMip,
        capacity: this.#physicalSlots,
        freeSlots: this.#freeSlots.length,
        residentPages: this.#pages.size,
        slotColumns: this.#slotColumns,
        slotRows: this.#slotRows,
      },
      config: {
        borderTexels: this.#borderTexels,
        bytesPerPage: this.#paddedPageSize() * this.#paddedPageSize() * this.#bytesPerTexel,
        bytesPerTexel: this.#bytesPerTexel,
        mipCount: this.#mipCount,
        pageSize: this.#pageSize,
        paddedPageSize: this.#paddedPageSize(),
        physicalSlots: this.#physicalSlots,
        virtualSize: this.#virtualSize,
      },
      dirtyEntriesPending: this.#dirtyEntries.length,
      pageTableEntries: [...this.#pageTable.values()].sort(compareEntries),
      slots: this.#slots.map(copySlot),
      staleResidentReferences: this.#staleResidentReferences(),
      version: this.#version,
    };
  }

  #downgradeEntriesUsing(evicted: VirtualTextureResidentPage, frame: number): void {
    for (const entry of [...this.#pageTable.values()]) {
      if (entry.residentPageId !== evicted.id) continue;
      const resident = this.#residentParent(entry.virtualPage);
      this.#writeEntry({
        frame,
        op: resident === null ? "evict" : "resolve",
        page: entry.virtualPage,
        reason: "resident-evicted",
        resident,
      });
    }
  }

  #evictionCandidate(): VirtualTextureResidentPage {
    let candidate: VirtualTextureResidentPage | undefined;
    for (const page of this.#pages.values()) {
      if (candidate === undefined || evictionScore(page) < evictionScore(candidate)) candidate = page;
    }
    if (candidate === undefined) throw new Error("Virtual texture cache has no eviction candidate");
    return candidate;
  }

  #paddedPageSize(): number {
    return this.#pageSize + this.#borderTexels * 2;
  }

  #residentParent(page: VirtualTexturePageAddress): VirtualTextureResidentPage | null {
    let parent = virtualTextureParentPage(page, this.#mipCount);
    while (parent !== null) {
      const resident = this.#pages.get(virtualTexturePageId(parent));
      if (resident !== undefined) return resident;
      parent = virtualTextureParentPage(parent, this.#mipCount);
    }
    return null;
  }

  #staleResidentReferences(): number {
    let stale = 0;
    for (const entry of this.#pageTable.values()) {
      if (entry.residentPageId !== null && !this.#pages.has(entry.residentPageId)) stale += 1;
    }
    return stale;
  }

  #validatePage(page: VirtualTexturePageAddress): VirtualTexturePageAddress {
    const mip = validateNonNegativeInteger(page.mip, "page.mip");
    if (mip >= this.#mipCount) throw new Error(`Virtual texture mip ${mip} exceeds mip count ${this.#mipCount}`);
    const pages = pagesAtMip(this.#virtualSize, this.#pageSize, mip);
    const x = validateNonNegativeInteger(page.x, "page.x");
    const y = validateNonNegativeInteger(page.y, "page.y");
    if (x >= pages[0] || y >= pages[1]) {
      throw new Error(`Virtual texture page m${mip}/${x}/${y} is outside ${pages[0]}x${pages[1]} mip bounds`);
    }
    return { mip, x, y };
  }

  #writeEntry(write: ResidentWrite): VirtualTexturePageTableEntry {
    const id = virtualTexturePageId(write.page);
    const entry = createPageTableEntry(write, this.#version, this.#slotColumns);
    const existing = this.#pageTable.get(id);
    if (existing !== undefined && equivalentEntry(existing, entry)) return existing;

    this.#version += 1;
    const versioned = { ...entry, version: this.#version, encodedRgba8: encodePageTableEntry(entry, this.#version) };
    if (versioned.physicalSlot === null) {
      this.#pageTable.delete(id);
    } else {
      this.#pageTable.set(id, versioned);
    }
    this.#dirtyEntries.push({
      entry: versioned,
      op: write.op,
      reason: write.reason,
      sequence: this.#dirtyEntries.length,
      tableCoord: write.page,
    });
    return versioned;
  }
}

const clampByte = (value: number): number => Math.min(255, Math.max(0, value));

const compareEntries = (a: VirtualTexturePageTableEntry, b: VirtualTexturePageTableEntry): number =>
  a.virtualPage.mip - b.virtualPage.mip ||
  a.virtualPage.y - b.virtualPage.y ||
  a.virtualPage.x - b.virtualPage.x;

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

const copySlot = (slot: MutableSlot): VirtualTextureSlotSnapshot => ({ ...slot });

const createPageTableEntry = (
  write: ResidentWrite,
  version: number,
  slotColumns: number,
): VirtualTexturePageTableEntry => {
  if (write.resident === null) {
    return {
      encodedRgba8: [0, 0, 0, 0],
      flags: ["unmapped"],
      mipDelta: null,
      physicalSlot: null,
      residentMip: null,
      residentPageId: null,
      updatedFrame: write.frame,
      uploadSerial: null,
      version,
      virtualPage: write.page,
    };
  }

  const mipDelta = write.resident.mip - write.page.mip;
  return {
    encodedRgba8: [0, 0, 0, 0],
    flags: mipDelta === 0 ? ["resident", "exact"] : ["resident", "fallback"],
    mipDelta,
    physicalSlot: {
      slot: write.resident.slot,
      x: write.resident.slot % slotColumns,
      y: Math.floor(write.resident.slot / slotColumns),
    },
    residentMip: write.resident.mip,
    residentPageId: write.resident.id,
    updatedFrame: write.frame,
    uploadSerial: write.resident.uploadSerial,
    version,
    virtualPage: write.page,
  };
};

const emptySlot = (slot: number, slotColumns: number): MutableSlot => ({
  loadedFrame: null,
  mip: null,
  pageId: null,
  slot,
  slotX: slot % slotColumns,
  slotY: Math.floor(slot / slotColumns),
  status: "free",
  uploadSerial: null,
  x: null,
  y: null,
  lastUsedFrame: null,
});

const encodePageTableEntry = (
  entry: Pick<VirtualTexturePageTableEntry, "mipDelta" | "physicalSlot">,
  version: number,
): readonly [number, number, number, number] => {
  if (entry.physicalSlot === null) return [0, 0, 0, 0];
  return [
    clampByte(entry.physicalSlot.x),
    clampByte(entry.physicalSlot.y),
    clampByte(entry.mipDelta ?? 0),
    clampByte(((version % 128) << 1) | 1),
  ];
};

const equivalentEntry = (
  a: VirtualTexturePageTableEntry,
  b: VirtualTexturePageTableEntry,
): boolean =>
  a.residentPageId === b.residentPageId &&
  a.residentMip === b.residentMip &&
  a.mipDelta === b.mipDelta &&
  a.physicalSlot?.slot === b.physicalSlot?.slot &&
  a.flags.join("\0") === b.flags.join("\0") &&
  a.uploadSerial === b.uploadSerial;

const evictionScore = (page: VirtualTextureResidentPage): number =>
  page.lastUsedFrame * 10 + page.mip;

const pagesAtMip = (
  virtualSize: readonly [number, number],
  pageSize: number,
  mip: number,
): readonly [number, number] => [
  Math.max(1, Math.ceil(Math.ceil(virtualSize[0] / pageSize) / 2 ** mip)),
  Math.max(1, Math.ceil(Math.ceil(virtualSize[1] / pageSize) / 2 ** mip)),
];

const slotFromPage = (page: VirtualTextureResidentPage, slotColumns: number): MutableSlot => ({
  loadedFrame: page.loadedFrame,
  mip: page.mip,
  pageId: page.id,
  slot: page.slot,
  slotX: page.slot % slotColumns,
  slotY: Math.floor(page.slot / slotColumns),
  status: "resident",
  uploadSerial: page.uploadSerial,
  x: page.x,
  y: page.y,
  lastUsedFrame: page.lastUsedFrame,
});

const validateNonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Virtual texture ${label} must be a non-negative integer`);
  return value;
};

const validatePositiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Virtual texture ${label} must be a positive integer`);
  return value;
};

const validateSlot = (slot: number, physicalSlots: number): number => {
  const normalized = validateNonNegativeInteger(slot, "slot");
  if (normalized >= physicalSlots) throw new Error(`Virtual texture slot ${normalized} exceeds physical slot count ${physicalSlots}`);
  return normalized;
};

const validateVirtualSize = (virtualSize: readonly [number, number]): readonly [number, number] => [
  validatePositiveInteger(virtualSize[0], "virtualSize[0]"),
  validatePositiveInteger(virtualSize[1], "virtualSize[1]"),
];
