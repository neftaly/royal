import type { RendererWebGlContext } from "./gl";
import {
  parseVirtualTextureManifest,
  type VirtualTextureManifest,
  type VirtualTextureManifestFormat,
} from "./virtual-texture-manifest";
import {
  createVirtualTexturePageTableTexture,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageTableMipDimensions,
  type VirtualTexturePageTableMip,
  type VirtualTexturePageTableTexture,
} from "./virtual-texture-page-table-texture";
import {
  type VirtualTexturePageAddress,
  type VirtualTexturePageId,
  VirtualTextureRuntime,
  virtualTexturePageId,
} from "./virtual-texture-runtime";
import {
  planVirtualTextureUploads,
  splitVirtualTextureUploadPlan,
  type VirtualTexturePageTableTexelUpload,
  type VirtualTexturePhysicalAtlasPageUpload,
  type VirtualTextureUploadPlan,
} from "./virtual-texture-upload-plan";

type VirtualTextureResourceGl = Pick<
  RendererWebGlContext,
  | "CLAMP_TO_EDGE"
  | "NEAREST"
  | "RGBA"
  | "RGBA8"
  | "TEXTURE_2D"
  | "TEXTURE_MAG_FILTER"
  | "TEXTURE_MIN_FILTER"
  | "TEXTURE_WRAP_S"
  | "TEXTURE_WRAP_T"
  | "UNSIGNED_BYTE"
  | "bindTexture"
  | "createTexture"
  | "deleteTexture"
  | "texImage2D"
  | "texParameteri"
  | "texSubImage2D"
>;

export type VirtualTexturePhysicalAtlasTexture = {
  readonly height: number;
  readonly paddedPageSize: number;
  readonly slotColumns: number;
  readonly slotRows: number;
  readonly texture: WebGLTexture;
  readonly width: number;
};

export type VirtualTexturePageSourceRequest = {
  readonly borderTexels: number;
  readonly byteLength: number;
  readonly bytesPerTexel: number;
  readonly paddedPageSize: number;
  readonly page: VirtualTexturePageAddress;
  readonly pageId: VirtualTexturePageId;
  readonly pageSize: number;
  readonly virtualSize: readonly [number, number];
};

export type VirtualTexturePageSource = {
  readonly loadPage: (
    request: VirtualTexturePageSourceRequest,
  ) => ArrayBufferView | Promise<ArrayBufferView>;
};

export type VirtualTexturePageSourceInput =
  | VirtualTexturePageSource
  | ((request: VirtualTexturePageSourceRequest) => ArrayBufferView | Promise<ArrayBufferView>);

export type VirtualTextureResourceOptions = {
  readonly pageSource?: VirtualTexturePageSourceInput;
};

export type CreateVirtualTextureResourceOptions = {
  readonly borderTexels?: number;
  readonly bytesPerTexel?: number;
  readonly format?: VirtualTextureManifestFormat;
  readonly id: string;
  readonly mipCount?: number;
  readonly pageSize: number;
  readonly pages?: unknown;
  readonly physicalSlots: number;
  readonly source?: VirtualTexturePageSourceInput;
  readonly virtualSize: readonly [number, number] | { readonly height: number; readonly width: number };
};

export type VirtualTextureUvFootprint = {
  readonly mip: number;
  readonly uMax: number;
  readonly uMin: number;
  readonly vMax: number;
  readonly vMin: number;
};

export type VirtualTexturePageRequestResult = {
  readonly pages: readonly VirtualTexturePageAddress[];
  readonly pending: number;
  readonly ready: number;
  readonly resident: number;
  readonly scheduled: number;
};

export type VirtualTextureFrameUploadOptions = {
  readonly frame?: number;
  readonly pageTableUploads?: number;
  readonly physicalAtlasUploads?: number;
};

export type VirtualTextureFrameUploadResult = {
  readonly bytesUploaded: number;
  readonly frame: number;
  readonly pageTableUploads: number;
  readonly pendingUploadCount: number;
  readonly physicalAtlasUploads: number;
};

export type VirtualTextureTextureBindings = {
  readonly borderTexels: number;
  readonly mipCount: number;
  readonly paddedPageSize: number;
  readonly pageSize: number;
  readonly pageTableMipDimensions: readonly VirtualTexturePageTableMip[];
  readonly pageTableTexture: WebGLTexture;
  readonly physicalAtlasSize: readonly [number, number];
  readonly physicalAtlasTexture: WebGLTexture;
  readonly slotGrid: readonly [number, number];
  readonly virtualSize: readonly [number, number];
};

export type VirtualTextureRequestStats = {
  readonly lastError: string | null;
  readonly pagesFailed: number;
  readonly pagesLoaded: number;
  readonly pagesRequested: number;
  readonly pendingPages: number;
  readonly readyPages: number;
  readonly sourceRequests: number;
};

export type VirtualTextureResidentCacheStats = {
  readonly byMip: Readonly<Record<string, number>>;
  readonly capacity: number;
  readonly freeSlots: number;
  readonly residentPages: number;
  readonly slotColumns: number;
  readonly slotRows: number;
};

export type VirtualTextureMappingStats = {
  readonly dirtyEntriesPending: number;
  readonly exactPages: number;
  readonly fallbackPages: number;
  readonly mappedPages: number;
  readonly residentEntries: number;
  readonly staleResidentReferences: number;
  readonly totalPages: number;
  readonly unmappedPages: number;
  readonly version: number;
};

export type VirtualTextureResourceStats = {
  readonly cache: VirtualTextureResidentCacheStats;
  readonly mappings: VirtualTextureMappingStats;
  readonly pendingUploadCount: number;
  readonly requests: VirtualTextureRequestStats;
  readonly uploads: VirtualTextureResourceUploadStats;
};

export type VirtualTextureResourceFacade = {
  dispose(): void;
  getTextureBindings(): VirtualTextureTextureBindings;
  requestPages(footprint: VirtualTextureUvFootprint, frame?: number): VirtualTexturePageRequestResult;
  stats(): VirtualTextureResourceStats;
  uploadFrame(options?: VirtualTextureFrameUploadOptions): VirtualTextureFrameUploadResult;
  waitForPendingRequests(): Promise<void>;
};

export type VirtualTextureResourceUploadBatch = {
  readonly frame: number;
  readonly plan: VirtualTextureUploadPlan;
};

export type VirtualTextureResourceUploadStats = {
  readonly bytesUploaded: number;
  readonly dirtyBatches: number;
  readonly lastFrame: number | null;
  readonly lastUploadCount: number;
  readonly pageTableBytesUploaded: number;
  readonly pageTableTexelsUploaded: number;
  readonly physicalAtlasBytesUploaded: number;
  readonly physicalAtlasPagesUploaded: number;
};

type MutableUploadStats = {
  bytesUploaded: number;
  dirtyBatches: number;
  lastFrame: number | null;
  lastUploadCount: number;
  pageTableBytesUploaded: number;
  pageTableTexelsUploaded: number;
  physicalAtlasBytesUploaded: number;
  physicalAtlasPagesUploaded: number;
};

type MutableRequestStats = {
  lastError: string | null;
  pagesFailed: number;
  pagesLoaded: number;
  pagesRequested: number;
  sourceRequests: number;
};

type PageSourceLoad = (request: VirtualTexturePageSourceRequest) => ArrayBufferView | Promise<ArrayBufferView>;

type PendingPageLoad = {
  readonly promise: Promise<void>;
};

type ReadyPage = {
  readonly page: VirtualTexturePageAddress;
  readonly pixels: ArrayBufferView;
};

export class VirtualTextureResource {
  readonly #gl: VirtualTextureResourceGl;
  readonly #pageSource: PageSourceLoad | null;
  readonly #requestStats: MutableRequestStats = {
    lastError: null,
    pagesFailed: 0,
    pagesLoaded: 0,
    pagesRequested: 0,
    sourceRequests: 0,
  };
  readonly #stats: MutableUploadStats = {
    bytesUploaded: 0,
    dirtyBatches: 0,
    lastFrame: null,
    lastUploadCount: 0,
    pageTableBytesUploaded: 0,
    pageTableTexelsUploaded: 0,
    physicalAtlasBytesUploaded: 0,
    physicalAtlasPagesUploaded: 0,
  };
  readonly #atlasPixels = new Map<string, ArrayBufferView>();
  readonly #missingResolvedPageIds = new Set<VirtualTexturePageId>();
  readonly #pendingPageLoads = new Map<VirtualTexturePageId, PendingPageLoad>();
  readonly #readyPages = new Map<VirtualTexturePageId, ReadyPage>();
  #disposed = false;
  #pendingUploadPlan: VirtualTextureUploadPlan = emptyVirtualTextureUploadPlan();

  readonly manifest: VirtualTextureManifest;
  readonly pageTable: VirtualTexturePageTableTexture;
  readonly physicalAtlas: VirtualTexturePhysicalAtlasTexture;
  readonly runtime: VirtualTextureRuntime;

  constructor(gl: VirtualTextureResourceGl, manifest: VirtualTextureManifest, options: VirtualTextureResourceOptions = {}) {
    this.#gl = gl;
    this.#pageSource = normalizePageSource(options.pageSource);
    this.manifest = manifest;
    this.runtime = new VirtualTextureRuntime(manifest.runtimeOptions);
    this.pageTable = createVirtualTexturePageTableTexture(
      gl,
      virtualTexturePageTableMipDimensions({
        mipCount: this.runtime.mipCount,
        pageSize: manifest.pageSize,
        virtualSize: manifest.virtualSize,
      }),
    );
    this.physicalAtlas = createVirtualTexturePhysicalAtlasTexture(gl, {
      paddedPageSize: manifest.pageSize + manifest.borderTexels * 2,
      slotColumns: this.runtime.slotColumns,
      slotRows: this.runtime.slotRows,
    });
  }

  get uploadStats(): VirtualTextureResourceUploadStats {
    return { ...this.#stats };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#gl.deleteTexture(this.pageTable.texture);
    this.#gl.deleteTexture(this.physicalAtlas.texture);
    this.#atlasPixels.clear();
    this.#missingResolvedPageIds.clear();
    this.#pendingPageLoads.clear();
    this.#readyPages.clear();
    this.#pendingUploadPlan = emptyVirtualTextureUploadPlan();
    this.#disposed = true;
  }

  drainUploadPlan(frame = 0): VirtualTextureResourceUploadBatch {
    this.#assertLive();
    const dirtyEntries = this.runtime.drainDirtyEntries(frame);
    const plan = planVirtualTextureUploads(dirtyEntries, {
      borderTexels: this.manifest.borderTexels,
      bytesPerTexel: this.manifest.bytesPerTexel,
      pageSize: this.manifest.pageSize,
    });
    this.#stats.dirtyBatches += 1;
    this.#stats.lastFrame = frame;
    this.#stats.lastUploadCount = plan.uploadCount;
    return { frame, plan };
  }

  getTextureBindings(): VirtualTextureTextureBindings {
    this.#assertLive();
    return {
      borderTexels: this.manifest.borderTexels,
      mipCount: this.runtime.mipCount,
      paddedPageSize: this.physicalAtlas.paddedPageSize,
      pageSize: this.manifest.pageSize,
      pageTableMipDimensions: this.pageTable.mipDimensions,
      pageTableTexture: this.pageTable.texture,
      physicalAtlasSize: [this.physicalAtlas.width, this.physicalAtlas.height],
      physicalAtlasTexture: this.physicalAtlas.texture,
      slotGrid: [this.physicalAtlas.slotColumns, this.physicalAtlas.slotRows],
      virtualSize: this.manifest.virtualSize,
    };
  }

  makeResident(page: VirtualTexturePageAddress, frame = 0): ReturnType<VirtualTextureRuntime["makeResident"]> {
    this.#assertLive();
    return this.runtime.makeResident(page, frame);
  }

  requestPages(footprint: VirtualTextureUvFootprint, frame = 0): VirtualTexturePageRequestResult {
    this.#assertLive();
    if (this.#pageSource === null) {
      throw new Error("Virtual texture resource requestPages requires a page source");
    }

    const pages = virtualTexturePagesForUvFootprint(this.manifest, footprint);
    let pending = 0;
    let ready = 0;
    let resident = 0;
    let scheduled = 0;
    const hasResidentPages = this.runtime.hasResidentPages();
    this.#requestStats.pagesRequested += pages.length;

    for (const page of pages) {
      const id = virtualTexturePageId(page);
      if (this.runtime.lookupResidentPage(page) !== null) {
        this.runtime.resolve(page, frame);
        resident += 1;
        continue;
      }

      const pendingLoad = this.#pendingPageLoads.has(id);
      const readyPage = this.#readyPages.has(id);
      if (pendingLoad) pending += 1;
      if (readyPage) ready += 1;

      if (!pendingLoad && !readyPage) {
        this.#schedulePageLoad(page);
        scheduled += 1;
      }

      if (hasResidentPages && !this.#missingResolvedPageIds.has(id)) {
        const resolved = this.runtime.resolve(page, frame);
        if (resolved.kind === "missing") this.#missingResolvedPageIds.add(id);
      }
    }

    return {
      pages,
      pending,
      ready,
      resident,
      scheduled,
    };
  }

  resolve(page: VirtualTexturePageAddress, frame = 0): ReturnType<VirtualTextureRuntime["resolve"]> {
    this.#assertLive();
    return this.runtime.resolve(page, frame);
  }

  stats(): VirtualTextureResourceStats {
    this.#assertLive();
    const runtimeStats = this.runtime.stats();
    return {
      cache: runtimeStats.cache,
      mappings: {
        dirtyEntriesPending: runtimeStats.dirtyEntriesPending,
        exactPages: runtimeStats.pageTable.exact,
        fallbackPages: runtimeStats.pageTable.fallback,
        mappedPages: runtimeStats.pageTable.mapped,
        residentEntries: runtimeStats.pageTable.resident,
        staleResidentReferences: runtimeStats.pageTable.staleResidentReferences,
        totalPages: runtimeStats.pageTable.totalVirtualPages,
        unmappedPages: runtimeStats.pageTable.unmapped,
        version: runtimeStats.version,
      },
      pendingUploadCount: this.#pendingUploadPlan.uploadCount,
      requests: {
        ...this.#requestStats,
        pendingPages: this.#pendingPageLoads.size,
        readyPages: this.#readyPages.size,
      },
      uploads: this.uploadStats,
    };
  }

  uploadFrame(options: VirtualTextureFrameUploadOptions = {}): VirtualTextureFrameUploadResult {
    this.#assertLive();
    const frame = options.frame ?? 0;
    const budget = {
      pageTableUploads: validateUploadBudget(options.pageTableUploads ?? Number.MAX_SAFE_INTEGER, "pageTableUploads"),
      physicalAtlasUploads: validateUploadBudget(
        options.physicalAtlasUploads ?? Number.MAX_SAFE_INTEGER,
        "physicalAtlasUploads",
      ),
    };
    const bytesBefore = this.#stats.bytesUploaded;
    this.#promoteReadyPages(frame, Math.max(0, budget.physicalAtlasUploads - this.#pendingUploadPlan.physicalAtlasUploads.length));
    this.#pendingUploadPlan = this.#currentUploadPlan(
      appendVirtualTextureUploadPlans(this.#pendingUploadPlan, this.drainUploadPlan(frame).plan),
    );

    const split = splitVirtualTextureUploadPlan(this.#pendingUploadPlan, budget);
    const physicalAtlasUploads = this.#currentPhysicalAtlasUploads(split.slice.physicalAtlasUploads);
    for (const upload of physicalAtlasUploads) {
      const pixels = this.#atlasPixels.get(atlasPixelsKey(upload.residentPageId, upload.uploadSerial));
      if (pixels === undefined) {
        throw new Error(`Virtual texture physical atlas upload for ${upload.residentPageId} has no staged page pixels`);
      }
      this.uploadPhysicalAtlasPage(upload, pixels);
      this.#atlasPixels.delete(atlasPixelsKey(upload.residentPageId, upload.uploadSerial));
    }

    const pageTableUploads = this.#currentPageTableUploads(split.slice.pageTableUploads);
    this.uploadPageTable(createVirtualTextureUploadPlan(pageTableUploads, []));

    this.#pendingUploadPlan = this.#currentUploadPlan(split.remainder);

    return {
      bytesUploaded: this.#stats.bytesUploaded - bytesBefore,
      frame,
      pageTableUploads: pageTableUploads.length,
      pendingUploadCount: this.#pendingUploadPlan.uploadCount,
      physicalAtlasUploads: physicalAtlasUploads.length,
    };
  }

  uploadPageTable(plan: VirtualTextureUploadPlan): void {
    this.#assertLive();
    const result = uploadVirtualTexturePageTableTexels(this.#gl, this.pageTable, plan.pageTableUploads);
    this.#stats.bytesUploaded += result.bytesUploaded;
    this.#stats.pageTableBytesUploaded += result.bytesUploaded;
    this.#stats.pageTableTexelsUploaded += result.texelsUploaded;
  }

  uploadPhysicalAtlasPage(upload: VirtualTexturePhysicalAtlasPageUpload, pixels: ArrayBufferView): void {
    this.#assertLive();
    if (pixels.byteLength !== upload.byteLength) {
      throw new Error(
        `Virtual texture physical atlas upload for ${upload.residentPageId} expected ${upload.byteLength} bytes, got ${pixels.byteLength}`,
      );
    }

    this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.physicalAtlas.texture);
    this.#gl.texSubImage2D(
      this.#gl.TEXTURE_2D,
      upload.level,
      upload.xOffset,
      upload.yOffset,
      upload.width,
      upload.height,
      this.#gl.RGBA,
      this.#gl.UNSIGNED_BYTE,
      pixels,
    );
    this.#stats.bytesUploaded += pixels.byteLength;
    this.#stats.physicalAtlasBytesUploaded += pixels.byteLength;
    this.#stats.physicalAtlasPagesUploaded += 1;
  }

  async waitForPendingRequests(): Promise<void> {
    this.#assertLive();
    await Promise.all([...this.#pendingPageLoads.values()].map((load) => load.promise));
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Virtual texture resource has been disposed");
  }

  #currentPageTableUploads(
    uploads: readonly VirtualTexturePageTableTexelUpload[],
  ): readonly VirtualTexturePageTableTexelUpload[] {
    return uploads.filter((upload) => {
      const entry = this.runtime.lookupPageTableEntry(upload.tableCoord);
      if (entry === null) return upload.residentPageId === null;
      return entry.residentPageId === upload.residentPageId && entry.uploadSerial === upload.uploadSerial;
    });
  }

  #currentPhysicalAtlasUploads(
    uploads: readonly VirtualTexturePhysicalAtlasPageUpload[],
  ): readonly VirtualTexturePhysicalAtlasPageUpload[] {
    return uploads.filter((upload) => {
      const resident = this.runtime.lookupResidentPage(upload.residentPageId);
      if (resident === null) return false;
      return resident.slot === upload.slot.slot && resident.uploadSerial === upload.uploadSerial;
    });
  }

  #currentUploadPlan(plan: VirtualTextureUploadPlan): VirtualTextureUploadPlan {
    return createVirtualTextureUploadPlan(
      this.#currentPageTableUploads(plan.pageTableUploads),
      this.#currentPhysicalAtlasUploads(plan.physicalAtlasUploads),
    );
  }

  #promoteReadyPages(frame: number, maxPages: number): void {
    let promoted = 0;
    for (const [id, ready] of this.#readyPages) {
      if (promoted >= maxPages) break;
      this.#readyPages.delete(id);
      const resident = this.runtime.makeResident(ready.page, frame).page;
      this.#atlasPixels.set(atlasPixelsKey(resident.id, resident.uploadSerial), ready.pixels);
      this.#missingResolvedPageIds.clear();
      promoted += 1;
    }
  }

  #schedulePageLoad(page: VirtualTexturePageAddress): void {
    if (this.#pageSource === null) return;
    const request = createPageSourceRequest(this.manifest, page);
    this.#requestStats.sourceRequests += 1;
    const promise = Promise.resolve()
      .then(() => this.#pageSource!(request))
      .then((pixels) => {
        if (this.#disposed) return;
        const validated = validatePageSourcePixels(request, pixels);
        this.#pendingPageLoads.delete(request.pageId);
        this.#readyPages.set(request.pageId, { page: request.page, pixels: validated });
        this.#requestStats.pagesLoaded += 1;
      })
      .catch((error: unknown) => {
        if (this.#disposed) return;
        this.#pendingPageLoads.delete(request.pageId);
        this.#requestStats.lastError = error instanceof Error ? error.message : String(error);
        this.#requestStats.pagesFailed += 1;
      });

    this.#pendingPageLoads.set(request.pageId, { promise });
  }
}

export const createVirtualTextureResource = (
  gl: VirtualTextureResourceGl,
  options: CreateVirtualTextureResourceOptions,
): VirtualTextureResourceFacade => {
  const { source, ...manifestInput } = options;
  return new VirtualTextureResource(
    gl,
    parseVirtualTextureManifest(manifestInput),
    source === undefined ? {} : { pageSource: source },
  );
};

const createVirtualTexturePhysicalAtlasTexture = (
  gl: VirtualTextureResourceGl,
  options: {
    readonly paddedPageSize: number;
    readonly slotColumns: number;
    readonly slotRows: number;
  },
): VirtualTexturePhysicalAtlasTexture => {
  const width = options.slotColumns * options.paddedPageSize;
  const height = options.slotRows * options.paddedPageSize;
  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create virtual texture physical atlas texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    height,
    paddedPageSize: options.paddedPageSize,
    slotColumns: options.slotColumns,
    slotRows: options.slotRows,
    texture,
    width,
  };
};

const appendVirtualTextureUploadPlans = (
  left: VirtualTextureUploadPlan,
  right: VirtualTextureUploadPlan,
): VirtualTextureUploadPlan => createVirtualTextureUploadPlan(
  [...left.pageTableUploads, ...right.pageTableUploads],
  [...left.physicalAtlasUploads, ...right.physicalAtlasUploads],
);

const atlasPixelsKey = (pageId: VirtualTexturePageId, uploadSerial: number): string => `${pageId}:${uploadSerial}`;

const createPageSourceRequest = (
  manifest: VirtualTextureManifest,
  page: VirtualTexturePageAddress,
): VirtualTexturePageSourceRequest => {
  const paddedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  const normalized = { mip: page.mip, x: page.x, y: page.y };
  return {
    borderTexels: manifest.borderTexels,
    byteLength: paddedPageSize * paddedPageSize * manifest.bytesPerTexel,
    bytesPerTexel: manifest.bytesPerTexel,
    paddedPageSize,
    page: normalized,
    pageId: virtualTexturePageId(normalized),
    pageSize: manifest.pageSize,
    virtualSize: manifest.virtualSize,
  };
};

const createVirtualTextureUploadPlan = (
  pageTableUploads: VirtualTextureUploadPlan["pageTableUploads"],
  physicalAtlasUploads: VirtualTextureUploadPlan["physicalAtlasUploads"],
): VirtualTextureUploadPlan => ({
  pageTableUploads,
  physicalAtlasUploads,
  uploadCount: pageTableUploads.length + physicalAtlasUploads.length,
});

const emptyVirtualTextureUploadPlan = (): VirtualTextureUploadPlan => createVirtualTextureUploadPlan([], []);

const normalizePageSource = (source: VirtualTexturePageSourceInput | undefined): PageSourceLoad | null => {
  if (source === undefined) return null;
  if (typeof source === "function") return source;
  return (request) => source.loadPage(request);
};

const validateFiniteNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new Error(`Virtual texture ${label} must be a finite number`);
  return value;
};

const validateNonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Virtual texture ${label} must be a non-negative integer`);
  return value;
};

const validatePageSourcePixels = (
  request: VirtualTexturePageSourceRequest,
  pixels: unknown,
): ArrayBufferView => {
  if (!ArrayBuffer.isView(pixels)) {
    throw new Error(`Virtual texture page source for ${request.pageId} must return an ArrayBufferView`);
  }
  if (pixels.byteLength !== request.byteLength) {
    throw new Error(
      `Virtual texture page source for ${request.pageId} expected ${request.byteLength} bytes, got ${pixels.byteLength}`,
    );
  }
  return pixels;
};

const validateUploadBudget = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Virtual texture resource ${label} budget must be a non-negative integer`);
  }
  return value;
};

const virtualPageGridAtMip = (
  virtualSize: readonly [number, number],
  pageSize: number,
  mip: number,
): readonly [number, number] => [
  Math.max(1, Math.ceil(Math.ceil(virtualSize[0] / pageSize) / 2 ** mip)),
  Math.max(1, Math.ceil(Math.ceil(virtualSize[1] / pageSize) / 2 ** mip)),
];

const virtualTexturePagesForUvFootprint = (
  manifest: VirtualTextureManifest,
  footprint: VirtualTextureUvFootprint,
): readonly VirtualTexturePageAddress[] => {
  const mip = validateNonNegativeInteger(footprint.mip, "footprint.mip");
  if (mip >= manifest.mipCount) throw new Error(`Virtual texture footprint mip ${mip} exceeds mip count ${manifest.mipCount}`);

  const uMin = validateFiniteNumber(footprint.uMin, "footprint.uMin");
  const uMax = validateFiniteNumber(footprint.uMax, "footprint.uMax");
  const vMin = validateFiniteNumber(footprint.vMin, "footprint.vMin");
  const vMax = validateFiniteNumber(footprint.vMax, "footprint.vMax");
  if (uMax <= uMin || vMax <= vMin) return [];

  const minU = Math.min(1, Math.max(0, uMin));
  const maxU = Math.min(1, Math.max(0, uMax));
  const minV = Math.min(1, Math.max(0, vMin));
  const maxV = Math.min(1, Math.max(0, vMax));
  if (maxU <= minU || maxV <= minV) return [];

  const [columns, rows] = virtualPageGridAtMip(manifest.virtualSize, manifest.pageSize, mip);
  const xStart = Math.min(columns - 1, Math.max(0, Math.floor(minU * columns)));
  const xEnd = Math.min(columns - 1, Math.max(0, Math.ceil(maxU * columns) - 1));
  const yStart = Math.min(rows - 1, Math.max(0, Math.floor(minV * rows)));
  const yEnd = Math.min(rows - 1, Math.max(0, Math.ceil(maxV * rows) - 1));
  const pages: VirtualTexturePageAddress[] = [];
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      pages.push({ mip, x, y });
    }
  }
  return pages;
};
